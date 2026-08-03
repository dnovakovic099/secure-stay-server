import { factFieldLabel } from "../config/propertyFactFields";

/**
 * Maps Verified Property Facts (short free text) onto the typed parameters of
 * Hostify's POST /listings/update.
 *
 * Only a subset of the fact catalog has a Hostify listing field AND can be
 * parsed deterministically from staff-written text; everything else stays in
 * SecureStay only. Fields that are mappable but whose text can't be parsed
 * with confidence are returned as `skipped` with a human-readable reason so
 * the UI can show exactly what will / won't be pushed.
 */

export interface MappedFact {
    fieldKey: string;
    label: string;
    factValue: string;
    param: string;
    value: string | number;
}

export interface SkippedFact {
    fieldKey: string;
    label: string;
    factValue: string;
    reason: string;
}

const NA_RE = /^(n\/?a\b|none\b|not applicable)/i;

/** "$25.75/night", "150", "no fee" → number (0 for none), null if unparseable. */
function parseMoney(text: string): number | null {
    const t = text.trim();
    if (NA_RE.test(t) || /^no\b/i.test(t) || /\bno (extra |additional )?(fee|charge|cost|deposit)\b/i.test(t)) {
        return 0;
    }
    const m = t.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
}

/** Yes/no policy text → 1/0, null if unclear. Negatives are checked first. */
function parseYesNo(text: string): 0 | 1 | null {
    const t = text.trim().toLowerCase();
    if (NA_RE.test(t)) return null;
    if (/(not allowed|not permitted|prohibited|forbidden|no pets|no smoking|^no\b)/.test(t)) return 0;
    if (/(^yes\b|allowed|permitted|welcome|\bok\b|okay)/.test(t)) return 1;
    return null;
}

/**
 * "4 PM", "16:00", "flexible" → "HH:00" | "flexible", null if unparseable.
 * Hostify accepts whole hours only, so times with minutes are rejected.
 */
function parseTime(text: string): string | null {
    if (/flexible/i.test(text)) return "flexible";
    const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
    if (!m) return null;
    let h = Number(m[1]);
    const minutes = m[2] ? Number(m[2]) : 0;
    const ampm = m[3]?.toLowerCase();
    if (h > 24 || minutes >= 60) return null;
    if (ampm?.startsWith("p") && h < 12) h += 12;
    if (ampm?.startsWith("a") && h === 12) h = 0;
    if (minutes !== 0) return null;
    return `${String(h).padStart(2, "0")}:00`;
}

const CANCEL_POLICIES = [
    "super_strict_60",
    "super_strict_30",
    "strict_or_non_refundable",
    "moderate_or_non_refundable",
    "flexible_or_non_refundable",
    "firm",
    "strict",
    "moderate",
    "flexible",
] as const;

/** Match staff text against Hostify's cancel_policy enum (combos first). */
function parseCancelPolicy(text: string): string | null {
    const t = text.trim().toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
    for (const policy of CANCEL_POLICIES) {
        const phrase = policy.replace(/_/g, " ");
        if (t.includes(phrase)) return policy;
    }
    // "Strict or non-refundable" style with punctuation stripped differently
    for (const base of ["strict", "moderate", "flexible"]) {
        if (new RegExp(`\\b${base}\\b.*non refundable`).test(t)) return `${base}_or_non_refundable`;
    }
    for (const base of ["firm", "strict", "moderate", "flexible"]) {
        if (new RegExp(`\\b${base}\\b`).test(t)) return base;
    }
    return null;
}

type Converter = (text: string) => { value: string | number } | { reason: string };

const inHourRange = (time: string, min: number, max: number) => {
    if (time === "flexible") return true;
    const h = Number(time.slice(0, 2));
    return h >= min && h <= max;
};

/** fact fieldKey → Hostify param + parser. Only entries here ever get pushed. */
const FIELD_MAP: Record<string, { param: string; convert: Converter }> = {
    check_in_time: {
        param: "checkin_start",
        convert: (text) => {
            const time = parseTime(text);
            if (!time) return { reason: "Couldn't read a whole-hour time (e.g. \"4 PM\" or \"16:00\")" };
            if (!inHourRange(time, 8, 25)) return { reason: `Hostify accepts check-in between 08:00 and 25:00 (got ${time})` };
            return { value: time };
        },
    },
    check_out_time: {
        param: "checkout",
        convert: (text) => {
            const time = parseTime(text);
            if (!time) return { reason: "Couldn't read a whole-hour time (e.g. \"11 AM\" or \"11:00\")" };
            if (!inHourRange(time, 0, 23)) return { reason: `Hostify accepts checkout between 00:00 and 23:00 (got ${time})` };
            return { value: time };
        },
    },
    cleaning_fee: {
        param: "cleaning_fee",
        convert: (text) => {
            const n = parseMoney(text);
            return n == null ? { reason: "Couldn't read a dollar amount" } : { value: Math.round(n) };
        },
    },
    pet_fee: {
        param: "pets_fee",
        convert: (text) => {
            const n = parseMoney(text);
            return n == null ? { reason: "Couldn't read a dollar amount" } : { value: n };
        },
    },
    extra_guest_fee: {
        param: "extra_person",
        convert: (text) => {
            const n = parseMoney(text);
            return n == null ? { reason: "Couldn't read a dollar amount" } : { value: Math.round(n) };
        },
    },
    deposit_direct: {
        param: "security_deposit",
        convert: (text) => {
            const n = parseMoney(text);
            return n == null ? { reason: "Couldn't read a dollar amount" } : { value: Math.round(n) };
        },
    },
    pets_allowed: {
        param: "pets_allowed",
        convert: (text) => {
            const v = parseYesNo(text);
            return v == null ? { reason: "Couldn't interpret as yes/no" } : { value: v };
        },
    },
    smoking: {
        param: "smoking_allowed",
        convert: (text) => {
            const v = parseYesNo(text);
            return v == null ? { reason: "Couldn't interpret as yes/no" } : { value: v };
        },
    },
    cancellation_policy: {
        param: "cancel_policy",
        convert: (text) => {
            const policy = parseCancelPolicy(text);
            return policy == null
                ? { reason: "Doesn't match a Hostify policy (strict, moderate, flexible, firm...)" }
                : { value: policy };
        },
    },
};

export function buildHostifyListingUpdate(factValues: Record<string, string>): {
    payload: Record<string, string | number>;
    mapped: MappedFact[];
    skipped: SkippedFact[];
} {
    const payload: Record<string, string | number> = {};
    const mapped: MappedFact[] = [];
    const skipped: SkippedFact[] = [];

    for (const [fieldKey, mapping] of Object.entries(FIELD_MAP)) {
        const factValue = factValues[fieldKey];
        if (!factValue) continue;
        const result = mapping.convert(factValue);
        if ("value" in result) {
            payload[mapping.param] = result.value;
            mapped.push({ fieldKey, label: factFieldLabel(fieldKey), factValue, param: mapping.param, value: result.value });
        } else {
            skipped.push({ fieldKey, label: factFieldLabel(fieldKey), factValue, reason: result.reason });
        }
    }

    return { payload, mapped, skipped };
}
