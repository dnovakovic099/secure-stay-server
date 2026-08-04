import { factFieldLabel } from "../config/propertyFactFields";

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

export type HostifyField = {
    param: string;
    type: "money" | "select";
    options?: readonly string[];
    integer?: boolean;
};

export interface HostifyFactConflict {
    fieldKey: string;
    label: string;
    param: string;
    secureStayValue: string;
    hostifyValue: string;
}

const CHECK_IN_TIMES = [
    ...Array.from({ length: 18 }, (_, i) => `${String(i + 8).padStart(2, "0")}:00`),
    "flexible",
] as const;
const CHECK_OUT_TIMES = [
    ...Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`),
    "flexible",
] as const;
const CANCELLATION_POLICIES = [
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

/** Only entries in this catalog can be sent to Hostify. */
export const HOSTIFY_FACT_FIELDS: Record<string, HostifyField> = {
    check_in_time: { param: "checkin_start", type: "select", options: CHECK_IN_TIMES },
    check_out_time: { param: "checkout", type: "select", options: CHECK_OUT_TIMES },
    cleaning_fee: { param: "cleaning_fee", type: "money", integer: true },
    pet_fee: { param: "pets_fee", type: "money" },
    extra_guest_fee: { param: "extra_person", type: "money", integer: true },
    deposit_direct: { param: "security_deposit", type: "money", integer: true },
    pets_allowed: { param: "pets_allowed", type: "select", options: ["1", "0"] },
    smoking: { param: "smoking_allowed", type: "select", options: ["1", "0"] },
    cancellation_policy: { param: "cancel_policy", type: "select", options: CANCELLATION_POLICIES },
};

export function normalizeHostifyActualValue(fieldKey: string, raw: unknown): string | null {
    if (raw == null || String(raw).trim() === "") return null;
    const config = HOSTIFY_FACT_FIELDS[fieldKey];
    if (!config) return null;
    if (config.type === "money") {
        const value = Number(raw);
        return Number.isFinite(value) && value >= 0 ? String(value) : null;
    }
    if (fieldKey === "check_in_time" || fieldKey === "check_out_time") {
        if (String(raw).toLowerCase() === "flexible") return "flexible";
        const match = String(raw).match(/^(\d{1,2}):/);
        if (match) return `${String(Number(match[1])).padStart(2, "0")}:00`;
        const hour = Number(raw);
        if (Number.isInteger(hour) && hour >= 0 && hour <= 25) return `${String(hour).padStart(2, "0")}:00`;
        return null;
    }
    if (fieldKey === "pets_allowed" || fieldKey === "smoking") {
        if (raw === true || String(raw).toLowerCase() === "true") return "1";
        if (raw === false || String(raw).toLowerCase() === "false") return "0";
    }
    return String(raw).trim();
}

export function findHostifyFactConflicts(
    facts: Array<{ fieldKey: string; hostifyValue: string | null }>,
    hostifyListing: Record<string, unknown>
): HostifyFactConflict[] {
    const conflicts: HostifyFactConflict[] = [];
    for (const fact of facts) {
        const config = HOSTIFY_FACT_FIELDS[fact.fieldKey];
        if (!config || !fact.hostifyValue?.trim()) continue;
        const secureStayValue = validateHostifyFactValue(fact.fieldKey, fact.hostifyValue);
        if (!Object.prototype.hasOwnProperty.call(hostifyListing || {}, config.param)) continue;
        const hostifyValue = normalizeHostifyActualValue(fact.fieldKey, hostifyListing?.[config.param]);
        if (secureStayValue != null && secureStayValue !== (hostifyValue ?? "")) {
            conflicts.push({
                fieldKey: fact.fieldKey,
                label: factFieldLabel(fact.fieldKey),
                param: config.param,
                secureStayValue,
                hostifyValue: hostifyValue ?? "",
            });
        }
    }
    return conflicts;
}

export function validateHostifyFactValue(fieldKey: string, raw: unknown): string | null {
    const config = HOSTIFY_FACT_FIELDS[fieldKey];
    if (!config) {
        if (raw == null || String(raw).trim() === "") return null;
        throw new Error(`${factFieldLabel(fieldKey)} does not map to Hostify`);
    }
    if (raw == null || String(raw).trim() === "") return null;
    const value = String(raw).trim();
    if (config.type === "select") {
        if (!config.options?.includes(value)) {
            throw new Error(`Invalid Hostify value for ${factFieldLabel(fieldKey)}`);
        }
        return value;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new Error(`${factFieldLabel(fieldKey)} must be a non-negative amount`);
    }
    if (config.integer && !Number.isInteger(number)) {
        throw new Error(`${factFieldLabel(fieldKey)} must be a whole-dollar amount`);
    }
    return String(number);
}

/** Human-readable form supplied to the guest AI alongside staff notes. */
export function formatHostifyFactValueForAI(fieldKey: string, value: string): string {
    if (["cleaning_fee", "pet_fee", "extra_guest_fee", "deposit_direct"].includes(fieldKey)) {
        return `$${value}`;
    }
    if (fieldKey === "pets_allowed") return value === "1" ? "Yes — pets allowed" : "No — pets not allowed";
    if (fieldKey === "smoking") return value === "1" ? "Yes — smoking allowed" : "No — smoking not allowed";
    if (fieldKey === "cancellation_policy") return value.replace(/_/g, " ");
    return value;
}

export function buildHostifyListingUpdate(hostifyValues: Record<string, string>): {
    payload: Record<string, string | number>;
    mapped: MappedFact[];
    skipped: SkippedFact[];
} {
    const payload: Record<string, string | number> = {};
    const mapped: MappedFact[] = [];
    const skipped: SkippedFact[] = [];

    for (const [fieldKey, config] of Object.entries(HOSTIFY_FACT_FIELDS)) {
        const raw = hostifyValues[fieldKey];
        if (!raw) continue;
        try {
            const normalized = validateHostifyFactValue(fieldKey, raw);
            if (normalized == null) continue;
            const value = config.type === "money" || normalized === "1" || normalized === "0"
                ? Number(normalized)
                : normalized;
            payload[config.param] = value;
            mapped.push({ fieldKey, label: factFieldLabel(fieldKey), factValue: raw, param: config.param, value });
        } catch (error: any) {
            skipped.push({
                fieldKey,
                label: factFieldLabel(fieldKey),
                factValue: raw,
                reason: error?.message || "Invalid Hostify value",
            });
        }
    }

    return { payload, mapped, skipped };
}
