import OpenAI from "openai";
import { IsNull } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Listing } from "../entity/Listing";
import { ListingIntake } from "../entity/ListingIntake";
import { AIMessageSuggestionEntity } from "../entity/AIMessageSuggestion";
import { AIMessageFeedbackEntity } from "../entity/AIMessageFeedback";
import { InboxService } from "./InboxService";
import { ListingKnowledgeService } from "./ListingKnowledgeService";
import { ListingKnowledgeSeeder } from "./ListingKnowledgeSeeder";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";
import { AIMessagingSettingsEntity } from "../entity/AIMessagingSettings";
import { AILearnedFactsService } from "./AILearnedFactsService";
import { ListingGroupService } from "./ListingGroupService";
import { ExemplarService } from "./ExemplarService";
import { RetrievalService } from "./RetrievalService";
import { Hostify } from "../client/Hostify";

/**
 * InboxAIService
 * Generates and persists AI reply *suggestions* for the v2 inbox.
 *
 * Hard rules:
 *  - SUGGESTION ONLY. This service never sends a message to a guest. Delivery is
 *    always an explicit human action via InboxService.sendReply.
 *  - Every suggestion is persisted (ai_message_suggestions) for comparison/learning.
 *  - The model must never invent facts; missing info is surfaced as warnings and a
 *    safe clarifying reply is preferred.
 *  - A server-side keyword safety net force-escalates sensitive topics regardless
 *    of model output (refunds, legal, safety, etc.).
 *
 * Gated by AI_MESSAGING_ENABLED (see isEnabled()).
 *
 * Auto-send (the "response bot") is implemented in maybeAutoRespond() and gated
 * separately by AI_MESSAGING_AUTOSEND_ENABLED (default OFF). It only delivers a
 * reply when strict guardrails pass (no escalation, no missing-info warnings,
 * confidence >= AI_MESSAGING_AUTOSEND_MIN_CONFIDENCE); otherwise the suggestion
 * is left for a human. Even when enabled, sensitive topics always route to a
 * human via the escalation keyword safety net.
 */

export const INBOX_AI_PROMPT_VERSION = "inbox-ai-v2";
const INBOX_AI_MODEL = process.env.AI_MESSAGING_MODEL || "gpt-4.1";

/** Topics that must always route to a human, regardless of model confidence. */
const ESCALATION_KEYWORDS: { pattern: RegExp; reason: string }[] = [
    { pattern: /\brefund(s|ed|ing)?\b/i, reason: "Refund request" },
    { pattern: /\b(discount|comp|credit|reimburse)\b/i, reason: "Discount/credit request" },
    { pattern: /\b(lawyer|legal|sue|lawsuit|attorney|liabilit)/i, reason: "Legal issue" },
    { pattern: /\b(threat|kill|hurt|weapon|gun)\b/i, reason: "Threat" },
    { pattern: /\b(emergency|fire|flood|gas leak|carbon monoxide|injur|bleed|ambulance|police|911)\b/i, reason: "Safety/emergency" },
    { pattern: /\b(discriminat|racis|fair housing|disability|service animal denied)/i, reason: "Discrimination / fair-housing sensitive" },
    { pattern: /\b(damage|broke|broken|destroyed)\b/i, reason: "Possible damage claim" },
    { pattern: /\b(deposit|security deposit)\b/i, reason: "Security deposit" },
    { pattern: /\b(cancel|cancellation|cancelling)\b/i, reason: "Cancellation / penalty" },
    { pattern: /\b(chargeback|dispute|bad review|1 star|one star|report you)\b/i, reason: "Angry guest / review risk" },
];

interface GenerateOptions {
    /** externalId of the inbound message to respond to. Defaults to latest inbound. */
    messageId?: number | null;
    /** Force a fresh generation even if a recent suggestion exists. */
    force?: boolean;
    /**
     * Staff instruction for what the reply should say (composer "Generate") or
     * how to revise it ("Refine"). Always bypasses the suggestion cache.
     */
    instructions?: string | null;
    /** The current draft to revise when refining. Only meaningful with instructions. */
    baseDraft?: string | null;
}

interface ModelOutput {
    suggested_reply: string;
    confidence: number; // 0..1
    escalation_required: boolean;
    escalation_reason: string | null;
    internal_summary: string | null;
    sources_used: string[];
    warnings: string[];
    suggested_action_items: string[];
    /** Optional: a short question to ask staff to learn a missing reusable fact. */
    learning_question?: string | null;
    /** Optional: short topic slug for the learning question, e.g. "parking". */
    learning_topic?: string | null;
}

export class InboxAIService {
    private conversationRepo = appDatabase.getRepository(InboxConversationEntity);
    private messageRepo = appDatabase.getRepository(InboxMessageEntity);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private suggestionRepo = appDatabase.getRepository(AIMessageSuggestionEntity);
    private feedbackRepo = appDatabase.getRepository(AIMessageFeedbackEntity);
    private hostify = new Hostify();

    private get hostifyApiKey(): string {
        return process.env.HOSTIFY_API_KEY as string;
    }

    /** Feature flag. Defaults OFF unless explicitly enabled. */
    static isEnabled(): boolean {
        return String(process.env.AI_MESSAGING_ENABLED || "").toLowerCase() === "true";
    }

    /**
     * Auto-send (response bot) flag. Requires BOTH the base assistant and the
     * auto-send flag to be on. Defaults OFF — no message is ever auto-sent
     * unless this is explicitly enabled.
     */
    static isAutosendEnabled(): boolean {
        return (
            InboxAIService.isEnabled() &&
            String(process.env.AI_MESSAGING_AUTOSEND_ENABLED || "").toLowerCase() === "true"
        );
    }

    /** Minimum model confidence (0..100) required to auto-send. Default 85. */
    static autosendMinConfidence(): number {
        const v = Number(process.env.AI_MESSAGING_AUTOSEND_MIN_CONFIDENCE);
        return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 85;
    }

    /** Optional channel allowlist for auto-send (CSV env), else null = all. */
    static autosendAllowedChannels(): string[] | null {
        const raw = (process.env.AI_MESSAGING_AUTOSEND_CHANNELS || "").trim();
        if (!raw) return null;
        return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    }

    /** Public config snapshot for the UI / settings surface (env-only, sync). */
    static autosendConfig() {
        return {
            enabled: InboxAIService.isAutosendEnabled(),
            minConfidence: InboxAIService.autosendMinConfidence(),
            allowedChannels: InboxAIService.autosendAllowedChannels(),
        };
    }

    /**
     * DB-aware auto-send resolution. The AI Copilot Settings page controls the
     * auto-respond toggle / min-confidence / channel allowlist. Env remains a
     * hard override: the base assistant must be enabled, and an explicit
     * AI_MESSAGING_AUTOSEND_ENABLED=false keeps auto-send OFF regardless.
     */
    static async resolveAutosendEnabled(): Promise<boolean> {
        if (!InboxAIService.isEnabled()) return false;
        const envRaw = String(process.env.AI_MESSAGING_AUTOSEND_ENABLED || "").toLowerCase();
        if (envRaw === "false") return false; // hard kill-switch
        try {
            const s = await new AIMessagingSettingsService().getGlobalCached();
            return Boolean(s.autoRespondEnabled);
        } catch {
            return envRaw === "true";
        }
    }

    static async autosendMinConfidenceAsync(): Promise<number> {
        try {
            const s = await new AIMessagingSettingsService().getGlobalCached();
            const v = Number(s.autosendMinConfidence);
            return Number.isFinite(v) && v >= 0 && v <= 100 ? v : InboxAIService.autosendMinConfidence();
        } catch {
            return InboxAIService.autosendMinConfidence();
        }
    }

    static async autosendAllowedChannelsAsync(): Promise<string[] | null> {
        try {
            const s = await new AIMessagingSettingsService().getGlobalCached();
            const raw = (s.autosendChannels || "").trim();
            if (!raw) return InboxAIService.autosendAllowedChannels();
            return raw.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
        } catch {
            return InboxAIService.autosendAllowedChannels();
        }
    }

    /** DB-aware config snapshot for the UI / settings surface. */
    static async autosendConfigAsync() {
        return {
            enabled: await InboxAIService.resolveAutosendEnabled(),
            minConfidence: await InboxAIService.autosendMinConfidenceAsync(),
            allowedChannels: await InboxAIService.autosendAllowedChannelsAsync(),
        };
    }

    private getClient(): OpenAI {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
        return new OpenAI({ apiKey });
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /** Latest persisted suggestion for a thread (optionally for a specific message). */
    async getLatestSuggestion(threadId: number, messageId?: number | null) {
        const where: any = { threadId };
        if (messageId != null) where.messageId = messageId;
        return this.suggestionRepo.findOne({ where, order: { generatedAt: "DESC", id: "DESC" } });
    }

    async listSuggestionsForThread(threadId: number) {
        return this.suggestionRepo.find({ where: { threadId }, order: { generatedAt: "DESC", id: "DESC" } });
    }

    /**
     * Generate (or return a cached) suggestion for the latest unanswered guest
     * message in a thread. Always persists. Returns the suggestion entity.
     */
    async generateSuggestion(threadId: number, options: GenerateOptions = {}) {
        const conversation = await this.conversationRepo.findOne({ where: { threadId } });
        if (!conversation) throw new Error(`Conversation ${threadId} not found`);

        const messages = await this.messageRepo.find({
            where: { threadId },
            order: { sentAt: "ASC", id: "ASC" },
        });

        // Target message = explicit messageId, else the most recent inbound (guest) message.
        const inbound = messages.filter((m) => m.direction === "incoming");
        const targetMessage =
            options.messageId != null
                ? messages.find((m) => Number(m.externalId) === Number(options.messageId)) || null
                : inbound.length
                ? inbound[inbound.length - 1]
                : null;
        const targetMessageId = targetMessage ? Number(targetMessage.externalId) : null;

        const instructions = (options.instructions || "").trim() || null;
        const baseDraft = instructions ? (options.baseDraft || "").trim() || null : null;

        // Cache: reuse the last suggestion for this target unless force=true.
        // Staff-steered generations (instructions present) always run fresh —
        // returning a cached suggestion here is why Refine/Generate appeared to
        // "not follow instructions at all".
        if (!options.force && !instructions) {
            const existing = await this.getLatestSuggestion(threadId, targetMessageId);
            if (existing) return existing;
        }

        // Self-heal listing knowledge: if this conversation is on a listing we've
        // never seeded (e.g. a new reservation arriving on a fresh Hostify child
        // ID), pull its Knowledge Base from Hostify on the spot so THIS reply is
        // grounded. Bounded + fully guarded so it can never block or break the
        // suggestion. Seeded entries are picked up by the keyword KB path even
        // before they're embedded; embedding (for RAG ranking) is best-effort.
        if (conversation.listingId) {
            try {
                const seeder = new ListingKnowledgeSeeder();
                const created = await Promise.race([
                    seeder.ensureListingSeeded(conversation.listingId),
                    new Promise<number>((resolve) => setTimeout(() => resolve(0), 15000)),
                ]);
                if (created > 0) await new RetrievalService().embedKnowledge().catch(() => 0);
            } catch {
                /* non-fatal — never block a suggestion on seeding */
            }
        }

        const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);
        const context = await this.buildContext(conversation, messages, targetMessage, {
            instructions,
            baseDraft,
        });
        const keywordEscalation = this.scanForEscalation(targetMessage?.body || conversation.lastMessageText || "");

        let output: ModelOutput;
        let raw = "";
        try {
            const client = this.getClient();
            const completion = await client.chat.completions.create({
                model: INBOX_AI_MODEL,
                temperature: 0.4,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content: this.systemPrompt(settings, {
                            airbnbSupport: this.isAirbnbSupportThread(conversation, messages),
                        }),
                    },
                    { role: "user", content: context },
                ],
            });
            raw = completion.choices[0]?.message?.content?.trim() || "";
            output = this.parseModelOutput(raw);
        } catch (err: any) {
            logger.error(`[InboxAIService] generation failed (thread ${threadId}): ${err.message}`);
            throw err;
        }

        // Server-side guardrail: force escalation on sensitive keywords.
        if (keywordEscalation) {
            output.escalation_required = true;
            output.escalation_reason = output.escalation_reason
                ? `${output.escalation_reason}; ${keywordEscalation}`
                : keywordEscalation;
        }

        // ---- Post-generation safety calibration ----
        // The model's self-reported confidence is optimistic; we harden it here so
        // it can be trusted as an auto-send gate and so humans see honest signals.
        const warnings: string[] = Array.isArray(output.warnings) ? [...output.warnings] : [];

        // (a) No pending guest question: the latest message in the thread is ours
        //     (or there is no inbound message at all). Drafting is fine, but this
        //     should never auto-send and confidence should be low.
        const lastMsg = messages.length ? messages[messages.length - 1] : null;
        const noPendingQuestion = !targetMessage || (lastMsg != null && lastMsg.direction !== "incoming");
        // When staff explicitly steered this draft (Generate/Refine), a proactive
        // message is intentional — don't flag it or crush its confidence.
        if (noPendingQuestion && !instructions) {
            warnings.push("No pending guest question — the guest has not sent a new message since our last reply.");
        }

        // (b) Anti-invention net: flag codes/prices in the reply that do not appear
        //     verbatim anywhere in the provided context (history + listing block).
        const contextHaystack = (context + " " + messages.map((m) => m.body || "").join(" ")).toLowerCase();
        const reply = output.suggested_reply || "";
        const leaks: string[] = [];
        for (const tok of reply.match(/\b\d{4,8}#?/g) || []) {
            const digits = tok.replace(/\D/g, "");
            if (digits && !contextHaystack.includes(digits)) leaks.push(tok);
        }
        for (const tok of reply.match(/[$€£]\s?\d[\d,]*(?:\.\d+)?/g) || []) {
            const num = tok.replace(/[^\d.]/g, "");
            if (num && !contextHaystack.includes(num)) leaks.push(tok);
        }
        if (leaks.length) {
            warnings.push(
                `Reply may contain unverified value(s) not found in context: ${leaks.join(", ")}. Verify before sending.`
            );
        }
        output.warnings = warnings;

        // (c) Calibrate confidence down when the reply is risky or under-informed.
        let confidencePct =
            typeof output.confidence === "number" && Number.isFinite(output.confidence)
                ? Math.max(0, Math.min(100, Math.round(output.confidence * 100)))
                : null;
        if (confidencePct != null) {
            if (leaks.length) confidencePct = Math.min(confidencePct, 30);
            if (output.escalation_required) confidencePct = Math.min(confidencePct, 45);
            else if (warnings.length) confidencePct = Math.min(confidencePct, 60);
            if (noPendingQuestion && !instructions) confidencePct = Math.min(confidencePct, 30);
        }

        const suggestion = this.suggestionRepo.create({
            threadId,
            messageId: targetMessageId,
            reservationId: conversation.reservationId,
            listingId: conversation.listingId,
            suggestedReply: output.suggested_reply || null,
            confidence: confidencePct,
            escalationRequired: output.escalation_required ? 1 : 0,
            escalationReason: output.escalation_reason ? String(output.escalation_reason).slice(0, 500) : null,
            internalSummary: output.internal_summary || null,
            sourcesUsed: JSON.stringify(output.sources_used || []),
            warnings: JSON.stringify(output.warnings || []),
            suggestedActionItems: JSON.stringify(output.suggested_action_items || []),
            modelName: INBOX_AI_MODEL,
            promptVersion: INBOX_AI_PROMPT_VERSION,
            status: "suggested",
            rawResponse: raw.slice(0, 60000) || null,
            generatedAt: new Date(),
        });
        const saved = await this.suggestionRepo.save(suggestion);
        logger.info(
            `[InboxAIService] suggestion ${saved.id} generated for thread ${threadId} ` +
            `(conf ${confidencePct ?? "?"}, escalate ${saved.escalationRequired})`
        );

        // If the model flagged a reusable knowledge gap, raise a learning prompt
        // for staff on this conversation. Best-effort; never blocks the suggestion.
        if (output.learning_question && String(output.learning_question).trim()) {
            try {
                const { AILearningPromptService } = await import("./AILearningPromptService");
                await new AILearningPromptService().raise({
                    threadId,
                    listingId: conversation.listingId ?? null,
                    listingName: conversation.listingName ?? null,
                    question: String(output.learning_question),
                    topic: output.learning_topic ? String(output.learning_topic) : null,
                    sampleSuggestionId: saved.id,
                });
            } catch (e: any) {
                logger.warn(`[InboxAIService] learning prompt raise failed: ${e.message}`);
            }
        }
        return saved;
    }

    /**
     * Dry-run preview: generate a suggestion for a hypothetical guest message on a
     * given listing WITHOUT a real thread and WITHOUT persisting. Runs the exact
     * retrieval (KB + learned facts + availability) and system prompt used in
     * production, so it faithfully reflects what the bot would say. Used by the QA
     * / eval harness and by any "test this listing" preview surface.
     */
    async previewSuggestion(
        listingId: number,
        guestMessage: string,
        opts: { grounded?: boolean } = {}
    ): Promise<{ output: ModelOutput; context: string; leaks: string[] }> {
        const listing = await this.listingRepo
            .findOne({ where: { id: Number(listingId) }, withDeleted: true })
            .catch(() => null);
        const conversation = this.conversationRepo.create({
            threadId: 0,
            listingId: Number(listingId),
            listingName: (listing as any)?.name || null,
            channel: "preview",
        }) as InboxConversationEntity;
        const msg = this.messageRepo.create({
            threadId: 0,
            direction: "incoming",
            body: guestMessage,
            senderName: "Guest",
            sentAt: new Date(),
        }) as InboxMessageEntity;

        const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);
        // grounded=false simulates the pre-knowledge bot (no KB / learned facts /
        // availability) for A/B comparison against the team's real replies.
        const context = await this.buildContext(conversation, [msg], msg, {
            includeKnowledge: opts.grounded !== false,
        });
        const client = this.getClient();
        const completion = await client.chat.completions.create({
            model: INBOX_AI_MODEL,
            temperature: 0.4,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: this.systemPrompt(settings) },
                { role: "user", content: context },
            ],
        });
        const raw = completion.choices[0]?.message?.content?.trim() || "";
        const output = this.parseModelOutput(raw);

        // Same anti-invention net used in production, surfaced for the eval.
        const haystack = (context + " " + guestMessage).toLowerCase();
        const reply = output.suggested_reply || "";
        const leaks: string[] = [];
        for (const tok of reply.match(/\b\d{4,8}#?/g) || []) {
            const digits = tok.replace(/\D/g, "");
            if (digits && !haystack.includes(digits)) leaks.push(tok);
        }
        for (const tok of reply.match(/[$€£]\s?\d[\d,]*(?:\.\d+)?/g) || []) {
            const num = tok.replace(/[^\d.]/g, "");
            if (num && !haystack.includes(num)) leaks.push(tok);
        }
        return { output, context, leaks };
    }

    /**
     * Guest Simulator: generate a reply for a multi-turn hypothetical conversation
     * on a given listing WITHOUT a real thread and WITHOUT persisting. Uses the
     * exact production retrieval (KB + learned facts + availability), system
     * prompt, escalation net and anti-invention net, so it faithfully mirrors what
     * the bot would say. Powers the "act as a guest" training page.
     */
    async sandboxReply(
        listingId: number,
        turns: { role: "guest" | "host"; text: string }[],
        opts: {
            /** Simulated reservation phase: inquiry | accepted | cancelled. */
            reservationStatus?: string | null;
        } = {}
    ): Promise<{
        reply: string;
        confidence: number | null;
        escalationRequired: boolean;
        escalationReason: string | null;
        warnings: string[];
        sourcesUsed: string[];
        suggestedActionItems: string[];
        internalSummary: string | null;
    }> {
        const listing = await this.listingRepo
            .findOne({ where: { id: Number(listingId) }, withDeleted: true })
            .catch(() => null);

        const conversation = this.conversationRepo.create({
            threadId: 0,
            listingId: Number(listingId),
            listingName: (listing as any)?.internalListingName || (listing as any)?.name || null,
            channel: "simulator",
            guestName: "Guest (simulated)",
            // Simulated phase flows into buildContext as "Reservation status: …"
            // so the bot answers as it would for an inquiry / confirmed booking /
            // cancelled reservation. Descriptive strings (prompt-only; this
            // conversation is never persisted) steer the model more reliably
            // than a bare status word.
            reservationStatus:
                opts.reservationStatus === "inquiry"
                    ? "inquiry — the guest has NOT booked yet; this is a pre-booking question. Answer helpfully and encourage them to book, but never imply they have a confirmed reservation."
                    : opts.reservationStatus === "accepted"
                    ? "accepted — confirmed upcoming/active reservation."
                    : opts.reservationStatus === "cancelled"
                    ? "cancelled — this reservation was cancelled. Do not treat it as an upcoming stay; do not share check-in details or access info."
                    : null,
        }) as InboxConversationEntity;

        const base = Date.now();
        const cleaned = (turns || []).filter(
            (t) => t && typeof t.text === "string" && t.text.trim()
        );
        const messages = cleaned.map(
            (t, i) =>
                this.messageRepo.create({
                    threadId: 0,
                    direction: t.role === "host" ? "outgoing" : "incoming",
                    body: t.text.trim(),
                    senderName: t.role === "host" ? "Host" : "Guest",
                    sentAt: new Date(base + i * 1000),
                }) as InboxMessageEntity
        );

        // Target = the most recent guest (incoming) turn.
        let target: InboxMessageEntity | null = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].direction === "incoming") {
                target = messages[i];
                break;
            }
        }
        if (!target) throw new Error("At least one guest message is required");

        const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);
        const context = await this.buildContext(conversation, messages, target, {
            includeKnowledge: true,
        });

        const client = this.getClient();
        const completion = await client.chat.completions.create({
            model: INBOX_AI_MODEL,
            temperature: 0.4,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: this.systemPrompt(settings) },
                { role: "user", content: context },
            ],
        });
        const raw = completion.choices[0]?.message?.content?.trim() || "";
        const output = this.parseModelOutput(raw);

        // Same server-side escalation safety net as production.
        const kw = this.scanForEscalation(target.body || "");
        if (kw) {
            output.escalation_required = true;
            output.escalation_reason = output.escalation_reason
                ? `${output.escalation_reason}; ${kw}`
                : kw;
        }

        // Anti-invention net: flag codes/prices not present in the context.
        const haystack = (context + " " + messages.map((m) => m.body || "").join(" ")).toLowerCase();
        const reply = output.suggested_reply || "";
        const leaks: string[] = [];
        for (const tok of reply.match(/\b\d{4,8}#?/g) || []) {
            const digits = tok.replace(/\D/g, "");
            if (digits && !haystack.includes(digits)) leaks.push(tok);
        }
        for (const tok of reply.match(/[$€£]\s?\d[\d,]*(?:\.\d+)?/g) || []) {
            const num = tok.replace(/[^\d.]/g, "");
            if (num && !haystack.includes(num)) leaks.push(tok);
        }
        const warnings = Array.isArray(output.warnings) ? [...output.warnings] : [];
        if (leaks.length) {
            warnings.push(`Reply may contain unverified value(s) not found in context: ${leaks.join(", ")}.`);
        }

        let confidencePct =
            typeof output.confidence === "number" && Number.isFinite(output.confidence)
                ? Math.max(0, Math.min(100, Math.round(output.confidence * 100)))
                : null;
        if (confidencePct != null) {
            if (leaks.length) confidencePct = Math.min(confidencePct, 30);
            if (output.escalation_required) confidencePct = Math.min(confidencePct, 45);
            else if (warnings.length) confidencePct = Math.min(confidencePct, 60);
        }

        return {
            reply: output.suggested_reply || "",
            confidence: confidencePct,
            escalationRequired: !!output.escalation_required,
            escalationReason: output.escalation_reason || null,
            warnings,
            sourcesUsed: Array.isArray(output.sources_used) ? output.sources_used : [],
            suggestedActionItems: Array.isArray(output.suggested_action_items)
                ? output.suggested_action_items
                : [],
            internalSummary: output.internal_summary || null,
        };
    }

    /** Update a suggestion's lifecycle status (accepted/edited/ignored/rejected). */
    async updateSuggestionStatus(
        id: number,
        status: string,
        opts: { acceptedByUserId?: number | null; finalSentMessageId?: number | null } = {}
    ) {
        const allowed = ["suggested", "accepted", "edited", "ignored", "rejected", "regenerated", "auto_sent"];
        if (!allowed.includes(status)) throw new Error(`Invalid suggestion status: ${status}`);
        const suggestion = await this.suggestionRepo.findOne({ where: { id } });
        if (!suggestion) throw new Error(`Suggestion ${id} not found`);
        suggestion.status = status;
        if (opts.acceptedByUserId != null) suggestion.acceptedByUserId = opts.acceptedByUserId;
        if (opts.finalSentMessageId != null) suggestion.finalSentMessageId = opts.finalSentMessageId;
        return this.suggestionRepo.save(suggestion);
    }

    /** Persist human feedback on a suggestion (or sent reply). */
    async recordFeedback(input: {
        suggestionId?: number | null;
        threadId?: number | null;
        messageId?: number | null;
        listingId?: number | null;
        reservationId?: number | null;
        userId?: number | null;
        rating?: string | null;
        categories?: string[] | null;
        feedbackText?: string | null;
        correctedResponse?: string | null;
    }) {
        const rating = input.rating === "up" || input.rating === "down" ? input.rating : null;
        const feedback = this.feedbackRepo.create({
            suggestionId: input.suggestionId ?? null,
            threadId: input.threadId ?? null,
            messageId: input.messageId ?? null,
            listingId: input.listingId ?? null,
            reservationId: input.reservationId ?? null,
            userId: input.userId ?? null,
            rating,
            categories: input.categories && input.categories.length ? JSON.stringify(input.categories) : null,
            feedbackText: input.feedbackText || null,
            correctedResponse: input.correctedResponse || null,
        });
        const saved = await this.feedbackRepo.save(feedback);
        logger.info(`[InboxAIService] feedback ${saved.id} recorded (suggestion ${input.suggestionId ?? "n/a"}, rating ${rating ?? "n/a"})`);
        return saved;
    }

    // ------------------------------------------------------------------
    // Auto-send (response bot)
    // ------------------------------------------------------------------

    /**
     * Consider auto-sending a reply to an inbound guest message. Generates a
     * fresh suggestion, applies hard guardrails, and only delivers when ALL of:
     *   - auto-send is enabled (AI_MESSAGING_AUTOSEND_ENABLED)
     *   - the channel is allowed (if an allowlist is configured)
     *   - the model did NOT flag escalation
     *   - the model produced no missing-info warnings
     *   - confidence >= AI_MESSAGING_AUTOSEND_MIN_CONFIDENCE
     *   - the reply text is non-empty
     * Otherwise the suggestion is left in "suggested" state for a human to review.
     *
     * Safe to call for every inbound webhook message; it self-gates and never
     * throws (returns a structured decision instead).
     */
    async maybeAutoRespond(
        threadId: number,
        messageId?: number | null
    ): Promise<{ sent: boolean; reason: string; suggestionId?: number; messageExternalId?: number }> {
        try {
            const conversation = await this.conversationRepo.findOne({ where: { threadId } });
            if (!conversation) return { sent: false, reason: "no_conversation" };

            // ALWAYS generate + persist a "shadow" suggestion for this inbound guest
            // message, regardless of auto-send. This builds the suggestion-vs-team
            // learning dataset: the guest message externalId is stored on the
            // suggestion (messageId) so the team's actual reply can be matched to it
            // when it arrives. Deduped per (thread, message), so webhook retries and
            // repeat opens are cheap no-ops.
            let suggestion: AIMessageSuggestionEntity;
            try {
                suggestion = await this.generateSuggestion(threadId, { messageId: messageId ?? null });
            } catch (err: any) {
                logger.error(`[InboxAIService] suggestion generation failed (thread ${threadId}): ${err.message}`);
                return { sent: false, reason: "generation_failed" };
            }

            // ---- Auto-send is a separate, stricter gate (default OFF) ----
            if (!(await InboxAIService.resolveAutosendEnabled()))
                return { sent: false, reason: "autosend_disabled", suggestionId: suggestion.id };

            const allowed = await InboxAIService.autosendAllowedChannelsAsync();
            if (allowed && conversation.channel && !allowed.includes(conversation.channel.toLowerCase())) {
                return { sent: false, reason: `channel_not_allowed:${conversation.channel}`, suggestionId: suggestion.id };
            }

            // ---- Hard guardrails (any failure => leave for human) ----
            const minConf = await InboxAIService.autosendMinConfidenceAsync();
            const conf = suggestion.confidence != null ? Number(suggestion.confidence) : null;
            const reply = (suggestion.suggestedReply || "").trim();
            const warnings = this.safeJsonArray(suggestion.warnings);

            if (suggestion.escalationRequired) return this.autosendSkip(threadId, suggestion.id, "escalation_required");
            if (!reply) return this.autosendSkip(threadId, suggestion.id, "empty_reply");
            if (warnings.length > 0) return this.autosendSkip(threadId, suggestion.id, "model_warnings");
            if (conf == null || conf < minConf) {
                return this.autosendSkip(threadId, suggestion.id, `low_confidence:${conf ?? "?"}<${minConf}`);
            }

            // ---- Deliver ----
            try {
                const inboxService = new InboxService();
                const saved = await inboxService.sendAutomatedReply(threadId, reply, { senderName: "AI Assistant" });
                const sentExternalId = Number((saved as any)?.externalId);
                await this.updateSuggestionStatus(suggestion.id, "auto_sent", {
                    finalSentMessageId: Number.isFinite(sentExternalId) ? sentExternalId : null,
                });
                logger.info(
                    `[InboxAIService] AUTO-SENT reply for thread ${threadId} ` +
                    `(suggestion ${suggestion.id}, conf ${conf} >= ${minConf})`
                );
                return { sent: true, reason: "sent", suggestionId: suggestion.id, messageExternalId: sentExternalId };
            } catch (err: any) {
                logger.error(`[InboxAIService] autosend delivery failed (thread ${threadId}): ${err.message}`);
                return { sent: false, reason: "delivery_failed", suggestionId: suggestion.id };
            }
        } catch (err: any) {
            logger.error(`[InboxAIService] maybeAutoRespond unexpected error (thread ${threadId}): ${err.message}`);
            return { sent: false, reason: "error" };
        }
    }

    private autosendSkip(threadId: number, suggestionId: number, reason: string) {
        logger.info(
            `[InboxAIService] autosend skipped for thread ${threadId} ` +
            `(suggestion ${suggestionId}): ${reason} — left for human review`
        );
        return { sent: false, reason, suggestionId };
    }

    /**
     * Link the team's actual reply to the pending shadow suggestion for a thread.
     *
     * Called live from the webhook when an outgoing HUMAN message is ingested, so
     * every (guest message → AI suggestion → team reply) triple is captured as it
     * happens. Matching is DETERMINISTIC — thread ordering plus the guest messageId
     * the suggestion was generated for — so no text similarity is needed to pair
     * them; similarity is only computed and stored as a quality score.
     *
     * Idempotent and safe to call for every outgoing message.
     */
    async linkActualReply(threadId: number, outgoingExternalId?: number | null): Promise<boolean> {
        try {
            // The outgoing team message we just ingested (or the latest one).
            const outgoing =
                outgoingExternalId != null
                    ? await this.messageRepo.findOne({ where: { threadId, externalId: outgoingExternalId as any } })
                    : await this.messageRepo.findOne({ where: { threadId, direction: "outgoing" }, order: { sentAt: "DESC" } });
            if (!outgoing || outgoing.direction !== "outgoing" || !outgoing.body || !outgoing.body.trim()) return false;
            // Never treat our own auto-sent message as the "team reply".
            if (outgoing.isAutomatic === 1 || (outgoing.senderName || "").toLowerCase() === "ai assistant") return false;

            // The most recent still-unmatched suggestion generated before this reply.
            const suggestion = await this.suggestionRepo.findOne({
                where: { threadId, actualReplyText: IsNull() },
                order: { generatedAt: "DESC" },
            });
            if (!suggestion || suggestion.status === "auto_sent") return false;
            if (outgoing.sentAt && suggestion.generatedAt && new Date(outgoing.sentAt) < new Date(suggestion.generatedAt)) return false;

            suggestion.actualReplyText = outgoing.body;
            suggestion.actualReplyMessageId = outgoing.externalId ?? null;
            suggestion.actualReplyAt = outgoing.sentAt ?? null;
            suggestion.replySimilarity = this.replyOverlapPct(suggestion.suggestedReply || "", outgoing.body);
            suggestion.auditedAt = new Date();
            await this.suggestionRepo.save(suggestion);
            logger.info(
                `[InboxAIService] linked team reply to suggestion ${suggestion.id} ` +
                `(thread ${threadId}, similarity ${suggestion.replySimilarity}%)`
            );

            // Grow the retrieval store live: the guest question this suggestion
            // answered + the team's real reply becomes a new proven exemplar.
            if (ExemplarService.isEnabled() && suggestion.messageId) {
                const guestMsg = await this.messageRepo.findOne({
                    where: { threadId, externalId: suggestion.messageId as any },
                });
                if (guestMsg?.body) {
                    new ExemplarService()
                        .addPair(suggestion.listingId ?? null, guestMsg.body, outgoing.body, Number(suggestion.messageId))
                        .catch(() => {});
                }
            }
            return true;
        } catch (err: any) {
            logger.warn(`[InboxAIService] linkActualReply failed (thread ${threadId}): ${err.message}`);
            return false;
        }
    }

    /** Token-overlap (Jaccard) similarity as a 0..100 percentage. */
    private replyOverlapPct(a: string, b: string): number {
        const norm = (s: string) =>
            new Set(
                String(s)
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/g, " ")
                    .split(/\s+/)
                    .filter((w) => w.length > 2)
            );
        const sa = norm(a);
        const sb = norm(b);
        if (sa.size === 0 || sb.size === 0) return 0;
        let inter = 0;
        for (const w of sa) if (sb.has(w)) inter++;
        const union = sa.size + sb.size - inter;
        return union === 0 ? 0 : Math.round((inter / union) * 10000) / 100;
    }

    private safeJsonArray(value: string | null): string[] {
        if (!value) return [];
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
            return [];
        }
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /** Threads where the counterparty is Airbnb Support (case workers), not a guest. */
    private isAirbnbSupportThread(
        conversation: InboxConversationEntity,
        messages: InboxMessageEntity[]
    ): boolean {
        if (/airbnb\s*support/i.test(conversation.guestName || "")) return true;
        return messages.some(
            (m) => m.direction === "incoming" && /airbnb\s*support/i.test(m.senderName || "")
        );
    }

    private scanForEscalation(text: string): string | null {
        for (const { pattern, reason } of ESCALATION_KEYWORDS) {
            if (pattern.test(text)) return reason;
        }
        return null;
    }

    /**
     * Deterministic post-processing: strip dashes from guest-facing replies.
     * Em/en dashes (and hyphens) read as an "AI tell", so we replace every dash
     * variant with a space, then tidy spacing (collapse runs, drop spaces before
     * punctuation, trim line edges) while preserving line breaks. Applied to the
     * suggested_reply only — never to internal fields.
     */
    private stripDashes(text: string): string {
        if (!text) return text;
        // Covers hyphen-minus plus unicode hyphen(2010)…horizontal bar(2015),
        // minus sign(2212), small/fullwidth hyphen & em dash variants.
        const noDash = text.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D-]/g, " ");
        return noDash
            .split("\n")
            .map((line) =>
                line
                    .replace(/[ \t]{2,}/g, " ")
                    .replace(/\s+([,.!?;:])/g, "$1")
                    .replace(/^ +| +$/g, "")
            )
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    private parseModelOutput(raw: string): ModelOutput {
        let parsed: any = {};
        try {
            parsed = JSON.parse(raw);
        } catch {
            // Fall back to a safe clarifying reply if the model returned non-JSON.
            return {
                suggested_reply:
                    "Thanks for your message! Let me look into this and get back to you shortly.",
                confidence: 0,
                escalation_required: true,
                escalation_reason: "AI response could not be parsed; routed to human",
                internal_summary: "Model returned unparseable output.",
                sources_used: [],
                warnings: ["AI output was not valid JSON."],
                suggested_action_items: [],
            };
        }
        return {
            suggested_reply: this.stripDashes(String(parsed.suggested_reply || "").trim()),
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence) || 0,
            escalation_required: Boolean(parsed.escalation_required),
            escalation_reason: parsed.escalation_reason ? String(parsed.escalation_reason) : null,
            internal_summary: parsed.internal_summary ? String(parsed.internal_summary) : null,
            sources_used: Array.isArray(parsed.sources_used) ? parsed.sources_used.map(String) : [],
            warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
            suggested_action_items: Array.isArray(parsed.suggested_action_items)
                ? parsed.suggested_action_items.map(String)
                : [],
            learning_question: parsed.learning_question ? String(parsed.learning_question) : null,
            learning_topic: parsed.learning_topic ? String(parsed.learning_topic) : null,
        };
    }

    private systemPrompt(
        settings?: AIMessagingSettingsEntity | null,
        opts: { airbnbSupport?: boolean } = {}
    ): string {
        const toneLabel = (settings?.tone || "warm").trim();
        const customRules = (settings?.communicationRules || "").trim();
        const topicsToAvoid = (settings?.topicsToAvoid || "").trim();
        const airbnbSupportRules = (settings?.airbnbSupportRules || "").trim();

        const settingsBlock: string[] = [];
        settingsBlock.push(`COMMUNICATION STYLE: adopt a ${toneLabel} tone.`);
        if (customRules) {
            settingsBlock.push("TEAM COMMUNICATION RULES (follow these strictly):");
            settingsBlock.push(customRules);
        }
        if (topicsToAvoid) {
            settingsBlock.push("TOPICS TO AVOID / ALWAYS ESCALATE (never answer these directly — set escalation_required=true):");
            settingsBlock.push(topicsToAvoid);
        }
        if (opts.airbnbSupport) {
            settingsBlock.push(
                "THIS CONVERSATION IS WITH AIRBNB SUPPORT (a platform case worker, NOT a guest). " +
                "Write as the host's team addressing Airbnb: factual, professional, case-focused. " +
                "Do not use guest hospitality phrasing ('we hope to host you', reviews, upsells)."
            );
            if (airbnbSupportRules) {
                settingsBlock.push("AIRBNB SUPPORT RULES (follow these strictly for this conversation):");
                settingsBlock.push(airbnbSupportRules);
            }
        }
        settingsBlock.push("");

        return [
            "You are SecureStay's guest-messaging assistant for short-term rental operations.",
            "You draft a SUGGESTED reply for a human agent to review. You never send messages yourself.",
            "",
            ...settingsBlock,
            "LENGTH & STYLE (team feedback — follow strictly):",
            "- KEEP IT SHORT: 1-3 sentences for most messages; 4-5 max when the guest asked several things or you're sending documented rules/instructions. Write like a friendly human host texting, not a customer-service email.",
            "- Sound personal, not corporate. NO filler like 'Your comfort and safety are very important to us', 'We strive to ensure', 'Thank you for your understanding and patience', 'Please don't hesitate to reach out'. One short warm touch is enough.",
            "- Don't restate the guest's question back to them, don't re-introduce the property, and don't stack multiple closers. Answer, add at most ONE helpful extra, stop.",
            "- Use the guest's first name naturally (not in every message), and match their energy — brief message gets a brief reply.",
            "",
            "PRINCIPLES:",
            `- Be concise, professional, and helpful with a ${toneLabel} hospitality brand voice.`,
            "- NEVER invent facts (codes, prices, policies, amenities, addresses). Only use provided context.",
            "- Do NOT invent physical features or capacities. In particular, never name a parking type (garage, driveway, carport, lot) or a specific number of cars/vehicles unless that detail appears in the provided context. If parking specifics are not in context, describe only what IS known and offer to confirm the rest — do not guess.",
            "- Earlier TEAM messages in this same thread are authoritative: prefer them, reuse their facts, and NEVER contradict something the team already told this guest.",
            "- The 'proven replies' section shows how our team answered similar questions for THIS property before. Strongly prefer their facts, specifics, and tone; adapt to the current guest. If they conflict with listing context, trust listing context and the current thread.",
            "- Answer DIRECTLY and confidently when the context (proven replies, learned answers, listing knowledge, availability, reservation details) already contains the answer. Do NOT default to 'the team will confirm' for information you already have — only defer for things genuinely not in context.",
            "- ANSWER THE QUESTION: never reply with only a generic acknowledgement ('thanks for reaching out', 'let us know if you need anything') when the guest asked a specific question. Address what they actually asked using the context. A generic holding reply is acceptable ONLY when the needed info is truly absent AND you add a warning and keep confidence low.",
            "- PRICING: never offer, promise, negotiate, or imply a discount, deal, coupon, or 'special offer'. If a guest asks for a better/lower price, explain the rate shown reflects current dynamic pricing for those dates; do not invent reductions.",
            "- POLICY & STANDARD OFFERS: If the context (proven replies, learned answers, listing knowledge/documents) shows how we normally handle something — e.g. early check-in for a stated fee, luggage drop-off, a specific refund/cancellation policy — STATE it the way our team does, noting 'subject to availability/confirmation' where appropriate. Do NOT invent or promise exceptions that are NOT documented (free waivers, discounts, penalty-free cancellations, guaranteed early check-in).",
            "- NEVER ASSERT AN UNKNOWN POLICY: if the context does not tell you how something is handled, do NOT state a policy either way — never say something is 'not allowed', 'non-refundable', 'no refund', or that a policy is 'unknown'. Instead say the team will confirm the specifics. (Stating a policy the context does not support is the worst kind of error.)",
            "- For platform cancellations or rebooking (Airbnb/Booking.com/Vrbo), direct the guest to manage it through that platform. Do not state a fee amount that is not in the provided context.",
            "- Do NOT put a specific door code, lock code, access code, gate code, wifi password, or a specific price/amount in the reply UNLESS that exact value already appears in the provided message history or listing context. If the guest needs a code or figure you do not have, say the team will send it (e.g. before check-in) rather than guessing a value.",
            "- If needed information is missing, say so in `warnings` and write a safe reply that asks the guest for clarification or says the team will follow up — do not guess.",
            "- Prefer the property's documented house rules / check-in info when present in context.",
            "- WHEN THE GUEST ASKS FOR THE RULES OR INSTRUCTIONS THEMSELVES (house rules, check-in/checkout instructions, house manual): if the actual content is in context (e.g. a 'House rules' or check-in entry), SEND IT — reproduce the documented rules/steps in the reply rather than telling the guest where to find them or offering to send them later. Only point to a physical location or defer if the actual content is not in context.",
            "- Reply in the same language the guest used.",
            "",
            "AVAILABILITY / EXTENSIONS:",
            "- If a 'Live availability' section is present, it is real calendar data. You MAY state those specific open dates and nightly prices to the guest and answer availability/extension questions directly — do NOT say 'let me check' or 'I'll get back to you' when this data is present.",
            "- For an extension request, if the relevant night is available, confirm it and its nightly price, then say the team will finalize the booking/charge (you cannot modify the reservation yourself). This does NOT require escalation.",
            "- If the requested night is NOT available per the calendar, tell the guest it's unavailable and, if helpful, mention the nearest open dates.",
            "- If NO 'Live availability' data is present for an extension/date request, do NOT express eagerness that presumes the night is open (avoid 'we'd love to extend your stay!'). Give a neutral reply that you'll confirm availability, keep confidence <= 0.4, and do not imply the night is likely available.",
            "- Only escalate availability/extension messages when the guest is negotiating price/discounts or the calendar data is absent.",
            "",
            "LOCAL AREA, DIRECTIONS & TRAVEL TIME:",
            "- For general questions about distance, drive time, or directions between the property and a well-known place (airports, downtowns, cities, landmarks, neighborhoods), give a helpful APPROXIMATE estimate from general geographic knowledge — do NOT defer to the team and do NOT escalate. Ground it in the property's city/area from the listing context.",
            "- Always label these as approximate and traffic-dependent, e.g. 'roughly a 20-minute drive (~15 miles), depending on traffic'. Round sensibly; never present an estimate as an exact, guaranteed figure.",
            "- This exception is ONLY for general travel time/distance/directions. It does NOT permit inventing property-specific facts (exact street address if not provided, gate/parking specifics, private transport arrangements) — those still follow the no-invention rules above.",
            "",
            "STAY-STAGE PROACTIVITY (anticipate like our team does):",
            "- The context includes a 'Stay stage' line. Use it to add the ONE next thing the guest will need, briefly, after answering their actual question:",
            "  * Checks in today/tomorrow → confirm arrival details you have (check-in time, access process — never invent a code).",
            "  * Checks out today/tomorrow → add a short checkout reminder using the property's documented checkout steps IF they are in context; otherwise just note the checkout time if known.",
            "  * Post-stay → warm closure; address anything left open. Do not send arrival info post-stay.",
            "- Keep the proactive part to 1–2 sentences; never let it crowd out the direct answer.",
            "",
            "INTERNAL OPERATIONS AWARENESS:",
            "- If an 'Internal operations in progress' section is present, our team already has real work open for this guest (tasks, maintenance, callbacks, payment follow-ups).",
            "- Align with it: if the guest's message relates to an open item, say the team is already on it and reference the state naturally. Do NOT offer to 'look into' something already in motion, and do NOT restart a process the team has underway.",
            "- Never reveal internal wording, staff names, vendor names, or internal prices from that section.",
            "",
            "PAID SERVICES / UPSELLS:",
            "- If an 'Available paid services' section is present, those are the ONLY add-on services offered for this property (e.g. early check-in, late checkout, pool heating) with their guest prices.",
            "- When the guest asks about one of them, state it directly with the listed price, subject to availability/confirmation by the team. Do not discount it.",
            "- If the guest asks for a service NOT in that section (e.g. airport transfer when none is listed), do NOT invent one and do NOT flatly say we don't offer it unless context says so — offer what IS documented, or say the team will confirm options. This is a prime case for a learning_question.",
            "",
            "LEARNING QUESTIONS — how the bot gets smarter (IMPORTANT, use often):",
            "- Whenever your reply would have been BETTER with a specific, reusable, property-level fact you did not have, you MUST fill `learning_question` with one short question a staff member can answer.",
            "- Triggers: you deferred to the team, escalated for missing info, added a missing-info warning, hedged ('the team will confirm'), or answered from general knowledge instead of property context (e.g. guest asked about airport transportation and context said nothing → ask 'Do we offer or arrange airport transportation for this property, and at what cost?').",
            "- Make it reusable and property-level: 'Is there a luggage drop-off option?', 'What parking is available and for how many cars?' — never guest-specific ('should we refund Janet?').",
            "- Do NOT raise one when the context already had the answer, or the gap is one-off/personal. One question max per reply; pick the most valuable gap.",
            "",
            "CONFIDENCE — be honest and well-calibrated (this drives automation decisions):",
            "- Use > 0.9 ONLY when every fact needed is present in context and the reply requires no assumptions.",
            "- If you added ANY warning or are missing information, confidence MUST be <= 0.6.",
            "- If the reply is a generic holding/acknowledgement message, or you are guessing, use <= 0.4.",
            "- If there is no actual pending guest question to answer, use <= 0.3.",
            "",
            "ESCALATION — set escalation_required=true (and explain in escalation_reason) for any of:",
            "refunds, discounts/credits, legal issues, threats, safety/medical/emergency, discrimination/fair-housing,",
            "damage claims, security deposits, cancellation penalties, angry guests / review threats, vendor dispatch,",
            "anything where listing data conflicts with guest expectations, or whenever your confidence is low.",
            "When escalating, still provide a safe, non-committal holding reply (e.g. acknowledging and saying the team will follow up).",
            "",
            "OUTPUT: Respond with STRICT JSON only, matching exactly this shape:",
            "{",
            '  "suggested_reply": "string — the guest-facing reply",',
            '  "confidence": 0.0,   // number 0..1',
            '  "escalation_required": false,',
            '  "escalation_reason": "string or null",',
            '  "internal_summary": "one or two short sentences for staff (NOT shown to the guest)",',
            '  "sources_used": ["short labels of context you relied on"],',
            '  "warnings": ["any missing info or risks"],',
            '  "suggested_action_items": ["optional internal tasks, e.g. \'Confirm early check-in availability\'"],',
            '  "learning_question": "string or null — if you lacked a SPECIFIC, REUSABLE, property-level fact a staff member could answer to improve FUTURE replies (e.g. parking capacity, whether the grill is gas/charcoal, nearest grocery), a short question to ask staff. Null if you had what you needed, or the gap is a one-off / not property-specific.",',
            '  "learning_topic": "string or null — a short slug for that question, e.g. \'parking\', \'grill\', \'checkout-time\'."',
            "}",
            "Do not include any text outside the JSON. Do not expose hidden chain-of-thought; keep internal_summary brief.",
        ].join("\n");
    }

    /**
     * Heuristic: does the guest message concern availability / dates / extending
     * a stay / booking additional nights? Kept broad but cheap (no model call).
     */
    private detectAvailabilityIntent(text: string): boolean {
        const t = (text || "").toLowerCase();
        if (!t) return false;
        const patterns = [
            "availab", "available", "vacan", "open date", "any opening",
            "one more night", "1 more night", "another night", "extra night", "extend", "extension",
            "stay longer", "stay another", "can we stay", "add a night", "add another", "additional night",
            "extend our stay", "extend my stay", "possible to extend", "one extra", "stay an extra",
            "early check", "late check", "check in early", "check out late", "checkout late", "arrive early", "get in early",
            "book", "reserve", "free on", "still open", "is it open", "are you open",
            "next weekend", "for the weekend", "any nights", "few more days", "couple more days",
        ];
        return patterns.some((p) => t.includes(p));
    }

    /**
     * Fetch the live Hostify calendar for the conversation's listing and render a
     * compact availability summary the model can quote. Window: from today (or
     * check-in, whichever is earlier-relevant) through ~45 days out; when we know
     * the checkout date we specifically flag the nights right after it (the exact
     * dates an extension request is about).
     */
    private async buildAvailabilityBlock(conversation: InboxConversationEntity): Promise<string | null> {
        if (!conversation.listingId || !this.hostifyApiKey) return null;

        const toKey = (d: Date) => d.toISOString().slice(0, 10);
        const today = new Date();
        const start = new Date(today);
        // If they already have a stay, anchor the window near it so extension math lines up.
        if (conversation.checkout) {
            const co = new Date(conversation.checkout as any);
            if (!isNaN(co.getTime()) && co > start) {
                // keep `start` at today so we also cover "can we come earlier" cases
            }
        }
        const end = new Date(start);
        end.setDate(end.getDate() + 45);

        let days;
        try {
            days = await this.hostify.getCalendar(this.hostifyApiKey, Number(conversation.listingId), toKey(start), toKey(end));
        } catch {
            return null;
        }
        if (!days || days.length === 0) return null;

        const isAvailable = (d: any) => String(d?.status || "").toLowerCase() === "available";
        const currency = (days.find((d: any) => d?.currency)?.currency) || conversation.currency || "USD";

        // Collapse consecutive available days into ranges for a tight summary.
        const ranges: Array<{ from: string; to: string; price: number }> = [];
        for (const d of days) {
            if (!isAvailable(d)) continue;
            const last = ranges[ranges.length - 1];
            const prevDate = last ? new Date(last.to) : null;
            const thisDate = new Date(d.date);
            const contiguous =
                last && prevDate && (thisDate.getTime() - prevDate.getTime()) === 86400000;
            if (contiguous) {
                last!.to = d.date;
            } else {
                ranges.push({ from: d.date, to: d.date, price: Number(d.price) || 0 });
            }
        }

        const out: string[] = [];
        if (ranges.length === 0) {
            out.push("No open nights in the next 45 days — the calendar is fully booked/blocked.");
        } else {
            out.push("Open date ranges (next 45 days):");
            for (const r of ranges.slice(0, 12)) {
                const label = r.from === r.to ? r.from : `${r.from} → ${r.to}`;
                out.push(`- ${label}${r.price ? ` (~${currency} ${r.price}/night)` : ""}`);
            }
        }

        // Extension-specific: is the night immediately after checkout open?
        if (conversation.checkout) {
            const co = new Date(conversation.checkout as any);
            if (!isNaN(co.getTime())) {
                const nextNightKey = toKey(co);
                const day = days.find((d: any) => String(d.date).slice(0, 10) === nextNightKey);
                if (day) {
                    out.push(
                        isAvailable(day)
                            ? `Extension check: the night of ${nextNightKey} (right after current checkout) IS available${day.price ? ` at ~${currency} ${Number(day.price)}/night` : ""}.`
                            : `Extension check: the night of ${nextNightKey} (right after current checkout) is NOT available.`
                    );
                }
            }
        }

        return out.join("\n");
    }

    /** Build the user-message context block from conversation + reservation + listing. */
    /** Short-lived cache so repeated previews of the same thread don't refetch Hostify. */
    private static reservationCache = new Map<number, { at: number; block: string | null }>();

    /**
     * Live reservation facts for the prompt: exact check-in/out dates, status,
     * confirmation code, payment state and cancellation/refund terms — pulled
     * straight from the Hostify booking. The team flagged that the bot "doesn't
     * detect cancellation policies / reservation dates": the reply pipeline
     * previously used only the thin InboxConversation columns (often empty) and
     * never loaded the real reservation. Guest-shareable facts (dates/status/
     * code) are separated from staff-only billing/cancellation facts so the
     * model can share the former but only uses the latter to inform its draft.
     */
    private async buildReservationBlock(conversation: InboxConversationEntity): Promise<string | null> {
        const reservationId = conversation.reservationId ? Number(conversation.reservationId) : null;
        if (!reservationId || !this.hostifyApiKey) return null;

        const cached = InboxAIService.reservationCache.get(reservationId);
        if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.block;

        let block: string | null = null;
        try {
            const data: any = await this.hostify.getReservationInfo(this.hostifyApiKey, reservationId);
            const r = data?.reservation || {};
            const l = data?.listing || {};
            if (r && (r.checkIn || r.confirmation_code || r.status)) {
                const fmtTime = (t: any): string | null => {
                    const m = String(t || "").match(/^(\d{1,2}):(\d{2})/);
                    if (!m) return null;
                    let h = Number(m[1]);
                    const ampm = h >= 12 ? "PM" : "AM";
                    h = h % 12 === 0 ? 12 : h % 12;
                    return `${h}:${m[2]} ${ampm}`;
                };
                const shareable: string[] = [];
                if (r.confirmation_code) shareable.push(`- Confirmation code: ${r.confirmation_code}`);
                if (r.checkIn) shareable.push(`- Check-in date: ${r.checkIn}${fmtTime(l.checkin_start) ? ` (from ${fmtTime(l.checkin_start)})` : ""}`);
                if (r.checkOut) shareable.push(`- Check-out date: ${r.checkOut}${fmtTime(l.checkout) ? ` (by ${fmtTime(l.checkout)})` : ""}`);
                const stay: string[] = [];
                if (r.nights != null) stay.push(`${r.nights} night(s)`);
                if (r.guests != null) stay.push(`${r.guests} guest(s)`);
                if (stay.length) shareable.push(`- Length of stay: ${stay.join(", ")}`);
                // Party breakdown incl. pets — the bot must know these when the
                // guest asks about pet fees, extra guests, etc.
                const party: string[] = [];
                if (r.adults != null && Number(r.adults) > 0) party.push(`${r.adults} adult(s)`);
                if (r.children != null && Number(r.children) > 0) party.push(`${r.children} child(ren)`);
                if (r.infants != null && Number(r.infants) > 0) party.push(`${r.infants} infant(s)`);
                if (r.pets != null) party.push(Number(r.pets) > 0 ? `${r.pets} pet(s)` : "no pets registered");
                if (party.length) shareable.push(`- Party details: ${party.join(", ")}`);
                if (r.status_description || r.status) shareable.push(`- Reservation status: ${r.status_description || r.status}`);
                const cancelPolicyName =
                    r.cancellation_policy || l.cancellation_policy || l.cancel_policy || null;
                if (cancelPolicyName) shareable.push(`- Cancellation policy: ${cancelPolicyName}`);

                const staff: string[] = [];
                const nonRefundable = Number(l.non_refundable_factor) >= 1;
                staff.push(
                    nonRefundable
                        ? "- Rate type: NON-REFUNDABLE rate plan (the guest booked a non-refundable rate)."
                        : "- Rate type: standard/refundable rate plan (not a non-refundable booking)."
                );
                if (r.cancellation_fee != null && Number(r.cancellation_fee) > 0)
                    staff.push(`- Cancellation fee currently on file: ${r.cancellation_fee}.`);
                if (r.cancelled_at)
                    staff.push(`- This reservation was CANCELLED on ${r.cancelled_at}${r.cancel_reason ? ` (reason: ${r.cancel_reason})` : ""}.`);
                if (r.sum_refunds != null && Number(r.sum_refunds) > 0) staff.push(`- Refunds issued so far: ${r.sum_refunds}.`);
                const paidLabel: Record<string, string> = { none: "not yet paid", part: "partially paid", full: "paid in full", all: "paid in full" };
                const pl = paidLabel[String(r.paid_part || "").toLowerCase()];
                if (pl) staff.push(`- Payment status: ${pl}${r.paid_sum != null && Number(r.paid_sum) > 0 ? ` (${r.paid_sum} collected so far)` : ""}.`);

                const out: string[] = [];
                if (shareable.length) {
                    out.push("## Reservation details (live booking — accurate; you MAY share dates, status and confirmation code with the guest)");
                    out.push(...shareable);
                }
                if (staff.length) {
                    out.push("");
                    out.push("## Reservation billing & cancellation (STAFF-ONLY facts — use to inform your reply; still confirm specifics with the team and do NOT over-assert a policy the facts don't clearly support)");
                    out.push(...staff);
                }
                block = out.length ? out.join("\n") : null;
            }
        } catch (e: any) {
            logger.warn(`[InboxAI] reservation enrich failed for ${reservationId}: ${e.message}`);
            block = null;
        }
        InboxAIService.reservationCache.set(reservationId, { at: Date.now(), block });
        return block;
    }

    /**
     * Stay-stage line so the bot can anticipate like the team does (checkout steps
     * the day before checkout, arrival info near check-in, warm closure post-stay).
     */
    private stayStageLine(checkin: string | null, checkout: string | null): string | null {
        const day = (s: string | null): number | null => {
            const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!m) return null;
            return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
        };
        const now = new Date();
        const today = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
        const ci = day(checkin);
        const co = day(checkout);
        if (ci == null && co == null) return null;
        const label = (() => {
            if (ci != null && today < ci) {
                const d = ci - today;
                return d === 1 ? "PRE-STAY — guest CHECKS IN TOMORROW" : `PRE-STAY — guest checks in in ${d} days`;
            }
            if (ci != null && today === ci) return "CHECK-IN IS TODAY";
            if (co != null && today === co) return "CHECKOUT IS TODAY";
            if (co != null && today === co - 1) return "MID-STAY — guest CHECKS OUT TOMORROW";
            if (co != null && today > co) {
                const d = today - co;
                return d <= 7 ? `POST-STAY — guest checked out ${d} day(s) ago` : "POST-STAY (checked out over a week ago)";
            }
            return "MID-STAY — guest is currently staying";
        })();
        return `Stay stage: ${label}.`;
    }

    /**
     * Internal operations context: open action items and property issues the team
     * is already working for this guest/reservation/property. This is what the
     * team's replies are often driven by ("a PM will call you", "please
     * authenticate your card") — without it the bot answers in a vacuum.
     * Best-effort raw queries; any failure just omits the block.
     */
    private async buildOpsBlock(
        conversation: InboxConversationEntity,
        groupIds: number[]
    ): Promise<string | null> {
        const resvId = conversation.reservationId ? Number(conversation.reservationId) : null;
        const listingIds = (groupIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
        const guestName = (conversation.guestName || "").trim();
        if (!resvId && !listingIds.length) return null;

        const fmtDate = (d: any): string => {
            const m = String(d || "").match(/^\d{4}-\d{2}-\d{2}/);
            return m ? m[0] : "";
        };
        const out: string[] = [];

        // Open action items for this reservation (or this guest on this property).
        try {
            const conds: string[] = [];
            const params: any[] = [];
            if (resvId) {
                conds.push("reservationId = ?");
                params.push(resvId);
            }
            if (listingIds.length && guestName) {
                conds.push(`(listingId IN (${listingIds.map(() => "?").join(",")}) AND guestName = ?)`);
                params.push(...listingIds, guestName);
            }
            if (conds.length) {
                const rows: any[] = await appDatabase.query(
                    `SELECT item, category, status, createdAt FROM action_items
                     WHERE deletedAt IS NULL
                       AND (completedOn IS NULL OR completedOn = '')
                       AND (${conds.join(" OR ")})
                     ORDER BY createdAt DESC LIMIT 5`,
                    params
                );
                const items = rows
                    .filter((r) => r.item && String(r.item).trim())
                    .map((r) => {
                        const meta = [r.category, r.status, fmtDate(r.createdAt)].filter(Boolean).join(", ");
                        return `- ${String(r.item).replace(/\s+/g, " ").trim().slice(0, 240)}${meta ? ` (${meta})` : ""}`;
                    });
                if (items.length) {
                    out.push("Open internal tasks for this guest/reservation:");
                    out.push(...items);
                }
            }
        } catch {
            /* non-fatal */
        }

        // Open property issues (maintenance etc.) on this property group.
        try {
            const conds: string[] = [];
            const params: any[] = [];
            if (resvId) {
                conds.push("reservation_id = ?");
                params.push(String(resvId));
            }
            if (listingIds.length) {
                conds.push(`listing_id IN (${listingIds.map(() => "?").join(",")})`);
                params.push(...listingIds.map((n) => String(n)));
            }
            if (conds.length) {
                const rows: any[] = await appDatabase.query(
                    `SELECT ai_short_title, issue_description, status, next_steps, created_at FROM issues
                     WHERE deleted_at IS NULL
                       AND status NOT IN ('Completed')
                       AND created_at >= (NOW() - INTERVAL 30 DAY)
                       AND (${conds.join(" OR ")})
                     ORDER BY created_at DESC LIMIT 4`,
                    params
                );
                const items = rows
                    .map((r) => {
                        const title = String(r.ai_short_title || r.issue_description || "").replace(/\s+/g, " ").trim();
                        if (!title) return null;
                        const next = String(r.next_steps || "").replace(/\s+/g, " ").trim();
                        return `- ${title.slice(0, 200)} (status: ${r.status || "?"}${next ? `; next steps: ${next.slice(0, 160)}` : ""})`;
                    })
                    .filter(Boolean) as string[];
                if (items.length) {
                    out.push("Open property issues the team is working on:");
                    out.push(...items);
                }
            }
        } catch {
            /* non-fatal */
        }

        if (!out.length) return null;
        return [
            "## Internal operations in progress (STAFF-ONLY — real work our team already has open for this guest/property. " +
                "Align your reply with it: reference ongoing work naturally ('our team is on it / will reach out'), " +
                "don't offer to 'check' something already in motion, and never quote internal wording, names, or prices verbatim)",
            ...out,
        ].join("\n");
    }

    /**
     * Paid add-on services (upsells) configured for this property group — early
     * check-in, late checkout, pool heating, etc., with the guest-facing price.
     * Per-listing fee overrides (upsell_property_config) win over the base price.
     * Without this the bot either invents offers or wrongly says "we don't
     * provide that" for services we actually sell.
     */
    private async buildUpsellsBlock(groupIds: number[]): Promise<string | null> {
        const listingIds = (groupIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
        if (!listingIds.length) return null;
        try {
            const ph = listingIds.map(() => "?").join(",");
            const rows: any[] = await appDatabase.query(
                `SELECT ui.title, ui.timePeriod, ui.availability, ui.description,
                        ui.price AS basePrice, MAX(upc.upsellFee) AS listingFee
                 FROM upsell_listing ul
                 JOIN upsell_info ui ON ui.upsell_id = ul.upSellId AND ui.isActive = 1
                 LEFT JOIN upsell_property_config upc
                        ON upc.upSellId = ul.upSellId AND upc.listingId = ul.listingId
                 WHERE ul.status = 1 AND ul.listingId IN (${ph})
                 GROUP BY ui.upsell_id, ui.title, ui.timePeriod, ui.availability, ui.description, ui.price`,
                listingIds
            );
            if (!rows.length) return null;
            const items = rows
                .map((r) => {
                    const title = String(r.title || "").trim();
                    if (!title) return null;
                    const fee = r.listingFee != null && Number(r.listingFee) > 0 ? Number(r.listingFee) : Number(r.basePrice) || 0;
                    const bits: string[] = [];
                    if (fee > 0) bits.push(`$${fee.toFixed(2)}${r.timePeriod ? ` ${String(r.timePeriod).toLowerCase()}` : ""}`);
                    else bits.push("price on request");
                    if (r.availability && String(r.availability).toLowerCase() !== "always") bits.push(`availability: ${r.availability}`);
                    const desc = String(r.description || "").replace(/\s+/g, " ").trim();
                    return `- ${title}: ${bits.join("; ")}${desc ? ` — ${desc.slice(0, 160)}` : ""}`;
                })
                .filter(Boolean) as string[];
            if (!items.length) return null;
            return [
                "## Available paid services for this property (the ONLY add-ons we offer here; " +
                    "state the price when the guest asks, subject to availability/confirmation — never discount)",
                ...items,
            ].join("\n");
        } catch {
            return null;
        }
    }

    private async buildContext(
        conversation: InboxConversationEntity,
        messages: InboxMessageEntity[],
        targetMessage: InboxMessageEntity | null,
        opts: { includeKnowledge?: boolean; instructions?: string | null; baseDraft?: string | null } = {}
    ): Promise<string> {
        const includeKnowledge = opts.includeKnowledge !== false;
        const lines: string[] = [];
        lines.push("## Conversation context");
        lines.push(`Channel: ${conversation.channel || "unknown"}`);
        lines.push(`Guest: ${conversation.guestName || "unknown"}`);
        lines.push(`Listing: ${conversation.listingName || "unknown"}`);
        if (conversation.checkin || conversation.checkout) {
            lines.push(`Stay: ${conversation.checkin || "?"} to ${conversation.checkout || "?"} (${conversation.nights ?? "?"} nights, ${conversation.guests ?? "?"} guests)`);
            const stage = this.stayStageLine(conversation.checkin, conversation.checkout);
            if (stage) lines.push(stage);
        }
        if (conversation.price != null) {
            lines.push(`Booking total: ${conversation.price} ${conversation.currency || ""}`.trim());
        }
        if (conversation.reservationStatus) lines.push(`Reservation status: ${conversation.reservationStatus}`);

        // Full reservation facts (exact dates, status, confirmation code, payment
        // state, refundability / cancellation terms) pulled live from Hostify.
        // The thin conversation columns above are frequently empty, which is why
        // the bot previously "didn't detect" reservation dates or cancellation
        // policy — this block is what lets it answer those accurately.
        if (includeKnowledge) try {
            const resvBlock = await this.buildReservationBlock(conversation);
            if (resvBlock) {
                lines.push("");
                lines.push(resvBlock);
            }
        } catch {
            /* non-fatal */
        }

        // Resolve the channel/child listing to its canonical property group so KB
        // and learned facts are shared across all sibling listings (Hostify splits
        // one property into per-channel IDs; conversations arrive on a child ID).
        let groupIds: number[] = conversation.listingId ? [Number(conversation.listingId)] : [];
        let canonicalListingId: number | null = conversation.listingId ? Number(conversation.listingId) : null;
        try {
            const grp = new ListingGroupService();
            const ids = await grp.groupIds(conversation.listingId);
            if (ids.length) groupIds = ids;
            const canon = await grp.resolve(conversation.listingId);
            if (canon) canonicalListingId = canon;
        } catch {
            /* non-fatal — fall back to the raw listingId */
        }

        // Internal operations context: what the team already has in motion for
        // this guest (open tasks, property issues). The team's replies are often
        // driven by this, so the bot must see it to stay consistent with them.
        if (includeKnowledge) try {
            const ops = await this.buildOpsBlock(conversation, groupIds);
            if (ops) {
                lines.push("");
                lines.push(ops);
            }
        } catch {
            /* non-fatal */
        }

        // Paid add-on services (early check-in, late checkout, pool heat…) that
        // are actually configured for this property, with real prices.
        if (includeKnowledge) try {
            const ups = await this.buildUpsellsBlock(groupIds);
            if (ups) {
                lines.push("");
                lines.push(ups);
            }
        } catch {
            /* non-fatal */
        }

        // Best-effort listing profile from the local listing record: times, size,
        // capacity, location and standard fees. The team flagged the bot "doesn't
        // use listing details like address, bedrooms, baths, fees" — this block is
        // what grounds those answers.
        try {
            const listing = canonicalListingId
                ? await this.listingRepo.findOne({ where: { id: Number(canonicalListingId) }, withDeleted: true })
                : null;
            if (listing) {
                const fmtHour = (v: any): string | null => {
                    if (v == null || v === "") return null;
                    let n = Number(v);
                    if (!Number.isFinite(n)) return null;
                    if (n > 23) n = Math.floor(n / 100);
                    if (n < 0 || n > 23) return null;
                    const ampm = n >= 12 ? "PM" : "AM";
                    return `${n % 12 === 0 ? 12 : n % 12}:00 ${ampm}`;
                };
                const ci = fmtHour((listing as any).checkInTimeStart);
                const co = fmtHour((listing as any).checkOutTime);
                const ll: string[] = [];
                if (ci) ll.push(`check-in from ${ci}`);
                if (co) ll.push(`check-out by ${co}`);
                if (ll.length) lines.push(`Listing times: ${ll.join(", ")}`);

                const l: any = listing;
                const details: string[] = [];
                const loc = [l.address, l.city, l.state].filter((v: any) => v && String(v).trim() && String(v) !== "(NOT SPECIFIED)");
                if (loc.length) details.push(`- Location: ${loc.join(", ")}`);
                if (l.bedroomsNumber != null) details.push(`- Bedrooms: ${l.bedroomsNumber}`);
                if (l.bathroomsNumber != null) details.push(`- Bathrooms: ${l.bathroomsNumber}`);
                if (l.personCapacity != null) details.push(`- Max guests: ${l.personCapacity}`);
                if (l.cleaningFee != null && Number(l.cleaningFee) > 0) details.push(`- Cleaning fee: $${l.cleaningFee}`);
                if (l.airbnbPetFeeAmount != null && Number(l.airbnbPetFeeAmount) > 0)
                    details.push(`- Pet fee: $${l.airbnbPetFeeAmount}`);
                const desc = String(l.description || "").replace(/\s+/g, " ").trim();
                if (desc) details.push(`- Description: ${desc.slice(0, 900)}`);
                if (details.length) {
                    lines.push("");
                    lines.push("## Listing details (from our listing record — you MAY share these with the guest)");
                    lines.push(...details);
                }
            }

            // Standing cancellation policy from the listing intake record (the
            // Hostify reservation block above only carries booking-level billing
            // signals; this is the property's documented standing policy).
            if (canonicalListingId) {
                const intakeRepo = appDatabase.getRepository(ListingIntake);
                const intake = await intakeRepo
                    .createQueryBuilder("i")
                    .where("i.listingId = :lid", { lid: Number(canonicalListingId) })
                    .orderBy("i.id", "DESC")
                    .getOne()
                    .catch(() => null);
                const policy = (intake as any)?.cancellationPolicy;
                if (policy && String(policy).trim()) {
                    lines.push("");
                    lines.push("## Cancellation policy (property's documented standing policy — you MAY state this to the guest)");
                    lines.push(String(policy).trim().slice(0, 1200));
                }
            }
        } catch {
            /* non-fatal */
        }

        // Property-specific Knowledge Base (staff-maintained on the All Listings
        // page). External entries are guest-shareable; internal entries inform the
        // reply but must not be quoted to the guest.
        const guestQuery = (targetMessage?.body || conversation.lastMessageText || "").toString();
        if (includeKnowledge) try {
            let rendered = false;
            // Prefer semantic KB retrieval (embedding-ranked, group-scoped,
            // visibility-split) when RAG is enabled and the KB has been indexed.
            if (ExemplarService.isEnabled() && guestQuery.trim()) {
                const kbSem = await new RetrievalService().retrieveKb(canonicalListingId, guestQuery, { k: 4 });
                if (kbSem.external.length) {
                    lines.push("");
                    lines.push("## Listing Knowledge Base (you MAY share this with the guest)");
                    for (const d of kbSem.external) lines.push(`- ${d.text.replace(/\s+/g, " ").trim().slice(0, 700)}`);
                    rendered = true;
                }
                if (kbSem.internal.length) {
                    lines.push("");
                    lines.push("## Internal knowledge (staff-only — use to inform your reply, do NOT quote verbatim)");
                    for (const d of kbSem.internal) lines.push(`- ${d.text.replace(/\s+/g, " ").trim().slice(0, 700)}`);
                    rendered = true;
                }
            }
            // Fallback to the keyword render path (RAG off, or KB not yet indexed).
            if (!rendered) {
                const kb = await new ListingKnowledgeService().renderForBot(conversation.listingId, { query: guestQuery, listingIds: groupIds });
                if (kb) {
                    lines.push("");
                    lines.push("## Listing Knowledge Base");
                    lines.push(kb);
                }
            }
        } catch {
            /* non-fatal */
        }

        // Learned answers: frequently-asked facts the team has answered before,
        // approved by staff (per-property + portfolio-wide). These are the bot's
        // accumulated memory that makes it smarter over time.
        if (includeKnowledge) try {
            let learned: string | null = null;
            if (ExemplarService.isEnabled() && guestQuery.trim()) {
                // Semantic fact retrieval — paraphrase-robust, ranked by meaning.
                const facts = await new RetrievalService().retrieveFacts(canonicalListingId, guestQuery, { k: 6 });
                learned = new RetrievalService().renderFacts(facts);
            }
            if (!learned) {
                learned = await new AILearnedFactsService().renderForBot(conversation.listingId, { query: guestQuery, listingIds: groupIds });
            }
            if (learned) {
                lines.push("");
                lines.push(
                    "## Learned answers (approved background facts — use the INFORMATION, but rewrite it for THIS guest; " +
                    "never paste one verbatim, and drop any part that is redundant for this guest's situation, " +
                    "e.g. don't tell a guest who already inquired to 'inquire if interested')"
                );
                lines.push(learned);
            }
        } catch {
            /* non-fatal */
        }

        // Proven replies (RAG): the highest-value signal — how OUR team actually
        // answered semantically similar questions on this SAME property group in
        // the past. Retrieved by embedding similarity over real message history.
        if (includeKnowledge && ExemplarService.isEnabled() && guestQuery.trim()) try {
            const exemplars = await new ExemplarService().retrieveForQuery(canonicalListingId, guestQuery, { k: 4, minSim: 0.55 });
            if (exemplars.length) {
                lines.push("");
                lines.push("## How our team answered similar questions before (proven replies — prefer these facts & phrasing)");
                for (const ex of exemplars) {
                    const a = ex.answer.replace(/\s+/g, " ").trim().slice(0, 500);
                    const q = ex.question.replace(/\s+/g, " ").trim().slice(0, 200);
                    lines.push(`- Guest asked: "${q}"\n  Team replied: "${a}"`);
                }
            }
        } catch {
            /* non-fatal */
        }

        // Uploaded listing documents (house manuals, guides, policy sheets):
        // retrieve the most relevant chunks, kept separate by visibility so the
        // model quotes guest-shareable content but only uses internal docs to
        // inform its reply.
        if (includeKnowledge && ExemplarService.isEnabled() && guestQuery.trim()) try {
            const docs = await new RetrievalService().retrieveDocs(canonicalListingId, guestQuery, { k: 3 });
            if (docs.external.length) {
                lines.push("");
                lines.push("## Listing documents (guest-shareable — you MAY share this content)");
                for (const d of docs.external) lines.push(`- ${d.text.replace(/\s+/g, " ").trim().slice(0, 700)}`);
            }
            if (docs.internal.length) {
                lines.push("");
                lines.push("## Internal listing documents (staff-only — use to inform your reply, do NOT quote verbatim)");
                for (const d of docs.internal) lines.push(`- ${d.text.replace(/\s+/g, " ").trim().slice(0, 700)}`);
            }
        } catch {
            /* non-fatal */
        }

        // Live availability: when the guest is asking about availability / dates /
        // extending their stay, pull the real calendar so the reply can answer
        // directly ("the 5th is open at $220") instead of "we'll check".
        if (includeKnowledge) try {
            const guestText = (targetMessage?.body || conversation.lastMessageText || "").toString();
            if (conversation.listingId && this.detectAvailabilityIntent(guestText)) {
                const avail = await this.buildAvailabilityBlock(conversation);
                if (avail) {
                    lines.push("");
                    lines.push("## Live availability (from the calendar — you MAY state these facts to the guest)");
                    lines.push(avail);
                }
            }
        } catch {
            /* non-fatal */
        }

        lines.push("");
        lines.push("## Message history (oldest first)");
        const recent = messages.slice(-25); // cap context size
        for (const m of recent) {
            const who =
                m.direction === "incoming"
                    ? `GUEST (${m.senderName || conversation.guestName || "guest"})`
                    : m.isAutomatic
                    ? "AUTOMATED"
                    : `TEAM (${m.sentByName || m.senderName || "host"})`;
            const body = (m.body || (m.note ? `[note] ${m.note}` : "")).replace(/\s+/g, " ").trim();
            if (!body) continue;
            lines.push(`- ${who}: ${body}`);
        }

        lines.push("");
        if (targetMessage) {
            lines.push("## Latest guest message to answer");
            lines.push((targetMessage.body || "").trim() || "(no text)");
        } else {
            lines.push("## Task");
            lines.push("There is no unanswered guest message; draft a helpful, context-appropriate reply or a check-in follow-up.");
        }

        // Staff steering (composer Refine/Generate). These instructions come from
        // OUR team, take precedence over defaults, and MUST be followed — while
        // still never inventing facts that aren't in context.
        const staffInstructions = (opts.instructions || "").trim();
        if (staffInstructions) {
            const staffDraft = (opts.baseDraft || "").trim();
            lines.push("");
            if (staffDraft) {
                lines.push("## Current draft to revise (written by staff/AI — revise it, do not start over)");
                lines.push(staffDraft);
                lines.push("");
                lines.push("## STAFF INSTRUCTIONS (highest priority — follow these exactly)");
                lines.push(staffInstructions);
                lines.push(
                    "Revise the draft above per these instructions. Keep everything from the draft that the instructions " +
                    "don't ask you to change. Do not add new facts that are not in the provided context."
                );
            } else {
                lines.push("## STAFF INSTRUCTIONS (highest priority — follow these exactly)");
                lines.push(staffInstructions);
                lines.push(
                    "A staff member is telling you what this reply should say. Write the reply to carry out these " +
                    "instructions, adapted to this guest and conversation, in the configured tone. Treat facts the staff " +
                    "member states here as authoritative context you may use."
                );
            }
        }

        lines.push("");
        lines.push("Draft the suggested reply now as STRICT JSON per the schema.");
        return lines.join("\n");
    }
}
