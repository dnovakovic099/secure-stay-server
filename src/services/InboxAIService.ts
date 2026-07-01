import OpenAI from "openai";
import { IsNull } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Listing } from "../entity/Listing";
import { AIMessageSuggestionEntity } from "../entity/AIMessageSuggestion";
import { AIMessageFeedbackEntity } from "../entity/AIMessageFeedback";
import { InboxService } from "./InboxService";
import { ListingKnowledgeService } from "./ListingKnowledgeService";
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

        // Cache: reuse the last suggestion for this target unless force=true.
        if (!options.force) {
            const existing = await this.getLatestSuggestion(threadId, targetMessageId);
            if (existing) return existing;
        }

        const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);
        const context = await this.buildContext(conversation, messages, targetMessage);
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
                    { role: "system", content: this.systemPrompt(settings) },
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
        if (noPendingQuestion) {
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
            if (noPendingQuestion) confidencePct = Math.min(confidencePct, 30);
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

    private scanForEscalation(text: string): string | null {
        for (const { pattern, reason } of ESCALATION_KEYWORDS) {
            if (pattern.test(text)) return reason;
        }
        return null;
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
            suggested_reply: String(parsed.suggested_reply || "").trim(),
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence) || 0,
            escalation_required: Boolean(parsed.escalation_required),
            escalation_reason: parsed.escalation_reason ? String(parsed.escalation_reason) : null,
            internal_summary: parsed.internal_summary ? String(parsed.internal_summary) : null,
            sources_used: Array.isArray(parsed.sources_used) ? parsed.sources_used.map(String) : [],
            warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
            suggested_action_items: Array.isArray(parsed.suggested_action_items)
                ? parsed.suggested_action_items.map(String)
                : [],
        };
    }

    private systemPrompt(settings?: AIMessagingSettingsEntity | null): string {
        const toneLabel = (settings?.tone || "warm").trim();
        const customRules = (settings?.communicationRules || "").trim();
        const topicsToAvoid = (settings?.topicsToAvoid || "").trim();

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
        settingsBlock.push("");

        return [
            "You are SecureStay's guest-messaging assistant for short-term rental operations.",
            "You draft a SUGGESTED reply for a human agent to review. You never send messages yourself.",
            "",
            ...settingsBlock,
            "PRINCIPLES:",
            `- Be concise, professional, and helpful with a ${toneLabel} hospitality brand voice.`,
            "- NEVER invent facts (codes, prices, policies, amenities, addresses). Only use provided context.",
            "- Do NOT invent physical features or capacities. In particular, never name a parking type (garage, driveway, carport, lot) or a specific number of cars/vehicles unless that detail appears in the provided context. If parking specifics are not in context, describe only what IS known and offer to confirm the rest — do not guess.",
            "- Earlier TEAM messages in this same thread are authoritative: prefer them, reuse their facts, and NEVER contradict something the team already told this guest.",
            "- The 'proven replies' section shows how our team answered similar questions for THIS property before. Strongly prefer their facts, specifics, and tone; adapt to the current guest. If they conflict with listing context, trust listing context and the current thread.",
            "- Answer DIRECTLY and confidently when the context (proven replies, learned answers, listing knowledge, availability, reservation details) already contains the answer. Do NOT default to 'the team will confirm' for information you already have — only defer for things genuinely not in context.",
            "- PRICING: never offer, promise, negotiate, or imply a discount, deal, coupon, or 'special offer'. If a guest asks for a better/lower price, explain the rate shown reflects current dynamic pricing for those dates; do not invent reductions.",
            "- POLICY EXCEPTIONS: never promise or commit to fee waivers, refunds, cancellations without penalty, rebooking, date changes, early check-in/late check-out, or any exception to policy. Say you'll have the team review the request. For platform cancellations or rebooking (Airbnb/Booking.com/Vrbo), direct the guest to manage it through that platform. Do not state a fee amount that is not in the provided context.",
            "- Do NOT put a specific door code, lock code, access code, gate code, wifi password, or a specific price/amount in the reply UNLESS that exact value already appears in the provided message history or listing context. If the guest needs a code or figure you do not have, say the team will send it (e.g. before check-in) rather than guessing a value.",
            "- If needed information is missing, say so in `warnings` and write a safe reply that asks the guest for clarification or says the team will follow up — do not guess.",
            "- Prefer the property's documented house rules / check-in info when present in context.",
            "- Reply in the same language the guest used.",
            "",
            "AVAILABILITY / EXTENSIONS:",
            "- If a 'Live availability' section is present, it is real calendar data. You MAY state those specific open dates and nightly prices to the guest and answer availability/extension questions directly — do NOT say 'let me check' or 'I'll get back to you' when this data is present.",
            "- For an extension request, if the relevant night is available, confirm it and its nightly price, then say the team will finalize the booking/charge (you cannot modify the reservation yourself). This does NOT require escalation.",
            "- If the requested night is NOT available per the calendar, tell the guest it's unavailable and, if helpful, mention the nearest open dates.",
            "- Only escalate availability/extension messages when the guest is negotiating price/discounts or the calendar data is absent.",
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
            '  "suggested_action_items": ["optional internal tasks, e.g. \'Confirm early check-in availability\'"]',
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
            "stay longer", "add a night", "add another", "additional night",
            "early check", "late check", "check in early", "check out late", "checkout late",
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
    private async buildContext(
        conversation: InboxConversationEntity,
        messages: InboxMessageEntity[],
        targetMessage: InboxMessageEntity | null,
        opts: { includeKnowledge?: boolean } = {}
    ): Promise<string> {
        const includeKnowledge = opts.includeKnowledge !== false;
        const lines: string[] = [];
        lines.push("## Conversation context");
        lines.push(`Channel: ${conversation.channel || "unknown"}`);
        lines.push(`Guest: ${conversation.guestName || "unknown"}`);
        lines.push(`Listing: ${conversation.listingName || "unknown"}`);
        if (conversation.checkin || conversation.checkout) {
            lines.push(`Stay: ${conversation.checkin || "?"} to ${conversation.checkout || "?"} (${conversation.nights ?? "?"} nights, ${conversation.guests ?? "?"} guests)`);
        }
        if (conversation.price != null) {
            lines.push(`Booking total: ${conversation.price} ${conversation.currency || ""}`.trim());
        }
        if (conversation.reservationStatus) lines.push(`Reservation status: ${conversation.reservationStatus}`);

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

        // Best-effort listing house-rules / check-in context from local reservation+listing.
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
            }
        } catch {
            /* non-fatal */
        }

        // Property-specific Knowledge Base (staff-maintained on the All Listings
        // page). External entries are guest-shareable; internal entries inform the
        // reply but must not be quoted to the guest.
        const guestQuery = (targetMessage?.body || conversation.lastMessageText || "").toString();
        if (includeKnowledge) try {
            const kb = await new ListingKnowledgeService().renderForBot(conversation.listingId, { query: guestQuery, listingIds: groupIds });
            if (kb) {
                lines.push("");
                lines.push("## Listing Knowledge Base");
                lines.push(kb);
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
                lines.push("## Learned answers (approved — you MAY use these directly)");
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
        lines.push("");
        lines.push("Draft the suggested reply now as STRICT JSON per the schema.");
        return lines.join("\n");
    }
}
