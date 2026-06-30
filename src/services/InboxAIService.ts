import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Listing } from "../entity/Listing";
import { AIMessageSuggestionEntity } from "../entity/AIMessageSuggestion";
import { AIMessageFeedbackEntity } from "../entity/AIMessageFeedback";

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
 * Gated by AI_MESSAGING_ENABLED (see isEnabled()). Auto-send is intentionally not
 * implemented here; AI_MESSAGING_AUTOSEND_ENABLED is reserved for future work.
 */

export const INBOX_AI_PROMPT_VERSION = "inbox-ai-v1";
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

    /** Feature flag. Defaults OFF unless explicitly enabled. */
    static isEnabled(): boolean {
        return String(process.env.AI_MESSAGING_ENABLED || "").toLowerCase() === "true";
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
                    { role: "system", content: this.systemPrompt() },
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

        const confidencePct =
            typeof output.confidence === "number" && Number.isFinite(output.confidence)
                ? Math.max(0, Math.min(100, Math.round(output.confidence * 100)))
                : null;

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

    /** Update a suggestion's lifecycle status (accepted/edited/ignored/rejected). */
    async updateSuggestionStatus(
        id: number,
        status: string,
        opts: { acceptedByUserId?: number | null; finalSentMessageId?: number | null } = {}
    ) {
        const allowed = ["suggested", "accepted", "edited", "ignored", "rejected", "regenerated"];
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

    private systemPrompt(): string {
        return [
            "You are SecureStay's guest-messaging assistant for short-term rental operations.",
            "You draft a SUGGESTED reply for a human agent to review. You never send messages yourself.",
            "",
            "PRINCIPLES:",
            "- Be warm, concise, professional, and helpful. Match a hospitality brand voice.",
            "- NEVER invent facts (codes, prices, policies, amenities, addresses). Only use provided context.",
            "- If needed information is missing, say so in `warnings` and write a safe reply that asks the guest for clarification or says the team will follow up — do not guess.",
            "- Prefer the property's documented house rules / check-in info when present in context.",
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

    /** Build the user-message context block from conversation + reservation + listing. */
    private async buildContext(
        conversation: InboxConversationEntity,
        messages: InboxMessageEntity[],
        targetMessage: InboxMessageEntity | null
    ): Promise<string> {
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

        // Best-effort listing house-rules / check-in context from local reservation+listing.
        try {
            const listingId = conversation.listingId;
            const listing = listingId
                ? await this.listingRepo.findOne({ where: { id: Number(listingId) }, withDeleted: true })
                : null;
            if (listing) {
                const ll: string[] = [];
                if ((listing as any).checkIn) ll.push(`check-in ${(listing as any).checkIn}`);
                if ((listing as any).checkOut) ll.push(`check-out ${(listing as any).checkOut}`);
                if (ll.length) lines.push(`Listing times: ${ll.join(", ")}`);
                // TODO: Pull richer house rules / listing documentation here once the
                // listing-documents retrieval layer (Core feature 9) is implemented.
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
