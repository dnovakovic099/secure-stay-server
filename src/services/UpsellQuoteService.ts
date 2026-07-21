import { appDatabase } from "../utils/database.util";

export type SdtoStatus = "not_allowed" | "needs_confirmation" | "allowed" | "unknown";
export type UpsellAutoRespond = "deny" | "escalate" | "quote";

export interface UpsellQuoteInput {
    listingId: number;
    /** Optional group siblings for fee fallback when the conversation listing has no config. */
    groupListingIds?: number[];
    nights?: number | null;
    hours?: number | null;
    quantity?: number | null;
    checkin?: string | null;
    checkout?: string | null;
}

export interface UpsellQuote {
    upSellId: number;
    title: string;
    sdtoRaw: string | null;
    sdto: SdtoStatus;
    chargeType: string | null;
    rateConfiguration: string | null;
    guestFee: number | null;
    unitLabel: string | null;
    breakdown: string[];
    autoRespond: UpsellAutoRespond;
    description: string | null;
    isEarlyCheckin: boolean;
    isLateCheckout: boolean;
}

interface PricingRule {
    id: string;
    start: string;
    end: string;
    rate: string;
}

interface FeeConstraints {
    minimumFeeEnabled: boolean;
    minimumFee: string;
    maximumFeeEnabled: boolean;
    maximumFee: string;
}

const DEFAULT_PROCESSING_FEE = 3;
const DEFAULT_RATE_RULES: PricingRule[] = [
    { id: "rule-1", start: "1", end: "2", rate: "70" },
    { id: "rule-2", start: "3", end: "5", rate: "60" },
    { id: "rule-3", start: "6", end: "10", rate: "50" },
    { id: "rule-4", start: "11", end: "", rate: "40" },
];

const toNumber = (value: any): number => {
    if (value === null || value === undefined || value === "") return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

const roundToTwo = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeText = (value: any) => String(value || "").trim();

const money = (n: number) => `$${roundToTwo(n).toFixed(2)}`;

export function normalizeSdto(raw: string | null | undefined): SdtoStatus {
    const v = String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
    if (!v) return "unknown";
    if (v === "not allowed" || v === "disallowed" || v === "no" || v === "denied") return "not_allowed";
    if (
        v === "need confirmation" ||
        v === "needs confirmation" ||
        v === "needs confirm" ||
        v === "confirmation needed" ||
        v === "confirm with team" ||
        v === "confirm with rep" ||
        v === "confirm with reps"
    ) {
        return "needs_confirmation";
    }
    // Product rule: anything else (including "Allowed" and custom text) = allowed.
    return "allowed";
}

export function nightCountFromStay(
    checkin?: string | null,
    checkout?: string | null,
    nightsHint?: number | null
): number {
    if (nightsHint != null && Number.isFinite(Number(nightsHint)) && Number(nightsHint) > 0) {
        return Math.max(1, Math.floor(Number(nightsHint)));
    }
    if (!checkin || !checkout) return 0;
    const a = new Date(`${String(checkin).slice(0, 10)}T12:00:00Z`);
    const b = new Date(`${String(checkout).slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
    const days = Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
    return days > 0 ? days : 0;
}

function parsePricingRules(value: string | null | undefined): PricingRule[] {
    if (!value) return DEFAULT_RATE_RULES.map((r) => ({ ...r }));
    try {
        const parsed = JSON.parse(value);
        const sourceRules = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rules) ? parsed.rules : [];
        if (!sourceRules.length) return DEFAULT_RATE_RULES.map((r) => ({ ...r }));
        const rules = sourceRules
            .map((rule: any, index: number) => ({
                id: String(rule?.id || `rule-${index + 1}`),
                start: String(rule?.start || ""),
                end: String(rule?.end || ""),
                rate: String(rule?.rate || ""),
            }))
            .filter((rule: PricingRule) => normalizeText(rule.start) && normalizeText(rule.rate));
        return rules.length ? rules : DEFAULT_RATE_RULES.map((r) => ({ ...r }));
    } catch {
        return DEFAULT_RATE_RULES.map((r) => ({ ...r }));
    }
}

function parseFeeConstraints(value: string | null | undefined): FeeConstraints {
    const empty = {
        minimumFeeEnabled: false,
        minimumFee: "",
        maximumFeeEnabled: false,
        maximumFee: "",
    };
    if (!value) return empty;
    try {
        const parsed = JSON.parse(value);
        const constraints = Array.isArray(parsed) ? null : parsed?.constraints;
        return {
            minimumFeeEnabled: Boolean(constraints?.minimumFeeEnabled),
            minimumFee: String(constraints?.minimumFee || ""),
            maximumFeeEnabled: Boolean(constraints?.maximumFeeEnabled),
            maximumFee: String(constraints?.maximumFee || ""),
        };
    } catch {
        return empty;
    }
}

function applyFeeConstraints(calculatedFee: number, constraints: FeeConstraints) {
    const minimumFee =
        constraints.minimumFeeEnabled && normalizeText(constraints.minimumFee)
            ? toNumber(constraints.minimumFee)
            : null;
    const maximumFee =
        constraints.maximumFeeEnabled && normalizeText(constraints.maximumFee)
            ? toNumber(constraints.maximumFee)
            : null;
    let finalFee = calculatedFee;
    if (minimumFee !== null && finalFee < minimumFee) finalFee = minimumFee;
    if (maximumFee !== null && finalFee > maximumFee) finalFee = maximumFee;
    return { finalFee, minimumFee, maximumFee };
}

function computeUpsellFee({
    actualFee,
    pmFee,
    processingFee = DEFAULT_PROCESSING_FEE,
    tax = 0,
    taxable = false,
}: {
    actualFee: number;
    pmFee: number;
    processingFee?: number;
    tax?: number;
    taxable?: boolean;
}) {
    const actual = toNumber(actualFee);
    const managementFee = toNumber(pmFee) / 100;
    const processing = toNumber(processingFee) / 100;
    const taxAmount = taxable ? actual * (toNumber(tax) / 100) : 0;
    const managementAdjusted = actual + actual * managementFee;
    return roundToTwo(managementAdjusted + managementAdjusted * processing + taxAmount);
}

function normalizeRateConfiguration(raw: string): string {
    const v = String(raw || "").trim().toLowerCase();
    if (v.includes("length") || v === "los") return "Length of Stay";
    if (v.includes("tier")) return "Tiered Pricing";
    if (v.includes("special")) return "Special Rate";
    return "Fixed Rate";
}

function normalizeChargeTypeKey(chargeType: string): string {
    return String(chargeType || "")
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ");
}

function getRuleLabel(rule: PricingRule) {
    return `${rule.start}${rule.end ? `-${rule.end}` : "+"} nights`;
}

function classifyTitle(title: string): { isEarlyCheckin: boolean; isLateCheckout: boolean } {
    const t = title.toLowerCase();
    return {
        isEarlyCheckin: /early/.test(t) && /check/.test(t),
        isLateCheckout: /late/.test(t) && /check/.test(t),
    };
}

function calculateGuestFee(row: any, nights: number, hours?: number | null, quantity?: number | null): {
    guestFee: number | null;
    unitLabel: string | null;
    breakdown: string[];
    needsUnits: boolean;
} {
    const rateConfiguration = normalizeRateConfiguration(String(row.rateConfiguration || "Fixed Rate"));
    const chargeType = String(row.chargeType || row.timePeriod || "Per Stay");
    const chargeTypeKey = normalizeChargeTypeKey(chargeType);
    const pmFee = toNumber(row.pmFee);
    const processingFee = toNumber(row.processingFee ?? DEFAULT_PROCESSING_FEE);
    const taxable = Boolean(row.taxable);
    const tax = taxable ? toNumber(row.taxRate) : 0;
    const rules = parsePricingRules(row.pricingRules);
    const constraints = parseFeeConstraints(row.pricingRules);
    const breakdown: string[] = [];
    let actualFee = 0;
    let units = 1;
    let unitLabel = "1 stay";
    let needsUnits = false;

    if (rateConfiguration === "Special Rate") {
        return {
            guestFee: null,
            unitLabel: "Special Rate",
            breakdown: ["Special Rate — team sets the fee manually; do not invent a price."],
            needsUnits: true,
        };
    }

    if (rateConfiguration === "Length of Stay") {
        const calcUnits =
            chargeTypeKey === "per hour"
                ? hours && hours > 0
                    ? hours
                    : 0
                : chargeTypeKey === "per quantity"
                  ? quantity && quantity > 0
                      ? quantity
                      : 0
                  : nights;
        if (!calcUnits) {
            needsUnits = true;
            return {
                guestFee: null,
                unitLabel: null,
                breakdown: [
                    chargeTypeKey === "per hour"
                        ? "Need hours to calculate this Length-of-Stay fee."
                        : "Need stay nights to calculate this Length-of-Stay fee.",
                ],
                needsUnits: true,
            };
        }
        const rule =
            rules.find((item) => {
                const start = Math.max(1, toNumber(item.start));
                const end = normalizeText(item.end) ? toNumber(item.end) : Number.POSITIVE_INFINITY;
                return calcUnits >= start && calcUnits <= end;
            }) || rules[rules.length - 1];
        const rate = toNumber(rule?.rate);
        actualFee = calcUnits * rate;
        const rateUnit = chargeTypeKey === "per hour" ? "hour" : chargeTypeKey === "per quantity" ? "item" : "night";
        breakdown.push(
            `${calcUnits} × ${money(rate)}/${rateUnit} (${rule ? getRuleLabel(rule) : "LOS"}) = ${money(actualFee)}`
        );
        units = calcUnits;
        unitLabel = `${units} ${rateUnit}${units === 1 ? "" : "s"}`;
    } else if (rateConfiguration === "Tiered Pricing") {
        const calcUnits =
            chargeTypeKey === "per hour"
                ? hours && hours > 0
                    ? hours
                    : 0
                : chargeTypeKey === "per quantity"
                  ? quantity && quantity > 0
                      ? quantity
                      : 0
                  : nights;
        if (!calcUnits) {
            return {
                guestFee: null,
                unitLabel: null,
                breakdown: ["Need stay nights (or hours) to calculate this tiered fee."],
                needsUnits: true,
            };
        }
        for (const rule of rules) {
            const start = Math.max(1, toNumber(rule.start));
            const end = normalizeText(rule.end) ? toNumber(rule.end) : Number.POSITIVE_INFINITY;
            if (calcUnits < start) continue;
            const applied = Math.max(0, Math.min(calcUnits, end) - start + 1);
            if (!applied) continue;
            const lineAmount = applied * toNumber(rule.rate);
            actualFee += lineAmount;
            breakdown.push(
                `${applied} × ${money(toNumber(rule.rate))} (${getRuleLabel(rule)}) = ${money(lineAmount)}`
            );
        }
        units = calcUnits;
        unitLabel = `${units} night${units === 1 ? "" : "s"}`;
    } else {
        // Fixed Rate
        const unitActual = toNumber(row.actualFee ?? row.basePrice);
        if (chargeType === "Per Night" || chargeTypeKey === "per night") {
            if (!nights) {
                return {
                    guestFee: null,
                    unitLabel: null,
                    breakdown: ["Need stay nights to calculate Per Night fee."],
                    needsUnits: true,
                };
            }
            units = nights;
            unitLabel = `${nights} night${nights === 1 ? "" : "s"}`;
            actualFee = unitActual * units;
            breakdown.push(`${money(unitActual)} × ${unitLabel} = ${money(actualFee)}`);
        } else if (chargeType === "Per Week" || chargeTypeKey === "per week") {
            if (!nights) {
                return {
                    guestFee: null,
                    unitLabel: null,
                    breakdown: ["Need stay nights to calculate Per Week fee."],
                    needsUnits: true,
                };
            }
            units = Math.max(1, Math.ceil(nights / 7));
            unitLabel = `${units} week${units === 1 ? "" : "s"}`;
            actualFee = unitActual * units;
            breakdown.push(`${money(unitActual)} × ${unitLabel} = ${money(actualFee)}`);
        } else if (chargeTypeKey === "per hour") {
            if (!hours || hours <= 0) {
                // For early/late, stored upsellFee is often the full guest price for the standard offer.
                const stored = toNumber(row.listingFee ?? row.upsellFee);
                if (stored > 0) {
                    return {
                        guestFee: roundToTwo(stored),
                        unitLabel: "fixed listed fee",
                        breakdown: [`Listed guest fee ${money(stored)} (hours not specified — use listed fee).`],
                        needsUnits: false,
                    };
                }
                return {
                    guestFee: null,
                    unitLabel: null,
                    breakdown: ["Need hours to calculate Per Hour fee."],
                    needsUnits: true,
                };
            }
            units = hours;
            unitLabel = `${hours} hour${hours === 1 ? "" : "s"}`;
            actualFee = unitActual * units;
            breakdown.push(`${money(unitActual)} × ${unitLabel} = ${money(actualFee)}`);
        } else {
            // Per Stay / default — prefer stored guest-facing upsellFee when present.
            const stored = toNumber(row.listingFee ?? row.upsellFee);
            if (stored > 0) {
                return {
                    guestFee: roundToTwo(stored),
                    unitLabel: "per stay",
                    breakdown: [`Listed guest fee ${money(stored)}.`],
                    needsUnits: false,
                };
            }
            units = 1;
            unitLabel = "per stay";
            actualFee = unitActual;
            breakdown.push(`Fixed rate = ${money(actualFee)}`);
        }
    }

    const calculated = computeUpsellFee({ actualFee, pmFee, processingFee, tax, taxable });
    const constrained = applyFeeConstraints(calculated, constraints);

    // Prefer stored Fixed Rate upsellFee when units === 1 (matches order form).
    const hasStoredFixed =
        rateConfiguration === "Fixed Rate" &&
        units === 1 &&
        row.listingFee != null &&
        toNumber(row.listingFee) > 0;
    const guestFee = hasStoredFixed ? roundToTwo(toNumber(row.listingFee)) : constrained.finalFee;
    if (constrained.minimumFee != null && constrained.finalFee === constrained.minimumFee) {
        breakdown.push(`Minimum fee applied → ${money(constrained.finalFee)}`);
    }
    if (constrained.maximumFee != null && constrained.finalFee === constrained.maximumFee) {
        breakdown.push(`Maximum fee applied → ${money(constrained.finalFee)}`);
    }
    breakdown.push(`Guest pays ${money(guestFee)} (incl. PM/processing).`);

    return { guestFee, unitLabel, breakdown, needsUnits };
}

/**
 * Load and quote upsells for a listing from the Upsells page database
 * (upsell_info + upsell_property_config), including LOS calculation and SDTO.
 */
export class UpsellQuoteService {
    async listQuotesForListing(input: UpsellQuoteInput): Promise<UpsellQuote[]> {
        const listingId = Number(input.listingId);
        if (!Number.isFinite(listingId) || listingId <= 0) return [];

        const groupIds = Array.from(
            new Set(
                [listingId, ...(input.groupListingIds || []).map(Number)].filter(
                    (n) => Number.isFinite(n) && n > 0
                )
            )
        );
        const nights = nightCountFromStay(input.checkin, input.checkout, input.nights);
        const ph = groupIds.map(() => "?").join(",");

        const rows: any[] = await appDatabase.query(
            `SELECT ui.upsell_id AS upSellId, ui.title, ui.timePeriod, ui.availability, ui.description,
                    ui.price AS basePrice, ul.listingId,
                    upc.upsellFee AS listingFee, upc.actualFee, upc.pmFee, upc.processingFee,
                    upc.chargeType, upc.rateConfiguration, upc.pricingRules, upc.taxable, upc.sdto,
                    upc.internalNotes
             FROM upsell_listing ul
             JOIN upsell_info ui ON ui.upsell_id = ul.upSellId AND ui.isActive = 1
             LEFT JOIN upsell_property_config upc
                    ON upc.upSellId = ul.upSellId AND upc.listingId = ul.listingId
             WHERE ul.status = 1 AND ul.listingId IN (${ph})
             ORDER BY ui.title ASC, (ul.listingId = ?) DESC`,
            [...groupIds, listingId]
        );

        // Prefer the conversation listing's config row per upsell.
        const byUpsell = new Map<number, any>();
        for (const r of rows) {
            const id = Number(r.upSellId);
            if (!Number.isFinite(id)) continue;
            const existing = byUpsell.get(id);
            if (!existing) {
                byUpsell.set(id, r);
                continue;
            }
            // Prefer exact listing match over sibling.
            if (Number(r.listingId) === listingId && Number(existing.listingId) !== listingId) {
                byUpsell.set(id, r);
            }
        }

        const quotes: UpsellQuote[] = [];
        for (const r of byUpsell.values()) {
            const title = String(r.title || "").trim();
            if (!title) continue;
            const { isEarlyCheckin, isLateCheckout } = classifyTitle(title);
            const sdto = normalizeSdto(r.sdto);
            const calc = calculateGuestFee(r, nights, input.hours, input.quantity);

            let autoRespond: UpsellAutoRespond = "escalate";
            if (sdto === "not_allowed") autoRespond = "deny";
            else if (sdto === "needs_confirmation" || sdto === "unknown") autoRespond = "escalate";
            else if (calc.needsUnits || calc.guestFee == null) autoRespond = "escalate";
            else autoRespond = "quote";

            quotes.push({
                upSellId: Number(r.upSellId),
                title,
                sdtoRaw: r.sdto != null ? String(r.sdto) : null,
                sdto,
                chargeType: r.chargeType || r.timePeriod || null,
                rateConfiguration: r.rateConfiguration || "Fixed Rate",
                guestFee: calc.guestFee,
                unitLabel: calc.unitLabel,
                breakdown: calc.breakdown,
                autoRespond,
                description: r.description ? String(r.description).replace(/\s+/g, " ").trim() : null,
                isEarlyCheckin,
                isLateCheckout,
            });
        }
        return quotes;
    }

    /** Build the prompt block + assertable facts for Inbox AI. */
    formatForPrompt(quotes: UpsellQuote[]): { text: string | null; facts: any[] } {
        if (!quotes.length) return { text: null, facts: [] };

        const facts: any[] = [];
        const lines: string[] = [];

        for (const q of quotes) {
            if (q.sdto === "not_allowed") {
                lines.push(
                    `- ${q.title}: NOT ALLOWED (SDTO). Tell the guest standard check-in/out / service is not available. Do NOT quote a fee. Do NOT escalate unless they push back angrily.`
                );
                facts.push({
                    id: `upsell_${q.upSellId}`,
                    assertWhen: "always",
                    assertText: `${q.title} is NOT ALLOWED for this property.`,
                    policyText: `${q.title}: deny — not offered.`,
                    kind: q.isEarlyCheckin || q.isLateCheckout ? "discretionary_upsell" : "upsell",
                });
                continue;
            }

            if (q.sdto === "needs_confirmation" || q.autoRespond === "escalate") {
                const why =
                    q.sdto === "needs_confirmation"
                        ? "SDTO = Needs Confirmation"
                        : q.guestFee == null
                          ? "price needs calculation inputs / special rate"
                          : "needs team confirmation";
                lines.push(
                    `- ${q.title}: NEEDS HUMAN CONFIRMATION (${why}). Acknowledge the ask. Do NOT invent or quote a firm price. Set escalation_required=true.`
                );
                facts.push({
                    id: `upsell_${q.upSellId}`,
                    assertWhen: "policy_only",
                    assertText: `${q.title}: escalate to team — do not auto-quote.`,
                    policyText: `${q.title}: needs confirmation — escalate.`,
                    kind: q.isEarlyCheckin || q.isLateCheckout ? "discretionary_upsell" : "upsell",
                });
                continue;
            }

            // Allowed — quote calculated price
            const feeBit =
                q.guestFee != null
                    ? `${money(q.guestFee)}${q.unitLabel ? ` (${q.unitLabel})` : ""}`
                    : "price on request";
            const rateBit =
                q.rateConfiguration && q.rateConfiguration !== "Fixed Rate"
                    ? `; rate=${q.rateConfiguration}`
                    : "";
            const chargeBit = q.chargeType ? `; ${q.chargeType}` : "";
            const calcBit = q.breakdown.length ? ` [${q.breakdown.join("; ")}]` : "";
            const desc = q.description ? ` — ${q.description.slice(0, 140)}` : "";
            lines.push(
                `- ${q.title}: ALLOWED — guest fee ${feeBit}${chargeBit}${rateBit}.${calcBit}${desc} You MAY quote this fee and say it is subject to availability. Do NOT approve a specific clock time unless a TEAM message already did. escalation_required=false for a simple fee quote.`
            );
            facts.push({
                id: `upsell_${q.upSellId}`,
                assertWhen: "fee_quote_ok",
                assertText: `${q.title} guest fee is ${feeBit} — quoteable; subject to availability (do not approve a specific time).`,
                policyText: `${q.title}: quote listed/calculated fee; do not invent.`,
                kind: q.isEarlyCheckin || q.isLateCheckout ? "discretionary_upsell" : "upsell",
            });
        }

        return {
            facts,
            text: [
                "## Available paid services (from Upsells database — SDTO governs auto-respond)",
                "SDTO rules (STRICT):",
                "1. NOT ALLOWED → tell guest it is not available. No fee. No escalate (unless angry).",
                "2. NEEDS CONFIRMATION → acknowledge + escalate to team. Do NOT quote a firm price.",
                "3. ALLOWED (or any other SDTO) → quote the calculated guest fee below. Subject to availability. Do NOT approve a specific clock time unless a TEAM message already confirmed it.",
                "Use ONLY these services. Never invent add-ons or fees not listed here.",
                "LOS / Length of Stay fees below are already calculated for THIS reservation's night count when nights are known.",
                ...lines,
            ].join("\n"),
        };
    }
}
