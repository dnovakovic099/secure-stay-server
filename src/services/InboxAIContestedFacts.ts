import { appDatabase } from "../utils/database.util";
import { Listing } from "../entity/Listing";
import { ListingIntake } from "../entity/ListingIntake";
import { ListingKnowledgeEntryEntity } from "../entity/ListingKnowledgeEntry";
import { AILearnedFactEntity } from "../entity/AILearnedFact";
import { ListingOpsOverrideService } from "./ListingOpsOverrideService";

export type ContestedField = "checkout_time" | "checkin_time" | "capacity";

export interface ContestedResolution {
    field: ContestedField;
    /** Guest-shareable value when safe to assert; null → must escalate / not assert. */
    value: string | null;
    source: string | null;
    conflict: boolean;
    note: string | null;
}

const STAFF_KB_SOURCES = new Set(["manual", "ai_suggested"]);

function fmtHour(v: any): string | null {
    if (v == null || v === "") return null;
    let n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n > 23) n = Math.floor(n / 100);
    if (n < 0 || n > 23) return null;
    const ampm = n >= 12 ? "PM" : "AM";
    return `${n % 12 === 0 ? 12 : n % 12}:00 ${ampm}`;
}

function normTimeToken(s: string | null | undefined): string | null {
    if (!s) return null;
    const m = String(s)
        .toLowerCase()
        .replace(/\./g, "")
        .match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
    if (!m) {
        const hourOnly = String(s).trim().match(/^(\d{1,2})$/);
        if (hourOnly) return fmtHour(Number(hourOnly[1]));
        return null;
    }
    return fmtHour(m[3] === "pm" && Number(m[1]) < 12 ? Number(m[1]) + 12 : m[3] === "am" && Number(m[1]) === 12 ? 0 : Number(m[1]));
}

function parseCheckoutFromText(text: string): string | null {
    const m =
        text.match(/check-?\s*out[^.\n]{0,40}?\b(?:by|at|is)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i) ||
        text.match(/check-?\s*out:\s*by\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    return m ? normTimeToken(m[1]) : null;
}

function parseCheckinFromText(text: string): string | null {
    const m =
        text.match(/check-?\s*in[^.\n]{0,40}?\b(?:from|at|is)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i) ||
        text.match(/check-?\s*in:\s*from\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    return m ? normTimeToken(m[1]) : null;
}

function parseCapacityFromText(text: string): string | null {
    const m =
        text.match(/sleeps up to\s+(\d{1,2})/i) ||
        text.match(/max(?:imum)?(?:\s+occupancy)?(?:\s+of)?\s+(\d{1,2})\s+guests?/i) ||
        text.match(/max guests?:\s*(\d{1,2})/i);
    return m ? m[1] : null;
}

/**
 * Resolve contested listing facts with staff/ops beating PMS.
 * Order: ops override → staff KB / learned facts → intake → listing_info.
 * If staff-tier and PMS-tier disagree → conflict (do not assert).
 */
export async function resolveContestedFacts(params: {
    listingIds: number[];
    canonicalListingId: number | null;
}): Promise<{ resolutions: ContestedResolution[]; promptBlock: string }> {
    const listingIds = params.listingIds.map(Number).filter((n) => Number.isFinite(n));
    const canon = params.canonicalListingId != null ? Number(params.canonicalListingId) : listingIds[0] || null;
    if (!canon && !listingIds.length) {
        return { resolutions: [], promptBlock: "" };
    }
    const ids = listingIds.length ? listingIds : canon ? [canon] : [];

    const overrides = await new ListingOpsOverrideService().getForListings(ids);
    const overrideByField = new Map<string, (typeof overrides)[0]>();
    for (const o of overrides) {
        // Prefer canonical listing's override when both exist.
        const prev = overrideByField.get(o.field);
        if (!prev || Number(o.listingId) === canon) overrideByField.set(o.field, o);
    }

    let listing: Listing | null = null;
    let intake: ListingIntake | null = null;
    try {
        if (canon) {
            listing = await appDatabase.getRepository(Listing).findOne({ where: { id: canon as any }, withDeleted: true });
            intake = await appDatabase
                .getRepository(ListingIntake)
                .createQueryBuilder("i")
                .where("i.listingId = :lid", { lid: canon })
                .orderBy("i.id", "DESC")
                .getOne();
        }
    } catch {
        /* non-fatal */
    }

    let kbRows: ListingKnowledgeEntryEntity[] = [];
    let facts: AILearnedFactEntity[] = [];
    try {
        kbRows = await appDatabase
            .getRepository(ListingKnowledgeEntryEntity)
            .createQueryBuilder("k")
            .where("k.listingId IN (:...ids)", { ids })
            .andWhere("k.isArchived = 0")
            .andWhere("k.visibility = 'external'")
            .getMany();
        facts = await appDatabase
            .getRepository(AILearnedFactEntity)
            .createQueryBuilder("f")
            .where("f.status = 'approved'")
            .andWhere("f.scope = 'property'")
            .andWhere("(f.visibility IS NULL OR f.visibility = 'external')")
            .andWhere("f.listingId IN (:...ids)", { ids })
            .getMany();
    } catch {
        /* non-fatal */
    }

    const staffKb = kbRows.filter((k) => STAFF_KB_SOURCES.has(String(k.source || "").toLowerCase()));
    const pmsKb = kbRows.filter((k) => !STAFF_KB_SOURCES.has(String(k.source || "").toLowerCase()));

    const staffCheckout =
        firstTruthy([
            ...staffKb.map((k) => parseCheckoutFromText(`${k.title || ""} ${k.content || ""}`)),
            ...facts.map((f) => parseCheckoutFromText(`${f.question || ""} ${f.answer || ""}`)),
        ]) || null;
    const staffCheckin =
        firstTruthy([
            ...staffKb.map((k) => parseCheckinFromText(`${k.title || ""} ${k.content || ""}`)),
            ...facts.map((f) => parseCheckinFromText(`${f.question || ""} ${f.answer || ""}`)),
        ]) || null;
    const staffCapacity =
        firstTruthy([
            ...staffKb.map((k) => parseCapacityFromText(`${k.title || ""} ${k.content || ""}`)),
            ...facts.map((f) => parseCapacityFromText(`${f.question || ""} ${f.answer || ""}`)),
        ]) || null;

    const intakeCheckout = fmtHour((intake as any)?.checkOutTime);
    const intakeCheckin = fmtHour((intake as any)?.checkInTimeStart);
    const intakeCapacity =
        (intake as any)?.personCapacity != null ? String((intake as any).personCapacity) : null;

    const pmsCheckout =
        fmtHour((listing as any)?.checkOutTime) ||
        firstTruthy(pmsKb.map((k) => parseCheckoutFromText(`${k.title || ""} ${k.content || ""}`)));
    const pmsCheckin =
        fmtHour((listing as any)?.checkInTimeStart) ||
        firstTruthy(pmsKb.map((k) => parseCheckinFromText(`${k.title || ""} ${k.content || ""}`)));
    const pmsCapacity =
        (listing as any)?.personCapacity != null
            ? String((listing as any).personCapacity)
            : firstTruthy(pmsKb.map((k) => parseCapacityFromText(`${k.title || ""} ${k.content || ""}`)));

    const resolutions: ContestedResolution[] = [
        resolveOne("checkout_time", overrideByField.get("checkout_time"), staffCheckout, intakeCheckout, pmsCheckout),
        resolveOne("checkin_time", overrideByField.get("checkin_time"), staffCheckin, intakeCheckin, pmsCheckin),
        resolveOne("capacity", overrideByField.get("capacity"), staffCapacity, intakeCapacity, pmsCapacity),
    ];

    const lines: string[] = [
        "## Contested listing facts (authority ladder — staff/ops beat PMS)",
        "Order: staff override → staff-written KB / approved property learned facts → listing intake → listing_info/Hostify seed.",
        "If sources CONFLICT, do NOT pick a side — say the team will confirm and set escalation_required=true.",
    ];
    for (const r of resolutions) {
        if (r.conflict) {
            lines.push(`- ${r.field}: CONFLICT — ${r.note}. Do NOT assert a specific value.`);
        } else if (r.value) {
            lines.push(`- ${r.field}: ${r.value} (source: ${r.source}) — you MAY state this.`);
        } else {
            lines.push(`- ${r.field}: unknown — do not invent; escalate if the guest asks.`);
        }
    }
    return { resolutions, promptBlock: lines.join("\n") };
}

function firstTruthy<T>(vals: (T | null | undefined)[]): T | null {
    for (const v of vals) if (v != null && v !== "") return v as T;
    return null;
}

function resolveOne(
    field: ContestedField,
    override: { status: string; value: string | null; note: string | null } | undefined,
    staff: string | null,
    intake: string | null,
    pms: string | null
): ContestedResolution {
    if (override?.status === "quarantined") {
        return {
            field,
            value: null,
            source: null,
            conflict: true,
            note: override.note || `${field} quarantined — do not use PMS value`,
        };
    }
    if (override?.status === "active" && override.value) {
        const v = field.includes("time") ? normTimeToken(override.value) || override.value : String(override.value);
        return { field, value: displayValue(field, v), source: "staff_override", conflict: false, note: override.note };
    }

    const staffPick = staff || intake;
    if (staffPick && pms && normalizeCompare(field, staffPick) !== normalizeCompare(field, pms)) {
        // Prefer staff tier when it exists and differs — but flag conflict so we escalate
        // rather than silently overriding guest-visible PMS listings without review.
        return {
            field,
            value: null,
            source: null,
            conflict: true,
            note: `staff/intake has ${staffPick} but PMS/listing has ${pms}`,
        };
    }
    if (staffPick) {
        return {
            field,
            value: displayValue(field, staffPick),
            source: staff ? "staff_kb_or_learned" : "listing_intake",
            conflict: false,
            note: null,
        };
    }
    if (pms) {
        return {
            field,
            value: displayValue(field, pms),
            source: "listing_info_or_hostify_seed",
            conflict: false,
            note: null,
        };
    }
    return { field, value: null, source: null, conflict: false, note: null };
}

function normalizeCompare(field: ContestedField, v: string): string {
    if (field.includes("time")) return (normTimeToken(v) || v).toLowerCase().replace(/\s+/g, "");
    return String(v).trim().toLowerCase();
}

function displayValue(field: ContestedField, v: string): string {
    if (field === "checkout_time") return `check-out by ${v}`;
    if (field === "checkin_time") return `check-in from ${v}`;
    if (field === "capacity") return `max guests ${v}`;
    return v;
}

/** Detect discretionary approvals / pre-arrival code leaks in a draft. */
export function detectUnsafeAsserts(reply: string, opts: { codesAllowed: boolean }): string[] {
    const text = String(reply || "");
    const hits: string[] = [];
    const discretionary =
        /\b(late|extended?)[\s-]*check[\s-]*out\b|\bearly[\s-]*check[\s-]*in\b|\bextension\b/i.test(text);
    if (discretionary) {
        if (
            /\b(yes[,.]?\s+you can|that (?:should |will )?work|i can (?:offer|arrange|approve)|you(?:'re| are) (?:approved|good|set) for|is possible since)\b/i.test(
                text
            )
        ) {
            hits.push("discretionary_approval");
        }
    }
    if (!opts.codesAllowed) {
        if (
            /\b(?:door|lock|gate|access|entry)\s*code\b[^.\n]{0,40}\b\d{3,}/i.test(text) ||
            /\bcode(?:\s+is|\s*:)\s*[A-Za-z0-9#-]{4,}\b/i.test(text) ||
            /\b\d{2,}[-–]\d{2,}(?:[-–]\d{2,})?\b/.test(text)
        ) {
            hits.push("prearrival_access_code");
        }
    }
    return hits;
}

export function guestReportsLockout(text: string): boolean {
    return /\b(lock(?:ed)?\s*out|can'?t get in|cannot get in|code (?:is )?(?:not )?work|door won'?t|won'?t (?:open|unlock)|access(?:\s+code)? (?:is )?(?:wrong|invalid|not working))\b/i.test(
        String(text || "")
    );
}

export function stayAllowsAccessCodes(stayStageLine: string | null): boolean {
    const s = String(stayStageLine || "");
    return /CHECK-IN IS TODAY|MID-STAY|CHECKOUT IS TODAY/i.test(s);
}
