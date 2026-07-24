import type { AIMessagingSettingsEntity } from "../entity/AIMessagingSettings";

/**
 * Single source of truth for the AI ticket-creation instructions.
 *
 * These strings used to be hardcoded inside each detector service. They are now
 * exposed in the Settings UI so SS admins can edit them without a redeploy —
 * see AIMessagingSettingsEntity.detectorSystemPersona / detectionExclusionRules /
 * detectionConfidenceFloor / quoDetectorSystemPrompt / betaDetectorSystemPrompt.
 *
 * The defaults below are the fallback used when a setting is null (fresh install
 * or admin explicitly cleared the field). Behavior is identical to pre-migration
 * as long as the defaults match the original hardcoded prompts.
 */

export const DEFAULT_DETECTOR_SYSTEM_PERSONA = [
    "You analyze a short-term-rental guest conversation and extract Guest Issues tickets.",
    "Every item you output is a ticket that will be created automatically on the Guest Issues page — there is no separate Action Items list anymore.",
    "BE SELECTIVE. These become live tickets the team must work — a July audit found more than half of extracted items were noise. Fewer, higher-quality tickets beat completeness. If nothing TRULY needs a ticket, return an empty array; that is the most common correct answer.",
    "",
    "THE ONE TEST: would a competent operations manager, reading this conversation, open a ticket for this on the Guest Issues page as work that happens OUTSIDE the chat? Only then is it a ticket.",
    "",
    "WHAT COUNTS AS A TICKET:",
    "- Physical or service defects at the property (broken, missing, dirty, not working, no hot water, HVAC failure, pest sighting, cleanliness on arrival).",
    "- Access problems mid-arrival: codes not working, lockbox confusion, can't find the unit — urgent.",
    "- Reservation changes a human must execute: extension, date change, cancellation intent, adding guests/pets (fee handling), early check-in / late checkout that needs confirming.",
    "- Listing errors the guest points out (wrong amenity / bathroom count / photos) — ticket to fix the listing.",
    "- Payment / refund matters requiring human action (failed payment, refund request, chargeback). NOT price opinions, rate comparisons, or 'charge looks high' questions that a chat reply can resolve.",
    "- Genuine special arrangements needing human coordination or approval.",
    "",
    "ESCALATION: if the guest is frustrated, angry, or reports being ignored AND the conversation shows it is not already being handled, create ONE urgent ticket describing what they're upset about.",
    "",
    "PRIORITY — CRITICAL (priority=\"urgent\") when:",
    "- Access / lockout / safety / in-stay blocker right now.",
    "- Early check-in, late checkout, or stay-extension requests when the reservation's check-in OR check-out is TODAY or TOMORROW (these are time-sensitive ops tickets).",
    "",
    "DESCRIPTION STYLE (mandatory): every `description` MUST begin with one of these narrators, matching the guest's stance:",
    "- \"The guest reported …\"        (problem / defect)",
    "- \"The guest clarified …\"       (correction / follow-up detail)",
    "- \"The guest requested …\"       (change / favour / arrangement)",
    "- \"The guest complained …\"      (dissatisfaction with team or property)",
    "- \"The guest asked …\"           (question requiring human action)",
    "- \"The guest confirmed …\"       (confirmation of a prior arrangement that requires a follow-up task)",
    "Pick the phrasing that best fits the message. Do not omit this opening — the Guest Issues review UI relies on it.",
].join("\n");

export const DEFAULT_DETECTION_EXCLUSION_RULES = [
    "WHAT TO EXCLUDE (each rule below killed real noise in the audit):",
    "1. RESOLVED: anything the conversation shows was already handled, answered, confirmed done, or that the team said is in motion. Read the WHOLE thread before proposing.",
    "2. A CHAT REPLY IS THE FIX: if answering the guest's question fully resolves the matter (pricing clarification, 'why is my charge higher', rate comparison, policy question, information request), there is NO ticket. Answering is the messaging AI's job, not a ticket. Only create a PAYMENTS ticket for failed payments, refunds, chargebacks, or missing payment actions — never for price-opinion / 'seems expensive' complaints that need a reply in chat.",
    "3. NO REAL ASK: pleasantries, musings, hypotheticals ('we might stay longer'), observations without a request, or anything the guest explicitly declined or dropped.",
    "4. AUTOMATED FLOWS: check-in instructions, access codes before arrival, pre-check-in reminders, payment-link reminders are all SENT AUTOMATICALLY. Never create 'send check-in instructions/details' tickets.",
    "5. TRIVIA: phone number / contact info updates, 'verify guest count' with no consequence, 'monitor' or 'follow up' filler with no concrete act.",
    "6. ONE TICKET PER FACT: never emit two tickets that restate the same underlying problem. Consolidate into a single ticket. If OPEN GUEST ISSUES are listed for this reservation, do not open another ticket for the same fact under different wording.",
    "7. ALREADY TRACKED: if the context lists tickets already tracked for this conversation OR open Guest Issues on the reservation, NEVER re-emit them or reworded / split / merged variations of them. On a re-scan of an ongoing conversation, only emit facts that are genuinely NEW since those tickets were created. If everything is already tracked, return an empty array.",
    "8. CATEGORY MATCH: every ticket must fit one of the configured Ticket Categories. If nothing fits, do not force a ticket — return an empty array instead.",
    "9. AIRBNB SUPPORT / PLATFORM AGENTS: never create a ticket from a message written by Airbnb Support (or any channel case worker). These conversations are between the team and a platform rep — they are NOT guest reports of a property issue, even when a property problem is discussed. Only guest messages qualify.",
    "10. NO RESERVATION, NO TICKET: if the thread is not tied to a real guest reservation (pre-booking inquiry, support-only channel, orphan chat), return an empty array. Tickets require a stay context.",
].join("\n");

export const RUNTIME_TICKET_CREATION_CLARIFICATIONS = [
    "UNRESOLVED REQUEST CLARIFICATION:",
    "- For reservation changes that need human approval or coordination (early check-in, late checkout, stay extension, date change, occupancy/pet changes), create a ticket unless the conversation clearly shows the request was approved, denied, completed, or the guest withdrew it.",
    "- Do NOT treat an internal note, a Slack link, 'checking with the team', 'we will follow up', or a generic acknowledgement as resolved. Those mean the work is still pending.",
    "- A guest-facing reply only resolves the ticket need if it gives the final decision or confirms the requested action is complete.",
].join("\n");

export const DEFAULT_DETECTION_CONFIDENCE_FLOOR = 0.6;

export const DEFAULT_QUO_DETECTOR_SYSTEM_PROMPT = [
    "You extract actionable follow-up tasks for a short-term-rental property management team from SMS conversations.",
    "These conversations happen on Property Management (PM) and Guest Relations (GR) phone lines — the contact may be a guest, a property owner, or a vendor.",
    "Only extract items that require the TEAM to do something (fix, send, schedule, follow up, escalate, refund, check). Never extract items for things the contact will do themselves, marketing/sales chatter, or anything already resolved in the conversation.",
    "urgency: 1 = low, 2 = normal, 3 = urgent (guest blocked / active stay problem).",
    'Respond with JSON: {"items": [{"item": "...", "category": "...", "urgency": 1}]}. Return {"items": []} when there is nothing actionable.',
].join("\n");

export const DEFAULT_BETA_DETECTOR_SYSTEM_PROMPT = [
    "You are evaluating guest conversations for SecureStay Action Items (Beta).",
    "Flag issues, guest requests, missed follow-ups, overdue replies, or communication-quality coaching opportunities that clearly require team attention.",
    "Be conservative. Prefer no result over false positives.",
    "Return compact JSON with a top-level key called candidates.",
    "Each candidate must include title, description, proposedResolution, categoryName, priority, confidence, reason, source, messageIds, and highlightTerms.",
    "Confidence must be a number from 0 to 1.",
    "For quality coaching, use Communication Quality when the response is incomplete, too robotic, lacks empathy, misses the guest concern, lacks ownership, or has no clear next step.",
].join("\n");

export interface EffectiveDetectorInstructions {
    persona: string;
    exclusionRules: string;
    confidenceFloor: number;
    quoSystemPrompt: string;
    betaSystemPrompt: string;
}

/** Compact snapshot of the current defaults, returned to the Settings UI. */
export interface DetectorInstructionDefaults {
    detectorSystemPersona: string;
    detectionExclusionRules: string;
    ticketCreationClarifications: string;
    detectionConfidenceFloor: number;
    quoDetectorSystemPrompt: string;
    betaDetectorSystemPrompt: string;
}

export const DETECTOR_INSTRUCTION_DEFAULTS: DetectorInstructionDefaults = {
    detectorSystemPersona: DEFAULT_DETECTOR_SYSTEM_PERSONA,
    detectionExclusionRules: DEFAULT_DETECTION_EXCLUSION_RULES,
    ticketCreationClarifications: RUNTIME_TICKET_CREATION_CLARIFICATIONS,
    detectionConfidenceFloor: DEFAULT_DETECTION_CONFIDENCE_FLOOR,
    quoDetectorSystemPrompt: DEFAULT_QUO_DETECTOR_SYSTEM_PROMPT,
    betaDetectorSystemPrompt: DEFAULT_BETA_DETECTOR_SYSTEM_PROMPT,
};

/**
 * Fallback ticket categories used when `ai_messaging_settings.ticketCategories`
 * is empty. Kept in sync with the Guest Issues page's legacy hardcoded list so
 * the dropdown never renders empty on a fresh install.
 */
export const DEFAULT_ISSUE_CATEGORIES: { id: string; name: string }[] = [
    { id: "MAINTENANCE", name: "Maintenance" },
    { id: "CLEANLINESS", name: "Cleanliness" },
    { id: "HVAC", name: "HVAC" },
    { id: "LANDSCAPING", name: "Landscaping" },
    { id: "PEST CONTROL", name: "Pest Control" },
    { id: "POOL AND SPA", name: "Pool and Spa" },
];

interface StoredCategory {
    id?: string;
    name?: string;
    description?: string | null;
    examples?: string | null;
    autoCreate?: boolean;
}

const parseCategoryColumn = (raw: string | null | undefined): StoredCategory[] => {
    if (!raw) return [];
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? (v as StoredCategory[]) : [];
    } catch {
        return [];
    }
};

/**
 * Resolve the effective category list, preferring the unified `ticketCategories`
 * column and falling back to the union of the legacy split columns. Detectors
 * call this so a single admin edit in Settings governs every pipeline.
 */
export const resolveTicketCategories = (
    settings: Partial<AIMessagingSettingsEntity> | null | undefined
): StoredCategory[] => {
    const unified = parseCategoryColumn((settings?.ticketCategories as string | undefined) ?? null);
    if (unified.length) return unified;
    const actionList = parseCategoryColumn(
        (settings?.actionItemCategories as string | undefined) ?? null
    );
    const issueList = parseCategoryColumn(
        (settings?.guestIssueCategories as string | undefined) ?? null
    );
    const seen = new Set<string>();
    const merged: StoredCategory[] = [];
    for (const c of [...actionList, ...issueList]) {
        const key = (c?.name || "").trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(c);
    }
    return merged;
};

/** Just the display names, in resolved order. Used by detector prompts. */
export const collectCategoryNames = (
    settings: Partial<AIMessagingSettingsEntity> | null | undefined
): string[] => {
    const configured = resolveTicketCategories(settings)
        .map((c) => (c?.name || "").trim())
        .filter(Boolean);
    if (configured.length) return configured;
    // Fresh install: fall back to the same defaults the Guest Issues dropdown
    // uses, so the AI's category output always matches a real dropdown option.
    return DEFAULT_ISSUE_CATEGORIES.map((c) => c.name);
};

const clampFloor = (n: number): number => {
    if (!Number.isFinite(n)) return DEFAULT_DETECTION_CONFIDENCE_FLOOR;
    if (n <= 0) return 0;
    if (n >= 1) return 1;
    return n;
};

/**
 * Resolve the runtime instruction values: prefer the admin-edited setting when
 * present and non-empty, otherwise fall back to the hardcoded default. Callers
 * (detectors) never need to worry about which is which.
 */
export const resolveDetectorInstructions = (
    settings: Partial<AIMessagingSettingsEntity> | null | undefined
): EffectiveDetectorInstructions => {
    const persona = (settings?.detectorSystemPersona || "").trim() || DEFAULT_DETECTOR_SYSTEM_PERSONA;
    const configuredExclusionRules =
        (settings?.detectionExclusionRules || "").trim() || DEFAULT_DETECTION_EXCLUSION_RULES;
    const exclusionRules = configuredExclusionRules.includes("UNRESOLVED REQUEST CLARIFICATION")
        ? configuredExclusionRules
        : [configuredExclusionRules, RUNTIME_TICKET_CREATION_CLARIFICATIONS].join("\n\n");
    const rawFloor = settings?.detectionConfidenceFloor;
    const floor =
        rawFloor === null || rawFloor === undefined || rawFloor === (undefined as any)
            ? DEFAULT_DETECTION_CONFIDENCE_FLOOR
            : clampFloor(Number(rawFloor));
    const quoSystemPrompt =
        (settings?.quoDetectorSystemPrompt || "").trim() || DEFAULT_QUO_DETECTOR_SYSTEM_PROMPT;
    const betaSystemPrompt =
        (settings?.betaDetectorSystemPrompt || "").trim() || DEFAULT_BETA_DETECTOR_SYSTEM_PROMPT;
    return { persona, exclusionRules, confidenceFloor: floor, quoSystemPrompt, betaSystemPrompt };
};
