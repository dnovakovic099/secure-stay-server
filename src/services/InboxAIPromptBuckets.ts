/**
 * Intent-bucketed prompts for Inbox AI.
 *
 * General mode dumps the whole listing into one prompt — fine for open-ended
 * chats, bad for fee quotes (model invents $ from marketing text / learned facts).
 *
 * When a detector says the guest only needs a fee/upsell answer, we switch to a
 * short specialist system prompt + a stripped context that keeps Upsells / stay
 * nights / SDTO signals and drops amenity KB, descriptions, exemplars, etc.
 *
 * Add new buckets here (access, deposit, availability, …) the same way: detector
 * → exclusive mode gate → slim system prompt → section allowlist.
 */

import { AIMessagingSettingsEntity } from "../entity/AIMessagingSettings";
import {
    guestAsksEarlyOrLateCheck,
    renderEarlyLateCheckPolicy,
} from "./InboxAIAssertPolicy";
import {
    normalizeEarlyLateHandling,
} from "./AIMessagingSettingsService";

export type PromptBucket = "fee" | "access" | "deposit" | "availability" | "general";

/** Context blocks that buildContext can include or skip. */
export type ContextSection =
    | "reservation"
    | "access"
    | "property_facts"
    | "conflicts"
    | "ops"
    | "precedent"
    | "upsells"
    | "feedback"
    | "contested"
    | "listing_details"
    | "cancellation"
    | "kb"
    | "documents"
    | "learned"
    | "exemplars"
    | "availability"
    | "listing_search"
    | "assert_policy";

/** Env: `fee` (default) | `all` | `off`. Only implemented specialists are used. */
export function bucketPromptsEnabled(): boolean {
    const v = String(process.env.AI_PROMPT_BUCKETS || "fee").trim().toLowerCase();
    return v !== "0" && v !== "off" && v !== "false" && v !== "none";
}

export function isSpecialistBucketImplemented(bucket: PromptBucket): boolean {
    return bucket === "fee";
}

const FEE_SECTIONS = new Set<ContextSection>([
    "reservation",
    "upsells",
    "contested",
    "ops",
    "assert_policy",
]);

export function contextAllowsSection(bucket: PromptBucket, section: ContextSection): boolean {
    if (bucket === "general") return true;
    if (bucket === "fee") return FEE_SECTIONS.has(section);
    return true;
}

/** Detect every matching bucket (order is not priority). */
export function detectAskBuckets(text: string): PromptBucket[] {
    const t = String(text || "").trim();
    if (!t) return ["general"];
    const found: PromptBucket[] = [];

    if (isFeeAsk(t)) found.push("fee");
    if (isAccessAsk(t)) found.push("access");
    if (isDepositAsk(t)) found.push("deposit");
    if (isAvailabilityAsk(t)) found.push("availability");

    return found.length ? found : ["general"];
}

/**
 * Pick a specialist mode only when the guest ask maps to exactly one bucket
 * and that bucket has a specialist prompt. Mixed asks (fee + door code) stay
 * on the full general prompt — even if only one of those specialists is built.
 */
export function resolvePromptBucket(text: string): PromptBucket {
    if (!bucketPromptsEnabled()) return "general";
    const buckets = detectAskBuckets(text);
    const nonGeneral = buckets.filter((b) => b !== "general");
    if (nonGeneral.length === 1 && isSpecialistBucketImplemented(nonGeneral[0])) {
        return nonGeneral[0];
    }
    return "general";
}

export function promptVersionForBucket(baseVersion: string, bucket: PromptBucket): string {
    if (!bucket || bucket === "general") return baseVersion;
    return `${baseVersion}+${bucket}`;
}

function isFeeAsk(t: string): boolean {
    // Extension pricing is a separate hard escalate — do not treat as fee lookup.
    if (
        /\b(extend(ing|ed)?(\s+my|\s+the)?\s+stay|extension|add(ing)?\s+(a\s+|another\s+|one\s+more\s+)?night|stay\s+(an\s+)?extra\s+night|one\s+more\s+night)\b/i.test(
            t
        )
    ) {
        return false;
    }
    // Deposit / refund money is not Upsells fee lookup.
    if (/\b(security\s+deposit|damage\s+deposit|refund|reimburse)\b/i.test(t)) {
        // Still allow if clearly early/late fee.
        if (!guestAsksEarlyOrLateCheck(t) && !/\b(early|late)\b.*\bfee\b/i.test(t)) return false;
    }

    if (guestAsksEarlyOrLateCheck(t)) return true;

    if (
        /\b(pool\s*heat(er|ing)?|heat(ed|ing)?\s+pool|pet\s+fee|parking\s+fee|late\s+fee|early\s+fee|upsell)\b/i.test(
            t
        )
    ) {
        return true;
    }

    if (
        /\b(how\s+much|what(?:'s|\s+is)\s+the\s+(fee|cost|charge|price)|additional\s+fee|extra\s+(fee|charge)|is\s+there\s+a\s+fee)\b/i.test(
            t
        ) &&
        /\b(early|late|check[- ]?in|check[- ]?out|pool|park(ing)?|pet|cleaning|heat)\b/i.test(t)
    ) {
        return true;
    }

    if (/\b(fee|cost|charge)\s+(for|of)\s+(early|late|pool|parking|pet|heat)/i.test(t)) return true;
    if (/\b(early|late|pool|parking|pet)\b.{0,40}\b(fee|cost|charge|\$)\b/i.test(t)) return true;

    return false;
}

function isAccessAsk(t: string): boolean {
    return /\b(door\s*code|lock\s*code|gate\s*code|access\s*code|lockbox|keypad|wifi\s*(password|pass|network)|can'?t\s+get\s+in|locked\s+out|lockout)\b/i.test(
        t
    );
}

function isDepositAsk(t: string): boolean {
    return /\b(security\s+deposit|damage\s+deposit|deposit\s+(released|refund|status|hold)|hold\s+on\s+my\s+card)\b/i.test(
        t
    );
}

function isAvailabilityAsk(t: string): boolean {
    return /\b(available|availability|open\s+(on|for)|booked\s+(on|for)|calendar|those\s+dates|extend|extension|add\s+(a\s+|another\s+)?night)\b/i.test(
        t
    );
}

const FEE_JSON_SCHEMA = [
    "OUTPUT: Respond with STRICT JSON only, matching exactly this shape:",
    "{",
    '  "suggested_reply": "string — the guest-facing reply",',
    '  "confidence": 0.0,',
    '  "warnings": ["string"],',
    '  "escalation_required": false,',
    '  "escalation_reason": "string|null",',
    '  "suggested_action_items": [],',
    '  "learning_question": "string|null",',
    '  "guest_sentiment": 6,',
    '  "guest_sentiment_label": "neutral",',
    '  "guest_sentiment_note": "string|null"',
    "}",
].join("\n");

/**
 * Specialist system prompt for paid-service / early-late fee questions.
 * Intentionally short — no amenity, sales, or access rules.
 */
export function buildFeeSystemPrompt(settings?: AIMessagingSettingsEntity | null): string {
    const toneLabel = (settings?.tone || "warm").trim();
    const early = normalizeEarlyLateHandling(settings?.earlyCheckinHandling);
    const late = normalizeEarlyLateHandling(settings?.lateCheckoutHandling);

    return [
        "You are SecureStay's guest-messaging assistant answering a FEE / PAID-SERVICE question only.",
        "You draft a SUGGESTED reply for a human agent to review. You never send messages yourself.",
        "",
        `Tone: ${toneLabel}, short, like a host texting. 1–3 sentences. No corporate filler.`,
        "",
        "YOUR ONLY JOB:",
        "- Answer the fee / early check-in / late check-out / paid add-on question using Available paid services (Upsells) in the context.",
        "- Quote the guest fee EXACTLY as listed (same dollar amount). Never invent, round, or substitute another figure.",
        "- Fee ≠ approval. You may quote a fee subject to availability; you must NOT say early/late is approved or confirmed for a clock time unless a TEAM message in THIS thread already did.",
        "- Follow SDTO rules in the Upsells block (same-day turnover → decline with cleaner-window explanation and no fee when marked NOT ALLOWED).",
        "- If no matching paid service / fee appears in context: say the team will confirm the exact cost. Do NOT guess a dollar amount. Set escalation_required=true and confidence <= 0.4.",
        "- Never discount, waive, or negotiate the fee.",
        "- Ignore listing descriptions, marketing copy, and any other dollar amounts that are not in Available paid services / Reservation billing / TEAM messages for this fee.",
        "",
        renderEarlyLateCheckPolicy(early, late),
        "",
        "LENGTH: answer the fee ask first; optional one short availability caveat; stop. No amenity pitches.",
        "",
        "CONFIDENCE:",
        "- > 0.9 only when the exact fee is in Available paid services and you quoted it.",
        "- <= 0.4 when the fee is missing and you deferred.",
        "",
        "ESCALATION: set escalation_required=true for waivers, discounts, approvals of a specific time, missing fees, or anything beyond quoting a documented fee.",
        "",
        "GUEST SENTIMENT: rate 1–10 from their latest message (6 = neutral).",
        "",
        FEE_JSON_SCHEMA,
    ].join("\n");
}
