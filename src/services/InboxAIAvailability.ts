/**
 * Availability helpers for Inbox AI.
 *
 * Hostify live calendar is primary. Our reservation_info DB is a backup /
 * conflict check so we don't claim nights open when a synced booking exists
 * (or when Hostify returns nothing for far-out dates the guest named).
 */

export type CalendarDayStatus = "available" | "booked" | "blocked" | "unknown";

export type CalendarDay = {
    date: string; // YYYY-MM-DD
    status: CalendarDayStatus;
    price?: number | null;
    currency?: string | null;
    source: "hostify" | "db" | "merged";
    note?: string;
};

export type DateWindow = {
    from: string;
    to: string;
    label: string;
};

const MONTHS: Record<string, number> = {
    january: 0,
    jan: 0,
    february: 1,
    feb: 1,
    march: 2,
    mar: 2,
    april: 3,
    apr: 3,
    may: 4,
    june: 5,
    jun: 5,
    july: 6,
    jul: 6,
    august: 7,
    aug: 7,
    september: 8,
    sept: 8,
    sep: 8,
    october: 9,
    oct: 9,
    november: 10,
    nov: 10,
    december: 11,
    dec: 11,
};

/** Statuses that occupy calendar nights in our DB. */
export const BLOCKING_RESERVATION_STATUSES = [
    "accepted",
    "modified",
    "confirmed",
    "ownerStay",
    "new",
];

export function toDateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
}

export function addDaysKey(key: string, days: number): string {
    const d = new Date(`${key}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return toDateKey(d);
}

export function daysBetweenKeys(from: string, to: string): number {
    const a = new Date(`${from}T00:00:00.000Z`).getTime();
    const b = new Date(`${to}T00:00:00.000Z`).getTime();
    return Math.round((b - a) / 86400000);
}

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

function ymd(y: number, m0: number, day: number): string {
    return `${y}-${pad2(m0 + 1)}-${pad2(day)}`;
}

function lastDayOfMonth(y: number, m0: number): number {
    return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

function inferYear(month0: number, explicitYear: number | null, today: Date): number {
    if (explicitYear != null && Number.isFinite(explicitYear)) return explicitYear;
    const y = today.getUTCFullYear();
    const tm = today.getUTCMonth();
    // If the named month is more than ~1 month behind current month, assume next year.
    if (month0 + 1 < tm) return y + 1;
    return y;
}

/**
 * Pull named months / explicit date ranges from the guest message so we can
 * expand the Hostify fetch past the default near-term horizon.
 */
export function parseGuestDateWindows(text: string, today: Date = new Date()): DateWindow[] {
    const t = String(text || "");
    if (!t.trim()) return [];
    const out: DateWindow[] = [];
    const seen = new Set<string>();
    const push = (from: string, to: string, label: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
        if (from > to) return;
        const key = `${from}:${to}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ from, to, label });
    };

    // "October 8 to 11, 2027" / "October 8-10 2027" / "Oct 8 – 11, 2027"
    const monthRangeRe =
        /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|through|thru|-|–|—)\s*(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/gi;
    let m: RegExpExecArray | null;
    while ((m = monthRangeRe.exec(t))) {
        const month0 = MONTHS[m[1].toLowerCase()];
        if (month0 == null) continue;
        const y = inferYear(month0, m[4] ? Number(m[4]) : null, today);
        const d1 = Number(m[2]);
        const d2 = Number(m[3]);
        push(ymd(y, month0, d1), ymd(y, month0, d2), `${m[1]} ${d1}-${d2}, ${y}`);
    }

    // "October 8, 2027" / "Oct 8 2027"
    const singleMonthDayRe =
        /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))\b/gi;
    while ((m = singleMonthDayRe.exec(t))) {
        const month0 = MONTHS[m[1].toLowerCase()];
        if (month0 == null) continue;
        const y = Number(m[3]);
        const d = Number(m[2]);
        push(ymd(y, month0, d), ymd(y, month0, d), `${m[1]} ${d}, ${y}`);
    }

    // "month of August" / "all of August" / "for August" / "in August" / "availability for August"
    // Require a date-ish prefix so English "may"/"march" verbs don't false-trigger.
    const monthOnlyRe =
        /\b(?:(?:month|all|entire|whole)\s+of\s+|for\s+(?:the\s+)?(?:month\s+of\s+)?|availability\s+(?:for|in)\s+|in\s+)(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/gi;
    while ((m = monthOnlyRe.exec(t))) {
        const after = t.slice(m.index + m[0].length, m.index + m[0].length + 4);
        if (/^\s+\d{1,2}\b/.test(after) && !m[2]) continue;
        const month0 = MONTHS[m[1].toLowerCase()];
        if (month0 == null) continue;
        const y = inferYear(month0, m[2] ? Number(m[2]) : null, today);
        const last = lastDayOfMonth(y, month0);
        push(ymd(y, month0, 1), ymd(y, month0, last), `${m[1]} ${y}`);
    }

    // "August 2026" / "October 2027" (month + year, no day)
    const monthYearRe =
        /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/gi;
    while ((m = monthYearRe.exec(t))) {
        const month0 = MONTHS[m[1].toLowerCase()];
        if (month0 == null) continue;
        const y = Number(m[2]);
        const last = lastDayOfMonth(y, month0);
        push(ymd(y, month0, 1), ymd(y, month0, last), `${m[1]} ${y}`);
    }

    // Numeric: 10/8/2027 - 10/11/2027 or 2027-10-08 to 2027-10-11
    const isoRangeRe =
        /\b(\d{4}-\d{2}-\d{2})\s*(?:to|through|thru|-|–|—)\s*(\d{4}-\d{2}-\d{2})\b/gi;
    while ((m = isoRangeRe.exec(t))) {
        push(m[1], m[2], `${m[1]} → ${m[2]}`);
    }

    const usRangeRe =
        /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:to|through|thru|-|–|—)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/gi;
    while ((m = usRangeRe.exec(t))) {
        const y1raw = m[3] ? Number(m[3]) : today.getUTCFullYear();
        const y2raw = m[6] ? Number(m[6]) : y1raw;
        const y1 = y1raw < 100 ? 2000 + y1raw : y1raw;
        const y2 = y2raw < 100 ? 2000 + y2raw : y2raw;
        push(ymd(y1, Number(m[1]) - 1, Number(m[2])), ymd(y2, Number(m[4]) - 1, Number(m[5])), m[0]);
    }

    return out;
}

export function computeCalendarFetchWindow(input: {
    today?: Date;
    defaultHorizonDays?: number;
    checkout?: string | Date | null;
    guestText?: string;
    maxHorizonDays?: number;
}): { start: string; end: string; guestWindows: DateWindow[] } {
    const today = input.today || new Date();
    const horizon = input.defaultHorizonDays ?? 45;
    const maxHorizon = input.maxHorizonDays ?? 730;
    const todayKey = toDateKey(today);
    let start = todayKey;
    let end = addDaysKey(todayKey, horizon);

    if (input.checkout) {
        const co = new Date(input.checkout as any);
        if (!isNaN(co.getTime())) {
            const past = addDaysKey(toDateKey(co), 14);
            if (past > end) end = past;
        }
    }

    const guestWindows = parseGuestDateWindows(input.guestText || "", today);
    for (const w of guestWindows) {
        // Pad a few days so adjacent nights are visible.
        const from = addDaysKey(w.from, -2);
        const to = addDaysKey(w.to, 2);
        if (from < start) start = from;
        if (to > end) end = to;
    }

    // Never fetch more than maxHorizon from today (Hostify + prompt size).
    const hardEnd = addDaysKey(todayKey, maxHorizon);
    if (end > hardEnd) end = hardEnd;
    // Don't start absurdly far in the past.
    const hardStart = addDaysKey(todayKey, -7);
    if (start < hardStart) start = hardStart;

    return { start, end, guestWindows };
}

export function normalizeHostifyDays(raw: any[]): CalendarDay[] {
    const out: CalendarDay[] = [];
    for (const d of raw || []) {
        const date = String(d?.date || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const st = String(d?.status || "").toLowerCase();
        let status: CalendarDayStatus = "unknown";
        if (st === "available") status = "available";
        else if (st === "booked" || st === "reserved" || st === "reservation") status = "booked";
        else if (st === "blocked" || st === "block" || st === "unavailable") status = "blocked";
        else if (st) status = "booked"; // treat other non-available as not open
        out.push({
            date,
            status,
            price: Number(d?.price) || null,
            currency: d?.currency || null,
            source: "hostify",
        });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
}

export type DbBlockingStay = {
    id: number;
    listingMapId: number;
    status: string;
    arrivalDate: string; // YYYY-MM-DD
    departureDate: string; // YYYY-MM-DD exclusive end for nights
};

/** Nights occupied: arrivalDate .. day before departureDate. */
export function nightsBlockedByStay(stay: DbBlockingStay): string[] {
    const nights: string[] = [];
    if (!stay.arrivalDate || !stay.departureDate) return nights;
    let cur = stay.arrivalDate;
    // Safety cap
    for (let i = 0; i < 400 && cur < stay.departureDate; i++) {
        nights.push(cur);
        cur = addDaysKey(cur, 1);
    }
    return nights;
}

/**
 * Merge Hostify calendar with DB reservations.
 * - Hostify available + DB block → booked (conflict)
 * - Missing Hostify day + DB block → booked from DB
 * - Missing Hostify day + no DB block inside a guest-asked window → unknown (do not invent open)
 */
export function mergeCalendarWithDb(input: {
    hostifyDays: CalendarDay[];
    dbStays: DbBlockingStay[];
    windowStart: string;
    windowEnd: string;
}): { days: CalendarDay[]; conflicts: string[]; dbBlockedDates: Set<string> } {
    const byDate = new Map<string, CalendarDay>();
    for (const d of input.hostifyDays) byDate.set(d.date, { ...d });

    const dbBlockedDates = new Set<string>();
    for (const stay of input.dbStays) {
        for (const n of nightsBlockedByStay(stay)) {
            if (n < input.windowStart || n > input.windowEnd) continue;
            dbBlockedDates.add(n);
        }
    }

    const conflicts: string[] = [];
    for (const date of dbBlockedDates) {
        const existing = byDate.get(date);
        if (!existing) {
            byDate.set(date, {
                date,
                status: "booked",
                source: "db",
                note: "blocked by reservation_info (Hostify day missing)",
            });
            continue;
        }
        if (existing.status === "available") {
            conflicts.push(date);
            byDate.set(date, {
                ...existing,
                status: "booked",
                source: "merged",
                note: "Hostify said available but reservation_info has a blocking booking — treat as UNAVAILABLE",
            });
        }
    }

    const days = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    return { days, conflicts, dbBlockedDates };
}

export function collapseAvailableRanges(
    days: CalendarDay[]
): Array<{ from: string; to: string; minPrice: number; maxPrice: number }> {
    const ranges: Array<{ from: string; to: string; minPrice: number; maxPrice: number }> = [];
    for (const d of days) {
        if (d.status !== "available") continue;
        const price = Number(d.price) || 0;
        const last = ranges[ranges.length - 1];
        const contiguous = last && addDaysKey(last.to, 1) === d.date;
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
    return ranges;
}

export function summarizeWindowCoverage(
    days: CalendarDay[],
    window: DateWindow
): {
    totalNights: number;
    available: number;
    unavailable: number;
    unknown: number;
    fullyAvailable: boolean;
    openRanges: Array<{ from: string; to: string }>;
} {
    let available = 0;
    let unavailable = 0;
    let unknown = 0;
    const byDate = new Map(days.map((d) => [d.date, d]));
    const openDays: string[] = [];
    let cur = window.from;
    let total = 0;
    while (cur <= window.to && total < 400) {
        total++;
        const d = byDate.get(cur);
        if (!d) unknown++;
        else if (d.status === "available") {
            available++;
            openDays.push(cur);
        } else unavailable++;
        cur = addDaysKey(cur, 1);
    }
    const openRanges: Array<{ from: string; to: string }> = [];
    for (const date of openDays) {
        const last = openRanges[openRanges.length - 1];
        if (last && addDaysKey(last.to, 1) === date) last.to = date;
        else openRanges.push({ from: date, to: date });
    }
    return {
        totalNights: total,
        available,
        unavailable,
        unknown,
        fullyAvailable: total > 0 && available === total && unknown === 0,
        openRanges,
    };
}

export function formatAvailabilityPromptBlock(input: {
    days: CalendarDay[];
    windowStart: string;
    windowEnd: string;
    guestWindows: DateWindow[];
    conflicts: string[];
    hidePrices?: boolean;
    currency?: string;
    checkout?: string | null;
    hostifyOk: boolean;
}): string {
    const hidePrices = Boolean(input.hidePrices);
    const currency =
        input.currency ||
        input.days.find((d) => d.currency)?.currency ||
        "USD";
    const ranges = collapseAvailableRanges(input.days);
    const out: string[] = [];

    out.push(
        "HARD AVAILABILITY RULES:",
        "- Only state open/closed facts that appear in this block. NEVER invent open dates outside the checked window.",
        "- NEVER say a month/range is fully available unless the guest-asked window summary below says fullyAvailable=yes.",
        "- If a guest-asked date is marked unknown / not in calendar, say the team will confirm — do NOT guess.",
        "- Hostify is primary; reservation_info is a backup conflict check. If they conflict, treat the night as UNAVAILABLE."
    );

    if (hidePrices) {
        out.push(
            "EXTENSION PRICING SECURITY (hard rule): Hostify calendar nightly rates are NOT guest-quotable for extensions. " +
                "You may say whether nights look open/closed. NEVER quote a dollar amount. Escalate for pricing."
        );
    }

    const windowLabel = `${input.windowStart} to ${input.windowEnd}`;
    if (!input.hostifyOk) {
        out.push(
            `Hostify live calendar fetch FAILED or returned empty for ${windowLabel}. ` +
                `Using reservation_info backup only — do not claim nights are open with high confidence; escalate if the guest needs a firm yes.`
        );
    }

    if (ranges.length === 0) {
        out.push(
            `No open nights between ${windowLabel} in the merged calendar. ` +
                `This says NOTHING about dates after ${input.windowEnd}; for those, say you'll confirm with the team.`
        );
    } else {
        out.push(
            `${hidePrices ? "Open date ranges — dates only, no prices" : "Open date ranges"} ` +
                `(checked ${windowLabel}; nothing is known about dates after ${input.windowEnd}):`
        );
        for (const r of ranges.slice(0, 16)) {
            const label = r.from === r.to ? r.from : `${r.from} → ${r.to}`;
            let priceBit = "";
            if (!hidePrices && (r.minPrice || r.maxPrice)) {
                priceBit =
                    !r.maxPrice || r.minPrice === r.maxPrice
                        ? ` (~${currency} ${r.minPrice}/night)`
                        : ` (~${currency} ${r.minPrice}–${r.maxPrice}/night, varies by date)`;
            }
            out.push(`- ${label}${priceBit}`);
        }
    }

    if (input.guestWindows.length) {
        out.push("Guest-asked windows (answer these specifically):");
        for (const w of input.guestWindows.slice(0, 6)) {
            const cov = summarizeWindowCoverage(input.days, w);
            const openBit = cov.openRanges.length
                ? cov.openRanges
                      .slice(0, 8)
                      .map((r) => (r.from === r.to ? r.from : `${r.from}→${r.to}`))
                      .join(", ")
                : "none";
            out.push(
                `- ${w.label} (${w.from} → ${w.to}): fullyAvailable=${cov.fullyAvailable ? "yes" : "no"}; ` +
                    `open=${cov.available}/${cov.totalNights}; unavailable=${cov.unavailable}; unknown=${cov.unknown}; ` +
                    `open nights: ${openBit}`
            );
            if (!cov.fullyAvailable) {
                out.push(
                    `  → Do NOT tell the guest this whole ${w.label} period is available. Quote only the open nights (or say it is not open for the full period).`
                );
            }
        }
    }

    if (input.conflicts.length) {
        out.push(
            `CONFLICTS (Hostify available but DB booking present — treat as unavailable): ${input.conflicts
                .slice(0, 20)
                .join(", ")}`
        );
    }

    if (input.checkout) {
        const co = new Date(input.checkout as any);
        if (!isNaN(co.getTime())) {
            const nextNightKey = toDateKey(co);
            const day = input.days.find((d) => d.date === nextNightKey);
            if (day) {
                out.push(
                    day.status === "available"
                        ? hidePrices
                            ? `Extension check: the night of ${nextNightKey} (right after current checkout) IS available — do NOT quote a rate; team prices it.`
                            : `Extension check: the night of ${nextNightKey} (right after current checkout) IS available${
                                  day.price ? ` at ~${currency} ${Number(day.price)}/night` : ""
                              }.`
                        : `Extension check: the night of ${nextNightKey} (right after current checkout) is NOT available.`
                );
            }
        }
    }

    return out.join("\n");
}
