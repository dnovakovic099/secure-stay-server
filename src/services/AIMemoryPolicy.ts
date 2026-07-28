/**
 * Memory policy — the pure decision layer for what the assistant remembers.
 *
 * The July audit found two structural problems with memory, both fixed here:
 *
 *  1. Nothing expired. `ai_learned_facts` had no TTL and no supersession, and
 *     while every fact carried a `lastSeenAt`, no code path ever read it. A fact
 *     learned in January was asserted in July with identical confidence.
 *
 *  2. Selection ignored the question. Team feedback in particular was chosen by
 *     recency from a portfolio-wide window, so across ~969 listings a note left
 *     on one property was pushed out by unrelated notes on others long before
 *     that property's next guest wrote in.
 *
 * Memory is typed, because the four kinds behave differently in time:
 *
 *   permanent_fact  — parking instructions, house rules. No natural expiry, but
 *                     decays in ranking if reality stopped confirming it.
 *   temporary_state — an active leak, a late cleaner. Worthless once stale, and
 *                     dangerous if quoted later; short hard TTL.
 *   learned_pattern — "this owner rejects discounts". Needs repeated observation
 *                     to earn trust, and fades fastest without reinforcement.
 *   decision        — why a refund or override was granted. Never expires, since
 *                     precedent stays relevant, but recent precedent wins.
 *
 * Everything here is a pure function of its inputs so it can be exercised by
 * src/scripts/evalMemoryPolicy.ts with no database.
 */

export const MEMORY_TYPES = ["permanent_fact", "temporary_state", "learned_pattern", "decision"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/**
 * What a memory is about. Until now memory could only be keyed to a property,
 * which is why "this owner rejects discounts" had nowhere to live.
 */
export const SUBJECT_TYPES = ["property", "owner", "guest", "employee", "vendor"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hard time-to-live per type, applied when a row carries no explicit
 * `validUntil`. Only temporary state expires on a clock; the rest are governed
 * by decay so that a still-true fact nobody has re-confirmed is demoted rather
 * than silently dropped.
 */
export const DEFAULT_TTL_DAYS: Record<MemoryType, number | null> = {
    permanent_fact: null,
    temporary_state: 7,
    learned_pattern: null,
    decision: null,
};

/**
 * Days without reinforcement before a memory is considered fully stale. Patterns
 * fade fastest: an inferred habit that stopped recurring is the most likely of
 * the four to have simply become untrue.
 */
export const STALE_AFTER_DAYS: Record<MemoryType, number> = {
    permanent_fact: 365,
    temporary_state: 7,
    learned_pattern: 120,
    decision: 540,
};

export type MemoryRecord = {
    id?: number;
    memoryType?: string | null;
    /** Explicit expiry set by a human or by the writer. Wins over the type default. */
    validUntil?: Date | string | null;
    /** Set when a newer memory replaces this one; superseded memory is never used. */
    supersededByFactId?: number | null;
    /** Last time reality confirmed this memory. Drives decay. */
    lastSeenAt?: Date | string | null;
    createdAt?: Date | string | null;
    /** How many times this has been observed. Repetition earns trust. */
    frequency?: number | null;
};

export function normalizeMemoryType(raw: unknown): MemoryType {
    const v = String(raw || "").trim();
    return (MEMORY_TYPES as readonly string[]).includes(v) ? (v as MemoryType) : "permanent_fact";
}

function toTime(value: Date | string | null | undefined): number | null {
    if (!value) return null;
    const t = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
    return Number.isFinite(t) ? t : null;
}

/** Most recent moment reality confirmed this memory. */
function confirmedAt(m: MemoryRecord): number | null {
    return toTime(m.lastSeenAt) ?? toTime(m.createdAt);
}

/**
 * Whether a memory must not be used at all. Distinct from decay: expiry is a
 * correctness rule (the leak is fixed, the cleaner arrived), decay is a ranking
 * preference.
 */
export function isExpired(m: MemoryRecord, now: Date = new Date()): boolean {
    if (m.supersededByFactId != null) return true;

    const nowMs = now.getTime();
    const explicit = toTime(m.validUntil);
    if (explicit != null) return explicit <= nowMs;

    const ttlDays = DEFAULT_TTL_DAYS[normalizeMemoryType(m.memoryType)];
    if (ttlDays == null) return false;

    const seen = confirmedAt(m);
    if (seen == null) return false;
    return nowMs - seen > ttlDays * DAY_MS;
}

/**
 * Confidence multiplier in [0,1] from how long ago reality last confirmed this.
 * 1.0 when fresh, tapering linearly to 0.15 at the type's stale horizon — never
 * to zero, so an old-but-unexpired fact still beats having no answer at all.
 */
export function freshnessFactor(m: MemoryRecord, now: Date = new Date()): number {
    const seen = confirmedAt(m);
    if (seen == null) return 0.6;
    const ageDays = Math.max(0, (now.getTime() - seen) / DAY_MS);
    const horizon = STALE_AFTER_DAYS[normalizeMemoryType(m.memoryType)];
    if (ageDays <= 0) return 1;
    if (ageDays >= horizon) return 0.15;
    return 1 - 0.85 * (ageDays / horizon);
}

const STOP_WORDS = new Set([
    "the", "and", "for", "are", "you", "your", "can", "with", "have", "has", "how", "what", "where", "when",
    "does", "did", "is", "it", "a", "an", "to", "of", "in", "on", "at", "we", "our", "my", "i", "do", "there",
    "any", "get", "this", "that", "whats", "im", "me", "please", "would", "could", "about", "will", "was",
]);

/** Content words from a guest message or memory body, deduped. */
export function tokenize(text?: string | null): string[] {
    return Array.from(
        new Set(
            String(text || "")
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ")
                .split(/\s+/)
                .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
        )
    );
}

/** Share of the question's content words this text covers, in [0,1]. */
export function relevanceScore(queryTokens: string[], haystack: string): number {
    if (!queryTokens.length) return 0;
    const hay = String(haystack || "").toLowerCase();
    let hits = 0;
    for (const t of queryTokens) if (hay.includes(t)) hits += 1;
    return hits / queryTokens.length;
}

/**
 * Ranking score for one memory against the current question.
 *
 * Relevance dominates, because the failure being fixed is relevant memory losing
 * its slot to irrelevant-but-recent memory. Repetition and freshness break ties.
 * Returns null when the memory must not be used.
 */
export function scoreMemory(
    m: MemoryRecord,
    queryTokens: string[],
    haystack: string,
    now: Date = new Date()
): number | null {
    if (isExpired(m, now)) return null;
    const relevance = relevanceScore(queryTokens, haystack);
    const repetition = Math.min(3, Math.max(1, Number(m.frequency) || 1)) / 3;
    return (relevance * 10 + repetition) * freshnessFactor(m, now);
}

/**
 * Pick the best `limit` items for the current question, dropping expired ones.
 * Ties fall back to the input order, which callers supply as recency.
 */
export function selectRelevant<T>(
    items: T[],
    opts: {
        limit: number;
        query?: string | null;
        /** Memory-time fields for expiry and decay. */
        record: (item: T) => MemoryRecord;
        /** Text the question is matched against. */
        haystack: (item: T) => string;
        now?: Date;
    }
): T[] {
    const now = opts.now ?? new Date();
    const qTokens = tokenize(opts.query);
    const scored: Array<{ item: T; score: number; index: number }> = [];
    items.forEach((item, index) => {
        const score = scoreMemory(opts.record(item), qTokens, opts.haystack(item), now);
        if (score == null) return;
        scored.push({ item, score, index });
    });
    scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));
    return scored.slice(0, Math.max(0, opts.limit)).map((s) => s.item);
}

/**
 * Whether a memory may inform a guest-facing reply.
 *
 * Patterns and decisions are inferences and internal rationale — useful for how
 * the assistant behaves, never for quoting at a guest. Temporary state is
 * operational and is delivered through the ops ledger, which carries its own
 * completion rules, so it is kept out of the general memory block.
 */
export function isGuestUsable(m: { memoryType?: string | null; visibility?: string | null }): boolean {
    if (String(m.visibility || "").trim() === "internal") return false;
    return normalizeMemoryType(m.memoryType) === "permanent_fact";
}
