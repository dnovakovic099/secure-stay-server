import OpenAI from "openai";
import { IsNull, LessThanOrEqual } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { QuoConversationEntity } from "../entity/QuoConversation";
import { QuoMessageEntity } from "../entity/QuoMessage";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Listing } from "../entity/Listing";
import { ListingDetail } from "../entity/ListingDetails";
import { ListingIntake } from "../entity/ListingIntake";
import { AIMessageSuggestionEntity } from "../entity/AIMessageSuggestion";
import { AIMessageFeedbackEntity } from "../entity/AIMessageFeedback";
import { AIGuestAutosendDisableEntity } from "../entity/AIGuestAutosendDisable";
import { InboxService } from "./InboxService";
import { OverduePaymentService } from "./OverduePaymentService";
import { ListingKnowledgeService } from "./ListingKnowledgeService";
import { ListingKnowledgeSeeder } from "./ListingKnowledgeSeeder";
import {
    AIMessagingSettingsService,
    normalizeEarlyLateHandling,
} from "./AIMessagingSettingsService";
import { AIMessagingSettingsEntity } from "../entity/AIMessagingSettings";
import { AILearnedFactsService } from "./AILearnedFactsService";
import { ListingGroupService } from "./ListingGroupService";
import { ExemplarService } from "./ExemplarService";
import { RetrievalService } from "./RetrievalService";
import { Hostify } from "../client/Hostify";
import sendSlackMessage from "../utils/sendSlackMsg";
import {
    FactLedger,
    hardFactSystemAddendum,
    restructureContextForHardFacts,
    ungroundedClaims,
} from "./InboxAIFactLedger";
import {
    detectUnsafeAsserts,
    guestReportsLockout,
    isBookingConfirmedStatus,
    resolveContestedFacts,
    stayAllowsAccessCodes,
} from "./InboxAIContestedFacts";
import { ListingOpsOverrideService } from "./ListingOpsOverrideService";
import {
    AssertableFact,
    AssertEvalContext,
    derivePaymentState,
    guestAsksAgreement,
    guestAsksWifi,
    opsTextExplicitlyConfirmed,
    PaymentState,
    renderAssertPolicyBlock,
    renderEarlyLateCheckPolicy,
} from "./InboxAIAssertPolicy";

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

export const INBOX_AI_PROMPT_VERSION = "inbox-ai-v7.8"; // v7.8: guest-code echo gate + payment_state diagnosis
const INBOX_AI_MODEL = process.env.AI_MESSAGING_MODEL || "gpt-4.1";

const textOrDefault = (value: string | null | undefined, fallback: string): string =>
    String(value || "").trim() || fallback;

export const AI_REPLY_RULE_DEFAULTS = {
    baseReplyStyleRules: "",
    airbnbSupportBaseRules:
        "THIS CONVERSATION IS WITH AIRBNB SUPPORT (a platform case worker, NOT a guest). " +
        "Write as the host's team addressing Airbnb: factual, professional, case-focused. " +
        "Do not use guest hospitality phrasing ('we hope to host you', reviews, upsells).",
    inquirySalesBaseRules: [
        "NEW INQUIRY — SALES MODE (this guest has NOT booked yet; your reply is a sales conversation and its job is to win the booking).",
        "For this reply you are the host texting back, not a support desk. The guest is reading on their phone, half-paying-attention, and can smell a corporate bot from a mile away. Sound human, answer fast, and nudge toward booking without ever being pushy or fake.",
        "",
        "VOICE:",
        "- First person, always. Say 'I've got a kayak on the pond', never 'there is a kayak available' or 'the property offers'. You are a person, not a property.",
        "- WARM, not clipped. You're genuinely glad they reached out and you'd love to host them — let that show in the wording. Short does NOT mean cold: a terse list of facts reads like a vending machine. Wrap the facts in a host's kindness ('you'll love...', 'it's all yours to enjoy', 'happy to help you plan').",
        "- Contractions always. Max one exclamation point per three sentences. No em dashes. No three-item parallel lists ('kayaking, grilling, and relaxing').",
        "- Banned words/phrases: 'certainly', 'I'd be happy to', 'feel free to', 'our property offers', 'nestled', 'oasis', 'a wonderful way to experience', 'perfect for relaxing and enjoying'.",
        "- Specificity beats adjectives: 'the sunset off the back deck is unreal' sells; 'beautiful views' doesn't. Concrete detail (from context only) makes them picture themselves there.",
        "",
        "STRUCTURE:",
        "- Answer their exact question first, in their order. Front-load the yes. Never open with 'Thanks for reaching out!' and make them scroll for the answer.",
        "- State amenities plainly and cut justification clauses: 'Grill and private hot tub too.' Not 'we provide a grill so you can enjoy relaxing after your adventures.'",
        "- Mention 1-2 related things we actually offer (from the listing context) that fit what they asked about. Skip entirely if nothing relates. NEVER invent amenities.",
        "- Mirror their intent ONCE if they mention kids, a dog, an anniversary, or group size: 'perfect spot for the kids to run around out back.' One reflection, not a theme.",
        "- One social-proof line ONLY if real guest feedback/reviews appear in the provided context, matched to what they asked about. Never generic ('past guests loved it'), never on every amenity, never invented.",
        "- Seasonal timing is a fair soft nudge when it's honest general knowledge for the area. Local events, festivals, games or news: ONLY if they appear in the provided context.",
        "- END WARM. The last line is what they remember — it must make them feel wanted as guests, never processed.",
        "",
        "HONESTY & LIMITS:",
        "- Genuine urgency only, and only from the live availability data. Never fake scarcity.",
        "- If we genuinely don't have what they need, say so straight — trust wins more bookings than spin. Never imply they already have a confirmed reservation.",
        "- NEVER offer to hold dates, NEVER ask for or offer a phone number or email, NEVER push anything off-platform, NEVER offer discounts. Booking happens on the platform.",
        "- Length: 2-4 sentences when it fits; more only if the question genuinely needs it. Never pad.",
        "",
        "EXAMPLES OF THE TARGET FEEL (adapt facts to the actual context, never copy amenities from these):",
        "Guest: 'Is there anything to do on the water there? And are the dates in July open?' → 'Yep! Kayak's on the pond and the fishing's great this time of year. Grill and private hot tub too. Place is open July 9 to Aug 21 if those are your dates. Just the two of you or a bigger group? Either way we'd love to have you out here.'",
        "Guest: 'Do you allow dogs? We have a golden retriever.' → 'I do, dogs are welcome! There's a fenced yard out back so your golden can run around off-leash. We'd love to host you both.'",
        "If a line sounds like a brochure or an upsell, rewrite it or cut it. If the last line could come from a support ticket, rewrite it warmer.",
    ].join("\n"),
    selfServiceTroubleshootingRules: [
        "SELF-SERVICE TROUBLESHOOTING MODE (enabled by the team):",
        "When a guest reports an in-stay issue that commonly has a guest-side fix (wifi/router, TV/remote, smart lock or keypad, thermostat/AC/heat, breaker/power, appliances, hot water):",
        "- FIRST check the property knowledge/context for documented fixes (router location and restart steps, breaker panel location, lock instructions, remote/TV input steps).",
        "- If steps exist, walk the guest through them clearly and numbered, one short step per line, then ask them to try it and let you know if it works. Reassure them the team will step in if it doesn't.",
        "- Only offer steps that are actually documented in the provided context. If nothing is documented for the issue, acknowledge, say the team is on it, and escalate as usual.",
        "- NEVER troubleshoot when the issue is dangerous (gas smell, sparks, flooding, fire, carbon monoxide, break-in) or the guest is locked OUT at night — escalate those immediately.",
        "- If the guest already tried the fix or says it didn't work, do NOT repeat the same steps — acknowledge and escalate to the team.",
    ].join("\n"),
    quoSmsRules:
        "This reply is sent as a plain SMS text message. Keep it tight (1-3 sentences unless the question needs more), no links unless they were already shared in this thread, no markdown or formatting.",
    quoPmClientRules: [
        "THIS CONVERSATION IS WITH A PROPERTY-MANAGEMENT CLIENT — the OWNER of properties we manage — NOT a guest.",
        "You are their property manager's assistant texting them back. They pay us to manage their rentals; treat them as a business partner who deserves straight answers about THEIR OWN properties.",
        "- The transcript labels the other party 'GUEST' for technical reasons — they are the CLIENT (owner). Never use guest hospitality phrasing (no 'we hope you enjoy your stay', no booking upsells, no 'we'd love to host you').",
        "- You MAY share operational details about the client's OWN properties from the provided context: bookings and dates, occupancy, statuses, maintenance items, payout/revenue figures that appear in context. Frame calendar/occupancy answers as 'Hostify / our system shows…' — never absolute certainty. Mention guest names only if they ask who is staying.",
        "- OWNER DISPUTES OCCUPANCY/CALENDAR: if they say there is no booking, the calendar is wrong, or a stay was cancelled — acknowledge, do NOT insist the LIVE BOOKINGS snapshot is correct, say the team will verify, escalation_required=true.",
        "- NEVER share information about OTHER clients, other owners' properties, internal margins, or staff/vendor internal pricing.",
        "- CLEANING & MAINTENANCE: check the SERVICE PACKAGE block in the context. On FULL-service properties our team coordinates cleaners/maintenance and you may promise that. On LAUNCH or PRO package properties the client handles their own cleaning and maintenance — never offer to send a cleaner, schedule maintenance, or coordinate vendors there.",
        "- If they ask about money we owe them, statements, contract terms, management fees, offboarding, or anything legal/financial beyond the figures in context: acknowledge, say the team will follow up with specifics, and set escalation_required=true.",
        "- If the answer isn't in the provided context, say the team will check and get back to them — never guess about their business.",
        "- When they REQUEST a change (block dates, adjust pricing, schedule maintenance, update the listing): acknowledge it, commit to it ('I'll have the team block that and confirm'), and include it in suggested_action_items — but NEVER say it's already done. You cannot change calendars, prices, or listings yourself.",
        "- CALL SCHEDULING: never offer a call today/tomorrow or pick a time yourself. Say a teammate will confirm a time, set escalation_required=true, and stop. You do not know staff availability.",
        "- Tone: professional, warm, concise. Use their first name naturally. SMS style — short.",
    ].join("\n"),
    quoUnlinkedThreadRules:
        "This SMS thread is NOT linked to a reservation, so there is no listing/reservation context. Answer only from the conversation itself. EXCEPTION: if the context contains a 'LIVE listing search results' block, that search has already been run — share those results per its instructions. Otherwise, if the guest asks something property-specific you can't answer, say you'll check and follow up.",
};

/** Topics that must always route to a human, regardless of model confidence. */
const ESCALATION_KEYWORDS: { pattern: RegExp; reason: string }[] = [
    { pattern: /\brefund(s|ed|ing)?\b/i, reason: "Refund request" },
    {
        pattern: /\b(discount|comp(?:ed|s)?|complimentary|free\s+night|goodwill|credit(?:\s+night)?|reimburse)\b/i,
        reason: "Discount/credit/complimentary request",
    },
    { pattern: /\b(lawyer|legal|sue|lawsuit|attorney|liabilit)/i, reason: "Legal issue" },
    { pattern: /\b(threat|kill|hurt|weapon|gun)\b/i, reason: "Threat" },
    { pattern: /\b(emergency|fire|flood|gas leak|carbon monoxide|injur|bleed|ambulance|police|911)\b/i, reason: "Safety/emergency" },
    { pattern: /\b(discriminat|racis|fair housing|disability|service animal denied)/i, reason: "Discrimination / fair-housing sensitive" },
    { pattern: /\b(damage|broke|broken|destroyed)\b/i, reason: "Possible damage claim" },
    { pattern: /\b(deposit|security deposit)\b/i, reason: "Security deposit" },
    { pattern: /\b(cancel|cancellation|cancelling)\b/i, reason: "Cancellation / penalty" },
    { pattern: /\b(chargeback|dispute|bad review|1 star|one star|report you)\b/i, reason: "Angry guest / review risk" },
    // Early/late check-in/out are governed by Upsells SDTO (Not Allowed /
    // Needs Confirmation / Allowed) — not blanket escalation. See buildUpsellsBlock.
    { pattern: /\b(extra|additional|more)\s+(guest|people|person|visitor)s?\b|\bguest\s+count\b|\badd\s+(a\s+)?guests?\b/i, reason: "Group-size change (team decides)" },
    { pattern: /\bwaiv(e|er|ed|ing)\b|\bskip\s+the\s+fee\b|\bfee\s+(waiver|removed|dropped)\b/i, reason: "Fee waiver request (team decides)" },
    // Call scheduling is staff-availability dependent. July 20 audit: AI offered
    // "I can make time for a call today" when the teammate was only free tomorrow.
    { pattern: /\b(schedule|set\s+up|book)\s+(a\s+)?(call|phone\s+call|phone\s+chat)\b|\b(call|phone)\s+(me|us|you)\b|\b(have|got|got\s+any|any)\s+time\s+(today|tomorrow|this\s+week)\b.*\b(call|chat|talk)\b|\bunless\s+you\s+have\s+time\s+today\b|\b(can|could)\s+we\s+(talk|chat|call)\b|\bjump\s+on\s+(a\s+)?call\b/i, reason: "Call scheduling (live person decides)" },
    // Extra amenity / baby-gear fulfillment is inventory + owner dependent.
    // July 20 audit: AI said "already working to arrange 3 pack n plays" when
    // ops usually only has 1 on-site. Acknowledge + check; never promise qty.
    { pattern: /\b(pack[\s-]*n[\s-]*plays?|pack[\s-]*and[\s-]*plays?|playards?|high[\s-]*chairs?|booster\s+seats?|cribs?|porta[\s-]*cribs?|travel\s+cribs?|rollaways?|air\s*mattress(?:es)?|extra\s+(beds?|cots?|towels?|pillows?|blankets?))\b/i, reason: "Amenity/gear request (team confirms inventory)" },
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
    private listingDetailRepo = appDatabase.getRepository(ListingDetail);
    private guestAutosendDisableRepo = appDatabase.getRepository(AIGuestAutosendDisableEntity);
    private suggestionRepo = appDatabase.getRepository(AIMessageSuggestionEntity);
    private feedbackRepo = appDatabase.getRepository(AIMessageFeedbackEntity);
    private hostify = new Hostify();
    private overduePaymentService = new OverduePaymentService();

    private get hostifyApiKey(): string {
        return process.env.HOSTIFY_API_KEY as string;
    }

    /** Feature flag. Defaults OFF unless explicitly enabled. */
    static isEnabled(): boolean {
        return String(process.env.AI_MESSAGING_ENABLED || "").toLowerCase() === "true";
    }

    /**
     * Legacy env-only snapshot. The real auto-send decision is DB-backed via
     * resolveAutosendEnabled() / resolveQuoAutosendEnabled().
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

    /** Public config snapshot for older sync callers. */
    static autosendConfig() {
        return {
            enabled: InboxAIService.isAutosendEnabled(),
            minConfidence: InboxAIService.autosendMinConfidence(),
            allowedChannels: InboxAIService.autosendAllowedChannels(),
        };
    }

    /**
     * Hostify auto-send resolution. The AI Assistant Settings page is the source
     * of truth for enabling auto-response. Env may only force it OFF.
     */
    static async resolveAutosendEnabled(): Promise<boolean> {
        if (!InboxAIService.isEnabled()) return false;
        const envRaw = String(process.env.AI_MESSAGING_AUTOSEND_ENABLED || "").toLowerCase();
        if (envRaw === "false") return false; // hard kill-switch
        try {
            const s = await new AIMessagingSettingsService().getGlobalCached();
            return Boolean(s.autoRespondEnabled);
        } catch {
            return false;
        }
    }

    /**
     * Quo PM auto-send resolution. Requires the global Quo toggle plus the
     * specific Quo phone line toggle from the AI Assistant Settings page.
     */
    static async resolveQuoAutosendEnabled(phoneNumberId: string): Promise<boolean> {
        if (!InboxAIService.quoSuggestionsEnabled()) return false;
        const envRaw = String(process.env.AI_MESSAGING_AUTOSEND_ENABLED || "").toLowerCase();
        if (envRaw === "false") return false; // emergency kill-switch only
        try {
            const settingsService = new AIMessagingSettingsService();
            const s = await settingsService.getGlobalCached();
            if (!s.quoAutoRespondEnabled) return false;
            return settingsService.isQuoLineAutoRespondEnabled(phoneNumberId);
        } catch {
            return false;
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
        const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);
        return {
            enabled: await InboxAIService.resolveAutosendEnabled(),
            minConfidence: await InboxAIService.autosendMinConfidenceAsync(),
            allowedChannels: await InboxAIService.autosendAllowedChannelsAsync(),
            tierEnabled: Boolean(settings?.autosendTierEnabled),
            instantMinConfidence: Number(settings?.autosendInstantMinConfidence ?? 95),
            delayedMinConfidence: Number(settings?.autosendDelayedMinConfidence ?? 85),
            delayMinutes: Number(settings?.autosendDelayMinutes ?? 5),
            inquiryAutoRespondEnabled: Boolean(settings?.inquiryAutoRespondEnabled),
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
        // source filter: quo suggestions reuse this table with their own
        // (small) numeric thread ids that could collide with Hostify's.
        const where: any = { threadId, source: "hostify" };
        if (messageId != null) where.messageId = messageId;
        return this.suggestionRepo.findOne({ where, order: { generatedAt: "DESC", id: "DESC" } });
    }

    async listSuggestionsForThread(threadId: number) {
        return this.suggestionRepo.find({
            where: { threadId, source: "hostify" },
            order: { generatedAt: "DESC", id: "DESC" },
        });
    }

    /**
     * Generate (or return a cached) suggestion for the latest unanswered guest
     * message in a thread. Persists what it generates. Returns null (no
     * generation) for auto-triggered calls when there is no pending inbound
     * message to answer.
     */
    async generateSuggestion(threadId: number, options: GenerateOptions = {}): Promise<AIMessageSuggestionEntity | null> {
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

        // Auto-triggered generations (thread open, no cached draft) skip threads
        // with nothing to answer: the latest message is ours, so a fresh draft is
        // wasted spend and analytics noise (928 such drafts in 14 days — July
        // audit). Deliberate asks still generate: force=true (the "Suggest a
        // reply" button), an explicit messageId (compare view / auto-respond
        // pipeline), or staff instructions (Generate/Refine).
        const lastThreadMessage = messages.length ? messages[messages.length - 1] : null;
        const autoTriggered = !options.force && !instructions && options.messageId == null;
        if (autoTriggered && (!targetMessage || (lastThreadMessage && lastThreadMessage.direction !== "incoming"))) {
            return null;
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
        const inquirySales =
            InboxAIService.isInquiryStatus(conversation.reservationStatus) &&
            !this.isAirbnbSupportThread(conversation, messages);

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
                            inquirySales,
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

        // (b2) Completion-claim net: the reply asserts an action already happened
        //      ("I've blocked…", "you're all set") with no confirmation in context.
        const actionClaims = this.detectActionClaims(reply, contextHaystack);
        if (actionClaims.length) {
            warnings.push(
                `Reply claims action(s) already completed with no confirmation in context: ${actionClaims
                    .map((c) => `"${c}"`)
                    .join("; ")}. Confirm it actually happened or rephrase as a commitment.`
            );
        }

        // (b3) Speech-act gate — codes, discretionary approvals, unconfirmed ops
        //      completions, Hostify-as-agreement — even when raw values exist in context.
        const stageLine = this.stayStageLine(conversation.checkin, conversation.checkout);
        const guestAskText = targetMessage?.body || conversation.lastMessageText || "";
        const codesAllowed = stayAllowsAccessCodes(stageLine) || guestReportsLockout(guestAskText);
        const paymentStateMatch = context.match(/payment_state:\s*(paid|due|failed|auth_required|unknown)/i);
        const paymentState = (paymentStateMatch?.[1]?.toLowerCase() || "unknown") as PaymentState;
        const unsafeAsserts = detectUnsafeAsserts(reply, {
            codesAllowed,
            agreementAsk: guestAsksAgreement(guestAskText),
            hasExplicitOpsConfirmation: /\[ops_confirm_ok\]/i.test(context),
            bookingConfirmed: isBookingConfirmedStatus(conversation.reservationStatus),
            guestText: guestAskText,
            earlyCheckinHandling: settings?.earlyCheckinHandling,
            lateCheckoutHandling: settings?.lateCheckoutHandling,
            // Hostify inbox is guest/Airbnb-support; PM owners are Quo PM lines.
            pmClient: /PM client/i.test(String(conversation.channel || "")),
            contextHaystack: contextHaystack,
            paymentState,
        });
        if (unsafeAsserts.length) {
            warnings.push(
                `Reply asserts something that must not be stated yet: ${unsafeAsserts.join(", ")}. ` +
                    `Defer to the team (fee OK for upsells; never approve; never share codes pre-arrival; never claim ops completion or booking confirmation without proof).`
            );
            output.escalation_required = true;
            output.escalation_reason = output.escalation_reason
                ? `${output.escalation_reason}; unsafe_assert:${unsafeAsserts.join("|")}`
                : `unsafe_assert:${unsafeAsserts.join("|")}`;
        }
        // Contested-field conflict in context + guest asking about those topics.
        if (
            /CONFLICT/i.test(context) &&
            /\b(check[\s-]*out|check[\s-]*in|how many guests|max(?:imum)? guests|sleeps|occupancy)\b/i.test(
                targetMessage?.body || conversation.lastMessageText || ""
            )
        ) {
            output.escalation_required = true;
            output.escalation_reason = output.escalation_reason
                ? `${output.escalation_reason}; contested_field_conflict`
                : "contested_field_conflict";
            warnings.push(
                "Contested listing fact conflict in context — do not assert check-in/out time or capacity; team must confirm."
            );
        }

        // Extension pricing security: pin thread to Urgent for a human rate quote.
        // Hostify calendar prices are not trusted for guest-facing extension quotes.
        if (this.detectExtensionAsk(guestAskText)) {
            output.escalation_required = true;
            output.escalation_reason = output.escalation_reason
                ? `${output.escalation_reason}; extension_price_needs_human`
                : "extension_price_needs_human";
            warnings.push(
                "Extension pricing must come from a teammate — do not quote Hostify calendar nightly rates. Thread pinned to Urgent."
            );
            if (/[$€£]\s?\d/.test(reply)) {
                // Strip AI-quoted dollars from the draft; keep a safe holding reply.
                output.suggested_reply =
                    "Thanks for asking about extending your stay — I'm checking availability with the team and we'll confirm the exact rate shortly.";
                warnings.push("Removed AI-quoted extension price from draft; human must supply the rate.");
            }
            try {
                const reason = `Guest asked about extending their stay — please confirm availability and reply with the exact extension price. Do not rely on Hostify calendar rates alone.`;
                await this.overduePaymentService.raiseEmergency(conversation, reason, "extension_price", {
                    notify: false,
                });
            } catch (err: any) {
                logger.warn(
                    `[InboxAIService] extension_price urgent flag failed (thread ${threadId}): ${err?.message}`
                );
            }
        }
        output.warnings = warnings;

        // (c) Calibrate confidence down when the reply is risky or under-informed.
        let confidencePct =
            typeof output.confidence === "number" && Number.isFinite(output.confidence)
                ? Math.max(0, Math.min(100, Math.round(output.confidence * 100)))
                : null;
        if (confidencePct != null) {
            if (leaks.length) confidencePct = Math.min(confidencePct, 30);
            if (actionClaims.length) confidencePct = Math.min(confidencePct, 35);
            if (unsafeAsserts.length) confidencePct = Math.min(confidencePct, 30);
            if (output.escalation_required) confidencePct = Math.min(confidencePct, 45);
            else if (warnings.length) confidencePct = Math.min(confidencePct, 60);
            if (noPendingQuestion && !instructions) confidencePct = Math.min(confidencePct, 30);
        }

        // (d) Independent verifier pass: a second model fact-checks the drafted
        //     reply against the exact context it was generated from. The
        //     generator's self-score clusters at 95-100 and hides real mistakes;
        //     this score is what confidence-gated auto-send will trust.
        //     Best-effort with a hard timeout — never blocks the suggestion.
        const verifier = await Promise.race([
            this.runReplyVerifier({ context, reply: output.suggested_reply || "" }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
        ]);

        const suggestion = this.suggestionRepo.create({
            threadId,
            messageId: targetMessageId,
            reservationId: conversation.reservationId,
            listingId: conversation.listingId,
            suggestedReply: output.suggested_reply || null,
            confidence: confidencePct,
            verifierConfidence: verifier?.confidence ?? null,
            verifierNote: verifier?.note ?? null,
            escalationRequired: output.escalation_required ? 1 : 0,
            escalationReason: output.escalation_reason ? String(output.escalation_reason).slice(0, 500) : null,
            internalSummary: output.internal_summary || null,
            sourcesUsed: JSON.stringify(output.sources_used || []),
            warnings: JSON.stringify(output.warnings || []),
            suggestedActionItems: JSON.stringify(output.suggested_action_items || []),
            modelName: INBOX_AI_MODEL,
            promptVersion: INBOX_AI_PROMPT_VERSION,
            status: "suggested",
            salesMode: inquirySales ? 1 : 0,
            rawResponse: raw.slice(0, 60000) || null,
            generatedAt: new Date(),
        });
        const saved = await this.suggestionRepo.save(suggestion);
        logger.info(
            `[InboxAIService] suggestion ${saved.id} generated for thread ${threadId} ` +
            `(conf ${confidencePct ?? "?"}, verified ${verifier?.confidence ?? "?"}, escalate ${saved.escalationRequired})`
        );

        // Proposed one-click actions (late checkout, lock code resend, ops
        // ticket) for the guest message that triggered this suggestion.
        // Best-effort; never blocks or fails the suggestion.
        if (targetMessage && targetMessage.direction === "incoming" && !instructions) {
            try {
                const { AIProposedActionService } = await import("./AIProposedActionService");
                new AIProposedActionService()
                    .detectForMessage({ conversation, guestMessage: targetMessage, suggestion: saved })
                    .catch(() => {});
            } catch {
                /* non-fatal */
            }
        }

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
     * Completion-claim detector (July audit: #1 miss pattern in BOTH inboxes).
     * The model asserts operational actions are already done — "I've blocked
     * off 7/19", "You're all set for a 2 PM checkout", "your refund has been
     * processed" — when nothing in the context confirms anyone did anything.
     * The verifier misses these because they aren't contradicted by context,
     * just unsupported by it. Returns the offending phrases; empty = clean.
     */
    private detectActionClaims(reply: string, contextHaystack: string): string[] {
        const text = String(reply || "");
        if (!text.trim()) return [];
        const hay = contextHaystack.toLowerCase();
        const claims: string[] = [];
        const verbGroup =
            "(blocked|booked|approved|confirmed|scheduled|arranged|processed|refunded|extended|updated|adjusted|added|removed|cancelled|canceled|waived|applied|activated|deactivated|reserved|set up|taken care of)";
        const patterns: RegExp[] = [
            // "I've blocked…", "we've already approved…", "we have gone ahead and scheduled…"
            new RegExp(
                `\\b(?:i|we)(?:['’]ve|\\s+have)\\s+(?:already\\s+|just\\s+|gone\\s+ahead\\s+and\\s+)?${verbGroup}\\b[^.!?\\n]{0,80}`,
                "gi"
            ),
            // "…has been approved", "it's been refunded"
            new RegExp(`\\b(?:has|have)\\s+(?:already\\s+)?been\\s+${verbGroup}\\b[^.!?\\n]{0,80}`, "gi"),
            new RegExp(`\\b(?:it|that)['’]s\\s+(?:already\\s+)?been\\s+${verbGroup}\\b[^.!?\\n]{0,80}`, "gi"),
            // "you're all set", "everything is set for…"
            /\byou(?:['’]re| are)\s+all\s+set\b[^.!?\n]{0,60}/gi,
        ];
        for (const re of patterns) {
            for (const match of text.match(re) || []) {
                // Evidence check: only the completed form counts ("blocked" in a
                // team message grounds "I've blocked"; the guest ASKING "can you
                // block" does not). Exact-form match keeps this tight.
                const m = match.toLowerCase();
                const verb = (m.match(new RegExp(verbGroup, "i")) || [])[0]?.toLowerCase() || null;
                if (verb && hay.includes(verb)) continue;
                if (!verb && /all\s+set/.test(m) && hay.includes("all set")) continue;
                claims.push(match.trim());
            }
        }
        return [...new Set(claims)].slice(0, 5);
    }

    private get verifierModel(): string {
        // Full model: mini scored 82% of replies at 95+ confidence while 16.5%
        // of that band were judged mistakes — too lenient to gate auto-send.
        return process.env.AI_VERIFIER_MODEL || "gpt-4.1";
    }

    private verifierPrompt(): string {
        return [
            "You are a strict pre-send reviewer for a short-term-rental guest-messaging AI.",
            "You get the full CONTEXT the AI had when drafting (conversation history, guest's latest message, reservation data, property knowledge, availability, proven replies) followed by the DRAFTED REPLY.",
            "Score how safe it is to send the reply AS-IS with no human review: send_confidence 0-100.",
            "",
            "Check each of these independently:",
            "1. GROUNDING — every factual claim in the reply (amenities, house rules, prices, fees, times, codes, addresses, availability, policies) must be supported by the context. Any claim NOT supported by the context caps the score at 40, even if it sounds plausible.",
            "2. COMPLETENESS — every explicit question or request in the guest's latest message must be addressed, including each part of a multi-part message. A skipped ask caps the score at 55.",
            "3. DEFERRAL — if the reply defers ('I'll check', 'the team will confirm') while the context already contains the answer, cap at 50. If the context genuinely lacks the answer, deferring is CORRECT and should score well (85+ if polite and safe).",
            "4. COMMITMENTS — promises, discounts, exceptions, or guarantees not documented in the context cap the score at 30.",
            "5. COMPLETION CLAIMS — if the reply states an operational action is already done, approved, or arranged ('I've blocked those dates', 'you're all set for late checkout', 'your refund has been processed') and the context does NOT explicitly confirm that action occurred, cap at 25. A request being made is not the same as it being done. Committing to do something ('I'll have the team block that') is fine; claiming it is DONE without evidence is the most damaging failure mode.",
            "6. DISCRETIONARY DECISIONS — extra guests and fee waivers are team-decided; early/late check follow Settings. If the reply approves early/late when Settings say defer/deny, or approves without a listed fee when Settings say accept_with_fee, cap at 35. Stating a documented fee while deferring is fine under defer/quote_fee modes.",
            "",
            "Calibration anchors:",
            "- 95-100: every claim grounded, every ask addressed, no needless deferral. Safe to auto-send.",
            "- 80-94: minor gaps (slightly incomplete nicety, small unverifiable detail) but nothing that could mislead the guest.",
            "- 60-79: partially helpful; some substance missing or weakly grounded.",
            "- 40-59: a real gap — skipped ask, needless deferral, or shaky grounding.",
            "- 0-39: contains an unsupported or wrong claim, or an undocumented commitment. Unsafe.",
            "",
            "Do NOT reward warmth or fluency; judge substance and safety only.",
            'Respond with STRICT JSON only: {"send_confidence": <0-100>, "note": "one short sentence explaining the biggest problem (null if 80+)"}',
        ].join("\n");
    }

    /**
     * Independent verifier pass over a drafted reply. Returns a calibrated
     * send-confidence (0..100) or null when verification is unavailable/fails.
     */
    async runReplyVerifier(params: { context: string; reply: string }): Promise<{ confidence: number; note: string | null } | null> {
        const reply = (params.reply || "").trim();
        if (!reply || !process.env.OPENAI_API_KEY) return null;
        try {
            const client = this.getClient();
            const completion = await client.chat.completions.create({
                model: this.verifierModel,
                temperature: 0,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: this.verifierPrompt() },
                    { role: "user", content: `${params.context}\n\n=== DRAFTED REPLY TO VERIFY ===\n${reply}` },
                ],
            });
            const parsed = JSON.parse(completion.choices[0]?.message?.content?.trim() || "{}");
            const num = Number(parsed.send_confidence);
            if (!Number.isFinite(num)) return null;
            return {
                confidence: Math.max(0, Math.min(100, Math.round(num))),
                note: parsed.note ? String(parsed.note).slice(0, 255) : null,
            };
        } catch (err: any) {
            logger.warn(`[InboxAIService] reply verifier failed: ${err.message}`);
            return null;
        }
    }

    /**
     * Re-run the verifier for an already-stored suggestion (history backfill /
     * re-verification). Rebuilds the context from the conversation as it stood
     * at generation time (messages up to the target message) and persists the
     * verifier score onto the suggestion row.
     */
    async verifyStoredSuggestion(suggestionId: number): Promise<{ confidence: number | null }> {
        const s = await this.suggestionRepo.findOne({ where: { id: suggestionId } });
        if (!s || !s.suggestedReply) return { confidence: null };
        const conversation = await this.conversationRepo.findOne({ where: { threadId: Number(s.threadId) } });
        if (!conversation) return { confidence: null };

        let messages = await this.messageRepo.find({
            where: { threadId: Number(s.threadId) },
            order: { sentAt: "ASC", id: "ASC" },
        });
        let target =
            s.messageId != null
                ? messages.find((m) => Number(m.externalId) === Number(s.messageId)) || null
                : null;
        if (target) {
            messages = messages.slice(0, messages.indexOf(target) + 1);
        } else if (s.generatedAt) {
            // No stored target: reconstruct "as of generation" from timestamps.
            messages = messages.filter((m) => !m.sentAt || m.sentAt <= s.generatedAt);
            const inbound = messages.filter((m) => m.direction === "incoming");
            target = inbound.length ? inbound[inbound.length - 1] : null;
        }

        const context = await this.buildContext(conversation, messages, target, {});
        const v = await this.runReplyVerifier({ context, reply: s.suggestedReply });
        if (v) {
            s.verifierConfidence = v.confidence;
            s.verifierNote = v.note;
            await this.suggestionRepo.save(s);
        }
        return { confidence: v?.confidence ?? null };
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
     * Offline replay: generate a draft for a historical wrong_info case WITHOUT
     * persisting. Caller must pass messages already cut at the target guest ask
     * (nothing after). mode=baseline uses current production context; mode=hard_fact
     * restructures into HARD/SOFT + claim-gates + HARD-only verifier context.
     */
    async generateReplayDraft(params: {
        conversation: InboxConversationEntity;
        messagesThroughTarget: InboxMessageEntity[];
        targetMessage: InboxMessageEntity | null;
        mode: "baseline" | "hard_fact";
    }): Promise<{
        reply: string;
        confidence: number | null;
        verifierConfidence: number | null;
        escalationRequired: boolean;
        escalationReason: string | null;
        warnings: string[];
        ungrounded: string[];
        mode: "baseline" | "hard_fact";
        promptVersion: string;
    }> {
        const { conversation, messagesThroughTarget: messages, targetMessage, mode } = params;
        const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);
        let flatContext = await this.buildContext(conversation, messages, targetMessage, {});
        let ledger = new FactLedger();
        let verifierContext = flatContext;
        let context = flatContext;
        if (mode === "hard_fact") {
            const rebuilt = restructureContextForHardFacts(flatContext);
            context = rebuilt.prompt;
            ledger = rebuilt.ledger;
            verifierContext = rebuilt.verifierContext;
        }

        const keywordEscalation = this.scanForEscalation(targetMessage?.body || conversation.lastMessageText || "");
        const inquirySales =
            InboxAIService.isInquiryStatus(conversation.reservationStatus) &&
            !this.isAirbnbSupportThread(conversation, messages);

        let system = this.systemPrompt(settings, {
            airbnbSupport: this.isAirbnbSupportThread(conversation, messages),
            inquirySales,
        });
        if (mode === "hard_fact") system += hardFactSystemAddendum();

        const client = this.getClient();
        const completion = await client.chat.completions.create({
            model: INBOX_AI_MODEL,
            temperature: 0.4,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: system },
                { role: "user", content: context },
            ],
        });
        const raw = completion.choices[0]?.message?.content?.trim() || "";
        const output = this.parseModelOutput(raw);

        if (keywordEscalation) {
            output.escalation_required = true;
            output.escalation_reason = output.escalation_reason
                ? `${output.escalation_reason}; ${keywordEscalation}`
                : keywordEscalation;
        }

        const warnings: string[] = Array.isArray(output.warnings) ? [...output.warnings] : [];
        const reply = output.suggested_reply || "";
        const ungrounded =
            mode === "hard_fact" ? ungroundedClaims(reply, ledger).map((c) => `${c.type}:${c.raw}`) : [];
        if (ungrounded.length) {
            warnings.push(`Ungrounded HARD-fact claims: ${ungrounded.join("; ")}`);
            output.escalation_required = true;
            output.escalation_reason = output.escalation_reason
                ? `${output.escalation_reason}; ungrounded_claim`
                : `ungrounded_claim: ${ungrounded.slice(0, 3).join("; ")}`;
        }

        let confidencePct =
            typeof output.confidence === "number" && Number.isFinite(output.confidence)
                ? Math.max(0, Math.min(100, Math.round(output.confidence * 100)))
                : null;
        if (confidencePct != null) {
            if (ungrounded.length) confidencePct = Math.min(confidencePct, 30);
            if (output.escalation_required) confidencePct = Math.min(confidencePct, 45);
            else if (warnings.length) confidencePct = Math.min(confidencePct, 60);
        }

        let verifier: { confidence: number; note: string | null } | null = null;
        if (process.env.AI_REPLAY_SKIP_VERIFIER !== "1") {
            verifier = await Promise.race([
                this.runReplyVerifier({ context: verifierContext, reply }),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
            ]);
        }

        return {
            reply,
            confidence: confidencePct,
            verifierConfidence: verifier?.confidence ?? null,
            escalationRequired: !!output.escalation_required,
            escalationReason: output.escalation_reason ? String(output.escalation_reason).slice(0, 500) : null,
            warnings,
            ungrounded,
            mode,
            promptVersion: mode === "hard_fact" ? "inbox-ai-hard-fact-eval" : INBOX_AI_PROMPT_VERSION,
        };
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
            /** Simulated reservation phase: inquiry | accepted | in_house | post_stay | cancelled. */
            reservationStatus?: string | null;
            channel?: string | null;
            guestName?: string | null;
            checkin?: string | null;
            checkout?: string | null;
            guests?: number | null;
            price?: number | null;
            currency?: string | null;
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

        const parseDate = (value?: string | null) =>
            value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
        const checkin = parseDate(opts.checkin);
        const checkout = parseDate(opts.checkout);
        const nights = (() => {
            if (!checkin || !checkout) return null;
            const start = new Date(`${checkin}T00:00:00Z`).getTime();
            const end = new Date(`${checkout}T00:00:00Z`).getTime();
            const diff = Math.round((end - start) / 86_400_000);
            return Number.isFinite(diff) && diff > 0 ? diff : null;
        })();
        const reservationStatus =
            opts.reservationStatus === "inquiry"
                ? "inquiry — the guest has NOT booked yet; this is a pre-booking question. Answer helpfully and encourage them to book, but never imply they have a confirmed reservation."
                : opts.reservationStatus === "accepted"
                ? "accepted — confirmed upcoming reservation."
                : opts.reservationStatus === "in_house"
                ? "accepted — guest is currently in-house during an active stay."
                : opts.reservationStatus === "post_stay"
                ? "checked out — this is a post-stay conversation."
                : opts.reservationStatus === "cancelled"
                ? "cancelled — this reservation was cancelled. Do not treat it as an upcoming stay; do not share check-in details or access info."
                : null;

        const conversation = this.conversationRepo.create({
            threadId: 0,
            listingId: Number(listingId),
            listingName: (listing as any)?.internalListingName || (listing as any)?.name || null,
            channel: opts.channel || "simulator",
            guestName: opts.guestName || "Guest (simulated)",
            checkin,
            checkout,
            nights,
            guests: Number.isFinite(Number(opts.guests)) && Number(opts.guests) > 0 ? Number(opts.guests) : null,
            price: Number.isFinite(Number(opts.price)) && Number(opts.price) > 0 ? Number(opts.price) : null,
            currency: opts.currency || null,
            // Simulated phase flows into buildContext as "Reservation status: …"
            // so the bot answers as it would for inquiry, active stay, post-stay,
            // or cancelled context. This fake conversation is never persisted.
            reservationStatus,
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
                {
                    role: "system",
                    content: this.systemPrompt(settings, {
                        inquirySales: opts.reservationStatus === "inquiry",
                    }),
                },
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

    // ------------------------------------------------------------------
    // Quo (OpenPhone SMS) suggestions
    // ------------------------------------------------------------------

    /** Kill switch for Quo shadow suggestions (default ON when AI messaging is on). */
    static quoSuggestionsEnabled(): boolean {
        return (
            InboxAIService.isEnabled() &&
            String(process.env.QUO_AI_SUGGESTIONS_ENABLED || "true").toLowerCase() !== "false"
        );
    }

    /** Sender label on AI-delivered Quo replies (also filters them out of audit pairing). */
    static readonly QUO_AI_SENDER = "SecureStay AI";

    /**
     * Legacy env-only PM-client auto-respond gate retained for compatibility
     * with older callers. New delivery checks must use resolveQuoAutosendEnabled().
     */
    static quoPmAutoRespondEnabled(): boolean {
        return false;
    }

    // SMS arrives in bursts; wait for the thread to settle and generate one
    // suggestion against the latest inbound instead of one per text.
    private static quoPendingTimers = new Map<string, NodeJS.Timeout>();
    private static QUO_SUGGEST_DEBOUNCE_MS = Number(process.env.QUO_AI_SUGGEST_DEBOUNCE_MS || 3 * 60 * 1000);

    /**
     * Schedule a shadow suggestion for a Quo conversation after its message
     * burst settles. Safe to call on every inbound webhook/poll; dedupes per
     * conversation and per target message.
     */
    static scheduleQuoSuggestion(conversationId: string): void {
        if (!InboxAIService.quoSuggestionsEnabled()) return;
        const existing = InboxAIService.quoPendingTimers.get(conversationId);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            InboxAIService.quoPendingTimers.delete(conversationId);
            const svc = new InboxAIService();
            svc.quoShadowSuggest(conversationId)
                .then(() => svc.quoMaybeAutoRespond(conversationId)) // PM client threads only; self-gates
                .catch((err) => logger.warn(`[InboxAI] Quo shadow suggestion failed for ${conversationId}: ${err?.message}`));
        }, InboxAIService.QUO_SUGGEST_DEBOUNCE_MS);
        timer.unref?.();
        InboxAIService.quoPendingTimers.set(conversationId, timer);
    }

    /**
     * Catch-up sweep: generate shadow suggestions for Quo threads whose latest
     * inbound message never got one. The debounce timers live in-process, so
     * deploys/restarts drop them, and the webhook can miss events — without
     * this sweep those threads never get a pre-generated draft (and linked ones
     * never enter the analytics dataset). Deduped per message, so repeat runs
     * are cheap.
     */
    async quoCatchUpSweep(hours = Number(process.env.QUO_AI_SWEEP_HOURS || 48)): Promise<{ scanned: number; generated: number }> {
        if (!InboxAIService.quoSuggestionsEnabled()) return { scanned: 0, generated: 0 };
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        const quoConvRepo = appDatabase.getRepository(QuoConversationEntity);
        const quoMsgRepo = appDatabase.getRepository(QuoMessageEntity);
        const convs = await quoConvRepo
            .createQueryBuilder("c")
            .where("c.lastMessageAt >= :since", { since })
            // Threads still waiting on a reply first — they're the ones staff
            // will open next and expect an instant suggestion in.
            .orderBy("CASE WHEN c.lastDirection = 'incoming' THEN 0 ELSE 1 END", "ASC")
            .addOrderBy("c.lastMessageAt", "DESC")
            .take(300)
            .getMany();

        let generated = 0;
        for (const conv of convs) {
            try {
                const latest = await quoMsgRepo
                    .createQueryBuilder("m")
                    .where("m.conversationId = :cid", { cid: conv.conversationId })
                    .andWhere("m.direction = :dir", { dir: "incoming" })
                    .andWhere("TRIM(COALESCE(m.body, '')) != ''")
                    .orderBy("m.sentAt", "DESC")
                    .getOne();
                if (!latest || (latest.sentAt && latest.sentAt < since)) continue;
                // Skip bursts still inside the debounce window; the timer (or the
                // next sweep) will pick them up once the thread settles.
                if (latest.sentAt && Date.now() - latest.sentAt.getTime() < InboxAIService.QUO_SUGGEST_DEBOUNCE_MS) continue;
                const existing = await this.suggestionRepo.findOne({
                    where: { source: "quo", threadId: conv.id, messageId: latest.id },
                });
                if (existing) {
                    // Suggestion exists but a restart may have dropped the
                    // auto-send step for PM client threads — retry it (self-gates
                    // on line category, freshness, status and confidence).
                    if (existing.status === "suggested" && conv.lastDirection === "incoming") {
                        await this.quoMaybeAutoRespond(conv.conversationId);
                    }
                    continue;
                }
                const s = await this.quoShadowSuggest(conv.conversationId);
                if (s) {
                    generated++;
                    // PM client threads: the sweep is also the auto-respond safety
                    // net when the debounce timer was lost (deploy/restart).
                    // Self-gates on line category, freshness and confidence.
                    await this.quoMaybeAutoRespond(conv.conversationId);
                    await new Promise((r) => setTimeout(r, 400)); // pace OpenAI calls
                }
            } catch (err: any) {
                logger.warn(`[InboxAI] Quo catch-up sweep failed for ${conv.conversationId}: ${err?.message}`);
            }
        }
        if (generated) logger.info(`[InboxAI] Quo catch-up sweep generated ${generated} shadow suggestion(s) (scanned ${convs.length})`);
        return { scanned: convs.length, generated };
    }

    /**
     * Shadow suggestion for a Quo thread: loads the conversation, generates and
     * PERSISTS a suggestion for the latest inbound message. For linked threads
     * the nightly audit pairs it with the team's actual SMS reply — the same
     * learning dataset the Hostify inbox builds. Unlinked threads get drafts for
     * inbox UX only; analytics queries filter them out (no property context).
     */
    async quoShadowSuggest(conversationId: string): Promise<AIMessageSuggestionEntity | null> {
        if (!InboxAIService.quoSuggestionsEnabled()) return null;
        const conv = await appDatabase
            .getRepository(QuoConversationEntity)
            .findOne({ where: { conversationId } });
        // Unlinked threads get drafts too (so the inbox shows a suggestion
        // instantly instead of "Thinking…"), but analytics scoring stays
        // linked-only — unlinked drafts have no property context to grade.
        if (!conv) return null;
        // NOTE: no lastDirection gate here. The team often texts back within the
        // debounce window; the draft is still generated (blind — the transcript is
        // truncated at the guest message) so the audit can grade it against the
        // team's actual reply. Skipping fast-answered threads starved analytics.
        // Webhook (API cluster) and the 3-min poll (cron worker) both schedule
        // this; a named MySQL lock makes one worker win, the loser skips.
        const runner = appDatabase.createQueryRunner();
        const lockName = `ss_quosuggest_${conversationId}`;
        try {
            await runner.connect();
            const lockRows: any[] = await runner.query("SELECT GET_LOCK(?, 0) AS l", [lockName]);
            if (!Number(lockRows?.[0]?.l)) return null;
            const result = await this.quoSuggestReply(conversationId, { persistOnly: true });
            return result?.suggestion ?? null;
        } finally {
            await runner.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
            await runner.release().catch(() => undefined);
        }
    }

    /**
     * Auto-respond to PM CLIENT (owner) SMS threads. Runs after the shadow
     * suggestion is persisted; delivers it only when ALL guardrails pass:
     *   - AI Assistant Settings page allows Quo auto-respond for this line
     *   - PM line AND a linked client (never auto-text unknown numbers)
     *   - the thread is still awaiting a reply (no human beat us to it)
     *   - the inbound message is fresh (default < 6h — no 2-day-late texts)
     *   - no escalation flag, no model warnings, non-empty reply
     *   - min(self-confidence, verifier confidence) ≥ the configured threshold;
     *     a missing verifier score fails closed
     * Same guardrail set as the Hostify auto-send. Never throws.
     */
    async quoMaybeAutoRespond(
        conversationId: string
    ): Promise<{ sent: boolean; reason: string; suggestionId?: number }> {
        try {
            const { QuoInboxService } = await import("./QuoInboxService");
            const quoService = new QuoInboxService();
            const conv = await appDatabase
                .getRepository(QuoConversationEntity)
                .findOne({ where: { conversationId } });
            if (!conv) return { sent: false, reason: "conversation_not_found" };
            if (!(await InboxAIService.resolveQuoAutosendEnabled(conv.phoneNumberId))) {
                return { sent: false, reason: "disabled" };
            }
            const category = await quoService.lineCategory(conv.phoneNumberId).catch(() => null);
            if (category !== "PM") return { sent: false, reason: "not_pm_line" };
            if (!conv.pmClientId) return { sent: false, reason: "no_client_link" };
            if (conv.lastDirection !== "incoming") return { sent: false, reason: "already_answered" };

            // Latest inbound with a body = the message we'd be answering.
            const target = await appDatabase
                .getRepository(QuoMessageEntity)
                .createQueryBuilder("m")
                .where("m.conversationId = :cid", { cid: conversationId })
                .andWhere("m.direction = 'incoming'")
                .andWhere("TRIM(COALESCE(m.body, '')) != ''")
                .orderBy("m.sentAt", "DESC")
                .getOne();
            if (!target) return { sent: false, reason: "no_inbound" };
            const maxAgeMs = Number(process.env.QUO_PM_AUTORESPOND_MAX_AGE_HOURS || 6) * 60 * 60 * 1000;
            if (target.sentAt && Date.now() - target.sentAt.getTime() > maxAgeMs) {
                return { sent: false, reason: "message_too_old" };
            }

            // The shadow pipeline persists the suggestion first; reuse it.
            let suggestion = await this.suggestionRepo.findOne({
                where: { source: "quo", threadId: conv.id, messageId: target.id },
                order: { generatedAt: "DESC", id: "DESC" },
            });
            if (!suggestion) {
                const gen = await this.quoSuggestReply(conversationId, { persistOnly: true });
                suggestion = gen?.suggestion ?? null;
            }
            if (!suggestion) return { sent: false, reason: "no_suggestion" };
            if (suggestion.status !== "suggested") {
                return { sent: false, reason: `status_${suggestion.status}`, suggestionId: suggestion.id };
            }

            // ---- Hard guardrails (any failure => leave for a human) ----
            const reply = (suggestion.suggestedReply || "").trim();
            const warnings = this.safeJsonArray(suggestion.warnings);
            const selfConf = suggestion.confidence != null ? Number(suggestion.confidence) : null;
            const verConf = suggestion.verifierConfidence != null ? Number(suggestion.verifierConfidence) : null;
            const conf = selfConf != null && verConf != null ? Math.min(selfConf, verConf) : null;
            const minConf = await InboxAIService.autosendMinConfidenceAsync();
            const skip = (reason: string) => {
                logger.info(`[InboxAI] Quo PM auto-respond skipped for ${conversationId}: ${reason}`);
                return { sent: false, reason, suggestionId: suggestion!.id };
            };
            if (suggestion.escalationRequired) return skip("escalation_required");
            if (!reply) return skip("empty_reply");
            if (warnings.length > 0) return skip("model_warnings");
            if (conf == null || conf < minConf) {
                return skip(`low_confidence:self=${selfConf ?? "?"},verified=${verConf ?? "?"}<${minConf}`);
            }

            // Cross-worker dedupe + last-second race check (team may have replied
            // while we were generating/verifying).
            const runner = appDatabase.createQueryRunner();
            const lockName = `ss_quoautosend_${conversationId}`;
            try {
                await runner.connect();
                const lockRows: any[] = await runner.query("SELECT GET_LOCK(?, 0) AS l", [lockName]);
                if (!Number(lockRows?.[0]?.l)) return { sent: false, reason: "locked" };

                const replied = await appDatabase
                    .getRepository(QuoMessageEntity)
                    .createQueryBuilder("m")
                    .where("m.conversationId = :cid", { cid: conversationId })
                    .andWhere("m.direction = 'outgoing'")
                    .andWhere("m.sentAt > :after", { after: target.sentAt })
                    .getOne();
                if (replied) return { sent: false, reason: "human_replied", suggestionId: suggestion.id };
                const fresh = await this.suggestionRepo.findOne({ where: { id: suggestion.id } });
                if (!fresh || fresh.status !== "suggested") {
                    return { sent: false, reason: "status_changed", suggestionId: suggestion.id };
                }

                const msg = await quoService.sendReply(conversationId, reply, InboxAIService.QUO_AI_SENDER);
                suggestion.status = "auto_sent";
                suggestion.finalSentMessageId = msg?.id ?? null;
                await this.suggestionRepo.save(suggestion);
                logger.info(
                    `[InboxAI] Quo PM auto-respond SENT for ${conversationId} ` +
                        `(client ${conv.pmClientName || conv.pmClientId}, suggestion ${suggestion.id}, conf ${conf})`
                );
                return { sent: true, reason: "sent", suggestionId: suggestion.id };
            } finally {
                await runner.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
                await runner.release().catch(() => undefined);
            }
        } catch (err: any) {
            logger.error(`[InboxAI] Quo PM auto-respond failed for ${conversationId}: ${err?.message}`);
            return { sent: false, reason: `error:${err?.message}` };
        }
    }

    /**
     * Generate a reply suggestion for a Quo SMS conversation. Quo threads live
     * in their own tables (quo_conversations / quo_messages), so we map the
     * thread onto an ephemeral inbox conversation — same context builder, same
     * system prompt, same guardrails as the Hostify inbox. Every generation is
     * persisted to ai_message_suggestions (source='quo', threadId =
     * quo_conversations.id, messageId = quo_messages.id) so the nightly audit
     * and Analytics work exactly like the Hostify inbox. Deduped per target
     * message unless force=true.
     */
    async quoSuggestReply(
        conversationId: string,
        opts: {
            force?: boolean;
            persistOnly?: boolean;
            /** Staff-steered composer: what the reply should say (Generate). */
            instructions?: string | null;
            /** Current draft to revise per the instructions (Refine). */
            baseDraft?: string | null;
        } = {}
    ): Promise<{
        suggestion: AIMessageSuggestionEntity;
        reply: string;
        confidence: number | null;
        escalationRequired: boolean;
        escalationReason: string | null;
        warnings: string[];
        sourcesUsed: string[];
        internalSummary: string | null;
        linked: boolean;
    } | null> {
        const quoConvRepo = appDatabase.getRepository(QuoConversationEntity);
        const quoMsgRepo = appDatabase.getRepository(QuoMessageEntity);
        const conv = await quoConvRepo.findOne({ where: { conversationId } });
        if (!conv) throw new Error(`Quo conversation ${conversationId} not found`);
        let quoMessages = await quoMsgRepo.find({
            where: { conversationId },
            order: { sentAt: "ASC" },
            take: 500,
        });

        // Target = latest inbound with a body.
        let targetQuo: QuoMessageEntity | null = null;
        for (let i = quoMessages.length - 1; i >= 0; i--) {
            if (quoMessages[i].direction === "incoming" && String(quoMessages[i].body || "").trim()) {
                targetQuo = quoMessages[i];
                break;
            }
        }
        if (!targetQuo) {
            if (opts.persistOnly) return null;
            throw new Error("No inbound guest message to reply to");
        }
        // Shadow pipeline only: don't generate (or auto-respond) for a bare
        // "thanks!" / "got it" — the auto-responder answering every ack made PM
        // threads feel like a bot loop. Staff-triggered drafts still generate.
        if (opts.persistOnly && !opts.force && InboxAIService.isPureAcknowledgment(targetQuo.body || "")) {
            return null;
        }

        // Draft "as of" the guest message: drop anything sent after it (e.g. the
        // team's reply when they beat the debounce timer). Keeps shadow drafts
        // blind so the audit's suggestion-vs-team comparison stays honest.
        const targetIdx = quoMessages.indexOf(targetQuo);
        if (targetIdx >= 0 && targetIdx < quoMessages.length - 1) {
            quoMessages = quoMessages.slice(0, targetIdx + 1);
        }

        // Dedupe: reuse the stored suggestion for this exact message unless forced
        // or the staff steered the draft (Refine/Generate always regenerate).
        if (!opts.force && !opts.instructions && !opts.baseDraft) {
            const existing = await this.suggestionRepo.findOne({
                where: { source: "quo", threadId: conv.id, messageId: targetQuo.id },
                order: { generatedAt: "DESC", id: "DESC" },
            });
            if (existing) return this.quoResult(existing, conv);
        }

        // Resolve reservation status (drives inquiry sales mode + phase rules).
        let reservationStatus: string | null = null;
        if (conv.reservationId) {
            const r = await this.reservationRepo
                .findOne({ where: { id: Number(conv.reservationId) } })
                .catch(() => null);
            reservationStatus = r?.status || null;
        }

        // PM-line threads are chats with our management CLIENTS (owners), not
        // guests — different persona, different context (their portfolio). The
        // persona applies to EVERY thread on a PM line (guest sales mode must
        // never fire there); the client data block additionally needs a link.
        const { QuoInboxService } = await import("./QuoInboxService");
        const lineCategory = await new QuoInboxService()
            .lineCategory(conv.phoneNumberId)
            .catch(() => null);
        const isPmLine = lineCategory === "PM";
        const isPmClientThread = isPmLine && Boolean(conv.pmClientId);

        const conversation = this.conversationRepo.create({
            threadId: 0,
            listingId: conv.listingId ? Number(conv.listingId) : null,
            listingName: conv.listingName || null,
            reservationId: conv.reservationId ? Number(conv.reservationId) : null,
            guestName: isPmLine
                ? conv.pmClientName || conv.contactName || "Client"
                : conv.guestName || conv.contactName || "Guest",
            channel: isPmLine ? "SMS (Quo · PM client)" : "SMS (Quo)",
            reservationStatus,
        }) as InboxConversationEntity;

        // Group threads: several external people text into the same thread. Label
        // every inbound message with WHO sent it, or the model answers the wrong
        // person (July audit: replied to "David" about a message Veronica sent).
        const participantList = String(conv.participants || conv.participantPhone || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const isGroupThread = participantList.length > 1;
        const inboundLabel = (m: QuoMessageEntity): string => {
            if (!isGroupThread) return m.senderName || conversation.guestName || "Guest";
            const from = String(m.fromNumber || "").trim();
            const isPrimary = from && participantList[0] && from === participantList[0];
            const known = isPrimary ? conversation.guestName || conv.contactName : null;
            return known ? `${known} · ${from}` : from || "unknown participant";
        };
        const messages = quoMessages
            .filter((m) => String(m.body || "").trim())
            .map(
                (m) =>
                    this.messageRepo.create({
                        threadId: 0,
                        externalId: m.id,
                        direction: m.direction === "outgoing" ? "outgoing" : "incoming",
                        body: String(m.body || "").trim(),
                        senderName: m.direction === "outgoing" ? m.senderName || "Host" : inboundLabel(m),
                        sentAt: m.sentAt,
                    }) as InboxMessageEntity
            );
        const target = messages.find((m) => Number(m.externalId) === Number(targetQuo!.id)) || null;
        if (!target) throw new Error("Target message not found after mapping");

        const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);
        let context = await this.buildContext(conversation, messages, target, {
            // PM-line threads skip the guest-oriented knowledge blocks (KB,
            // upsells, exemplars) — the client block below carries their context.
            includeKnowledge: !isPmLine,
            instructions: opts.instructions ?? null,
            baseDraft: opts.baseDraft ?? null,
        });
        context += `\n\n## Delivery channel note\n${textOrDefault(settings?.quoSmsRules, AI_REPLY_RULE_DEFAULTS.quoSmsRules)}`;
        if (isGroupThread) {
            context +=
                `\nGROUP THREAD: ${participantList.length} external participants share this conversation (each inbound message is labeled with its sender). ` +
                `The latest message is from ${inboundLabel(targetQuo)} — address YOUR reply to that person and answer THEIR message, not an earlier participant's.`;
        }
        if (isPmClientThread) {
            // Owner context: profile + portfolio + live booking picture.
            const clientBlock = await this.buildPmClientBlock(conv.pmClientId!).catch((err) => {
                logger.warn(`[InboxAI] PM client block failed for ${conversationId}: ${err?.message}`);
                return null;
            });
            if (clientBlock) context += `\n\n${clientBlock}`;
        } else if (isPmLine) {
            context +=
                "\nThis PM-line thread could not be matched to a client record, so you have NO account context. " +
                "Answer only from the conversation itself, never guess about their properties or bookings, and " +
                "set escalation_required=true if they ask anything account-specific so the team can identify them.";
        } else if (!conv.reservationId) {
            context += `\n${textOrDefault(settings?.quoUnlinkedThreadRules, AI_REPLY_RULE_DEFAULTS.quoUnlinkedThreadRules)}`;
        }

        const client = this.getClient();
        const completion = await client.chat.completions.create({
            model: INBOX_AI_MODEL,
            temperature: 0.4,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: this.systemPrompt(settings, {
                        inquirySales: !isPmLine && InboxAIService.isInquiryStatus(reservationStatus),
                        pmClient: isPmLine,
                    }),
                },
                { role: "user", content: context },
            ],
        });
        const raw = completion.choices[0]?.message?.content?.trim() || "";
        const output = this.parseModelOutput(raw);

        // Same server-side escalation safety net as the Hostify inbox.
        const kw = this.scanForEscalation(target.body || "");
        if (kw) {
            output.escalation_required = true;
            output.escalation_reason = output.escalation_reason ? `${output.escalation_reason}; ${kw}` : kw;
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

        // Completion-claim net — critical on PM threads, where "I've blocked off
        // 7/19" to an owner (self-score AND verifier 100 in the July audit) would
        // otherwise go out as fact when nobody has touched the calendar.
        const actionClaims = this.detectActionClaims(reply, haystack);
        if (actionClaims.length) {
            warnings.push(
                `Reply claims action(s) already completed with no confirmation in context: ${actionClaims
                    .map((c) => `"${c}"`)
                    .join("; ")}. Confirm it actually happened or rephrase as a commitment.`
            );
        }
        // Quo rows lack stay dates here — only allow codes on explicit lockout reports.
        const quoGuest = target.body || "";
        const quoPayMatch = context.match(/payment_state:\s*(paid|due|failed|auth_required|unknown)/i);
        const quoUnsafe = detectUnsafeAsserts(reply, {
            codesAllowed: guestReportsLockout(quoGuest),
            agreementAsk: guestAsksAgreement(quoGuest),
            hasExplicitOpsConfirmation: /\[ops_confirm_ok\]/i.test(context),
            // Quo often has no reservationStatus — never invent "you're confirmed".
            bookingConfirmed: isBookingConfirmedStatus(reservationStatus),
            guestText: quoGuest,
            earlyCheckinHandling: settings?.earlyCheckinHandling,
            lateCheckoutHandling: settings?.lateCheckoutHandling,
            pmClient: isPmLine,
            contextHaystack: haystack,
            paymentState: (quoPayMatch?.[1]?.toLowerCase() || "unknown") as PaymentState,
        });
        if (quoUnsafe.length) {
            warnings.push(`Reply asserts something that must not be stated yet: ${quoUnsafe.join(", ")}.`);
            output.escalation_required = true;
            output.escalation_reason = output.escalation_reason
                ? `${output.escalation_reason}; unsafe_assert:${quoUnsafe.join("|")}`
                : `unsafe_assert:${quoUnsafe.join("|")}`;
        }

        let confidencePct =
            typeof output.confidence === "number" && Number.isFinite(output.confidence)
                ? Math.max(0, Math.min(100, Math.round(output.confidence * 100)))
                : null;
        if (confidencePct != null) {
            if (leaks.length) confidencePct = Math.min(confidencePct, 30);
            if (actionClaims.length) confidencePct = Math.min(confidencePct, 35);
            if (quoUnsafe.length) confidencePct = Math.min(confidencePct, 30);
            if (output.escalation_required) confidencePct = Math.min(confidencePct, 45);
            else if (warnings.length) confidencePct = Math.min(confidencePct, 60);
        }

        // Independent verifier pass (same gate the Hostify inbox trusts).
        const verifier = await Promise.race([
            this.runReplyVerifier({ context, reply: output.suggested_reply || "" }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
        ]);

        const suggestion = await this.suggestionRepo.save(
            this.suggestionRepo.create({
                source: "quo",
                quoConversationId: conversationId,
                threadId: conv.id,
                messageId: targetQuo.id,
                reservationId: conv.reservationId ? Number(conv.reservationId) : null,
                listingId: conv.listingId ? Number(conv.listingId) : null,
                salesMode: !isPmLine && InboxAIService.isInquiryStatus(reservationStatus) ? 1 : 0,
                suggestedReply: output.suggested_reply || null,
                confidence: confidencePct,
                verifierConfidence: verifier?.confidence ?? null,
                verifierNote: verifier?.note ?? null,
                escalationRequired: output.escalation_required ? 1 : 0,
                escalationReason: output.escalation_reason ? String(output.escalation_reason).slice(0, 500) : null,
                internalSummary: output.internal_summary || null,
                sourcesUsed: JSON.stringify(output.sources_used || []),
                warnings: JSON.stringify(warnings),
                suggestedActionItems: JSON.stringify(output.suggested_action_items || []),
                modelName: INBOX_AI_MODEL,
                promptVersion: INBOX_AI_PROMPT_VERSION,
                status: "suggested",
                rawResponse: raw.slice(0, 60000) || null,
                generatedAt: new Date(),
            })
        );

        logger.info(
            `[InboxAI] Quo suggestion ${suggestion.id} for ${conversationId} ` +
                `(linked=${Boolean(conv.reservationId)}, conf=${confidencePct ?? "n/a"}, verified=${verifier?.confidence ?? "n/a"})`
        );

        // Knowledge gap flagged → raise a learning prompt on this SMS thread,
        // exactly like the Hostify inbox. Best-effort; never blocks the reply.
        // PM-line threads are excluded: their gaps are client-business facts,
        // not reusable property facts for guest messaging.
        if (!isPmLine && output.learning_question && String(output.learning_question).trim()) {
            try {
                const { AILearningPromptService } = await import("./AILearningPromptService");
                await new AILearningPromptService().raise({
                    threadId: conv.id,
                    source: "quo",
                    listingId: conv.listingId ? Number(conv.listingId) : null,
                    listingName: conv.listingName ?? null,
                    question: String(output.learning_question),
                    topic: output.learning_topic ? String(output.learning_topic) : null,
                    sampleSuggestionId: suggestion.id,
                });
            } catch (e: any) {
                logger.warn(`[InboxAI] Quo learning prompt raise failed: ${e.message}`);
            }
        }
        return this.quoResult(suggestion, conv);
    }

    /** Shape a stored quo suggestion row into the API response the composer uses. */
    /**
     * Cached suggestion for a Quo thread's latest inbound message — no generation.
     * Mirrors getLatestSuggestion for the Hostify inbox so the Quo UI can show a
     * suggestion instantly on thread open (shadow suggestions are persisted by
     * the webhook/poll pipeline for linked threads).
     */
    async quoGetSuggestion(conversationId: string) {
        const conv = await appDatabase
            .getRepository(QuoConversationEntity)
            .findOne({ where: { conversationId } });
        if (!conv) return null;
        const quoMessages = await appDatabase.getRepository(QuoMessageEntity).find({
            where: { conversationId },
            order: { sentAt: "DESC" },
            take: 50,
        });
        const target = quoMessages.find(
            (m) => m.direction === "incoming" && String(m.body || "").trim()
        );
        if (!target) return null;
        const existing = await this.suggestionRepo.findOne({
            where: { source: "quo", threadId: conv.id, messageId: target.id },
            order: { generatedAt: "DESC", id: "DESC" },
        });
        return existing ? this.quoResult(existing, conv) : null;
    }

    private quoResult(s: AIMessageSuggestionEntity, conv: QuoConversationEntity) {
        return {
            suggestion: s,
            reply: s.suggestedReply || "",
            confidence: s.confidence != null ? Number(s.confidence) : null,
            escalationRequired: Number(s.escalationRequired) === 1,
            escalationReason: s.escalationReason || null,
            warnings: this.safeJsonArray(s.warnings),
            sourcesUsed: this.safeJsonArray(s.sourcesUsed),
            suggestedActionItems: this.safeJsonArray(s.suggestedActionItems),
            internalSummary: s.internalSummary || null,
            status: s.status || "suggested",
            modelName: s.modelName || null,
            promptVersion: s.promptVersion || null,
            // "Linked" = the AI had real context: a reservation (guest threads)
            // or a client profile (PM owner threads).
            linked: Boolean(conv.reservationId) || Boolean(conv.pmClientId),
        };
    }

    /**
     * Owner context for PM-client SMS threads: the client's profile, their
     * managed properties, and the live booking picture (current guests, upcoming
     * arrivals, recent checkouts) across their portfolio. This is what lets the
     * AI answer "how's my calendar looking?" / "who's in the house this weekend?"
     * with real data instead of deflecting.
     */
    private async buildPmClientBlock(clientId: string): Promise<string | null> {
        const { ClientEntity } = await import("../entity/Client");
        const client = await appDatabase
            .getRepository(ClientEntity)
            .findOne({ where: { id: clientId }, relations: ["properties", "secondaryContacts"] });
        if (!client) return null;

        // Service package per property — property_service_info is the source of
        // truth (client_management.serviceType is rarely filled). This decides
        // WHO handles cleaning/maintenance, so the AI must never promise the
        // wrong thing (see the responsibilities block below).
        const svcRows: any[] = await appDatabase
            .query(
                `SELECT cp.listingId, UPPER(TRIM(COALESCE(psi.serviceType, ''))) AS svc
                 FROM client_properties cp
                 LEFT JOIN property_service_info psi ON psi.clientPropertyId = cp.id AND psi.deletedAt IS NULL
                 WHERE cp.clientId = ? AND cp.deletedAt IS NULL`,
                [clientId]
            )
            .catch(() => []);
        const svcByListing = new Map<number, string>();
        for (const r of svcRows) {
            const svc = String(r.svc || "").replace(/_SERVICE$/, "").trim();
            const lid = Number(r.listingId);
            if (svc && Number.isFinite(lid)) svcByListing.set(lid, svc);
        }
        const distinctSvc = [...new Set(svcByListing.values())];
        const fallbackSvc = String(client.serviceType || "").replace(/_SERVICE$/, "").trim().toUpperCase() || null;
        const packageLabel =
            distinctSvc.length === 1 ? distinctSvc[0] : distinctSvc.length > 1 ? "MIXED" : fallbackSvc;

        const lines: string[] = [];
        lines.push("## CLIENT PROFILE (the person you are texting — our property-management client)");
        const name = [client.preferredName || client.firstName, client.lastName].filter(Boolean).join(" ").trim();
        lines.push(`- Name: ${name || "unknown"}${client.preferredName ? ` (goes by ${client.preferredName})` : ""}`);
        if (client.companyName) lines.push(`- Company: ${client.companyName}`);
        if (client.status) lines.push(`- Client status: ${client.status}`);
        if (packageLabel) {
            lines.push(
                `- Service package: ${packageLabel}${packageLabel === "MIXED" ? " (differs per property — see the property list)" : ""}`
            );
        }
        if (client.timezone) lines.push(`- Timezone: ${client.timezone}`);
        const notes = String(client.notes || "").replace(/\s+/g, " ").trim();
        if (notes) lines.push(`- Team notes on this client: ${notes.slice(0, 800)}`);
        const contacts = (client.secondaryContacts || []).filter((c) => !c.deletedAt);
        if (contacts.length) {
            lines.push(
                `- Other contacts on the account: ${contacts
                    .map((c) => [c.firstName, c.lastName].filter(Boolean).join(" ") + (c.type ? ` (${c.type})` : ""))
                    .join(", ")}`
            );
        }

        // Portfolio: their managed properties, joined to our listing records.
        const props = (client.properties || []).filter((p) => !p.deletedAt);
        const listingIds = [
            ...new Set(props.map((p) => Number(p.listingId)).filter((n) => Number.isFinite(n) && n > 0)),
        ];
        const listings = listingIds.length
            ? await this.listingRepo
                  .createQueryBuilder("l")
                  .where("l.id IN (:...ids)", { ids: listingIds })
                  .withDeleted()
                  .getMany()
            : [];
        const listingById = new Map(listings.map((l) => [Number(l.id), l]));
        lines.push("");
        lines.push(`## CLIENT'S PROPERTIES (${listingIds.length} under management — you may discuss these freely with them)`);
        if (!listingIds.length) {
            lines.push("(no properties linked to this client in our records — if they ask property specifics, say the team will follow up)");
        }
        for (const id of listingIds.slice(0, 15)) {
            const l: any = listingById.get(id);
            if (!l) continue;
            const bits: string[] = [];
            const loc = [l.address, l.city, l.state].filter((v: any) => v && String(v).trim() && String(v) !== "(NOT SPECIFIED)");
            if (loc.length) bits.push(loc.join(", "));
            if (l.bedroomsNumber != null) bits.push(`${l.bedroomsNumber}BR`);
            if (l.bathroomsNumber != null) bits.push(`${l.bathroomsNumber}BA`);
            if (l.personCapacity != null) bits.push(`sleeps ${l.personCapacity}`);
            const svc = svcByListing.get(id);
            if (svc) bits.push(`${svc} package`);
            if (l.deletedAt) bits.push("INACTIVE in our records");
            lines.push(`- ${l.internalListingName || l.name || `Listing ${id}`}${bits.length ? ` — ${bits.join(", ")}` : ""}`);
        }
        lines.push(
            "NOTE: this list can lag reality (a property being onboarded right now may not appear yet). " +
                "If the client mentions a property NOT shown above, do not guess or deny it — say the team will check and follow up."
        );

        // Who does what: FULL-service owners pay us to run cleanings/maintenance;
        // LAUNCH/PRO owners run their own. The AI promising "we'll send the
        // cleaner" to a LAUNCH client creates work we aren't contracted to do.
        lines.push("");
        lines.push("## SERVICE PACKAGE — WHO HANDLES CLEANING & MAINTENANCE (critical)");
        lines.push(
            "- FULL service properties: WE (the management team) handle cleanings, turnovers, maintenance and vendor coordination. " +
                "You MAY say things like \"we'll have the cleaner check it\" or \"we'll send someone out\" and coordinate next steps."
        );
        lines.push(
            "- LAUNCH and PRO package properties: the CLIENT handles their own cleanings and maintenance — we do NOT coordinate " +
                "cleaners or vendors for them. NEVER promise to send a cleaner, schedule maintenance, or dispatch a vendor for these " +
                "properties. Instead, share what you know and let them arrange it (you can suggest they have their cleaner/handyman " +
                "take a look); escalate to the team only for questions about our actual scope."
        );
        lines.push(
            packageLabel === "MIXED"
                ? "- THIS client has a mix of packages — check the per-property tag in the property list above before promising anything."
                : packageLabel
                  ? `- THIS client is on the ${packageLabel} package${
                        packageLabel === "FULL"
                            ? " — we handle their cleanings and maintenance."
                            : packageLabel === "LAUNCH" || packageLabel === "PRO"
                              ? " — they handle their own cleanings and maintenance; do not offer to coordinate those."
                              : "."
                    }`
                  : "- This client's package is not recorded — do not promise cleaning/maintenance coordination; say the team will confirm who handles it."
        );

        // Live booking picture across their portfolio: who's in now, who's
        // arriving, what just checked out. Payout figures included — this is the
        // owner of these properties, these are their numbers.
        if (listingIds.length) {
            const now = new Date();
            const fmt = (d: any) => {
                const dt = d instanceof Date ? d : new Date(d);
                return Number.isNaN(dt.getTime()) ? "?" : dt.toISOString().slice(0, 10);
            };
            const money = (v: any) => (v != null && Number(v) > 0 ? ` · owner revenue $${Number(v).toFixed(0)}` : "");
            const activeStatuses = "('accepted','confirmed','new','modified')";
            // Dates/unit/status first; guest name only as optional detail — owners
            // often ask occupancy, not PII. Prefer "Hostify shows…" framing in replies.
            const resvLine = (r: ReservationInfoEntity) =>
                `- ${r.listingName || `Listing ${r.listingMapId}`}: ${fmt(r.arrivalDate)} → ${fmt(
                    r.departureDate
                )} (${r.source || "direct"}, ${r.status})${money(r.owner_revenue)}${
                    r.guestName ? ` · guest on file: ${r.guestName}` : ""
                }`;

            const current = await this.reservationRepo
                .createQueryBuilder("r")
                .where("r.listingMapId IN (:...ids)", { ids: listingIds })
                .andWhere(`r.status IN ${activeStatuses}`)
                .andWhere("r.arrivalDate <= :now AND r.departureDate >= :now", { now })
                .orderBy("r.departureDate", "ASC")
                .take(15)
                .getMany()
                .catch(() => [] as ReservationInfoEntity[]);
            const upcoming = await this.reservationRepo
                .createQueryBuilder("r")
                .where("r.listingMapId IN (:...ids)", { ids: listingIds })
                .andWhere(`r.status IN ${activeStatuses}`)
                .andWhere("r.arrivalDate > :now", { now })
                .andWhere("r.arrivalDate <= DATE_ADD(:now, INTERVAL 45 DAY)", { now })
                .orderBy("r.arrivalDate", "ASC")
                .take(20)
                .getMany()
                .catch(() => [] as ReservationInfoEntity[]);
            const recent = await this.reservationRepo
                .createQueryBuilder("r")
                .where("r.listingMapId IN (:...ids)", { ids: listingIds })
                .andWhere("r.departureDate < :now", { now })
                .andWhere("r.departureDate >= DATE_SUB(:now, INTERVAL 14 DAY)", { now })
                .andWhere(`r.status IN ${activeStatuses}`)
                .orderBy("r.departureDate", "DESC")
                .take(10)
                .getMany()
                .catch(() => [] as ReservationInfoEntity[]);

            lines.push("");
            lines.push(
                "## LIVE BOOKINGS ON THEIR PROPERTIES (per Hostify / our reservation system — may lag cancellations or sync)"
            );
            lines.push(`Snapshot as of ${fmt(now)} (not real-time absolute truth):`);
            lines.push(current.length ? "Currently hosting (per Hostify):" : "Currently hosting (per Hostify): none on file right now");
            for (const r of current) lines.push(resvLine(r));
            if (upcoming.length) {
                lines.push("Upcoming arrivals next 45 days (per Hostify):");
                for (const r of upcoming) lines.push(resvLine(r));
            } else {
                lines.push("Upcoming arrivals next 45 days (per Hostify): none on the books.");
            }
            if (recent.length) {
                lines.push("Recent checkouts last 14 days (per Hostify):");
                for (const r of recent) lines.push(resvLine(r));
            }
            lines.push(
                "INSTRUCTIONS: When answering occupancy/booking questions, frame as 'Hostify / our system shows…' — never absolute 'both units are booked' / 'there is definitely a guest'. " +
                    "Share dates, unit/listing, and status by default; only mention guest names if the owner asks who is staying. " +
                    "If the OWNER DISPUTES this data (says there is no booking, cancel lag, wrong calendar, 'that isn't right'): acknowledge their concern, do NOT argue or re-assert the snapshot as fact, say the team will verify in Hostify, and set escalation_required=true. " +
                    "If they ask about a period beyond this snapshot, or about statements/money transfers, say the team will pull the details and follow up (escalate). " +
                    "IMPORTANT: an empty booking list means NO BOOKINGS ON FILE in Hostify — it says NOTHING about whether a listing is live, published, or bookable. " +
                    "If they ask whether a listing is live/published/visible, that is a listing-status question this data cannot answer: say the team will confirm."
            );
        }
        return lines.join("\n");
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
        // Any human action (or delivery) vetoes a queued delayed auto-send.
        if (status !== "suggested") suggestion.autosendScheduledAt = null;
        return this.suggestionRepo.save(suggestion);
    }

    /** Persist human feedback on a suggestion, general AI guidance, or sent reply. */
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
        targetType?: string | null;
        originalMessage?: string | null;
        subjectUserId?: number | null;
    }) {
        const rating = input.rating === "up" || input.rating === "down" ? input.rating : null;
        const targetType =
            input.targetType === "suggestion" ||
            input.targetType === "general" ||
            input.targetType === "sent_reply"
                ? input.targetType
                : input.suggestionId != null
                  ? "suggestion"
                  : "general";
        const originalMessage = input.originalMessage
            ? String(input.originalMessage).replace(/\u0000/g, "").trim().slice(0, 20000) || null
            : null;
        const feedback = this.feedbackRepo.create({
            suggestionId: input.suggestionId ?? null,
            threadId: input.threadId ?? null,
            messageId: input.messageId ?? null,
            listingId: input.listingId ?? null,
            reservationId: input.reservationId ?? null,
            userId: input.userId ?? null,
            targetType,
            originalMessage,
            subjectUserId: input.subjectUserId ?? null,
            rating,
            categories: input.categories && input.categories.length ? JSON.stringify(input.categories) : null,
            feedbackText: input.feedbackText || null,
            correctedResponse: input.correctedResponse || null,
        });
        const saved = await this.feedbackRepo.save(feedback);
        logger.info(
            `[InboxAIService] feedback ${saved.id} recorded (type=${targetType}, suggestion ${input.suggestionId ?? "n/a"}, rating ${rating ?? "n/a"})`
        );
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

    /**
     * Check listing / guest / thread mutes that block Hostify auto-respond.
     * Suggestions still generate; only delivery is suppressed.
     */
    async resolveAutosendMute(
        conversation: InboxConversationEntity
    ): Promise<{ disabled: boolean; reason?: string }> {
        if (Number(conversation.aiAutoRespondDisabled) === 1) {
            return { disabled: true, reason: "thread_autosend_disabled" };
        }
        if (conversation.guestId != null) {
            const guestMute = await this.guestAutosendDisableRepo
                .findOne({ where: { guestId: Number(conversation.guestId) as any } })
                .catch(() => null);
            if (guestMute) {
                return { disabled: true, reason: "guest_autosend_disabled" };
            }
        }
        if (conversation.listingId != null) {
            const detail = await this.listingDetailRepo
                .findOne({ where: { listingId: Number(conversation.listingId) } })
                .catch(() => null);
            if (detail && Number((detail as any).aiAutoRespondDisabled) === 1) {
                return { disabled: true, reason: "listing_autosend_disabled" };
            }
        }
        return { disabled: false };
    }

    /**
     * Inbox toggle: disable/enable auto-respond for this conversation's guest.
     * When guestId is present, persists a guest-level mute so future threads
     * for the same guest stay muted. Also cancels any queued delayed autosends.
     */
    async setConversationAutoRespondDisabled(
        threadId: number,
        disabled: boolean,
        disabledBy?: string | null
    ): Promise<InboxConversationEntity> {
        const conversation = await this.conversationRepo.findOne({ where: { threadId } });
        if (!conversation) throw new Error(`Conversation ${threadId} not found`);

        conversation.aiAutoRespondDisabled = disabled ? 1 : 0;
        conversation.aiAutoRespondDisabledAt = disabled ? new Date() : null;
        conversation.aiAutoRespondDisabledBy = disabled ? disabledBy || null : null;
        await this.conversationRepo.save(conversation);

        if (conversation.guestId != null) {
            const guestId = Number(conversation.guestId);
            if (disabled) {
                let row = await this.guestAutosendDisableRepo.findOne({
                    where: { guestId: guestId as any },
                });
                if (!row) {
                    row = this.guestAutosendDisableRepo.create({
                        guestId: guestId as any,
                        guestName: conversation.guestName || null,
                        disabledBy: disabledBy || null,
                    });
                } else {
                    row.guestName = conversation.guestName || row.guestName;
                    row.disabledBy = disabledBy || row.disabledBy;
                }
                await this.guestAutosendDisableRepo.save(row);

                // Mirror the flag onto other open threads for this guest so the
                // inbox UI shows the mute everywhere without an extra lookup.
                await this.conversationRepo
                    .createQueryBuilder()
                    .update(InboxConversationEntity)
                    .set({
                        aiAutoRespondDisabled: 1,
                        aiAutoRespondDisabledAt: new Date(),
                        aiAutoRespondDisabledBy: disabledBy || null,
                    } as any)
                    .where("guestId = :guestId", { guestId })
                    .execute()
                    .catch(() => undefined);
            } else {
                await this.guestAutosendDisableRepo.delete({ guestId: guestId as any }).catch(() => undefined);
                await this.conversationRepo
                    .createQueryBuilder()
                    .update(InboxConversationEntity)
                    .set({
                        aiAutoRespondDisabled: 0,
                        aiAutoRespondDisabledAt: null,
                        aiAutoRespondDisabledBy: null,
                    } as any)
                    .where("guestId = :guestId", { guestId })
                    .execute()
                    .catch(() => undefined);
            }
        }

        if (disabled) {
            const queued = await this.suggestionRepo.find({
                where: {
                    source: "hostify",
                    threadId: threadId as any,
                    status: "suggested",
                },
                take: 20,
            });
            for (const s of queued) {
                if (s.autosendScheduledAt == null) continue;
                s.autosendScheduledAt = null;
                s.status = "ignored";
                await this.suggestionRepo.save(s).catch(() => undefined);
            }
        }

        logger.info(
            `[InboxAIService] auto-respond ${disabled ? "DISABLED" : "ENABLED"} for thread ${threadId}` +
                (conversation.guestId != null ? ` (guest ${conversation.guestId})` : "") +
                (disabledBy ? ` by ${disabledBy}` : "")
        );
        return conversation;
    }

    async maybeAutoRespond(
        threadId: number,
        messageId?: number | null
    ): Promise<{ sent: boolean; reason: string; suggestionId?: number; messageExternalId?: number }> {
        try {
            const conversation = await this.conversationRepo.findOne({ where: { threadId } });
            if (!conversation) return { sent: false, reason: "no_conversation" };

            // Pure acknowledgment ("thanks!", "sounds good") — nothing to answer,
            // don't spend a generation + verification on it.
            try {
                const msgs = await this.messageRepo.find({ where: { threadId }, order: { sentAt: "ASC", id: "ASC" } });
                const inbound = msgs.filter((m) => m.direction === "incoming");
                const ackTarget =
                    messageId != null
                        ? msgs.find((m) => Number(m.externalId) === Number(messageId)) || null
                        : inbound.length
                        ? inbound[inbound.length - 1]
                        : null;
                if (ackTarget && InboxAIService.isPureAcknowledgment(ackTarget.body || "")) {
                    return { sent: false, reason: "ack_only" };
                }
            } catch {
                /* non-fatal — fall through to normal generation */
            }

            // ALWAYS generate + persist a "shadow" suggestion for this inbound guest
            // message, regardless of auto-send. This builds the suggestion-vs-team
            // learning dataset: the guest message externalId is stored on the
            // suggestion (messageId) so the team's actual reply can be matched to it
            // when it arrives. Deduped per (thread, message), so webhook retries and
            // repeat opens are cheap no-ops.
            let suggestion: AIMessageSuggestionEntity | null;
            try {
                suggestion = await this.generateSuggestion(threadId, { messageId: messageId ?? null });
            } catch (err: any) {
                logger.error(`[InboxAIService] suggestion generation failed (thread ${threadId}): ${err.message}`);
                return { sent: false, reason: "generation_failed" };
            }
            // No pending inbound question (team already replied by the time this
            // ran) — nothing to answer, nothing to auto-send.
            if (!suggestion) return { sent: false, reason: "no_pending_question" };

            // generateSuggestion dedupes per (thread, message), so webhook
            // retries hand back the SAME suggestion row. If it was already
            // delivered/handled, or is already sitting in the delayed queue,
            // never send again (and never reset a running veto timer).
            if (suggestion.status !== "suggested") {
                return { sent: false, reason: `already_${suggestion.status}`, suggestionId: suggestion.id };
            }
            if (suggestion.autosendScheduledAt != null) {
                return { sent: false, reason: "already_queued", suggestionId: suggestion.id };
            }

            // Manual mutes: per-thread, per-guest (problematic guests), or per-listing.
            const mute = await this.resolveAutosendMute(conversation);
            if (mute.disabled) {
                return this.autosendSkip(threadId, suggestion.id, mute.reason || "autosend_muted");
            }

            // ---- Unpaid-arrival emergency (non-Airbnb only) ----
            // If the guest is arriving/staying on a non-Airbnb channel with an
            // outstanding balance, do NOT auto-answer. Flag the conversation as an
            // emergency ("guest needs to pay") and email the configured recipients
            // so a human collects payment before access is granted. This runs
            // regardless of the auto-send toggle so the alert always fires.
            // Also clears stale payment pins on cancelled/inactive reservations.
            try {
                const paymentCheck = await this.overduePaymentService.evaluateArrivalPaymentEmergency(conversation);
                if (paymentCheck.isEmergency) {
                    await this.overduePaymentService.raiseEmergency(conversation, paymentCheck.reason || "Guest has an unpaid balance at check-in.", "payment");
                    return this.autosendSkip(threadId, suggestion.id, "payment_emergency");
                }
                // evaluateArrivalPaymentEmergency may have cleared a cancelled pin —
                // reload so a stale emergency flag doesn't keep blocking autosend.
                if (Number(conversation.emergency) === 1 && conversation.emergencyType === "payment") {
                    const fresh = await this.conversationRepo.findOne({ where: { threadId } });
                    if (fresh) {
                        conversation.emergency = fresh.emergency;
                        conversation.emergencyType = fresh.emergencyType;
                        conversation.emergencyReason = fresh.emergencyReason;
                        conversation.emergencyAt = fresh.emergencyAt;
                    }
                }
            } catch (err: any) {
                logger.warn(`[InboxAIService] payment-emergency check failed (thread ${threadId}): ${err.message}`);
            }

            // Any urgent flag (payment, extension price, etc.) blocks auto-send.
            if (Number(conversation.emergency) === 1) {
                return this.autosendSkip(
                    threadId,
                    suggestion.id,
                    `emergency:${conversation.emergencyType || "unknown"}`
                );
            }

            // Extension asks: never auto-quote Hostify calendar rates — pin Urgent for a human price.
            // generateSuggestion already raises this flag; this is a belt-and-suspenders autosend block.
            try {
                const fresh = await this.conversationRepo.findOne({ where: { threadId } });
                if (Number(fresh?.emergency) === 1 && String(fresh?.emergencyType || "") === "extension_price") {
                    return this.autosendSkip(threadId, suggestion.id, "extension_price_urgent");
                }
                const guestBody = conversation.lastMessageText || "";
                if (this.detectExtensionAsk(guestBody)) {
                    await this.overduePaymentService.raiseEmergency(
                        conversation,
                        "Guest asked about extending their stay — please confirm availability and reply with the exact extension price. Do not rely on Hostify calendar rates alone.",
                        "extension_price",
                        { notify: false }
                    );
                    return this.autosendSkip(threadId, suggestion.id, "extension_price_urgent");
                }
            } catch (err: any) {
                logger.warn(`[InboxAIService] extension_price urgent check failed (thread ${threadId}): ${err.message}`);
            }

            // ---- Auto-send is a separate, stricter gate (default OFF) ----
            if (!(await InboxAIService.resolveAutosendEnabled()))
                return { sent: false, reason: "autosend_disabled", suggestionId: suggestion.id };

            const allowed = await InboxAIService.autosendAllowedChannelsAsync();
            if (allowed && conversation.channel && !allowed.includes(conversation.channel.toLowerCase())) {
                return { sent: false, reason: `channel_not_allowed:${conversation.channel}`, suggestionId: suggestion.id };
            }

            // ---- Hard guardrails (any failure => leave for human) ----
            // Gate on the stricter of the generator's self-score and the
            // independent verifier score; BOTH must clear the bar. A missing
            // verifier score fails closed (no auto-send without verification).
            const selfConf = suggestion.confidence != null ? Number(suggestion.confidence) : null;
            const verConf = suggestion.verifierConfidence != null ? Number(suggestion.verifierConfidence) : null;
            const conf = selfConf != null && verConf != null ? Math.min(selfConf, verConf) : null;
            const reply = (suggestion.suggestedReply || "").trim();
            const warnings = this.safeJsonArray(suggestion.warnings);

            if (suggestion.escalationRequired) return this.autosendSkip(threadId, suggestion.id, "escalation_required");
            if (!reply) return this.autosendSkip(threadId, suggestion.id, "empty_reply");
            if (warnings.length > 0) return this.autosendSkip(threadId, suggestion.id, "model_warnings");

            // Inquiry (pre-booking) threads are sales conversations — auto-send
            // needs its own opt-in on top of the general auto-respond toggle.
            const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);
            if (InboxAIService.isInquiryStatus(conversation.reservationStatus) && !settings?.inquiryAutoRespondEnabled) {
                return this.autosendSkip(threadId, suggestion.id, "inquiry_autosend_disabled");
            }

            // ---- Confidence tier decision ----
            // Tiered mode: instant send at the top tier; a delayed, human-vetoable
            // send in the middle tier; draft-only below. Legacy mode: one bar.
            const tierEnabled = Boolean(settings?.autosendTierEnabled);
            const instantBar = tierEnabled
                ? Number(settings?.autosendInstantMinConfidence ?? 95)
                : await InboxAIService.autosendMinConfidenceAsync();
            const delayedBar = tierEnabled ? Number(settings?.autosendDelayedMinConfidence ?? 85) : null;

            if (conf == null || (tierEnabled ? delayedBar != null && conf < delayedBar : conf < instantBar)) {
                return this.autosendSkip(
                    threadId,
                    suggestion.id,
                    `low_confidence:self=${selfConf ?? "?"},verified=${verConf ?? "?"}<${tierEnabled ? delayedBar : instantBar}`
                );
            }

            if (tierEnabled && conf < instantBar) {
                // Middle tier: queue with a veto window instead of sending now.
                const delayMin = Math.max(1, Number(settings?.autosendDelayMinutes ?? 5));
                suggestion.autosendScheduledAt = new Date(Date.now() + delayMin * 60000);
                await this.suggestionRepo.save(suggestion);
                logger.info(
                    `[InboxAIService] auto-send QUEUED for thread ${threadId} ` +
                    `(suggestion ${suggestion.id}, conf ${conf} in [${delayedBar}, ${instantBar}), sends in ${delayMin}m unless vetoed)`
                );
                return { sent: false, reason: "queued_delayed", suggestionId: suggestion.id };
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
                    `(suggestion ${suggestion.id}, conf ${conf} >= ${instantBar})`
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
     * Deliver queued middle-tier auto-sends whose veto window has elapsed.
     * Runs on a short scheduler interval. Each candidate is re-checked before
     * delivery: auto-send must still be enabled, the thread must not be in an
     * emergency, and the guest message this reply answers must still be the
     * last message in the thread (a team reply or a newer guest message vetoes
     * the queued send — the newer message gets its own fresh pipeline run).
     */
    async processDueDelayedAutosends(): Promise<{ sent: number; cancelled: number }> {
        let sent = 0;
        let cancelled = 0;
        const due = await this.suggestionRepo.find({
            where: {
                source: "hostify",
                status: "suggested",
                autosendScheduledAt: LessThanOrEqual(new Date()),
            },
            take: 25,
        });
        if (!due.length) return { sent, cancelled };

        // Settings can change while sends sit in the queue — re-resolve every
        // gate at delivery time, not just at queueing time.
        const enabled = await InboxAIService.resolveAutosendEnabled();
        const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);
        const allowedChannels = await InboxAIService.autosendAllowedChannelsAsync();

        for (const suggestion of due) {
            const cancel = async (reason: string) => {
                suggestion.autosendScheduledAt = null;
                await this.suggestionRepo.save(suggestion);
                cancelled++;
                logger.info(`[InboxAIService] delayed autosend cancelled (suggestion ${suggestion.id}): ${reason}`);
            };
            try {
                if (!enabled) {
                    await cancel("autosend_disabled");
                    continue;
                }
                if (!settings?.autosendTierEnabled) {
                    await cancel("tiers_disabled");
                    continue;
                }
                const threadId = Number(suggestion.threadId);
                const conversation = await this.conversationRepo.findOne({ where: { threadId } });
                if (!conversation || conversation.emergency) {
                    await cancel(conversation ? "emergency" : "no_conversation");
                    continue;
                }
                const mute = await this.resolveAutosendMute(conversation);
                if (mute.disabled) {
                    await cancel(mute.reason || "autosend_muted");
                    continue;
                }
                if (
                    allowedChannels &&
                    conversation.channel &&
                    !allowedChannels.includes(conversation.channel.toLowerCase())
                ) {
                    await cancel(`channel_not_allowed:${conversation.channel}`);
                    continue;
                }
                if (
                    InboxAIService.isInquiryStatus(conversation.reservationStatus) &&
                    !settings?.inquiryAutoRespondEnabled
                ) {
                    await cancel("inquiry_autosend_disabled");
                    continue;
                }
                const lastMsg = await this.messageRepo.findOne({
                    where: { threadId },
                    order: { sentAt: "DESC", id: "DESC" },
                });
                const stillPending =
                    lastMsg &&
                    lastMsg.direction === "incoming" &&
                    (suggestion.messageId == null || Number(lastMsg.externalId) === Number(suggestion.messageId));
                if (!stillPending) {
                    await cancel("thread_moved_on");
                    continue;
                }
                const reply = (suggestion.suggestedReply || "").trim();
                if (!reply) {
                    await cancel("empty_reply");
                    continue;
                }
                // At-most-once: take the row out of the queue BEFORE delivering.
                // A crash mid-send then leaves a draft (safe), never a double-send.
                suggestion.autosendScheduledAt = null;
                await this.suggestionRepo.save(suggestion);
                const inboxService = new InboxService();
                const saved = await inboxService.sendAutomatedReply(threadId, reply, { senderName: "AI Assistant" });
                const sentExternalId = Number((saved as any)?.externalId);
                await this.updateSuggestionStatus(suggestion.id, "auto_sent", {
                    finalSentMessageId: Number.isFinite(sentExternalId) ? sentExternalId : null,
                });
                sent++;
                logger.info(
                    `[InboxAIService] delayed AUTO-SENT reply for thread ${threadId} (suggestion ${suggestion.id})`
                );
            } catch (err: any) {
                logger.error(`[InboxAIService] delayed autosend failed (suggestion ${suggestion.id}): ${err.message}`);
                await cancel(`delivery_failed:${err.message}`).catch(() => {});
            }
        }
        return { sent, cancelled };
    }

    /**
     * Human veto of a queued delayed auto-send. Clears the schedule AND moves
     * the suggestion to "ignored" so a webhook retry can never re-queue it
     * (maybeAutoRespond only acts on status "suggested"). The draft text stays
     * in the inbox — staff can still edit and send it themselves, which flips
     * the status to accepted/edited through the normal flow.
     */
    async vetoDelayedAutosend(id: number, vetoedByUserId?: number | null): Promise<AIMessageSuggestionEntity> {
        const suggestion = await this.suggestionRepo.findOne({ where: { id } });
        if (!suggestion) throw new Error(`Suggestion ${id} not found`);
        suggestion.autosendScheduledAt = null;
        if (suggestion.status === "suggested") suggestion.status = "ignored";
        if (vetoedByUserId != null) suggestion.acceptedByUserId = vetoedByUserId;
        await this.suggestionRepo.save(suggestion);
        logger.info(`[InboxAIService] delayed autosend vetoed by human (suggestion ${id})`);
        return suggestion;
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
            // Team replied themselves — veto any queued delayed auto-send.
            suggestion.autosendScheduledAt = null;
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

    /**
     * Pure acknowledgment detector — "thanks!", "ok great", "sounds good", a
     * thumbs-up emoji. These need no reply, but the July 16 audit found 128
     * drafts (13.5% of Hostify volume) generated for them in 2 days, and the
     * Quo auto-responder answering every "got it" made PM threads feel spammy.
     * Conservative: any digits, a question mark, or a non-ack word disqualifies.
     */
    static isPureAcknowledgment(text: string): boolean {
        const t = String(text || "").trim().toLowerCase();
        if (!t || t.length > 80) return false;
        if (t.includes("?") || /\d/.test(t)) return false;
        const words = t.replace(/[^a-z' ]+/g, " ").replace(/'/g, "").split(/\s+/).filter(Boolean);
        // No alphabetic content at all (emoji / punctuation only) = an ack.
        if (!words.length) return true;
        if (words.length > 10) return false;
        const ACK = new Set([
            "ok", "okay", "k", "kk", "thanks", "thank", "thankyou", "you", "u", "so", "very", "much", "ty", "tysm",
            "thx", "great", "perfect", "awesome", "amazing", "wonderful", "excellent", "fantastic", "sounds", "good",
            "got", "it", "will", "do", "no", "problem", "worries", "too", "night", "goodnight", "morning", "evening",
            "weekend", "noted", "understood", "yes", "yep", "yup", "sure", "all", "love", "appreciate", "appreciated",
            "that", "this", "was", "bye", "goodbye", "see", "then", "soon", "have", "a", "nice", "day", "one", "cool",
            "gotcha", "welcome", "my", "pleasure", "anytime", "of", "course", "sweet", "well", "same", "likewise",
        ]);
        return words.every((w) => ACK.has(w));
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
        // Sentence dashes (en/em dash, or a spaced hyphen) read as punctuation —
        // turn them into a comma so the sentence still flows ("out back — I've
        // got a kayak" → "out back, I've got a kayak"), instead of the bare
        // space that used to create run-ons.
        const commaFixed = text
            .replace(/(\d)\s*[\u2012-\u2015\u2212]\s*(?=[A-Za-z0-9])/g, "$1 to ")
            .replace(/\s+-\s+/g, ", ")
            .replace(/\s*[\u2012-\u2015\u2212]\s*/g, ", ");
        // Remaining hyphen variants (compound words like check-in) become spaces.
        const noDash = commaFixed.replace(/[\u2010-\u2011\uFE58\uFE63\uFF0D-]/g, " ");
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

    /**
     * Pre-booking statuses where the guest hasn't committed yet — the reply is a
     * sales conversation, so the prompt switches into inquiry sales mode.
     */
    static isInquiryStatus(status?: string | null): boolean {
        const s = String(status || "").toLowerCase();
        if (!s) return false;
        return s.startsWith("inquiry") || s.startsWith("preapproved") || s.startsWith("offer") || s.startsWith("pending");
    }

    private systemPrompt(
        settings?: AIMessagingSettingsEntity | null,
        opts: { airbnbSupport?: boolean; inquirySales?: boolean; pmClient?: boolean } = {}
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
        const baseReplyStyleRules = (settings?.baseReplyStyleRules || "").trim();
        if (baseReplyStyleRules) {
            settingsBlock.push("TEAM BASE REPLY STYLE RULES (follow these strictly):");
            settingsBlock.push(baseReplyStyleRules);
        }
        if (topicsToAvoid) {
            settingsBlock.push("TOPICS TO AVOID / ALWAYS ESCALATE (never answer these directly — set escalation_required=true):");
            settingsBlock.push(topicsToAvoid);
        }
        if (opts.airbnbSupport) {
            settingsBlock.push(textOrDefault(settings?.airbnbSupportBaseRules, AI_REPLY_RULE_DEFAULTS.airbnbSupportBaseRules));
            if (airbnbSupportRules) {
                settingsBlock.push("AIRBNB SUPPORT RULES (follow these strictly for this conversation):");
                settingsBlock.push(airbnbSupportRules);
            }
        }
        if (opts.pmClient) {
            settingsBlock.push(textOrDefault(settings?.quoPmClientRules, AI_REPLY_RULE_DEFAULTS.quoPmClientRules));
        }
        if (opts.inquirySales && !opts.airbnbSupport && !opts.pmClient) {
            settingsBlock.push(textOrDefault(settings?.inquirySalesBaseRules,
                [
                    "NEW INQUIRY — SALES MODE (this guest has NOT booked yet; your reply is a sales conversation and its job is to win the booking).",
                    "For this reply you are the host texting back, not a support desk. The guest is reading on their phone, half-paying-attention, and can smell a corporate bot from a mile away. Sound human, answer fast, and nudge toward booking without ever being pushy or fake.",
                    "",
                    "VOICE:",
                    "- First person, always. Say 'I've got a kayak on the pond', never 'there is a kayak available' or 'the property offers'. You are a person, not a property.",
                    "- WARM, not clipped. You're genuinely glad they reached out and you'd love to host them — let that show in the wording. Short does NOT mean cold: a terse list of facts reads like a vending machine. Wrap the facts in a host's kindness ('you'll love...', 'it's all yours to enjoy', 'happy to help you plan').",
                    "- Contractions always. Max one exclamation point per three sentences. No em dashes. No three-item parallel lists ('kayaking, grilling, and relaxing').",
                    "- Banned words/phrases: 'certainly', 'I'd be happy to', 'feel free to', 'our property offers', 'nestled', 'oasis', 'a wonderful way to experience', 'perfect for relaxing and enjoying'.",
                    "- Specificity beats adjectives: 'the sunset off the back deck is unreal' sells; 'beautiful views' doesn't. Concrete detail (from context only) makes them picture themselves there.",
                    "",
                    "STRUCTURE:",
                    "- Answer their exact question first, in their order. Front-load the yes. Never open with 'Thanks for reaching out!' and make them scroll for the answer.",
                    "- State amenities plainly and cut justification clauses: 'Grill and private hot tub too.' Not 'we provide a grill so you can enjoy relaxing after your adventures.'",
                    "- Mention 1-2 related things we actually offer (from the listing context) that fit what they asked about. Skip entirely if nothing relates. NEVER invent amenities.",
                    "- Mirror their intent ONCE if they mention kids, a dog, an anniversary, or group size: 'perfect spot for the kids to run around out back.' One reflection, not a theme.",
                    "- One social-proof line ONLY if real guest feedback/reviews appear in the provided context, matched to what they asked about ('guests always tell me the hot tub at night is the best part'). Never generic ('past guests loved it'), never on every amenity, never invented.",
                    "- Seasonal timing is a fair soft nudge when it's honest general knowledge for the area ('this time of year the pond's great for early morning fishing'). Local events, festivals, games or news: ONLY if they appear in the provided context — if you don't have a real one, say nothing. A made-up local fact burns trust; silence beats a guess.",
                    "- END WARM. The last line is what they remember — it must make them feel wanted as guests, never processed. Good closes: 'We'd love to have you!' / 'You'd have a great time here — happy to answer anything else.' / 'Just the two of you or a bigger group? Either way we'd love to host you.' BANNED closes: 'Anything else you want to know before booking?', 'Let me know if you have questions', or any transactional line that reads like a checkout screen.",
                    "",
                    "HONESTY & LIMITS:",
                    "- Genuine urgency only, and only from the live availability data: if the calendar really is tight around their dates, say it ('only got a couple weekends left in that stretch'); if it's wide open, skip urgency entirely. Never fake scarcity.",
                    "- If we genuinely don't have what they need, say so straight — trust wins more bookings than spin. Never imply they already have a confirmed reservation. Anxious 'do we have somewhere to go?' questions are NOT confirmations — check status / escalate; never reassure with a fake booking.",
                    "- NEVER offer to hold dates, NEVER ask for or offer a phone number or email, NEVER push anything off-platform, NEVER offer discounts. Booking happens on the platform.",
                    "- Length: 2-4 sentences when it fits; more only if the question genuinely needs it. Never pad.",
                    "",
                    "EXAMPLES OF THE TARGET FEEL (adapt facts to the actual context, never copy amenities from these):",
                    "Guest: 'Is there anything to do on the water there? And are the dates in July open?' → 'Yep! Kayak's on the pond and the fishing's great this time of year. Grill and private hot tub too. Place is open July 9 to Aug 21 if those are your dates. Just the two of you or a bigger group? Either way we'd love to have you out here.'",
                    "Guest: 'Do you allow dogs? We have a golden retriever.' → 'I do, dogs are welcome! There's a fenced yard out back so your golden can run around off-leash. We'd love to host you both.'",
                    "If a line sounds like a brochure or an upsell, rewrite it or cut it. If the last line could come from a support ticket, rewrite it warmer.",
                ].join("\n")
            ));
            const inquiryRules = (settings?.inquirySalesRules || "").trim();
            if (inquiryRules) {
                settingsBlock.push("TEAM INQUIRY SALES RULES (follow these strictly for inquiry replies):");
                settingsBlock.push(inquiryRules);
            }
        }
        if (Number(settings?.selfServiceTroubleshootingEnabled) === 1 && !opts.airbnbSupport && !opts.pmClient && !opts.inquirySales) {
            settingsBlock.push(textOrDefault(settings?.selfServiceTroubleshootingRules, AI_REPLY_RULE_DEFAULTS.selfServiceTroubleshootingRules));
        }
        if (!opts.airbnbSupport && !opts.pmClient) {
            settingsBlock.push(
                renderEarlyLateCheckPolicy(
                    normalizeEarlyLateHandling(settings?.earlyCheckinHandling),
                    normalizeEarlyLateHandling(settings?.lateCheckoutHandling)
                )
            );
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
            "- BANNED PHRASE: never write \"you're all set\" (or \"you are all set\" / \"all set for\"). It asserts completion you usually can't verify and it reads canned. Say what IS true instead (only if status is accepted/confirmed: 'your reservation is confirmed'; otherwise 'the team will confirm your booking status') or just close warmly.",
            "",
            "PRINCIPLES:",
            `- Be concise, professional, and helpful with a ${toneLabel} hospitality brand voice.`,
            "- NEVER invent facts (codes, prices, policies, amenities, addresses). Only use provided context.",
            "- NEVER claim an action has already been completed, approved, scheduled, blocked, or refunded unless the provided context or an earlier TEAM message explicitly confirms it happened. When someone asks you to change something, acknowledge and COMMIT ('I'll have the team get that blocked and confirm shortly') — never pretend it's done. 'I've blocked those dates' or 'you're all set' with no confirmation is the most damaging mistake you can make.",
            "- COMPLIMENTARY / FREE / GOODWILL: never confirm a complimentary night, free night, waived fee, or goodwill credit as approved/confirmed unless a TEAM message or [ops_confirm_ok] in THIS thread already says so. Acknowledge → escalate_required=true → team decides.",
            "- LOCAL EVENTS & PROPERTY EXPERIENCE: never invent festivals, games, concerts, news, train noise, lake/beach swimability, neighborhood vibe, or on-site feel. Those require External KB / proven replies / TEAM messages. Approx drive times to well-known places are OK; property-experience claims are not.",
            "- NEVER quote a specific fee or price that does not appear in the provided context — not even a plausible-sounding one. If the amount isn't in context, say the team will confirm the exact cost.",
            "- NEVER promise to send a phone number, email address, or any personal contact info — you don't have one. Keep the conversation in this thread.",
            "- DISCRETIONARY REQUESTS — early check-in / late check-out / pool heating / parking follow the Available paid services SDTO rules (Upsells database). NOT ALLOWED → deny. NEEDS CONFIRMATION → escalate (no firm price). ALLOWED → quote the calculated fee, subject to availability; do not approve a specific clock time unless a TEAM message already confirmed it. Extensions beyond listed nights, group-size changes, and fee waivers remain team-decided — always escalate those.",
            "- CALL SCHEDULING (hard rule for now): if the other party wants a phone call / to talk / to find a time to chat, defer to a live person. Never say you (or a named teammate) are free today/tomorrow or propose a specific slot. Acknowledge → a teammate will confirm timing → escalation_required=true.",
            "- AMENITY / GEAR FULFILLMENT (pack n play, high chair, crib, rollaway, extra towels, etc.): you may acknowledge and say the team will check what is on-site / with the owner. You must NEVER say we are already arranging it, that N units are confirmed, or that everything will be set for arrival — unless a TEAM message or [ops_confirm_ok] task in THIS thread already says so. Escalate; do not invent inventory.",
            "- BOOKING CONFIRMATION: never say the reservation/booking is confirmed, or that the guest 'has a place to go', unless Reservation status in context is clearly accepted/confirmed (not inquiry, preapproved, pending, or missing). If they are anxious about having a place and status is unclear, say the team will verify availability/status — escalation_required=true. Never invent a confirmation.",
            "- ASSERT POLICY: when an 'Assert policy' section is present, only ASSERTABLE lines may be stated as certain. POLICY lines are instructions, not guest facts. Price/fee ≠ approval.",
            "- ACCESS CODES: only share when the Door access block contains live codes (check-in day / mid-stay / lockout). If the policy block says codes go out on arrival day, do NOT share or invent any code.",
            "- NEVER CONFIRM A CODE THE GUEST SUGGESTED. If they ask 'is the code 14-28-38?', do NOT say yes / you've got it right unless that exact code appears in Door access / EXTERNAL KB / a TEAM message. Prefer stating the documented code, or say the team will verify.",
            "- PAYMENT STATE: follow the payment_state line in Reservation billing. failed → charge did not go through (ask for a valid card / bank; never say authenticate or confirmed). auth_required → guest may need to complete verification. due → balance outstanding. A ChargeAutomation securelink alone does NOT mean authentication is needed.",
            "- CONTESTED FACTS: when the Contested listing facts section marks CONFLICT for checkout/check-in/capacity, do NOT pick a time or max-guest number — escalate for the team to confirm.",
            "- Do NOT invent physical features or capacities. In particular, never name a parking type (garage, driveway, carport, lot) or a specific number of cars/vehicles unless that detail appears in the provided context. If parking specifics are not in context, describe only what IS known and offer to confirm the rest — do not guess.",
            "- AMENITIES: A platform 'Amenities' checklist is marketing/listed-on-site data, NOT confirmed on-site inventory. You may say an item is listed for the property, but NEVER invent where it is stored/located (cabinet, drawer, under sink, etc.). If the guest needs to find something and location isn't in a staff-written KB entry, say the team will confirm. Prefer house rules / staff-written KB over amenity checklists when they conflict.",
            "- DEPOSITS & MONEY: Prefer live 'Reservation billing' fields (security_price / deposit_paid) over any learned/portfolio answer. Never assert 'no deposit was collected' from a portfolio/Airbnb rule when this booking's channel or billing block does not clearly support it — if unclear, say the team will check the deposit status and escalate.",
            "- RENTAL AGREEMENT / DEPOSIT AUTHORIZATION LINKS: Only send a ChargeAutomation securelink or a SecureStay rental-agreement link that appears in context (or an earlier TEAM message in THIS thread). NEVER send a Hostify pre-check-in / us.hostify.com/checkin URL as the rental agreement — that is a different form. If the guest needs the agreement and no correct link is in context, say the team will send the secure link.",
            "- AUTHORITY ORDER when sources conflict: (1) TEAM messages in THIS thread, (2) live reservation billing + listing times/capacity/house rules, (3) property-specific KB/learned facts, (4) proven replies for this property, (5) portfolio answers last and only for generic ops. Never let portfolio override house rules, capacity, checkout time, or deposit facts.",
            "- Earlier TEAM messages in this same thread are authoritative: prefer them, reuse their facts, and NEVER contradict something the team already told this guest.",
            "- The 'proven replies' section shows how our team answered similar questions for THIS property before. Strongly prefer their facts, specifics, and tone; adapt to the current guest. If they conflict with listing context (especially house rules / max guests / checkout time), trust listing context and the current thread.",
            "- Answer DIRECTLY and confidently when the context (proven replies, learned answers, listing knowledge, availability, reservation details) already contains the answer. Do NOT default to 'the team will confirm' for information you already have — only defer for things genuinely not in context.",
            "- ANSWER THE QUESTION: never reply with only a generic acknowledgement ('thanks for reaching out', 'let us know if you need anything') when the guest asked a specific question. Address what they actually asked using the context. A generic holding reply is acceptable ONLY when the needed info is truly absent AND you add a warning and keep confidence low.",
            "- PRICING: never offer, promise, negotiate, or imply a discount, deal, coupon, or 'special offer'. If a guest asks for a better/lower price, explain the rate shown reflects current dynamic pricing for those dates; do not invent reductions.",
            "- POLICY & STANDARD OFFERS: If the context (proven replies, learned answers, listing knowledge/documents) shows how we normally handle something — e.g. early check-in for a stated fee, luggage drop-off, a specific refund/cancellation policy — STATE it the way our team does, noting 'subject to availability/confirmation' where appropriate. Do NOT invent or promise exceptions that are NOT documented (free waivers, discounts, penalty-free cancellations, guaranteed early check-in).",
            "- NEVER ASSERT AN UNKNOWN POLICY: if the context does not tell you how something is handled, do NOT state a policy either way — never say something is 'not allowed', 'non-refundable', 'no refund', or that a policy is 'unknown'. Instead say the team will confirm the specifics. (Stating a policy the context does not support is the worst kind of error.)",
            "- For platform cancellations or rebooking (Airbnb/Booking.com/Vrbo), direct the guest to manage it through that platform. Do not state a fee amount that is not in the provided context.",
            "- Do NOT put a specific door code, lock code, access code, gate code, wifi password, or a specific price/amount in the reply UNLESS that exact value already appears in the provided message history or listing context. If the guest needs a code or figure you do not have, say the team will send it (e.g. before check-in) rather than guessing a value.",
            "- SHARING ACCESS DETAILS WITH CONFIRMED GUESTS: when the guest has a confirmed reservation and it is their check-in day or they are mid-stay, and the context contains documented guest-shareable access/arrival instructions (garage code, door code, lockbox, parking from EXTERNAL knowledge, reservation access codes, or the access block), you SHOULD give them the exact steps and codes when they ask how to get in. Never use or infer from staff-only/internal notes — those are not in your context. Never share access codes with pre-booking inquiries or guests whose stay has not reached check-in day.",
            "- If needed information is missing, say so in `warnings` and write a safe reply that asks the guest for clarification or says the team will follow up — do not guess.",
            "- Prefer the property's documented house rules / check-in info when present in context.",
            "- If a 'Knowledge conflicts under staff review' section is present, those topics have contradictory Q&A/KB vs listing data. Prefer live listing data; never use the conflicting learned/KB value; if listing data is silent, say the team will confirm.",
            "- WHEN THE GUEST ASKS FOR THE RULES OR INSTRUCTIONS THEMSELVES (house rules, check-in/checkout instructions, house manual): if the actual content is in context (e.g. a 'House rules' or check-in entry), SEND IT — reproduce the documented rules/steps in the reply rather than telling the guest where to find them or offering to send them later. Only point to a physical location or defer if the actual content is not in context.",
            "- Reply in the same language the guest used.",
            "",
            "AVAILABILITY / EXTENSIONS:",
            "- If a 'Live availability' section is present without the extension-pricing security banner, it is real calendar data — you MAY state open dates and nightly prices for general availability questions.",
            "- When a date range shows a price band (e.g. ~$40–$55/night), do NOT collapse it to a single number — say rates vary by date in that range.",
            "- EXTENSION PRICING (hard security rule): if the guest wants to extend / add nights, NEVER quote a nightly rate, total, or dollar amount — even if a calendar price appears elsewhere in context. Acknowledge → say a teammate will confirm availability and the exact price → escalation_required=true. A human must price extensions.",
            "- For an extension request you MAY say whether the night after checkout looks open/closed from Live availability (dates only). You cannot modify the reservation yourself.",
            "- If the requested night is NOT available per the calendar, tell the guest it's unavailable and, if helpful, mention the nearest open dates (still no prices on extensions).",
            "- If NO 'Live availability' data is present for an extension/date request, do NOT express eagerness that presumes the night is open (avoid 'we'd love to extend your stay!'). Give a neutral reply that you'll confirm availability, keep confidence <= 0.4, and do not imply the night is likely available.",
            "- NEVER answer an availability question by telling the guest to rely on the platform calendar (no 'if the platform lets you select the dates, they're available', no claims that 'our calendar/system is always up to date'). Without Live availability data, the ONLY correct availability answer is that the team will confirm the specific dates.",
            "- Escalate every extension request (pricing must come from a human). Escalate other availability messages when the guest is negotiating discounts or the calendar data is absent.",
            "",
            "LOCAL AREA, DIRECTIONS & TRAVEL TIME:",
            "- For general questions about distance, drive time, or directions between the property and a well-known place (airports, downtowns, cities, landmarks, neighborhoods), give a helpful APPROXIMATE estimate from general geographic knowledge — do NOT defer to the team and do NOT escalate. Ground it in the property's city/area from the listing context.",
            "- Always label these as approximate and traffic-dependent, e.g. 'roughly a 20-minute drive (~15 miles), depending on traffic'. Round sensibly; never present an estimate as an exact, guaranteed figure.",
            "- This exception is ONLY for general travel time/distance/directions. It does NOT permit inventing property-experience facts (train/road noise, lake or beach swimability, 'quiet neighborhood', festival/game schedules, private transport, gate/parking specifics, or exact street address if not provided) — those need External KB / proven replies / TEAM messages, otherwise defer.",
            "",
            "STAY-STAGE PROACTIVITY (anticipate like our team does):",
            "- The context includes a 'Stay stage' line. Use it to add the ONE next thing the guest will need, briefly, after answering their actual question:",
            "  * Checks in today/tomorrow → confirm arrival details you have (check-in time, access process — never invent a code).",
            "  * Checks out today/tomorrow → add a short checkout reminder using the property's documented checkout steps IF they are in context; otherwise just note the checkout time if known.",
            "  * Post-stay → warm closure; address anything left open. Do not send arrival info post-stay.",
            "- Keep the proactive part to 1–2 sentences; never let it crowd out the direct answer.",
            "",
            "INTERNAL OPERATIONS AWARENESS:",
            "- If an 'Internal operations in progress' section is present, it only includes work tied to THIS guest/reservation — treat it as in-progress for them.",
            "- Align with it: if the guest's message relates to an open item, say the team is already on it and reference the state naturally. Do NOT offer to 'look into' something already in motion, and do NOT restart a process the team has underway.",
            "- Never reveal internal wording, staff names, vendor names, or internal prices from that section. Never invent on-site presence (cleaner, vendor) unless the ops block or a TEAM message explicitly says someone is there.",
            "",
            "TEAM FEEDBACK:",
            "- If a 'Team feedback on the AI's past replies' section is present, it is direct instruction from our staff about how your replies should improve (tone, length, wording, things you got wrong).",
            "- Apply it to THIS reply. Feedback tagged [this property] outranks [general] when they conflict. Preferred-wording examples show the style to emulate — do not copy them verbatim into unrelated answers, and never mention feedback to the guest.",
            "",
            "PAID SERVICES / UPSELLS (from Upsells database):",
            "- If an 'Available paid services' section is present, those are the ONLY add-on services for this property with SDTO + calculated guest fees (including Length-of-Stay rates for this stay).",
            "- SDTO: NOT ALLOWED → tell guest it is not available (no fee). NEEDS CONFIRMATION → acknowledge + escalate_required=true, do NOT quote a firm price. ALLOWED → quote the calculated fee, subject to availability; escalation_required=false for a simple fee quote.",
            "- Do not invent fees, discount fees, or approve a specific early/late clock time unless a TEAM message already confirmed it.",
            "- If the guest asks for a service NOT in that section, do NOT invent one — offer what IS documented, or say the team will confirm options (learning_question).",
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
     * Guest is asking to extend / add nights. Nightly rates from Hostify calendar
     * have been wrong_info — these must go to a human for pricing (urgent pin).
     */
    private detectExtensionAsk(text: string): boolean {
        return /\b(extend(?:ing|ed)?|extension|extra\s+night|another\s+night|one\s+more\s+night|1\s+more\s+night|stay\s+(?:longer|another)|add\s+(?:a\s+|another\s+)?night|additional\s+night|stay\s+an\s+extra)\b/i.test(
            String(text || "")
        );
    }

    /**
     * Fetch the live Hostify calendar for the conversation's listing and render a
     * compact availability summary the model can quote. Window: from today (or
     * check-in, whichever is earlier-relevant) through ~45 days out; when we know
     * the checkout date we specifically flag the nights right after it (the exact
     * dates an extension request is about).
     */
    private async buildAvailabilityBlock(
        conversation: InboxConversationEntity,
        opts: { hidePrices?: boolean } = {}
    ): Promise<string | null> {
        if (!conversation.listingId || !this.hostifyApiKey) return null;

        const hidePrices = Boolean(opts.hidePrices);
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
        // Track min/max nightly price across the range — quoting only night-1
        // caused wrong_info misses (AI said ~$40 while later nights were ~$50).
        const ranges: Array<{ from: string; to: string; minPrice: number; maxPrice: number }> = [];
        for (const d of days) {
            if (!isAvailable(d)) continue;
            const price = Number(d.price) || 0;
            const last = ranges[ranges.length - 1];
            const prevDate = last ? new Date(last.to) : null;
            const thisDate = new Date(d.date);
            const contiguous =
                last && prevDate && (thisDate.getTime() - prevDate.getTime()) === 86400000;
            if (contiguous && last) {
                last.to = d.date;
                if (price > 0) {
                    if (!last.minPrice || price < last.minPrice) last.minPrice = price;
                    if (price > last.maxPrice) last.maxPrice = price;
                }
            } else {
                ranges.push({ from: d.date, to: d.date, minPrice: price, maxPrice: price });
            }
        }

        const fmtRangePrice = (r: { minPrice: number; maxPrice: number }): string => {
            if (hidePrices) return "";
            if (!r.minPrice && !r.maxPrice) return "";
            if (!r.maxPrice || r.minPrice === r.maxPrice) return ` (~${currency} ${r.minPrice}/night)`;
            return ` (~${currency} ${r.minPrice}–${r.maxPrice}/night, varies by date)`;
        };

        const out: string[] = [];
        if (hidePrices) {
            out.push(
                "EXTENSION PRICING SECURITY (hard rule): Hostify calendar nightly rates are NOT guest-quotable for extensions — they have been wrong. " +
                    "You may say whether nights look open/closed. You must NEVER quote a dollar amount, nightly rate, or total. " +
                    "Acknowledge the extension ask, say a teammate will confirm availability and the exact price, set escalation_required=true."
            );
        }
        if (ranges.length === 0) {
            out.push("No open nights in the next 45 days — the calendar is fully booked/blocked.");
        } else {
            out.push(hidePrices ? "Open date ranges (next 45 days) — dates only, no prices:" : "Open date ranges (next 45 days):");
            for (const r of ranges.slice(0, 12)) {
                const label = r.from === r.to ? r.from : `${r.from} → ${r.to}`;
                out.push(`- ${label}${fmtRangePrice(r)}`);
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
                            ? hidePrices
                                ? `Extension check: the night of ${nextNightKey} (right after current checkout) IS available — do NOT quote a rate; team prices it.`
                                : `Extension check: the night of ${nextNightKey} (right after current checkout) IS available${day.price ? ` at ~${currency} ${Number(day.price)}/night` : ""}.`
                            : `Extension check: the night of ${nextNightKey} (right after current checkout) is NOT available.`
                    );
                }
            }
        }

        return out.join("\n");
    }

    /**
     * Heuristic: is the guest telling us they TRIED to book and failed?
     * ("I tried to book... told it's not available though the dates don't
     * appear booked"). These are the highest-intent messages in the inbox —
     * they must never get a bare "try refreshing" reply.
     */
    private detectBookingTrouble(text: string): boolean {
        const t = (text || "").toLowerCase();
        if (!t) return false;
        const patterns = [
            "tried to book", "trying to book", "can't book", "cant book", "cannot book",
            "unable to book", "won't let me", "wont let me", "not letting me",
            "says it's not available", "says its not available", "says not available",
            "told it's not available", "told its not available", "shows unavailable",
            "not available though", "not available but", "dates don't appear", "dates dont appear",
            "different device", "error when i", "booking error", "won't go through", "wont go through",
        ];
        return patterns.some((p) => t.includes(p));
    }

    /** Base name of a listing minus channel/owner suffixes ("Columbia (#02) - Airbnb" → "columbia (#02)"). */
    private listingBaseName(l: Listing): string {
        const raw = (l.internalListingName || l.name || "").toString();
        return raw.split(" - ")[0].trim().toLowerCase();
    }

    /** threadId → last alert time, so repeated suggestion runs don't re-page the team. */
    private static bookingTroubleAlerts = new Map<number, number>();

    /** Fire-and-forget Slack alert: a guest is trying to book and failing. */
    private alertBookingTrouble(
        conversation: InboxConversationEntity,
        guestText: string,
        calendarOpen: boolean | null,
    ): void {
        const threadId = Number(conversation.threadId);
        const last = InboxAIService.bookingTroubleAlerts.get(threadId) || 0;
        if (Date.now() - last < 6 * 60 * 60 * 1000) return;
        InboxAIService.bookingTroubleAlerts.set(threadId, Date.now());

        const channel = process.env.BOOKING_TROUBLE_SLACK_CHANNEL || "#guest-relations";
        const calNote =
            calendarOpen === true
                ? "Calendar shows these dates OPEN — likely a channel-sync or min-stay settings bug."
                : calendarOpen === false
                ? "Calendar shows these dates NOT fully open."
                : "Calendar state could not be verified.";
        const text =
            `:rotating_light: Guest can't complete a booking (live sale at risk)\n` +
            `Listing: ${conversation.listingName || conversation.listingId} | Guest: ${conversation.guestName || "unknown"} | ` +
            `Dates: ${conversation.checkin || "?"} → ${conversation.checkout || "?"}${conversation.price ? ` | ~$${conversation.price}` : ""}\n` +
            `${calNote}\n` +
            `Guest said: "${(guestText || "").replace(/\s+/g, " ").trim().slice(0, 220)}"\n` +
            `Check the multicalendar/min-stay settings and send the guest a pre-approval or booking link. Thread ${threadId}.`;
        void sendSlackMessage({ channel, text }).catch((err: unknown) =>
            logger.warn(`[InboxAI] booking-trouble Slack alert failed: ${err instanceof Error ? err.message : err}`),
        );
    }

    /**
     * Same-city alternatives for an inquiry's exact dates. Runs when the thread
     * carries concrete stay dates, the guest hasn't booked yet, and either
     * (a) the guest reports they can't complete the booking, or (b) the live
     * calendar says the requested dates are NOT fully open on this listing.
     * Injects a concrete, calendar-verified list of other listings in the same
     * city the guest could book instead — so a dead inquiry converts to a
     * sibling property instead of expiring. (Born from a real $3.4K loss:
     * guest "James" couldn't book Columbia (#02), was told to refresh his
     * browser, and walked.)
     */
    private async buildAlternativesBlock(
        conversation: InboxConversationEntity,
        guestText: string,
    ): Promise<string | null> {
        if (!this.hostifyApiKey || !conversation.listingId) return null;

        // Pre-booking threads only — never pitch other homes to a booked guest.
        const status = (conversation.reservationStatus || "").toLowerCase();
        const preBooking = ["", "inquiry", "preapproved", "offer", "pending", "expired", "not_possible", "timedout", "denied", "incomplete"];
        if (!preBooking.includes(status)) return null;

        const toKey = (v: unknown): string | null => {
            const s = String(v ?? "");
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
            const d = new Date(v as any);
            return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
        };
        const ciKey = toKey(conversation.checkin);
        const coKey = toKey(conversation.checkout);
        if (!ciKey || !coKey || coKey <= ciKey) return null;
        if (ciKey < toKey(new Date())!) return null; // stay already started/past
        const nights = Math.round((new Date(coKey).getTime() - new Date(ciKey).getTime()) / 86400000);
        const lastNight = toKey(new Date(new Date(coKey).getTime() - 86400000))!;

        // Is this exact range fully open on the CURRENT listing?
        const rangeOpen = async (listingId: number): Promise<boolean | null> => {
            try {
                const days: any[] = await this.hostify.getCalendar(this.hostifyApiKey, listingId, ciKey, lastNight);
                const wanted = (days || []).filter((d) => {
                    const k = String(d.date).slice(0, 10);
                    return k >= ciKey && k <= lastNight;
                });
                if (!wanted.length) return null;
                return wanted.every((d) => String(d?.status || "").toLowerCase() === "available");
            } catch {
                return null;
            }
        };
        const currentOpen = await rangeOpen(Number(conversation.listingId));
        const trouble = this.detectBookingTrouble(guestText);
        // Quiet path: dates open, guest reports no problem — nothing to add.
        if (currentOpen !== false && !trouble) return null;

        // A guest saying "I can't book" while the calendar shows OPEN is a
        // channel-sync/min-stay bug losing a live sale — page the team so the
        // "we've notified the team" line in the reply is actually true.
        if (trouble) this.alertBookingTrouble(conversation, guestText, currentOpen);

        const current = await this.listingRepo.findOne({
            where: { id: Number(conversation.listingId) } as any,
            withDeleted: true,
        });
        const city = (current?.city || "").trim();
        if (!city) return null;
        const currentBase = current ? this.listingBaseName(current) : "";

        // Candidates: same city, big enough for the party, not this unit (or a
        // channel-twin of it), deduped by base name so parent/child/channel
        // copies of one home count once.
        const all = await this.listingRepo.find({ take: 3000 });
        const wantedGuests = Number(conversation.guests) || null;
        const seenBases = new Set<string>([currentBase]);
        const candidates: Listing[] = [];
        for (const l of all) {
            if (Number(l.id) === Number(conversation.listingId)) continue;
            if ((l.city || "").trim().toLowerCase() !== city.toLowerCase()) continue;
            const cap = Number(l.personCapacity || l.guests || 0);
            if (wantedGuests && cap && cap < wantedGuests) continue;
            const base = this.listingBaseName(l);
            if (seenBases.has(base)) continue;
            seenBases.add(base);
            candidates.push(l);
            if (candidates.length >= 12) break;
        }
        if (candidates.length === 0) return null;

        const checks = await Promise.all(
            candidates.map(async (l) => {
                if (l.minNights && nights < Number(l.minNights)) return { l, ok: false, avg: 0 };
                try {
                    const days: any[] = await this.hostify.getCalendar(this.hostifyApiKey, Number(l.id), ciKey, lastNight);
                    const wanted = (days || []).filter((d) => {
                        const k = String(d.date).slice(0, 10);
                        return k >= ciKey && k <= lastNight;
                    });
                    if (!wanted.length) return { l, ok: false, avg: 0 };
                    const open = wanted.every((d) => String(d?.status || "").toLowerCase() === "available");
                    const prices = wanted.map((d) => Number(d.price) || 0).filter((p) => p > 0);
                    const avg = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
                    return { l, ok: open, avg };
                } catch {
                    return { l, ok: false, avg: 0 };
                }
            })
        );
        const bookable = checks.filter((c) => c.ok);

        const reason = trouble
            ? "The guest reports they are UNABLE to complete the booking on the platform"
            : "The requested dates are NOT fully open on this listing's calendar";
        const out: string[] = [
            `## Alternative listings for the guest's dates (${ciKey} → ${coKey}, ${nights} night${nights === 1 ? "" : "s"}${wantedGuests ? `, ${wantedGuests} guests` : ""}) — live calendar results, same city (${city})`,
            `WHY THIS IS HERE: ${reason}.`,
        ];
        if (trouble) {
            out.push(
                `IMPORTANT: The guest is actively trying to give us money and hitting a platform/calendar error. ` +
                `Do NOT tell them to refresh or try another device and leave it there. Tell them the team has been notified to fix the calendar, and offer the alternatives below so they can book NOW.`
            );
        }
        if (bookable.length) {
            out.push(`BOOKABLE for those exact dates:`);
            for (const c of bookable.slice(0, 5)) {
                const bits = [
                    c.l.address || c.l.city || "",
                    c.l.personCapacity || c.l.guests ? `sleeps ${c.l.personCapacity || c.l.guests}` : "",
                    c.l.bedroomsNumber != null ? `${c.l.bedroomsNumber} BR` : "",
                    c.avg ? `~$${c.avg}/night (≈$${c.avg * nights} for ${nights} nights, before fees)` : "",
                ].filter(Boolean);
                out.push(`- ${c.l.name || c.l.internalListingName}: ${bits.join("; ")}`);
            }
            out.push(
                `INSTRUCTIONS: Offer these alternatives concretely (name, sleeps, approximate rate) as ready-to-book options for the guest's exact dates. ` +
                `These are live, verified results — do NOT say "let me check" or invent other listings. Suggest they search our host profile for the listing name, and tell them we can send a booking link.`
            );
        } else {
            out.push(
                `RESULT: no other ${city} listings are open for those exact dates.`,
                `INSTRUCTIONS: Be honest that nothing else is open in ${city} for those dates; offer nearby dates on this home if any are open (see availability block), and invite flexible dates. Do NOT invent alternatives.`
            );
        }
        return out.join("\n");
    }

    /**
     * Cross-portfolio listing search. When a guest is SHOPPING for a place
     * ("looking for an apartment in Wicker Park, July 16-19, 4 people"), extract
     * the criteria, match our listings by area/capacity, check each candidate's
     * live calendar for those exact nights, and hand the model a concrete list
     * of bookable options — so the reply shares real results instead of
     * promising to "check and get back to you".
     */
    private async buildListingSearchBlock(guestText: string): Promise<string | null> {
        if (!guestText || !this.hostifyApiKey) return null;
        const t = guestText.toLowerCase();
        // Cheap gate before spending an LLM call on extraction.
        const wantsPlace = /(looking for|searching for|do you have|got any|need|find me|help me find|interested in)[\s\S]{0,80}(apartment|house|home|condo|place|rental|listing|propert|room|somewhere)|apartment for rent|place to stay/.test(t);
        const hasDates = /(\d{1,2}[\/\-.]\d{1,2})|\b(jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\bmay\b|check.?in|check.?out|night/.test(t);
        if (!wantsPlace || !hasDates) return null;

        // 1) Structured criteria extraction (dates, party size, city, areas).
        let crit: any = null;
        try {
            const client = this.getClient();
            const completion = await client.chat.completions.create({
                model: process.env.AI_EXTRACT_MODEL || "gpt-4.1-mini",
                temperature: 0,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content:
                            `Decide whether the guest message is a search for a place to stay (NOT a question about an existing booking). Today is ${new Date().toISOString().slice(0, 10)}. ` +
                            `Reply with JSON exactly: {"is_search": boolean, "checkin": "YYYY-MM-DD" or null, "checkout": "YYYY-MM-DD" or null, "guests": number or null, "city": string or null, "areas": string[]} ` +
                            `where areas are neighborhoods/districts/suburbs mentioned. Resolve relative dates against today; if the year is ambiguous choose the next future occurrence.`,
                    },
                    { role: "user", content: guestText.slice(0, 1200) },
                ],
            });
            crit = JSON.parse(completion.choices[0]?.message?.content?.trim() || "{}");
        } catch {
            return null;
        }
        if (!crit?.is_search || !crit.checkin || !crit.checkout) return null;
        const checkin = new Date(`${crit.checkin}T00:00:00Z`);
        const checkout = new Date(`${crit.checkout}T00:00:00Z`);
        if (isNaN(checkin.getTime()) || isNaN(checkout.getTime()) || checkout <= checkin) return null;
        const nights = Math.round((checkout.getTime() - checkin.getTime()) / 86400000);
        const wantedGuests = Number(crit.guests) || null;
        const tokens = [...(Array.isArray(crit.areas) ? crit.areas : []), crit.city]
            .filter(Boolean)
            .map((s: any) => String(s).toLowerCase().trim())
            .filter((s: string) => s.length >= 3);

        // 2) Candidate listings by area + capacity.
        const all = await this.listingRepo.find({ take: 3000 });
        const hayOf = (l: Listing) =>
            `${l.name || ""} ${l.internalListingName || ""} ${l.externalListingName || ""} ${l.address || ""} ${l.city || ""} ${l.state || ""}`.toLowerCase();
        const capOk = (l: Listing) => {
            const cap = Number(l.personCapacity || l.guests || 0);
            return !wantedGuests || !cap || cap >= wantedGuests;
        };
        const matched = tokens.length
            ? all.filter((l) => capOk(l) && tokens.some((tok) => hayOf(l).includes(tok)))
            : [];

        const header =
            `## LIVE listing search results — the search has ALREADY been run for the guest's request ` +
            `(${tokens.length ? tokens.join(", ") : "any area"}; ${crit.checkin} → ${crit.checkout}, ${nights} night${nights === 1 ? "" : "s"}${wantedGuests ? `, ${wantedGuests} guests` : ""})`;

        if (!matched.length) {
            // Honest miss: tell the model what we actually cover so it can offer
            // real alternatives instead of inventing or stalling.
            const cities = [...new Set(all.map((l) => (l.city || "").trim()).filter(Boolean))].slice(0, 20);
            return [
                header,
                `RESULT: our portfolio has NO listings matching the requested area(s).`,
                cities.length ? `Cities we DO have properties in: ${cities.join(", ")}.` : "",
                `INSTRUCTIONS: Tell the guest plainly that we don't have properties in that area. If a nearby city from the list above could work, offer it. Do NOT say you will check or get back to them — this IS the result. Never invent listings.`,
            ].filter(Boolean).join("\n");
        }

        // 3) Live calendar check for the exact nights, in parallel (bounded).
        const toKey = (d: Date) => d.toISOString().slice(0, 10);
        const lastNight = toKey(new Date(checkout.getTime() - 86400000));
        const candidates = matched.slice(0, 12);
        const checks = await Promise.all(
            candidates.map(async (l) => {
                if (l.minNights && nights < Number(l.minNights)) {
                    return { l, ok: false, reason: `min stay ${l.minNights} nights`, avg: 0 };
                }
                try {
                    const days: any[] = await this.hostify.getCalendar(this.hostifyApiKey, Number(l.id), crit.checkin, lastNight);
                    const wanted = (days || []).filter((d) => {
                        const k = String(d.date).slice(0, 10);
                        return k >= crit.checkin && k <= lastNight;
                    });
                    if (!wanted.length) return { l, ok: false, reason: "no calendar data", avg: 0 };
                    const open = wanted.every((d) => String(d?.status || "").toLowerCase() === "available");
                    const prices = wanted.map((d) => Number(d.price) || 0).filter((p) => p > 0);
                    const avg = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
                    return { l, ok: open, reason: open ? "" : "booked/blocked", avg };
                } catch {
                    return { l, ok: false, reason: "calendar unavailable", avg: 0 };
                }
            })
        );

        const out: string[] = [header];
        const bookable = checks.filter((c) => c.ok);
        if (bookable.length) {
            out.push(`BOOKABLE for those exact dates:`);
            for (const c of bookable.slice(0, 6)) {
                const bits = [
                    c.l.city ? `${c.l.address || c.l.city}` : c.l.address || "",
                    c.l.personCapacity || c.l.guests ? `sleeps ${c.l.personCapacity || c.l.guests}` : "",
                    c.l.bedroomsNumber != null ? `${c.l.bedroomsNumber} BR` : "",
                    c.avg ? `~$${c.avg}/night (≈$${c.avg * nights} for ${nights} nights, before fees)` : "",
                ].filter(Boolean);
                out.push(`- ${c.l.name || c.l.internalListingName}: ${bits.join("; ")}`);
            }
        } else {
            out.push(`RESULT: we have ${candidates.length} propert${candidates.length === 1 ? "y" : "ies"} in that area, but NONE are open for those exact dates.`);
        }
        const misses = checks.filter((c) => !c.ok);
        if (misses.length && bookable.length) {
            out.push(`Not available those dates: ${misses.map((c) => c.l.name || c.l.internalListingName).slice(0, 6).join(", ")}.`);
        }
        out.push(
            `INSTRUCTIONS: These are live results — share the best matching option(s) concretely (name/area, sleeps, approximate nightly rate). ` +
            `Do NOT say "I'll check", "let me look into it" or "we'll get back to you" — the search is already done. ` +
            `If nothing is bookable, say so honestly and suggest flexible dates or another area from the list. Never invent listings or prices beyond this block.`
        );
        return out.join("\n");
    }

    /** Build the user-message context block from conversation + reservation + listing. */
    /** Short-lived cache so repeated previews of the same thread don't refetch Hostify. */
    private static reservationCache = new Map<
        number,
        {
            at: number;
            block: string | null;
            paidPart: string | null;
            due: number | null;
            paidSum: number | null;
        }
    >();

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
    private extractChargeAutomationLink(messages: InboxMessageEntity[]): string | null {
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.direction === "incoming") continue;
            const body = String(m.body || "");
            const match = body.match(/https?:\/\/(?:app\.)?chargeautomation\.com\/securelink\/[A-Za-z0-9_-]+/i);
            if (match) return match[0];
        }
        return null;
    }

    private async buildReservationBlock(
        conversation: InboxConversationEntity,
        messages: InboxMessageEntity[] = []
    ): Promise<string | null> {
        const reservationId = conversation.reservationId ? Number(conversation.reservationId) : null;
        if (!reservationId || !this.hostifyApiKey) return null;

        // Cache Hostify payload only; payment_state (thread-sensitive) and agreement
        // links are appended after so we don't serve stale diagnosis/links.
        const cached = InboxAIService.reservationCache.get(reservationId);
        let core: string | null = null;
        let paidPart: string | null = null;
        let dueAmt: number | null = null;
        let paidSum: number | null = null;
        if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
            core = cached.block;
            paidPart = cached.paidPart;
            dueAmt = cached.due;
            paidSum = cached.paidSum;
        } else {
            try {
                const data: any = await this.hostify.getReservationInfo(this.hostifyApiKey, reservationId);
                const r = data?.reservation || {};
                const l = data?.listing || {};
                if (r && (r.checkIn || r.confirmation_code || r.status)) {
                const shareable: string[] = [];
                if (r.confirmation_code) shareable.push(`- Confirmation code: ${r.confirmation_code}`);
                // Dates only here — check-in/out CLOCK times come from the contested
                // authority ladder (staff/ops beat Hostify listing times).
                if (r.checkIn) shareable.push(`- Check-in date: ${r.checkIn}`);
                if (r.checkOut) shareable.push(`- Check-out date: ${r.checkOut}`);
                const stay: string[] = [];
                if (r.nights != null) stay.push(`${r.nights} night(s)`);
                if (r.guests != null) stay.push(`${r.guests} guest(s)`);
                if (stay.length) shareable.push(`- Length of stay: ${stay.join(", ")}`);
                const party: string[] = [];
                if (r.adults != null && Number(r.adults) > 0) party.push(`${r.adults} adult(s)`);
                if (r.children != null && Number(r.children) > 0) party.push(`${r.children} child(ren)`);
                if (r.infants != null && Number(r.infants) > 0) party.push(`${r.infants} infant(s)`);
                if (r.pets != null) party.push(Number(r.pets) > 0 ? `${r.pets} pet(s)` : "no pets registered");
                if (party.length) shareable.push(`- Party details: ${party.join(", ")}`);
                if (r.status_description || r.status)
                    shareable.push(`- Reservation status: ${r.status_description || r.status}`);
                const cancelPolicyName =
                    r.cancellation_policy || l.cancellation_policy || l.cancel_policy || null;
                if (cancelPolicyName) shareable.push(`- Cancellation policy: ${cancelPolicyName}`);
                // Hostify pre-check-in is NOT the rental agreement. Label it
                // explicitly so the model stops substituting it for CA links.
                if (r.hostify_checkin_form_link && String(r.hostify_checkin_form_link).startsWith("http")) {
                    shareable.push(
                        Number(r.pre_check_in_completed) === 1 || Number(r.hostify_checkin_form_completed) === 1
                            ? "- Hostify pre-check-in form: already completed by the guest."
                            : `- Hostify pre-check-in form link (arrival questionnaire ONLY — NOT the rental agreement / deposit authorization; do NOT send this when the guest asks for the rental agreement): ${r.hostify_checkin_form_link}`
                    );
                }

                const staff: string[] = [];
                // Ops-truth: platform "accepted/confirmed" with unpaid/partial balance
                // must not be sold to the guest as fully confirmed.
                paidPart = String(r.paid_part || "").toLowerCase() || null;
                dueAmt = r.due != null && Number.isFinite(Number(r.due)) ? Number(r.due) : null;
                paidSum = r.paid_sum != null && Number.isFinite(Number(r.paid_sum)) ? Number(r.paid_sum) : null;
                const statusBlob = `${r.status_description || ""} ${r.status || ""}`.toLowerCase();
                const looksBooked = /\b(accepted|confirmed|modified|checked.?in)\b/.test(statusBlob);
                if (looksBooked && (paidPart === "none" || (dueAmt != null && dueAmt > 0))) {
                    staff.push(
                        "- PAYMENT RISK (ops truth): booking status looks accepted/confirmed but payment is incomplete " +
                            `(paid_part=${paidPart || "unknown"}${dueAmt != null && dueAmt > 0 ? `, due=${dueAmt}` : ""}). ` +
                            "Do NOT tell the guest they are fully confirmed/paid or 'all set' on payment — escalate payment questions to the team."
                    );
                }
                const nonRefundable = Number(l.non_refundable_factor) >= 1;
                    staff.push(
                        nonRefundable
                            ? "- Rate type: NON-REFUNDABLE rate plan (the guest booked a non-refundable rate)."
                            : "- Rate type: standard/refundable rate plan (not a non-refundable booking)."
                    );
                    if (r.cancellation_fee != null && Number(r.cancellation_fee) > 0)
                        staff.push(`- Cancellation fee currently on file: ${r.cancellation_fee}.`);
                    if (r.cancelled_at)
                        staff.push(
                            `- This reservation was CANCELLED on ${r.cancelled_at}${
                                r.cancel_reason ? ` (reason: ${r.cancel_reason})` : ""
                            }.`
                        );
                    if (r.sum_refunds != null && Number(r.sum_refunds) > 0)
                        staff.push(`- Refunds issued so far: ${r.sum_refunds}.`);
                    const paidLabel: Record<string, string> = {
                        none: "not yet paid",
                        part: "partially paid",
                        full: "paid in full",
                        all: "paid in full",
                    };
                    const pl = paidLabel[String(r.paid_part || "").toLowerCase()];
                    if (pl)
                        staff.push(
                            `- Payment status: ${pl}${
                                r.paid_sum != null && Number(r.paid_sum) > 0 ? ` (${r.paid_sum} collected so far)` : ""
                            }.`
                        );
                    if (r.due != null && Number(r.due) > 0)
                        staff.push(
                            `- Balance still due: ${r.due}. If the guest needs to pay it, the team sends a secure Hostify payment link — you cannot generate one; say the team will send it.`
                        );
                    // Live deposit facts beat portfolio "no deposit on Airbnb" answers.
                    const sec = r.security_price != null ? Number(r.security_price) : null;
                    const depPaid = r.deposit_paid != null ? Number(r.deposit_paid) : null;
                    const depRefunded = r.deposit_refunded != null ? Number(r.deposit_refunded) : null;
                    if (sec != null && Number.isFinite(sec)) {
                        if (sec > 0) {
                            staff.push(
                                `- Security deposit / hold on file for THIS reservation: ${sec}` +
                                    (depPaid != null && Number.isFinite(depPaid) ? ` (deposit_paid recorded: ${depPaid})` : "") +
                                    ". Do NOT claim no deposit was collected."
                            );
                        } else {
                            staff.push(
                                "- Security deposit / hold on file for THIS reservation: 0. Still do not invent channel-wide deposit policy; if the guest disputes a charge, escalate for the team to check."
                            );
                        }
                    } else {
                        staff.push(
                            "- Security deposit amount is not present on the live reservation payload. Do NOT assert there is or isn't a deposit from portfolio/learned answers — say the team will check."
                        );
                    }
                    if (depRefunded != null && Number.isFinite(depRefunded) && depRefunded > 0) {
                        staff.push(`- Deposit refunded so far (on file): ${depRefunded}.`);
                    }

                    const out: string[] = [];
                    if (shareable.length) {
                        out.push(
                            "## Reservation details (live booking — accurate; you MAY share dates, status and confirmation code with the guest)"
                        );
                        out.push(...shareable);
                    }
                    if (staff.length) {
                        out.push("");
                        out.push(
                            "## Reservation billing & cancellation (STAFF-ONLY facts — authoritative for money/deposit on THIS booking; do NOT override with portfolio learned answers)"
                        );
                        out.push(...staff);
                    }
                    core = out.length ? out.join("\n") : null;
                }
            } catch (e: any) {
                logger.warn(`[InboxAI] reservation enrich failed for ${reservationId}: ${e.message}`);
                core = null;
            }
            InboxAIService.reservationCache.set(reservationId, {
                at: Date.now(),
                block: core,
                paidPart,
                due: dueAmt,
                paidSum,
            });
        }

        const threadText = messages.map((m) => String(m.body || "")).join("\n");
        const paymentState: PaymentState = derivePaymentState({
            paidPart,
            due: dueAmt,
            paidSum,
            threadText,
        });
        const paymentPolicy: Record<PaymentState, string> = {
            paid: "Guest is paid in full — do not ask for payment.",
            due: "Balance outstanding — do NOT invent 3DS/authentication; say the team will send the correct payment link / next step. escalation_required=true for payment questions.",
            failed:
                "Charge FAILED / declined — tell the guest the payment did not go through and they need a valid card or bank action. NEVER say authenticate, verified, or that the reservation is paid/confirmed. escalation_required=true.",
            auth_required:
                "Guest may need to complete card authentication/verification — you may point them at an existing ChargeAutomation securelink if present. Do not claim payment succeeded.",
            unknown:
                "Payment status unclear — do NOT diagnose authenticate vs failed. Say the team will check payment status. escalation_required=true.",
        };
        const paymentBlock = [
            "## Payment diagnosis (structural — follow exactly)",
            `- payment_state: ${paymentState}`,
            `- payment_policy: ${paymentPolicy[paymentState]}`,
            "- A ChargeAutomation securelink in this thread does NOT by itself mean authentication is required — only follow payment_state.",
        ].join("\n");

        const agreementLines: string[] = [];
        const caLink = this.extractChargeAutomationLink(messages);
        if (caLink) {
            agreementLines.push(
                `- ChargeAutomation secure link already sent in this thread (you MAY resend if the guest needs the rental agreement / deposit authorization): ${caLink}`
            );
        }
        const frontendBase = (
            process.env.FRONTEND_URL ||
            process.env.DASHBOARD_URL ||
            process.env.APP_FRONTEND_URL ||
            ""
        ).replace(/\/$/, "");
        if (frontendBase) {
            agreementLines.push(
                `- SecureStay rental agreement page (use only if the guest asks for our signing link and no ChargeAutomation link is available): ${frontendBase}/rental-agreement/${reservationId}`
            );
        }
        const parts = [core, paymentBlock].filter(Boolean);
        if (agreementLines.length) {
            parts.push(
                [
                    "## Rental agreement / deposit authorization links",
                    "- Prefer ChargeAutomation securelink when present. Never substitute the Hostify pre-check-in form for these.",
                    ...agreementLines,
                ].join("\n")
            );
        }
        return parts.length ? parts.join("\n\n") : null;
    }

    /**
     * Door code(s) actually programmed on the smart lock for THIS reservation
     * (access_codes rows with status='set'). Only for booked guests, never
     * inquiries. Coverage is partial (smart locks aren't on every property),
     * but when a row exists it is the exact live code.
     */
    private async buildAccessBlock(
        conversation: InboxConversationEntity,
        guestText: string = ""
    ): Promise<{ text: string | null; facts: AssertableFact[]; codesAllowed: boolean }> {
        const empty = { text: null, facts: [] as AssertableFact[], codesAllowed: false };
        const resvId = conversation.reservationId ? Number(conversation.reservationId) : null;
        if (!resvId || InboxAIService.isInquiryStatus(conversation.reservationStatus)) return empty;

        const stage = this.stayStageLine(conversation.checkin, conversation.checkout);
        const codesAllowed = stayAllowsAccessCodes(stage) || guestReportsLockout(guestText);
        const policyFact: AssertableFact = {
            id: "access_codes",
            assertWhen: "checkin_day_or_midstay",
            assertText: "Door/lock/gate codes for THIS reservation may be shared when the guest asks.",
            policyText:
                "Access codes go out the morning of check-in / at arrival. Do NOT share, invent, or hint at any code before then.",
            kind: "access_code",
        };

        // Pre-arrival: never put live codes in the prompt (model will leak them).
        if (!codesAllowed) {
            return {
                codesAllowed: false,
                facts: [policyFact],
                text: [
                    "## Door access policy (pre-arrival — codes NOT shareable yet)",
                    "- assert_when=checkin_day_or_midstay (not met).",
                    "- Access codes go out the morning of check-in / at arrival.",
                    "- Do NOT share, invent, or hint at any door/lock/gate code before then.",
                    "- If the guest asks early, say the code will be sent on check-in day.",
                ].join("\n"),
            };
        }

        const rows: any[] = await appDatabase
            .query(
                `SELECT ac.code, ac.code_name, d.device_name, d.location_name
                 FROM access_codes ac
                 LEFT JOIN smart_lock_devices d ON d.id = ac.device_id
                 WHERE ac.reservation_id = ? AND ac.status = 'set'
                 ORDER BY ac.set_at DESC LIMIT 3`,
                [resvId]
            )
            .catch(() => []);
        if (!rows.length) {
            return {
                codesAllowed: true,
                facts: [
                    {
                        ...policyFact,
                        assertText:
                            "No programmed code is on file yet — say the team will send access details; do not invent a code.",
                    },
                ],
                text: [
                    "## Door access (check-in/mid-stay)",
                    "- No programmed code is on file yet. Do NOT invent one — say the team will send access details shortly.",
                ].join("\n"),
            };
        }
        const out = ["## Door access for THIS stay (live code — shareable because check-in day / mid-stay / lockout)"];
        const codeLines: string[] = [];
        for (const r of rows) {
            const where = [r.device_name, r.location_name].filter(Boolean).join(", ");
            const line = `Code: ${r.code}${where ? ` (${where})` : ""}${r.code_name ? ` — ${r.code_name}` : ""}`;
            out.push(`- ${line}`);
            codeLines.push(line);
        }
        out.push("You MAY give this code to the booked guest when they ask for access.");
        return {
            codesAllowed: true,
            facts: [
                {
                    ...policyFact,
                    assertText: codeLines.join("; "),
                },
            ],
            text: out.join("\n"),
        };
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
    ): Promise<{ text: string | null; hasExplicitConfirmation: boolean }> {
        const resvId = conversation.reservationId ? Number(conversation.reservationId) : null;
        const listingIds = (groupIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
        const guestName = (conversation.guestName || "").trim();
        if (!resvId && !listingIds.length) return { text: null, hasExplicitConfirmation: false };

        const fmtDate = (d: any): string => {
            const m = String(d || "").match(/^\d{4}-\d{2}-\d{2}/);
            return m ? m[0] : "";
        };
        const out: string[] = [];
        let hasExplicitConfirmation = false;

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
                        const raw = String(r.item).replace(/\s+/g, " ").trim();
                        const confirmed = opsTextExplicitlyConfirmed(raw);
                        if (confirmed) hasExplicitConfirmation = true;
                        const meta = [r.category, r.status, fmtDate(r.createdAt)].filter(Boolean).join(", ");
                        return `- ${raw.slice(0, 240)}${meta ? ` (${meta})` : ""}${
                            confirmed ? " [ops_confirm_ok]" : " [open_work_only — do not claim done/ETA]"
                        }`;
                    });
                if (items.length) {
                    out.push("Open internal tasks for this guest/reservation:");
                    out.push(...items);
                }
            }
        } catch {
            /* non-fatal */
        }

        // Open property issues tied to THIS reservation only.
        try {
            if (resvId) {
                const rows: any[] = await appDatabase.query(
                    `SELECT ai_short_title, issue_description, status, next_steps, created_at FROM issues
                     WHERE deleted_at IS NULL
                       AND status NOT IN ('Completed')
                       AND created_at >= (NOW() - INTERVAL 30 DAY)
                       AND reservation_id = ?
                     ORDER BY created_at DESC LIMIT 4`,
                    [String(resvId)]
                );
                const items = rows
                    .map((r) => {
                        const title = String(r.ai_short_title || r.issue_description || "").replace(/\s+/g, " ").trim();
                        if (!title) return null;
                        const next = String(r.next_steps || "").replace(/\s+/g, " ").trim();
                        const blob = `${title} ${next}`;
                        const confirmed = opsTextExplicitlyConfirmed(blob);
                        if (confirmed) hasExplicitConfirmation = true;
                        return `- ${title.slice(0, 200)} (status: ${r.status || "?"}${
                            next ? `; next steps: ${next.slice(0, 160)}` : ""
                        })${confirmed ? " [ops_confirm_ok]" : " [open_work_only — do not claim done/ETA]"}`;
                    })
                    .filter(Boolean) as string[];
                if (items.length) {
                    out.push("Open property issues the team is working on for this reservation:");
                    out.push(...items);
                }
            }
        } catch {
            /* non-fatal */
        }

        if (!out.length) return { text: null, hasExplicitConfirmation: false };
        return {
            hasExplicitConfirmation,
            text: [
                "## Internal operations in progress (STAFF-ONLY — open work for THIS reservation only)",
                "assert_when=never_assert_completion unless a line is tagged [ops_confirm_ok].",
                "Status is unknown to the guest: you may say the team will follow up. You may NOT claim completion, delivery ETAs, or that something is already arranged unless [ops_confirm_ok]. Never invent on-site presence. Never quote internal wording/names/prices.",
                ...out,
            ].join("\n"),
        };
    }

    /**
     * Team feedback on past AI replies — the direct steering channel. Staff
     * submit thumbs/notes/corrected responses from the inbox; this block feeds
     * the recent, substantive ones back into every new suggestion so the same
     * mistake isn't repeated. General (no-listing) feedback applies everywhere;
     * listing-specific feedback is included for this property group only.
     */
    private async buildFeedbackBlock(groupIds: number[]): Promise<string | null> {
        try {
            const listingIds = (groupIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
            const since = new Date();
            since.setDate(since.getDate() - 90);

            const qb = this.feedbackRepo
                .createQueryBuilder("f")
                .where("f.createdAt >= :since", { since })
                .andWhere(
                    "((f.feedbackText IS NOT NULL AND f.feedbackText <> '') OR (f.correctedResponse IS NOT NULL AND f.correctedResponse <> ''))"
                )
                .orderBy("f.createdAt", "DESC")
                .take(40);
            const rows = await qb.getMany();
            if (!rows.length) return null;

            const lidSet = new Set(listingIds);
            const picked: string[] = [];
            const seen = new Set<string>();
            for (const f of rows) {
                const isForThisListing = f.listingId != null && lidSet.has(Number(f.listingId));
                const isGeneral = f.listingId == null;
                // Listing-specific feedback for OTHER properties doesn't apply here.
                if (!isForThisListing && !isGeneral) continue;
                const parts: string[] = [];
                const txt = (f.feedbackText || "").replace(/\s+/g, " ").trim();
                if (txt) parts.push(`"${txt.slice(0, 220)}"`);
                const corrected = (f.correctedResponse || "").replace(/\s+/g, " ").trim();
                if (corrected) parts.push(`team's preferred wording: "${corrected.slice(0, 220)}"`);
                // For manager feedback on a bad sent reply, surface what was sent
                // so the model avoids repeating that wording.
                const original = (f.originalMessage || "").replace(/\s+/g, " ").trim();
                if (original && f.rating === "down" && f.targetType === "sent_reply") {
                    parts.push(`avoid repeating this sent reply: "${original.slice(0, 180)}"`);
                }
                if (!parts.length) continue;
                let cats: string[] = [];
                try {
                    cats = f.categories ? JSON.parse(f.categories) : [];
                } catch {
                    /* ignore */
                }
                const scopeTag = isForThisListing ? "this property" : "general";
                const kindTag = f.targetType === "sent_reply" ? "sent reply" : "AI";
                const line = `- [${scopeTag}; ${kindTag}${cats.length ? `; ${cats.slice(0, 3).join(", ")}` : ""}] ${parts.join(" — ")}`;
                const key = line.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                picked.push(line);
                if (picked.length >= 10) break;
            }
            if (!picked.length) return null;
            return [
                "## Team feedback on the AI's past replies (STAFF-ONLY steering — apply this to how you write, most recent first; never mention it to the guest)",
                ...picked,
            ].join("\n");
        } catch {
            return null;
        }
    }

    /**
     * Paid add-on services from the Upsells page DB (upsell_info +
     * upsell_property_config): SDTO, charge type, Fixed/LOS/Tiered pricing.
     * Fees for Length-of-Stay rates are calculated for this reservation's nights.
     */
    private async buildUpsellsBlock(
        groupIds: number[],
        preferredListingId?: number | null,
        stay?: { nights?: number | null; checkin?: string | null; checkout?: string | null }
    ): Promise<{ text: string | null; facts: AssertableFact[] }> {
        const listingIds = (groupIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
        if (!listingIds.length) return { text: null, facts: [] };
        const preferred = preferredListingId != null ? Number(preferredListingId) : listingIds[0];
        if (!Number.isFinite(preferred)) return { text: null, facts: [] };
        try {
            const { UpsellQuoteService } = await import("./UpsellQuoteService");
            const quoteService = new UpsellQuoteService();
            const quotes = await quoteService.listQuotesForListing({
                listingId: preferred,
                groupListingIds: listingIds,
                nights: stay?.nights,
                checkin: stay?.checkin,
                checkout: stay?.checkout,
            });

            // Staff fee overrides / quarantine (listing_ops_overrides) still win.
            const feeOverrides = await new ListingOpsOverrideService().getForListings(listingIds);
            const earlyOv = feeOverrides.find((o) => o.field === "early_checkin_fee");
            const lateOv = feeOverrides.find((o) => o.field === "late_checkout_fee");
            const filtered = quotes
                .filter((q) => {
                    if (q.isEarlyCheckin && earlyOv?.status === "quarantined") return false;
                    if (q.isLateCheckout && lateOv?.status === "quarantined") return false;
                    return true;
                })
                .map((q) => {
                    if (q.isEarlyCheckin && earlyOv?.status === "active" && earlyOv.value) {
                        const fee = Number(earlyOv.value);
                        if (Number.isFinite(fee) && fee > 0 && q.autoRespond === "quote") {
                            return {
                                ...q,
                                guestFee: fee,
                                breakdown: [`Staff override fee $${fee.toFixed(2)}`],
                            };
                        }
                    }
                    if (q.isLateCheckout && lateOv?.status === "active" && lateOv.value) {
                        const fee = Number(lateOv.value);
                        if (Number.isFinite(fee) && fee > 0 && q.autoRespond === "quote") {
                            return {
                                ...q,
                                guestFee: fee,
                                breakdown: [`Staff override fee $${fee.toFixed(2)}`],
                            };
                        }
                    }
                    return q;
                });

            return quoteService.formatForPrompt(filtered) as {
                text: string | null;
                facts: AssertableFact[];
            };
        } catch (err: any) {
            logger.warn(
                `[InboxAIService] buildUpsellsBlock failed (listing ${preferred}): ${err?.message || err}`
            );
            return { text: null, facts: [] };
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

        const guestQueryEarly = (targetMessage?.body || conversation.lastMessageText || "").toString();
        const stageLineEarly = this.stayStageLine(conversation.checkin, conversation.checkout);
        const isBooked =
            !!conversation.reservationId && !InboxAIService.isInquiryStatus(conversation.reservationStatus);
        const assertFacts: AssertableFact[] = [];
        let opsExplicitConfirm = false;

        // Full reservation facts (exact dates, status, confirmation code, payment
        // state, refundability / cancellation terms) pulled live from Hostify.
        // The thin conversation columns above are frequently empty, which is why
        // the bot previously "didn't detect" reservation dates or cancellation
        // policy — this block is what lets it answer those accurately.
        if (includeKnowledge) try {
            const resvBlock = await this.buildReservationBlock(conversation, messages);
            if (resvBlock) {
                lines.push("");
                lines.push(resvBlock);
            }
        } catch {
            /* non-fatal */
        }

        // Smart-lock door codes — only injected on check-in day / mid-stay / lockout.
        if (includeKnowledge) try {
            const access = await this.buildAccessBlock(conversation, guestQueryEarly);
            assertFacts.push(...access.facts);
            if (access.text) {
                lines.push("");
                lines.push(access.text);
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

        // Conflicts page (AI Assistant → Conflicts): open contradictions between
        // listing data / learned Q&A / KB. Until staff clears them, suppress the
        // non-listing side(s) so the guest never hears the bad value. Live
        // listing_info below remains the source of truth.
        let conflictExcludeFactIds = new Set<number>();
        let conflictExcludeKbIds = new Set<number>();
        let conflictTopics: string[] = [];
        if (includeKnowledge && groupIds.length) {
            try {
                const { AIConflictDetectorService } = require("./AIConflictDetectorService");
                const suppressed = await new AIConflictDetectorService().getGuestReplySuppressions(groupIds);
                conflictExcludeFactIds = suppressed.factIds;
                conflictExcludeKbIds = suppressed.kbIds;
                conflictTopics = suppressed.topics;
                if (conflictTopics.length) {
                    lines.push("");
                    lines.push("## Knowledge conflicts under staff review (Conflicts page)");
                    lines.push(
                        `Open conflicts for: ${conflictTopics.join(", ")}. Prefer LIVE LISTING DATA below. ` +
                            `Do NOT use learned answers or Knowledge Base entries that disagree on these topics. ` +
                            `If listing data is silent on a conflicted topic, say the team will confirm — never guess.`
                    );
                }
            } catch {
                /* non-fatal */
            }
        }

        // Internal operations context: what the team already has in motion for
        // this guest (open tasks, property issues). The team's replies are often
        // driven by this, so the bot must see it to stay consistent with them.
        if (includeKnowledge) try {
            const ops = await this.buildOpsBlock(conversation, groupIds);
            opsExplicitConfirm = ops.hasExplicitConfirmation;
            assertFacts.push({
                id: "ops_open_work",
                assertWhen: "never_assert_completion",
                assertText:
                    "An ops/task line for THIS reservation is tagged [ops_confirm_ok] — you may state that confirmed outcome only.",
                policyText:
                    "Ops status is unknown to the guest: you may say the team will follow up. You may NOT claim completion, delivery, or an ETA.",
                kind: "ops",
            });
            if (ops.text) {
                lines.push("");
                lines.push(ops.text);
            }
        } catch {
            /* non-fatal */
        }

        // Paid add-on services from Upsells DB (SDTO + LOS-calculated fees).
        if (includeKnowledge) try {
            const ups = await this.buildUpsellsBlock(groupIds, conversation.listingId, {
                nights: conversation.nights != null ? Number(conversation.nights) : null,
                checkin: conversation.checkin,
                checkout: conversation.checkout,
            });
            assertFacts.push(...ups.facts);
            if (ups.text) {
                lines.push("");
                lines.push(ups.text);
            }
        } catch {
            /* non-fatal */
        }

        // Recent team feedback on AI replies — direct steering from staff.
        if (includeKnowledge) try {
            const fb = await this.buildFeedbackBlock(groupIds);
            if (fb) {
                lines.push("");
                lines.push(fb);
            }
        } catch {
            /* non-fatal */
        }

        // Contested facts (checkout/check-in times, capacity): staff/ops beat PMS.
        let contestedConflicts = false;
        if (includeKnowledge) try {
            const contested = await resolveContestedFacts({
                listingIds: groupIds,
                canonicalListingId,
            });
            if (contested.promptBlock) {
                lines.push("");
                lines.push(contested.promptBlock);
            }
            contestedConflicts = contested.resolutions.some((r) => r.conflict);
            for (const r of contested.resolutions) {
                if (r.conflict) {
                    assertFacts.push({
                        id: r.field,
                        assertWhen: "always",
                        assertText: "",
                        policyText: `${r.field}: CONFLICT — ${r.note || "sources disagree"}. Do NOT assert a specific value; escalate.`,
                        kind: r.field,
                    });
                } else if (r.value) {
                    assertFacts.push({
                        id: r.field,
                        assertWhen: "always",
                        assertText: `${r.value} (source: ${r.source})`,
                        policyText: `${r.field}: unknown — do not invent; escalate if the guest asks.`,
                        kind: r.field,
                    });
                } else {
                    assertFacts.push({
                        id: r.field,
                        assertWhen: "always",
                        assertText: "",
                        policyText: `${r.field}: unknown — do not invent; escalate if the guest asks.`,
                        kind: r.field,
                    });
                }
            }
            if (contestedConflicts) {
                lines.push(
                    "- NOTE: because at least one contested field conflicts across sources, set escalation_required=true if the guest asks about check-in/out time or max guests."
                );
            }
        } catch {
            /* non-fatal */
        }

        // Listing profile WITHOUT asserting PMS checkout/capacity (those come from
        // the contested ladder above). WiFi is assert_when=booked_and_ask only.
        try {
            const listing = canonicalListingId
                ? await this.listingRepo.findOne({ where: { id: Number(canonicalListingId) }, withDeleted: true })
                : null;
            if (listing) {
                const l: any = listing;
                const details: string[] = [];
                const loc = [l.address, l.city, l.state].filter((v: any) => v && String(v).trim() && String(v) !== "(NOT SPECIFIED)");
                if (loc.length) details.push(`- Location: ${loc.join(", ")}`);
                if (l.bedroomsNumber != null) details.push(`- Bedrooms: ${l.bedroomsNumber}`);
                if (l.bathroomsNumber != null) details.push(`- Bathrooms: ${l.bathroomsNumber}`);
                if (l.cleaningFee != null && Number(l.cleaningFee) > 0) details.push(`- Cleaning fee: $${l.cleaningFee}`);
                if (l.airbnbPetFeeAmount != null && Number(l.airbnbPetFeeAmount) > 0)
                    details.push(`- Pet fee: $${l.airbnbPetFeeAmount}`);
                const wifiName = String(l.wifiUsername || "").trim();
                if (wifiName && isBooked) {
                    const wifiPass = String(l.wifiPassword || "").trim();
                    const wifiAssert = `WiFi network: ${wifiName}${wifiPass ? ` (password: ${wifiPass})` : ""}`;
                    assertFacts.push({
                        id: "wifi",
                        assertWhen: "booked_and_ask",
                        assertText: `${wifiAssert} — share with this booked guest only when they ask.`,
                        policyText:
                            "WiFi details are for confirmed guests when they ask. Do not volunteer credentials unprompted or to inquiries.",
                        kind: "wifi",
                    });
                    // Only put credentials in the listing block when assert_when passes.
                    if (guestAsksWifi(guestQueryEarly)) {
                        details.push(`- ${wifiAssert} — you MAY share this with this booked guest (they asked)`);
                    }
                }
                const desc = String(l.description || "").replace(/\s+/g, " ").trim();
                if (desc) details.push(`- Description: ${desc.slice(0, 900)}`);
                if (details.length) {
                    lines.push("");
                    lines.push("## Listing details (non-contested — you MAY share these with the guest)");
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
                    const pol = String(policy).trim().slice(0, 1200);
                    lines.push("");
                    lines.push("## Cancellation policy (property's documented standing policy — you MAY state this to the guest)");
                    lines.push(pol);
                    assertFacts.push({
                        id: "cancellation_policy",
                        assertWhen: "always",
                        assertText: `Cancellation policy: ${pol.slice(0, 400)}`,
                        policyText: "Do not invent a cancellation policy; escalate if asked and none is documented.",
                        kind: "house_policy",
                    });
                }
            }
        } catch {
            /* non-fatal */
        }

        // Property-specific Knowledge Base (staff-maintained on the All Listings
        // page). External entries are guest-shareable; internal entries inform the
        // reply but must not be quoted to the guest.
        const guestQuery = guestQueryEarly;
        if (includeKnowledge) try {
            let rendered = false;
            // Prefer semantic KB retrieval (embedding-ranked, group-scoped,
            // visibility-split) when RAG is enabled and the KB has been indexed.
            if (ExemplarService.isEnabled() && guestQuery.trim()) {
                const kbSem = await new RetrievalService().retrieveKb(canonicalListingId, guestQuery, {
                    k: 4,
                    excludeKbIds: conflictExcludeKbIds,
                });
                // Chunks are embedded at up to ~1350 chars (1200 + overlap); render
                // them whole. Slicing at 700 dropped trailing caveats like "Note:
                // Pool and hot tub heating are available for an additional fee",
                // which made the bot present paid amenities as free.
                // External only — internal KB is never fed into guest replies
                // (even "to inform" is a leak risk for sensitive staff notes).
                if (kbSem.external.length) {
                    lines.push("");
                    lines.push("## Listing Knowledge Base (you MAY share this with the guest)");
                    for (const d of kbSem.external) {
                        let text = d.text.replace(/\s+/g, " ").trim().slice(0, 1400);
                        if (/^amenities\b/i.test(text) || /:\s*Essentials,\s*Kitchen/i.test(text)) {
                            text =
                                `[Platform amenity checklist — listed on the booking site, NOT confirmed on-site inventory; ` +
                                `do NOT invent where items are stored] ${text}`;
                        } else if (/\bhouse rules?\b/i.test(text)) {
                            assertFacts.push({
                                id: `house_rules_${assertFacts.length}`,
                                assertWhen: "always",
                                assertText: text.slice(0, 500),
                                policyText: "House rules are not documented here — do not invent rules; escalate if asked.",
                                kind: "house_rules",
                            });
                        }
                        lines.push(`- ${text}`);
                    }
                    rendered = true;
                }
            }
            // Fallback to the keyword render path (RAG off, or KB not yet indexed).
            if (!rendered) {
                const kb = await new ListingKnowledgeService().renderForBot(conversation.listingId, {
                    query: guestQuery,
                    listingIds: groupIds,
                    excludeKbIds: conflictExcludeKbIds,
                });
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
                const facts = await new RetrievalService().retrieveFacts(canonicalListingId, guestQuery, {
                    k: 6,
                    channel: conversation.channel,
                    excludeFactIds: conflictExcludeFactIds,
                });
                learned = new RetrievalService().renderFacts(facts);
            }
            if (!learned) {
                learned = await new AILearnedFactsService().renderForBot(conversation.listingId, {
                    query: guestQuery,
                    listingIds: groupIds,
                    channel: conversation.channel,
                    excludeFactIds: conflictExcludeFactIds,
                });
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
            const exemplars = await new ExemplarService().retrieveForQuery(canonicalListingId, guestQuery, {
                k: 4,
                minSim: 0.55,
                channel: conversation.channel,
            });
            if (exemplars.length) {
                lines.push("");
                lines.push(
                    "## How our team answered similar questions before (proven replies — prefer these facts & phrasing; " +
                        "if they conflict with house rules / capacity / listing times for THIS property, trust the listing)"
                );
                for (const ex of exemplars) {
                    const a = ex.answer.replace(/\s+/g, " ").trim().slice(0, 500);
                    const q = ex.question.replace(/\s+/g, " ").trim().slice(0, 200);
                    const scopeTag = ex.scope === "portfolio" ? " [portfolio — generic ops only]" : "";
                    lines.push(`- Guest asked: "${q}"\n  Team replied: "${a}"${scopeTag}`);
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
            // External only — internal documents never reach guest-facing prompts.
            if (docs.external.length) {
                lines.push("");
                lines.push("## Listing documents (guest-shareable — you MAY share this content)");
                for (const d of docs.external) lines.push(`- ${d.text.replace(/\s+/g, " ").trim().slice(0, 1400)}`);
            }
        } catch {
            /* non-fatal */
        }

        // Live availability: when the guest is asking about availability / dates /
        // extending their stay, pull the real calendar so the reply can answer
        // directly ("the 5th is open at $220") instead of "we'll check".
        if (includeKnowledge) try {
            const guestText = (targetMessage?.body || conversation.lastMessageText || "").toString();
            if (this.detectAvailabilityIntent(guestText)) {
                // The conversation row should always carry a listingId, but thread
                // summaries have dropped it before — recover it from the
                // reservation, then the listing name, rather than skipping the
                // calendar.
                if (!conversation.listingId && conversation.reservationId) {
                    try {
                        const r = await this.reservationRepo.findOne({ where: { id: Number(conversation.reservationId) } });
                        if (r?.listingMapId) conversation.listingId = Number(r.listingMapId);
                    } catch { /* fall through */ }
                }
                if (!conversation.listingId && conversation.listingName) {
                    try {
                        const l = await appDatabase.getRepository(Listing).findOne({
                            where: [
                                { internalListingName: conversation.listingName },
                                { name: conversation.listingName },
                                { externalListingName: conversation.listingName },
                            ],
                            withDeleted: true,
                        });
                        if (l?.id) conversation.listingId = Number(l.id);
                    } catch { /* fall through to the warning below */ }
                }
                if (conversation.listingId) {
                    const extensionAsk = this.detectExtensionAsk(guestText);
                    const avail = await this.buildAvailabilityBlock(conversation, { hidePrices: extensionAsk });
                    if (avail) {
                        lines.push("");
                        lines.push(
                            extensionAsk
                                ? "## Live availability (dates only — NEVER quote Hostify nightly prices for extensions; a human prices them)"
                                : "## Live availability (from the calendar — you MAY state these facts to the guest)"
                        );
                        lines.push(avail);
                    } else {
                        logger.warn(`[InboxAI] Availability intent on thread ${conversation.threadId} but calendar fetch returned nothing (listing ${conversation.listingId})`);
                    }
                } else {
                    logger.warn(`[InboxAI] Availability intent on thread ${conversation.threadId} but conversation has no listingId — calendar skipped`);
                }
            }
        } catch (err: any) {
            logger.warn(`[InboxAI] Availability block failed for thread ${conversation.threadId}: ${err?.message}`);
        }

        // Same-city alternatives: inquiry dates that this listing can't take
        // (calendar closed, or the guest literally can't get the booking
        // through) → offer sibling homes that ARE open for those exact nights.
        if (includeKnowledge) try {
            const guestText = (targetMessage?.body || conversation.lastMessageText || "").toString();
            const altBlock = await this.buildAlternativesBlock(conversation, guestText);
            if (altBlock) {
                lines.push("");
                lines.push(altBlock);
            }
        } catch (err: any) {
            logger.warn(`[InboxAI] Alternatives block failed for thread ${conversation.threadId}: ${err?.message}`);
        }

        // Cross-portfolio search: guest shopping for a place (typical on unlinked
        // SMS leads) → run the real search and inject bookable options.
        if (includeKnowledge) try {
            const guestText = (targetMessage?.body || conversation.lastMessageText || "").toString();
            const searchBlock = await this.buildListingSearchBlock(guestText);
            if (searchBlock) {
                lines.push("");
                lines.push(searchBlock);
            }
        } catch (err: any) {
            logger.warn(`[InboxAI] Listing search block failed for thread ${conversation.threadId}: ${err?.message}`);
        }

        // Structural assert_when gate (after fact sources): only ASSERTABLE lines
        // may be stated as certain; otherwise the model gets a POLICY substitute.
        if (includeKnowledge && assertFacts.length) {
            const assertCtx: AssertEvalContext = {
                stayStageLine: stageLineEarly,
                isBooked,
                guestText: guestQueryEarly,
                lockoutAsk: guestReportsLockout(guestQueryEarly),
                wifiAsk: guestAsksWifi(guestQueryEarly),
                agreementAsk: guestAsksAgreement(guestQueryEarly),
                hasExplicitOpsConfirmation: opsExplicitConfirm,
            };
            const assertBlock = renderAssertPolicyBlock(assertFacts, assertCtx);
            if (assertBlock) {
                lines.push("");
                lines.push(assertBlock);
            }
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
