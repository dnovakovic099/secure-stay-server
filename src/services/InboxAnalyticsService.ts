import { appDatabase } from "../utils/database.util";
import { InboxAIAuditService } from "./InboxAIAuditService";

/**
 * InboxAnalyticsService — powers the Inbox → Analytics report.
 *
 * Compares the AI's suggested reply against:
 *   (a) what the TEAM actually sent (captured from Hostify by the nightly audit), and
 *   (b) what the USER sent from SecureStay when they accepted / edited / rejected a
 *       suggestion (the future primary path once replies move onto SS).
 *
 * It reports similarity (semantic = embedding cosine, plus Jaccard token overlap),
 * a weekly trend for the improvement chart, and a breakdown of WHY replies diverge,
 * with real examples. Read-only over inbox-v2 AI tables.
 */

/** Which inbox the report covers: Hostify v2 inbox or Quo (OpenPhone SMS). */
export type AnalyticsSource = "hostify" | "quo";

interface Pair {
    id: number;
    threadId: number;
    /** Quo only: OpenPhone conversation key for deep-links to /messages/quo. */
    threadKey?: string | null;
    channel: string | null;
    listingId: number | null;
    listingName: string | null;
    guestMsg: string | null;
    ai: string;
    other: string;
    jaccard: number;
    semantic: number | null;
    coverage: number | null;
    escalation: boolean;
    generatedAt: Date;
    matchQuality?: string | null;
    relevance?: string | null;
    relevanceNote?: string | null;
    aiQuality?: string | null;
    aiQualityNote?: string | null;
    aiQualityCategory?: string | null;
    missResolvedAt?: Date | null;
    missResolvedBy?: string | null;
    confidence?: number | null;
}

/** Shared filter set for the Analytics endpoints (property / date range / user). */
export interface AnalyticsFilters {
    startDate?: string | null;
    endDate?: string | null;
    listingIds?: number[] | null;
    taughtByUserId?: number | null;
    taughtByName?: string | null;
}

const words = (s: string) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

/** Split an array into fixed-size batches; used for bulk auto-resolve UPDATEs. */
function chunked<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/**
 * Reservation phases a taught fact applies to. Kept in sync with the phase
 * vocabulary the reply drafter already understands (see InboxAIService). "any"
 * is the default: the fact applies regardless of the guest's booking status.
 */
const KNOWN_PHASES = new Set(["inquiry", "accepted", "cancelled", "in_house", "post_stay"]);

function normalizePhases(input?: string[] | null): string[] | null {
    if (!input || !input.length) return null;
    const cleaned = input
        .map((p) => String(p || "").trim().toLowerCase())
        .filter((p) => KNOWN_PHASES.has(p));
    if (!cleaned.length) return null;
    // "all phases" is the same as no filter — collapse it back to null so the
    // column stays sparse and the render pipeline doesn't have to special-case it.
    if (cleaned.length === KNOWN_PHASES.size) return null;
    return [...new Set(cleaned)];
}

/**
 * Persist the applicablePhases JSON list on a learned fact row. The column
 * is added lazily on first use so environments without a run-time schema
 * migration still work (silent no-op on failure).
 */
async function setFactApplicablePhases(factId: number, phases: string[]): Promise<void> {
    try {
        // MySQL 8 supports IF NOT EXISTS on ADD COLUMN; older MySQL will error
        // once and then the second attempt hits the existing column silently.
        await appDatabase
            .query(`ALTER TABLE ai_learned_facts ADD COLUMN applicablePhases JSON NULL`)
            .catch(() => {
                /* column already exists */
            });
        await appDatabase.query(`UPDATE ai_learned_facts SET applicablePhases = ? WHERE id = ?`, [
            JSON.stringify(phases),
            factId,
        ]);
    } catch {
        /* Non-fatal: phase targeting degrades to "applies to all phases". */
    }
}
const deferRe =
    /(i['’]?ll (check|confirm|look into|find out|get back|follow up)|let me (check|confirm|find out)|get back to you|reach out to|our team will|will forward|check with (the|our)|i will (check|confirm|get back)|property manager will|team will (get|reach|be in touch))/i;
const specificsRe = /(\d{1,2}:\d{2}|\d{1,2}\s?(am|pm)|\$\d|\d{3,}|https?:\/\/|\bcode\b|\bwifi\b|\bpassword\b)/i;
const nonLatinRe = /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\u0600-\u06FF]/;
const ackRe =
    /^(yes|no|yep|sure|ok|okay|great|perfect|thanks|thank you|sounds good|got it|will do|done|absolutely|of course|no problem|you['’]?re\s+(?:most\s+|very\s+|so\s+)?welcome|most welcome|awesome|wonderful|glad)/i;

// Team replies driven by internal operations (PM callbacks, payment auth links,
// unreachable-phone chases, alteration mechanics). These aren't answers to the
// guest's question, so grading the AI against them is meaningless.
const opsDrivenRe =
    /(property managers? will reach out|will reach out to you shortly|kindly anticipate (their|the) call|(has|have) been trying to reach you|currently unreachable|alternate phone number|authenticate now|requires authentication|chargeautomation|securelink|alteration request|payment card ending)/i;

// Cheap stopword-based language detection for Latin-script languages (the
// non-Latin regex can't tell Spanish from English). Only claims a language when
// clearly ahead, so mixed/short texts return null instead of a guess.
const LANG_STOPWORDS: Record<string, string[]> = {
    en: ["the", "and", "you", "for", "your", "with", "that", "have", "will", "this", "please", "thank", "thanks", "know", "our", "here", "let", "stay", "any", "need"],
    es: ["que", "para", "por", "con", "los", "las", "una", "esta", "gracias", "hola", "favor", "aqui", "como", "pero", "estamos", "cualquier", "durante", "sea", "tu", "si"],
    fr: ["vous", "pour", "avec", "votre", "merci", "bonjour", "est", "nous", "dans", "pas", "les", "une", "sur", "sont"],
    de: ["der", "die", "und", "sie", "fur", "mit", "ihr", "danke", "hallo", "ist", "ein", "wir", "nicht", "das", "haben"],
    pt: ["voce", "obrigado", "ola", "seu", "sua", "uma", "nao", "por", "para", "com", "aqui", "estamos"],
    fi: ["etta", "kiitos", "hei", "jos", "mukavaa", "hyvaa", "olemme", "tama", "voit", "vain", "myos", "kun"],
    it: ["che", "per", "con", "grazie", "ciao", "una", "non", "siamo", "questo", "sono", "anche"],
};

function detectLang(text: string): string | null {
    const norm = String(text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const tokens = new Set(norm.replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean));
    if (tokens.size < 4) return null;
    let best: string | null = null;
    let bestHits = 0;
    let secondHits = 0;
    for (const [lang, words] of Object.entries(LANG_STOPWORDS)) {
        let hits = 0;
        for (const w of words) if (tokens.has(w)) hits++;
        if (hits > bestHits) {
            secondHits = bestHits;
            bestHits = hits;
            best = lang;
        } else if (hits > secondHits) {
            secondHits = hits;
        }
    }
    // Require a clear signal and a clear margin over the runner-up.
    return bestHits >= 3 && bestHits >= secondHits + 2 ? best : null;
}

/**
 * Text is clearly not English. Catches short foreign acks the stopword detector
 * can't ("¡De nada!", "Ole hyvä 💛"): non-Latin scripts, Spanish inverted
 * punctuation, two-plus accented/foreign letters, or a non-en stopword verdict.
 * A single accented char is allowed so English replies greeting "José" pass.
 */
function looksNonEnglish(text: string): boolean {
    const t = String(text || "");
    if (nonLatinRe.test(t)) return true;
    if (/[¡¿]/.test(t)) return true;
    const accents = (t.match(/[àâãäåæçèéêëìíîïñòóôõöøùúûüýÿßœ]/gi) || []).length;
    if (accents >= 2) return true;
    const lang = detectLang(t);
    return !!(lang && lang !== "en");
}

/** Pair involves a non-English reply on either side — skip grading for now. */
function isLanguageMismatch(ai: string, team: string): boolean {
    return looksNonEnglish(ai) || looksNonEnglish(team);
}

/** First name in a leading greeting ("Hi Caitlyn, ..."), lowercased, or null. */
function greetName(s: string): string | null {
    const m = String(s || "").match(/^\s*(?:hi|hello|hey|hola|aloha)[ ,]+([A-Za-zÀ-ÿ]{2,})/i);
    return m ? m[1].toLowerCase() : null;
}

/** Team reply is a pure pleasantry/ack (possibly after a greeting) — no substance to cover. */
function isAckOnly(s: string): boolean {
    const stripped = String(s || "")
        .replace(/^\s*(?:hi|hello|hey|hola|aloha)[ ,!]*[A-Za-zÀ-ÿ]*[.!,]*\s*/i, "")
        .trim();
    const w = stripped.split(/\s+/).filter(Boolean).length;
    if (w === 0) return true;
    return w <= 9 && (ackRe.test(stripped) || /^thank(s| you) for (reaching out|your (message|patience|feedback))/i.test(stripped));
}

const REASON_LABELS: Record<string, string> = {
    team_ack_short: "They sent a short acknowledgement",
    ai_deferred_or_escalated: "AI deferred / escalated; they answered directly",
    team_specifics_ai_missing: "They gave specifics the AI didn't have",
    ai_verbose: "AI reply much longer than theirs",
    ai_missed_substance: "AI reply missed part of what the team said",
    language_mismatch: "Different language",
    other_wording: "Same meaning, different wording",
};

function jaccardPct(a: string, b: string): number {
    const norm = (s: string) =>
        new Set(
            String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2)
        );
    const sa = norm(a);
    const sb = norm(b);
    if (!sa.size || !sb.size) return 0;
    let inter = 0;
    for (const w of sa) if (sb.has(w)) inter++;
    const union = sa.size + sb.size - inter;
    return union ? Math.round((inter / union) * 10000) / 100 : 0;
}

export class InboxAnalyticsService {
    /**
     * Primary quality metric for a pair: answer coverage (length-invariant) when
     * scored, else semantic, else jaccard. Keeps the reason breakdown consistent
     * with the headline KPI so verbosity alone never counts as "diverging".
     */
    private simOf(p: Pair): number {
        if (p.coverage != null) return p.coverage;
        return p.semantic != null ? p.semantic : p.jaccard;
    }

    private classify(p: Pair): string {
        const ai = p.ai;
        const other = p.other;
        const wOther = words(other);
        if (nonLatinRe.test(other) && !nonLatinRe.test(ai)) return "language_mismatch";
        if (wOther <= 6 || ackRe.test(other.trim())) return "team_ack_short";
        if (p.escalation || (deferRe.test(ai) && (specificsRe.test(other) || wOther >= 12)))
            return "ai_deferred_or_escalated";
        if (specificsRe.test(other) && !specificsRe.test(ai)) return "team_specifics_ai_missing";
        // Length is only a "reason" for pairs graded by the old style-sensitive
        // metrics (no coverage score). Under coverage grading, verbosity cannot
        // lower the score, so a low-coverage verbose reply is missing substance.
        if (p.coverage == null && wOther > 0 && words(ai) / Math.max(wOther, 1) >= 2.5) return "ai_verbose";
        return p.coverage != null ? "ai_missed_substance" : "other_wording";
    }

    private summarize(pairs: Pair[], lowThreshold = 45) {
        const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : 0);
        const sem = pairs.filter((p) => p.semantic != null).map((p) => p.semantic as number);
        const cov = pairs.filter((p) => p.coverage != null).map((p) => p.coverage as number);
        const jac = pairs.map((p) => p.jaccard);
        // Mistake-vs-acceptable: the LLM judge's per-reply verdict is the primary
        // quality signal ("missed" = the AI genuinely got it wrong).
        const aiMissed = pairs.filter((p) => p.aiQuality === "missed").length;
        const aiAddressed = pairs.filter((p) => p.aiQuality === "addressed").length;
        const aiJudged = aiMissed + aiAddressed;
        const aiAcceptablePct = aiJudged ? Math.round((aiAddressed / aiJudged) * 1000) / 10 : null;
        const buckets = { "0-25": 0, "25-50": 0, "50-70": 0, "70-100": 0 };
        pairs.forEach((p) => {
            const s = this.simOf(p);
            if (s < 25) buckets["0-25"]++;
            else if (s < 50) buckets["25-50"]++;
            else if (s < 70) buckets["50-70"]++;
            else buckets["70-100"]++;
        });

        // Reason breakdown over the diverging (low-similarity) pairs.
        const low = pairs.filter((p) => this.simOf(p) < lowThreshold);
        const byReason: Record<string, Pair[]> = {};
        for (const p of low) {
            const r = this.classify(p);
            (byReason[r] = byReason[r] || []).push(p);
        }
        const reasons = Object.entries(byReason)
            .map(([key, ps]) => ({
                key,
                label: REASON_LABELS[key] || key,
                count: ps.length,
                pct: Math.round((ps.length / Math.max(low.length, 1)) * 100),
                examples: ps
                    // Audit-worthy first: true AI misses, then unjudged, then pairs
                    // where the AI's reply was actually fine (team just did/knew
                    // something else) — those need the least human attention.
                    .sort((a, b) => {
                        const rank = (p: Pair) =>
                            p.aiQuality === "missed" ? 0 : p.aiQuality === "addressed" ? 2 : 1;
                        return rank(a) - rank(b) || this.simOf(a) - this.simOf(b);
                    })
                    .slice(0, 30)
                    .map((p) => ({
                        threadId: p.threadId,
                        threadKey: p.threadKey ?? null,
                        channel: p.channel,
                        listingId: p.listingId,
                        listingName: p.listingName,
                        guestMessage: (p.guestMsg || "").replace(/\s+/g, " ").slice(0, 240),
                        aiReply: p.ai.replace(/\s+/g, " ").slice(0, 320),
                        theirReply: p.other.replace(/\s+/g, " ").slice(0, 320),
                        coverage: p.coverage,
                        semantic: p.semantic,
                        jaccard: p.jaccard,
                        aiQuality: p.aiQuality ?? null,
                    })),
            }))
            .sort((a, b) => b.count - a.count);

        return {
            count: pairs.length,
            aiAcceptablePct,
            aiJudged,
            aiMissed,
            avgCoverage: avg(cov),
            coverageScored: cov.length,
            avgSemantic: avg(sem),
            avgJaccard: avg(jac),
            semanticCoverage: sem.length,
            buckets,
            reasons,
        };
    }

    private bucketKey(d: Date, granularity: "day" | "week" | "month"): string {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        if (granularity === "month") return `${y}-${m}`;
        if (granularity === "day") return `${y}-${m}-${String(d.getDate()).padStart(2, "0")}`;
        // ISO-ish week bucket
        const onejan = new Date(y, 0, 1);
        const wk = String(
            Math.ceil((((d as any) - (onejan as any)) / 86400000 + onejan.getDay() + 1) / 7)
        ).padStart(2, "0");
        return `${y}-W${wk}`;
    }

    private buildTrend(pairs: Pair[], granularity: "day" | "week" | "month") {
        const byBucket: Record<string, { sem: number[]; jac: number[]; cov: number[]; missed: number; addressed: number }> = {};
        for (const p of pairs) {
            const key = this.bucketKey(new Date(p.generatedAt), granularity);
            const b = (byBucket[key] = byBucket[key] || { sem: [], jac: [], cov: [], missed: 0, addressed: 0 });
            if (p.semantic != null) b.sem.push(p.semantic);
            if (p.coverage != null) b.cov.push(p.coverage);
            b.jac.push(p.jaccard);
            if (p.aiQuality === "missed") b.missed++;
            else if (p.aiQuality === "addressed") b.addressed++;
        }
        const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
        return Object.keys(byBucket)
            .sort()
            .map((key) => {
                const b = byBucket[key];
                const judged = b.missed + b.addressed;
                return {
                    bucket: key,
                    acceptablePct: judged ? Math.round((b.addressed / judged) * 1000) / 10 : null,
                    judged,
                    missed: b.missed,
                    avgCoverage: avg(b.cov),
                    avgSemantic: avg(b.sem),
                    avgJaccard: avg(b.jac),
                    count: b.jac.length,
                };
            });
    }

    /**
     * Build a `s.generatedAt` window clause based on either an explicit
     * start/end range (inclusive of end-day) or a fallback "last N days" window.
     * Returns the SQL fragment + parameter array to splice into a query.
     */
    private windowClause(days: number, filters?: AnalyticsFilters): { sql: string; params: any[] } {
        const start = (filters?.startDate || "").trim();
        const end = (filters?.endDate || "").trim();
        if (start && end) {
            return { sql: "AND s.generatedAt >= ? AND s.generatedAt < DATE_ADD(?, INTERVAL 1 DAY)", params: [start, end] };
        }
        if (start) return { sql: "AND s.generatedAt >= ?", params: [start] };
        if (end) return { sql: "AND s.generatedAt < DATE_ADD(?, INTERVAL 1 DAY)", params: [end] };
        return { sql: "AND s.generatedAt >= (NOW() - INTERVAL ? DAY)", params: [days] };
    }

    /** Load AI-vs-team pairs (audit-captured replies) for the window. */
    private async loadTeamPairs(
        days: number,
        source: AnalyticsSource = "hostify",
        filters?: AnalyticsFilters
    ): Promise<Pair[]> {
        const win = this.windowClause(days, filters);
        const teamRows: any[] =
            source === "quo"
                ? await appDatabase.query(
                      `SELECT s.id, s.threadId, s.quoConversationId AS threadKey, s.escalationRequired, s.suggestedReply, s.actualReplyText,
                              s.confidence, s.verifierConfidence,
                              s.replySimilarity, s.replySemanticSimilarity, s.replyCoverageScore, s.auditMatchQuality,
                              s.replyRelevance, s.replyRelevanceNote, s.aiReplyQuality, s.aiReplyQualityNote,
                              s.aiReplyQualityCategory, s.missResolvedAt, s.missResolvedBy, s.generatedAt,
                              COALESCE(c.lineName, 'SMS') AS channel,
                              c.listingId AS listingId, c.listingName AS listingName,
                              COALESCE(
                                  NULLIF(gm.body, ''),
                                  (SELECT m2.body FROM quo_messages m2
                                   WHERE m2.conversationId = s.quoConversationId AND m2.direction = 'incoming'
                                     AND m2.sentAt <= s.generatedAt
                                     AND m2.body IS NOT NULL AND m2.body <> ''
                                   ORDER BY m2.sentAt DESC LIMIT 1)
                              ) AS guestMsg
                       FROM ai_message_suggestions s
                       LEFT JOIN quo_conversations c ON c.id = s.threadId
                       LEFT JOIN quo_messages gm ON gm.id = s.messageId
                       WHERE s.source = 'quo'
                         -- Linked threads only: unlinked SMS drafts exist for UX
                         -- (instant suggestions) but have no property context, so
                         -- grading them would be noise.
                         AND s.reservationId IS NOT NULL
                         AND s.actualReplyText IS NOT NULL AND s.actualReplyText <> ''
                         AND s.suggestedReply IS NOT NULL AND s.suggestedReply <> ''
                         ${win.sql}
                       ORDER BY s.generatedAt DESC`,
                      win.params
                  )
                : await appDatabase.query(
                      `SELECT s.id, s.threadId, NULL AS threadKey, s.escalationRequired, s.suggestedReply, s.actualReplyText, s.confidence, s.verifierConfidence,
                              s.replySimilarity, s.replySemanticSimilarity, s.replyCoverageScore, s.auditMatchQuality,
                              s.replyRelevance, s.replyRelevanceNote, s.aiReplyQuality, s.aiReplyQualityNote,
                              s.aiReplyQualityCategory, s.missResolvedAt, s.missResolvedBy, s.generatedAt,
                              c.channel,
                              c.listingId AS listingId, c.listingName AS listingName,
                              COALESCE(
                                  NULLIF(gm.body, ''),
                                  (SELECT m2.body FROM inbox_messages m2
                                   WHERE m2.threadId = s.threadId AND m2.direction = 'incoming'
                                     AND m2.sentAt <= s.generatedAt
                                     AND m2.body IS NOT NULL AND m2.body <> ''
                                   ORDER BY m2.sentAt DESC LIMIT 1)
                              ) AS guestMsg
                       FROM ai_message_suggestions s
                       LEFT JOIN inbox_conversations c ON c.threadId = s.threadId
                       LEFT JOIN inbox_messages gm ON gm.threadId = s.threadId AND gm.externalId = s.messageId
                       WHERE s.source = 'hostify'
                         AND s.actualReplyText IS NOT NULL AND s.actualReplyText <> ''
                         AND s.suggestedReply IS NOT NULL AND s.suggestedReply <> ''
                         ${win.sql}
                       ORDER BY s.generatedAt DESC`,
                      win.params
                  );
        const listingIdFilter = await this.listingFilterSet(filters);
        const taughtByName = (filters?.taughtByName || "").trim().toLowerCase() || null;
        const teamPairs: Pair[] = teamRows
            .filter((r) => (listingIdFilter ? r.listingId != null && listingIdFilter.has(Number(r.listingId)) : true))
            .filter((r) =>
                taughtByName ? String(r.missResolvedBy || "").trim().toLowerCase() === taughtByName : true
            )
            .map((r) => ({
            id: Number(r.id),
            threadId: Number(r.threadId),
            threadKey: r.threadKey ?? null,
            channel: r.channel ?? null,
            listingId: r.listingId != null ? Number(r.listingId) : null,
            listingName: r.listingName || null,
            guestMsg: r.guestMsg ?? null,
            ai: r.suggestedReply,
            other: r.actualReplyText,
            jaccard: r.replySimilarity != null ? Number(r.replySimilarity) : jaccardPct(r.suggestedReply, r.actualReplyText),
            semantic: r.replySemanticSimilarity != null ? Number(r.replySemanticSimilarity) : null,
            // Negative = "scored, not applicable" sentinel (team reply was a pure ack).
            coverage:
                r.replyCoverageScore != null && Number(r.replyCoverageScore) >= 0
                    ? Number(r.replyCoverageScore)
                    : null,
            escalation: Number(r.escalationRequired) === 1,
            generatedAt: r.generatedAt,
            matchQuality: r.auditMatchQuality ?? null,
            relevance: r.replyRelevance ?? null,
            relevanceNote: r.replyRelevanceNote ?? null,
            aiQuality: r.aiReplyQuality ?? null,
            aiQualityNote: r.aiReplyQualityNote ?? null,
            aiQualityCategory: r.aiReplyQualityCategory ?? null,
            missResolvedAt: r.missResolvedAt ?? null,
            missResolvedBy: r.missResolvedBy ?? null,
            // Effective confidence = the stricter of the generator's self-score
            // and the independent verifier score (matches the auto-send gate).
            confidence: (() => {
                const self = r.confidence != null ? Number(r.confidence) : null;
                const ver = r.verifierConfidence != null ? Number(r.verifierConfidence) : null;
                if (self != null && ver != null) return Math.min(self, ver);
                return ver ?? self;
            })(),
        }));
        return teamPairs;
    }

    /**
     * Auto-send safety analysis: how the AI's self-reported confidence relates
     * to judged mistakes. For each confidence band and each candidate auto-send
     * threshold: how many replies would have gone out, and how many of those
     * were judged mistakes. This is the go/no-go data for confidence-gated
     * auto-send (auto-send above the threshold, rep review below).
     */
    private confidenceSafety(pairs: Pair[]) {
        const judged = pairs.filter(
            (p) => (p.aiQuality === "missed" || p.aiQuality === "addressed") && p.confidence != null
        );
        const bands = [
            { key: "<50", min: 0, max: 49.99 },
            { key: "50-69", min: 50, max: 69.99 },
            { key: "70-84", min: 70, max: 84.99 },
            { key: "85-94", min: 85, max: 94.99 },
            { key: "95+", min: 95, max: 1000 },
        ].map((b) => {
            const inBand = judged.filter((p) => (p.confidence as number) >= b.min && (p.confidence as number) <= b.max);
            const missed = inBand.filter((p) => p.aiQuality === "missed").length;
            return {
                band: b.key,
                judged: inBand.length,
                mistakes: missed,
                mistakePct: inBand.length ? Math.round((missed / inBand.length) * 1000) / 10 : null,
            };
        });
        const thresholds = [100, 95, 90, 85, 80, 70, 60].map((t) => {
            const above = judged.filter((p) => (p.confidence as number) >= t);
            const missed = above.filter((p) => p.aiQuality === "missed").length;
            return {
                threshold: t,
                wouldAutoSend: above.length,
                sharePct: judged.length ? Math.round((above.length / judged.length) * 1000) / 10 : 0,
                mistakes: missed,
                mistakePct: above.length ? Math.round((missed / above.length) * 1000) / 10 : null,
            };
        });
        const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
        return {
            judged: judged.length,
            avgConfidenceFine: avg(judged.filter((p) => p.aiQuality === "addressed").map((p) => p.confidence as number)),
            avgConfidenceMistake: avg(judged.filter((p) => p.aiQuality === "missed").map((p) => p.confidence as number)),
            bands,
            thresholds,
        };
    }

    /**
     * Split team pairs into comparable (fair grade of AI answer quality) vs
     * excluded, with the exclusion breakdown. Excluded:
     *  - guest_followup: team answered a NEWER guest message than the AI drafted against
     *  - off_topic / ops_driven: team reply didn't answer the guest (kept in notValid)
     *  - ack_only: team reply is a pure pleasantry with no substance to cover
     *  - name_mismatch: greeting names differ → replies are clearly to different messages/guests
     *  - language_mismatch: non-English on either side, embeddings under-score those
     */
    private filterComparable(teamPairs: Pair[]) {
        let teamOpsDriven = 0;
        let teamAckOnly = 0;
        let teamNameMismatch = 0;
        let teamLangMismatch = 0;
        let teamOffTopic = 0;
        const notValid: Pair[] = [];
        const teamComparable = teamPairs.filter((p) => {
            if (p.matchQuality === "guest_followup") return false;
            if (p.relevance === "off_topic") {
                teamOffTopic++;
                notValid.push(p);
                return false;
            }
            if (opsDrivenRe.test(p.other)) {
                teamOpsDriven++;
                if (!p.relevanceNote) p.relevanceNote = "Internal ops action (auto-detected)";
                notValid.push(p);
                return false;
            }
            if (isAckOnly(p.other)) {
                teamAckOnly++;
                return false;
            }
            const an = greetName(p.ai);
            const tn = greetName(p.other);
            if (an && tn && an !== tn) {
                teamNameMismatch++;
                return false;
            }
            if (isLanguageMismatch(p.ai, p.other)) {
                teamLangMismatch++;
                return false;
            }
            return true;
        });
        return {
            teamComparable,
            notValid,
            teamOpsDriven,
            teamAckOnly,
            teamNameMismatch,
            teamLangMismatch,
            teamOffTopic,
        };
    }

    async report(
        sinceDays = 60,
        granularity: "day" | "week" | "month" = "day",
        source: AnalyticsSource = "hostify",
        filters?: AnalyticsFilters
    ): Promise<any> {
        const days = Math.min(Math.max(sinceDays, 7), 180);
        const gran = granularity === "week" || granularity === "month" ? granularity : "day";

        const teamPairs = await this.loadTeamPairs(days, source, filters);
        const {
            teamComparable,
            notValid,
            teamOpsDriven,
            teamAckOnly,
            teamNameMismatch,
            teamLangMismatch,
            teamOffTopic,
        } = this.filterComparable(teamPairs);
        const teamNotComparable = teamPairs.length - teamComparable.length;

        // (b) vs USER edits/rejects sent from SecureStay. Hostify only — the Quo
        // composer doesn't track accept/edit outcomes yet.
        const win = this.windowClause(days, filters);
        const userRows: any[] = source === "quo" ? [] : await appDatabase.query(
            `SELECT s.id, s.threadId, s.status, s.escalationRequired, s.suggestedReply, s.generatedAt,
                    c.channel, c.listingId, c.listingName,
                    COALESCE(
                        NULLIF(gm.body, ''),
                        (SELECT m2.body FROM inbox_messages m2
                         WHERE m2.threadId = s.threadId AND m2.direction = 'incoming'
                           AND m2.sentAt <= s.generatedAt
                           AND m2.body IS NOT NULL AND m2.body <> ''
                         ORDER BY m2.sentAt DESC LIMIT 1)
                    ) AS guestMsg, sm.body AS sentBody
             FROM ai_message_suggestions s
             LEFT JOIN inbox_conversations c ON c.threadId = s.threadId
             LEFT JOIN inbox_messages gm ON gm.threadId = s.threadId AND gm.externalId = s.messageId
             LEFT JOIN inbox_messages sm ON sm.threadId = s.threadId AND sm.externalId = s.finalSentMessageId
             WHERE s.source = 'hostify'
               AND s.status IN ('accepted','edited','rejected')
               AND s.finalSentMessageId IS NOT NULL
               AND s.suggestedReply IS NOT NULL AND s.suggestedReply <> ''
               ${win.sql}
             ORDER BY s.generatedAt DESC`,
            win.params
        );
        const listingIdFilter = await this.listingFilterSet(filters);
        const userPairs: Pair[] = userRows
            .filter((r) => r.sentBody && String(r.sentBody).trim())
            .filter((r) => (listingIdFilter ? r.listingId != null && listingIdFilter.has(Number(r.listingId)) : true))
            .map((r) => ({
                id: Number(r.id),
                threadId: Number(r.threadId),
                channel: r.channel ?? null,
                listingId: r.listingId != null ? Number(r.listingId) : null,
                listingName: r.listingName || null,
                guestMsg: r.guestMsg ?? null,
                ai: r.suggestedReply,
                other: r.sentBody,
                jaccard: jaccardPct(r.suggestedReply, r.sentBody),
                semantic: null,
                coverage: null,
                escalation: Number(r.escalationRequired) === 1,
                generatedAt: r.generatedAt,
            }));

        // Overall totals for semantic coverage messaging (comparable pairs only).
        const totalMatched = teamComparable.length;
        const totalSemantic = teamComparable.filter((p) => p.semantic != null).length;
        // Pairs not yet relevance-judged (LLM): drives the "Compute now" nudge too,
        // since unjudged off-topic replies silently drag the coverage average down.
        const relevancePending = teamPairs.filter(
            (p) => p.relevance == null && p.matchQuality !== "guest_followup"
        ).length;

        return {
            sinceDays: days,
            granularity: gran,
            source,
            generatedAt: new Date().toISOString(),
            semanticCoverage: { scored: totalSemantic, total: totalMatched, relevancePending },
            dataQuality: {
                teamMatched: teamPairs.length,
                teamComparable: teamComparable.length,
                teamNotComparable, // total excluded (followup + ops + ack + name mismatch)
                teamOpsDriven,
                teamAckOnly,
                teamNameMismatch,
                teamLangMismatch,
                teamOffTopic,
            },
            vsTeam: this.summarize(teamComparable),
            vsUser: this.summarize(userPairs),
            confidenceSafety: this.confidenceSafety(teamComparable),
            trend: this.buildTrend(teamComparable, gran),
            notValidForScoring: {
                count: notValid.length,
                examples: notValid.slice(0, 30).map((p) => ({
                    threadId: p.threadId,
                    threadKey: p.threadKey ?? null,
                    channel: p.channel,
                    listingId: p.listingId,
                    listingName: p.listingName,
                    guestMessage: (p.guestMsg || "").replace(/\s+/g, " ").slice(0, 240),
                    aiReply: p.ai.replace(/\s+/g, " ").slice(0, 320),
                    theirReply: p.other.replace(/\s+/g, " ").slice(0, 320),
                    note: p.relevanceNote || null,
                    generatedAt: p.generatedAt,
                })),
            },
        };
    }

    /**
     * Worst-scoring comparable AI-vs-team pairs by a chosen metric (coverage,
     * semantic, or word overlap), ascending — powers the "click a metric to see
     * the worst replies" drill-down on the Analytics page.
     */
    async worstReplies(
        metric: "coverage" | "semantic" | "jaccard" = "coverage",
        sinceDays = 60,
        limit = 50,
        source: AnalyticsSource = "hostify",
        filters?: AnalyticsFilters
    ): Promise<any> {
        const days = Math.min(Math.max(sinceDays, 7), 180);
        const cap = Math.min(Math.max(limit, 1), 100);
        const m = metric === "semantic" || metric === "jaccard" ? metric : "coverage";

        const teamPairs = await this.loadTeamPairs(days, source, filters);
        const { teamComparable } = this.filterComparable(teamPairs);

        const score = (p: Pair): number | null =>
            m === "coverage" ? p.coverage : m === "semantic" ? p.semantic : p.jaccard;

        const scored = teamComparable.filter((p) => score(p) != null);
        const examples = scored
            .sort((a, b) => {
                const d = (score(a) as number) - (score(b) as number);
                if (d !== 0) return d;
                // Tie-break: true AI misses first, judged-fine replies last.
                const rank = (p: Pair) =>
                    p.aiQuality === "missed" ? 0 : p.aiQuality === "addressed" ? 2 : 1;
                return rank(a) - rank(b);
            })
            .slice(0, cap)
            .map((p) => ({
                threadId: p.threadId,
                threadKey: p.threadKey ?? null,
                channel: p.channel,
                listingId: p.listingId,
                listingName: p.listingName,
                guestMessage: (p.guestMsg || "").replace(/\s+/g, " ").slice(0, 240),
                aiReply: p.ai.replace(/\s+/g, " ").slice(0, 320),
                theirReply: p.other.replace(/\s+/g, " ").slice(0, 320),
                coverage: p.coverage,
                semantic: p.semantic,
                jaccard: p.jaccard,
                aiQuality: p.aiQuality ?? null,
                reason: REASON_LABELS[this.classify(p)] || null,
                generatedAt: p.generatedAt,
            }));

        return { metric: m, sinceDays: days, scored: scored.length, examples };
    }

    /**
     * "Questions from the AI" queue: every pending learning prompt across both
     * inboxes, enriched with enough context to answer it from the Analytics
     * page. The July audit found 400+ prompts piling up unanswered because
     * they were only surfaced one-at-a-time inside their own conversations.
     */
    async learningPrompts(source?: AnalyticsSource, filters?: AnalyticsFilters): Promise<any> {
        const { AILearningPromptService } = await import("./AILearningPromptService");
        let pending = await new AILearningPromptService().listPending({ source, limit: 300 });

        const listingIdFilter = await this.listingFilterSet(filters);
        if (listingIdFilter) {
            pending = pending.filter((p) => p.listingId != null && listingIdFilter.has(Number(p.listingId)));
        }
        const startMs = filters?.startDate ? Date.parse(filters.startDate) : NaN;
        const endMs = filters?.endDate ? Date.parse(filters.endDate) + 86_400_000 : NaN;
        if (!isNaN(startMs)) pending = pending.filter((p) => new Date(p.createdAt).getTime() >= startMs);
        if (!isNaN(endMs)) pending = pending.filter((p) => new Date(p.createdAt).getTime() < endMs);

        // Deep-link + display context per source.
        const quoIds = pending.filter((p) => p.source === "quo").map((p) => Number(p.threadId));
        const hostifyIds = pending.filter((p) => p.source !== "quo").map((p) => Number(p.threadId));
        const quoRows: any[] = quoIds.length
            ? await appDatabase.query(
                  `SELECT id, conversationId, COALESCE(NULLIF(guestName,''), NULLIF(contactName,''), participantPhone) AS who
                   FROM quo_conversations WHERE id IN (${quoIds.map(() => "?").join(",")})`,
                  quoIds
              )
            : [];
        const hostifyRows: any[] = hostifyIds.length
            ? await appDatabase.query(
                  `SELECT threadId, guestName AS who FROM inbox_conversations
                   WHERE threadId IN (${hostifyIds.map(() => "?").join(",")})`,
                  hostifyIds
              )
            : [];
        const quoByThread = new Map<number, any>(quoRows.map((r) => [Number(r.id), r]));
        const hostifyByThread = new Map<number, any>(hostifyRows.map((r) => [Number(r.threadId), r]));

        const counts = { hostify: 0, quo: 0 };
        const prompts = pending.map((p) => {
            const isQuo = p.source === "quo";
            counts[isQuo ? "quo" : "hostify"]++;
            const ctx = isQuo ? quoByThread.get(Number(p.threadId)) : hostifyByThread.get(Number(p.threadId));
            return {
                id: p.id,
                source: isQuo ? "quo" : "hostify",
                threadId: Number(p.threadId),
                threadKey: isQuo ? ctx?.conversationId || null : null,
                guestName: ctx?.who || null,
                listingId: p.listingId != null ? Number(p.listingId) : null,
                listingName: p.listingName || null,
                question: p.question,
                topic: p.topic || null,
                createdAt: p.createdAt,
            };
        });
        return { total: prompts.length, counts, prompts };
    }

    /**
     * "Replies to fix" queue: every pair the LLM judged as a true AI miss
     * (guest asked for something specific, AI failed while the team delivered,
     * or the AI was wrong). Grouped counts by root cause so fixes can be routed
     * (missing_info → add KB fact, wrong_info → correct KB, deferral → behavior).
     */
    async misses(
        sinceDays = 60,
        includeResolved = false,
        source: AnalyticsSource = "hostify",
        filters?: AnalyticsFilters
    ): Promise<any> {
        const days = Math.min(Math.max(sinceDays, 7), 180);
        const teamPairs = await this.loadTeamPairs(days, source, filters);
        // Same fairness filters as the scores: a "miss" judged against a
        // follow-up or off-topic team reply isn't actionable.
        const { teamComparable } = this.filterComparable(teamPairs);

        const all = teamComparable.filter((p) => p.aiQuality === "missed");

        // Preload remediation state so we can auto-resolve misses whose fix has
        // already been taught (learned fact matched by sampleSuggestionId, or
        // learning prompt on the SAME suggestion that has now been answered).
        // Historically we only used the checkbox — the analytics kept showing a
        // fixed miss as "open" until a manager ticked it, which was noise.
        const suggestionIds = all.map((p) => p.id);
        const threadIds = [...new Set(all.map((p) => p.threadId))];
        const listingRowsAll: any[] = threadIds.length
            ? source === "quo"
                ? await appDatabase.query(
                      `SELECT id AS threadId, listingId FROM quo_conversations WHERE id IN (${threadIds.map(() => "?").join(",")})`,
                      threadIds
                  )
                : await appDatabase.query(
                      `SELECT threadId, listingId FROM inbox_conversations WHERE threadId IN (${threadIds.map(() => "?").join(",")})`,
                      threadIds
                  )
            : [];
        const listingByThread = new Map<number, number | null>(
            listingRowsAll.map((r) => [Number(r.threadId), r.listingId != null ? Number(r.listingId) : null])
        );
        const listingIds = [...new Set(listingRowsAll.map((r) => Number(r.listingId)).filter(Boolean))];
        const facts: any[] = listingIds.length
            ? await appDatabase.query(
                  `SELECT id, listingId, scope, topic, question, answer, status, createdAt, createdByUserId, sampleThreadId FROM ai_learned_facts
                   WHERE status IN ('approved','pending') AND (scope = 'portfolio' OR listingId IN (${listingIds.map(() => "?").join(",")}))`,
                  listingIds
              )
            : [];
        // Learning prompts: use sampleSuggestionId (per-message match — the audit
        // note said the AI's "asked the team" question was getting mismatched to
        // unrelated topics because we were falling back to thread-scope) plus a
        // per-thread map as fallback for older prompts without that link.
        const prompts: any[] = threadIds.length
            ? await appDatabase.query(
                  `SELECT id, threadId, question, status, answerText, answeredByUserId, answerScope, sampleSuggestionId, topic, resolvedAt, createdAt
                   FROM ai_learning_prompts
                   WHERE source = ? AND threadId IN (${threadIds.map(() => "?").join(",")})
                   ORDER BY createdAt DESC`,
                  [source === "quo" ? "quo" : "hostify", ...threadIds]
              )
            : [];
        const { AILearnedFactsService } = await import("./AILearnedFactsService");
        const attributionIds = [
            ...facts.map((f) => f.createdByUserId),
            ...prompts.map((p) => p.answeredByUserId),
        ]
            .filter((v) => v != null)
            .map(Number);
        const attributionNames = await AILearnedFactsService.userNames([...new Set(attributionIds)]);
        const promptBySuggestion = new Map<number, any>();
        const promptByThread = new Map<number, any>();
        for (const pr of prompts) {
            if (pr.sampleSuggestionId != null) {
                promptBySuggestion.set(Number(pr.sampleSuggestionId), pr);
            }
            // Prefer answered prompts as the thread-level fallback; else keep the
            // most recent (regardless of status).
            const existing = promptByThread.get(Number(pr.threadId));
            if (!existing || (pr.status === "answered" && existing.status !== "answered")) {
                promptByThread.set(Number(pr.threadId), pr);
            }
        }

        // Learned-fact match by sampleThreadId (much stronger than fuzzy topic
        // overlap — it means "this fact was extracted FROM the miss's own
        // conversation," so it definitively addresses the miss).
        const factByThread = new Map<number, any>();
        for (const f of facts) {
            if (f.sampleThreadId == null) continue;
            const tid = Number(f.sampleThreadId);
            const existing = factByThread.get(tid);
            if (!existing || (f.status === "approved" && existing.status !== "approved")) {
                factByThread.set(tid, f);
            }
        }

        // Fuzzy topic overlap kept only as a last-resort backstop with a
        // higher gate (was 0.45 → 0.6) after the "unrelated topic" reports.
        const MATCH_STOPWORDS = new Set([
            "guest", "guests", "team", "property", "answer", "answered", "question", "provided", "clear",
            "reply", "replied", "reported", "requested", "request", "asked", "asking", "needs", "needed",
            "their", "there", "about", "should", "would", "could", "entire", "total", "your", "stay",
            "host", "listing", "information", "info", "correct", "correctly", "incorrectly", "specific",
            "the", "and", "did", "not", "but", "was", "has", "have", "had", "this", "that", "will",
            "can", "you", "are", "were", "they", "them", "its", "his", "her", "our", "with", "for",
        ]);
        const tokOverlap = (a: string, b: string): number => {
            const tok = (s: string) =>
                new Set(
                    String(s || "")
                        .toLowerCase()
                        .replace(/[^a-z0-9\s]/g, " ")
                        .split(/\s+/)
                        .filter((w) => w.length >= 3 && !MATCH_STOPWORDS.has(w))
                );
            const A = tok(a);
            const B = tok(b);
            if (A.size < 2 || B.size < 2) return 0;
            let inter = 0;
            for (const w of A) if (B.has(w)) inter++;
            if (inter < 2) return 0;
            return inter / Math.min(A.size, B.size);
        };

        const remediationOf = (p: Pair): {
            status: string;
            detail: string | null;
            by: string | null;
        } => {
            // 1) Learning prompt anchored to THIS suggestion — highest confidence,
            //    the AI asked/was answered about exactly this message.
            const promptDirect = promptBySuggestion.get(p.id);
            if (promptDirect) {
                return {
                    status: promptDirect.status === "pending" ? "asked" : "answered",
                    detail: String(
                        promptDirect.status === "pending"
                            ? promptDirect.question
                            : promptDirect.answerText || promptDirect.question
                    )
                        .replace(/\s+/g, " ")
                        .slice(0, 220),
                    by:
                        promptDirect.status !== "pending" && promptDirect.answeredByUserId != null
                            ? attributionNames.get(Number(promptDirect.answeredByUserId)) ?? null
                            : null,
                };
            }
            // 2) Learned fact extracted from the exact same conversation.
            const factDirect = factByThread.get(p.threadId);
            if (factDirect) {
                return {
                    status: factDirect.status === "approved" ? "learned" : "learned_pending_review",
                    detail: String(factDirect.answer || factDirect.question || factDirect.topic)
                        .replace(/\s+/g, " ")
                        .slice(0, 220),
                    by:
                        factDirect.createdByUserId != null
                            ? attributionNames.get(Number(factDirect.createdByUserId)) ?? null
                            : null,
                };
            }
            // 3) Fuzzy topical match against learned facts for the same property
            //    or portfolio-wide — stricter gate to avoid the mis-labelling
            //    where an unrelated fact was surfaced next to the miss.
            const lid = listingByThread.get(p.threadId) ?? null;
            const missText = p.aiQualityNote || p.guestMsg || "";
            const candidates = facts.filter(
                (f) => f.scope === "portfolio" || (lid != null && Number(f.listingId) === lid)
            );
            let best: any = null;
            let bestScore = 0;
            for (const f of candidates) {
                const s = tokOverlap(missText, `${f.topic || ""} ${f.question || ""} ${f.answer || ""}`);
                if (s > bestScore) {
                    bestScore = s;
                    best = f;
                }
            }
            if (best && bestScore >= 0.6) {
                return {
                    status: best.status === "approved" ? "learned" : "learned_pending_review",
                    detail: String(best.answer || best.question || best.topic).replace(/\s+/g, " ").slice(0, 220),
                    by: best.createdByUserId != null ? attributionNames.get(Number(best.createdByUserId)) ?? null : null,
                };
            }
            // 4) Thread-level prompt fallback (older prompts without sampleSuggestionId).
            //    Only surface as "asked/answered" when the prompt's own topic looks
            //    close to the miss note — otherwise the "AI asked the team" line
            //    ends up unrelated to the guest/AI/sent triple shown in the card.
            const threadPrompt = promptByThread.get(p.threadId);
            if (threadPrompt) {
                const promptText = `${threadPrompt.topic || ""} ${threadPrompt.question || ""} ${threadPrompt.answerText || ""}`;
                if (tokOverlap(missText, promptText) >= 0.4) {
                    return {
                        status: threadPrompt.status === "pending" ? "asked" : "answered",
                        detail: String(
                            threadPrompt.status === "pending"
                                ? threadPrompt.question
                                : threadPrompt.answerText || threadPrompt.question
                        )
                            .replace(/\s+/g, " ")
                            .slice(0, 220),
                        by:
                            threadPrompt.status !== "pending" && threadPrompt.answeredByUserId != null
                                ? attributionNames.get(Number(threadPrompt.answeredByUserId)) ?? null
                                : null,
                    };
                }
            }
            return { status: "none", detail: null, by: null };
        };

        // Auto-resolve on read: if the AI has actually learned/been-answered on
        // this specific miss, treat it as resolved (no manual tick required).
        // Persist so future report loads and counts stay in sync.
        const autoResolves: Array<{ id: number; by: string | null }> = [];
        const remediationById = new Map<number, ReturnType<typeof remediationOf>>();
        for (const p of all) {
            const rem = remediationOf(p);
            remediationById.set(p.id, rem);
            const alreadyResolved = !!p.missResolvedAt;
            const shouldAutoResolve = rem.status === "learned" || rem.status === "answered";
            if (!alreadyResolved && shouldAutoResolve) {
                p.missResolvedAt = new Date();
                p.missResolvedBy = rem.by || "AI Copilot";
                autoResolves.push({ id: p.id, by: p.missResolvedBy });
            }
        }
        if (autoResolves.length) {
            const now = new Date();
            for (const chunk of chunked(autoResolves, 200)) {
                await appDatabase.query(
                    `UPDATE ai_message_suggestions
                     SET missResolvedAt = ?, missResolvedBy = COALESCE(missResolvedBy, ?)
                     WHERE id IN (${chunk.map(() => "?").join(",")}) AND missResolvedAt IS NULL`,
                    [now, autoResolves[0].by, ...chunk.map((c) => c.id)]
                );
            }
        }

        const unresolved = all.filter((p) => !p.missResolvedAt);
        const shown = includeResolved ? all : unresolved;

        const byCategory: Record<string, number> = {};
        for (const p of unresolved) {
            const c = p.aiQualityCategory || "other";
            byCategory[c] = (byCategory[c] || 0) + 1;
        }

        const list = shown
            .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
            .slice(0, 200);

        return {
            sinceDays: days,
            total: all.length,
            unresolved: unresolved.length,
            resolved: all.length - unresolved.length,
            byCategory,
            examples: list.map((p) => ({
                id: p.id,
                threadId: p.threadId,
                threadKey: p.threadKey ?? null,
                channel: p.channel,
                listingId: p.listingId,
                listingName: p.listingName,
                guestMessage: (p.guestMsg || "").replace(/\s+/g, " ").slice(0, 240),
                aiReply: p.ai.replace(/\s+/g, " ").slice(0, 320),
                theirReply: p.other.replace(/\s+/g, " ").slice(0, 320),
                note: p.aiQualityNote || null,
                category: p.aiQualityCategory || "other",
                coverage: p.coverage,
                confidence: p.confidence ?? null,
                resolvedAt: p.missResolvedAt || null,
                resolvedBy: p.missResolvedBy || null,
                generatedAt: p.generatedAt,
                remediation: remediationById.get(p.id) || { status: "none", detail: null, by: null },
            })),
        };
    }

    /**
     * Staff teaches the AI the missing/corrected info for a specific miss:
     * stored as a trusted learned fact (same path as learning-prompt answers,
     * so it feeds context + RAG immediately) and the miss is marked resolved.
     */
    async teachMiss(
        suggestionId: number,
        answer: string,
        scope: "property" | "portfolio" | "selected" = "property",
        userId?: string | null,
        opts?: { listingIds?: number[] | null; phases?: string[] | null }
    ): Promise<{ saved: boolean; resolvedBy?: string | null; listingsTaught?: number }> {
        const text = (answer || "").trim();
        if (!text) return { saved: false };
        const rows: any[] = await appDatabase.query(
            `SELECT s.id, s.source, s.threadId, s.quoConversationId, s.aiReplyQualityNote, s.messageId,
                    COALESCE(c.listingId, q.listingId) AS listingId
             FROM ai_message_suggestions s
             LEFT JOIN inbox_conversations c ON s.source = 'hostify' AND c.threadId = s.threadId
             LEFT JOIN quo_conversations q ON s.source = 'quo' AND q.id = s.threadId
             WHERE s.id = ?`,
            [suggestionId]
        );
        if (!rows.length) return { saved: false };
        const r = rows[0];
        const isQuo = r.source === "quo";
        const guestRows: any[] = r.messageId
            ? isQuo
                ? await appDatabase.query(`SELECT body FROM quo_messages WHERE id = ? LIMIT 1`, [r.messageId])
                : await appDatabase.query(
                      `SELECT body FROM inbox_messages WHERE threadId = ? AND externalId = ? LIMIT 1`,
                      [r.threadId, r.messageId]
                  )
            : [];
        const question = String(r.aiReplyQualityNote || guestRows?.[0]?.body || "guest question").slice(0, 500);

        const { AILearnedFactsService } = await import("./AILearnedFactsService");
        const { InboxAIAuditService } = await import("./InboxAIAuditService");
        const learned = new AILearnedFactsService();
        const missListingId = r.listingId != null ? Number(r.listingId) : null;
        const byUser = await this.resolveUser(userId);

        // Normalize scope + resolve which listing ids receive this fact.
        //   portfolio → account-wide (listingId=null)
        //   selected  → each id in opts.listingIds gets its own property-scoped fact
        //   property  → the miss's own listing
        const desiredListingIds: (number | null)[] = (() => {
            if (scope === "portfolio") return [null];
            if (scope === "selected") {
                const ids = (opts?.listingIds || [])
                    .map((n) => Number(n))
                    .filter((n) => Number.isFinite(n) && n > 0);
                if (ids.length) return [...new Set(ids)];
                // Fall back to the miss's own listing if the caller forgot to include ids.
                return missListingId != null ? [missListingId] : [null];
            }
            return [missListingId];
        })();
        const phases = normalizePhases(opts?.phases);

        let taughtCount = 0;
        for (const lid of desiredListingIds) {
            const rowScope = lid == null ? "portfolio" : "property";
            try {
                const saved = await learned.upsert(
                    {
                        scope: rowScope,
                        listingId: lid,
                        topic: question.slice(0, 120),
                        question,
                        answer: text,
                        sampleThreadId: Number(r.threadId),
                        source: "manual",
                        createdByUserId: byUser.id,
                    },
                    { autoApprove: InboxAIAuditService.autoApproveFacts(), trustedSource: true }
                );
                if (phases && saved?.id) {
                    await setFactApplicablePhases(saved.id, phases);
                }
                taughtCount++;
            } catch {
                // Property-specific content that can't go portfolio-wide is dropped
                // by the learned-facts service; keep going with the rest.
            }
        }

        await appDatabase.query(
            `UPDATE ai_message_suggestions SET missResolvedAt = NOW(), missResolvedBy = ? WHERE id = ?`,
            [byUser.name, suggestionId]
        );
        // If the AI had raised a learning question on this thread, the manager's
        // answer covers it — close it so the team isn't asked again in the inbox.
        // (threadId is scoped per source: Hostify thread id vs quo_conversations.id.)
        await appDatabase.query(
            `UPDATE ai_learning_prompts
             SET status = 'answered', answerText = ?, answerScope = ?, answeredByUserId = COALESCE(?, answeredByUserId),
                 resolvedAt = NOW(), resolvedVia = 'staff'
             WHERE source = ? AND threadId = ? AND status = 'pending'`,
            [
                text,
                scope === "portfolio" ? "portfolio" : "property",
                byUser.id,
                isQuo ? "quo" : "hostify",
                r.threadId,
            ]
        );
        return { saved: taughtCount > 0, resolvedBy: byUser.name, listingsTaught: taughtCount };
    }

        /**
     * Expand compound (group) ids from the property filter into every Hostify
     * channel listing under that compound. Selecting "Drummond (#01)" must
     * match Airbnb + Booking + Vrbo threads without forcing staff to tick
     * each channel row.
     */
    private async expandCompoundListingIds(selected: number[]): Promise<Set<number>> {
        const ids = [...new Set((selected || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
        if (!ids.length) return new Set();
        const ph = ids.map(() => "?").join(",");
        const mapped: any[] = await appDatabase.query(
            `SELECT listingId, groupId FROM listing_group_map
             WHERE listingId IN (${ph}) OR groupId IN (${ph})`,
            [...ids, ...ids]
        );
        const groupIds = new Set<number>();
        for (const id of ids) {
            const asMember = mapped.find((r) => Number(r.listingId) === id);
            groupIds.add(asMember ? Number(asMember.groupId) : id);
        }
        const out = new Set<number>(groupIds);
        if (groupIds.size) {
            const gph = [...groupIds].map(() => "?").join(",");
            const members: any[] = await appDatabase.query(
                `SELECT listingId FROM listing_group_map WHERE groupId IN (${gph})`,
                [...groupIds]
            );
            for (const r of members) out.add(Number(r.listingId));
        }
        return out;
    }

    private async listingFilterSet(filters?: AnalyticsFilters): Promise<Set<number> | null> {
        if (!filters?.listingIds?.length) return null;
        return this.expandCompoundListingIds(filters.listingIds);
    }

    /**
     * Distinct COMPOUNDS (Hostify channel-groups) that appear in the analytics
     * window — powers the property filter. One row per real property so staff
     * pick "Drummond (#01)" once instead of Airbnb + Booking + Vrbo siblings.
     * The returned `id` is the canonical groupId; filters expand it to every
     * channel listing under that compound server-side.
     */
    async listListings(source: AnalyticsSource = "hostify", sinceDays = 60): Promise<any> {
        const days = Math.min(Math.max(sinceDays, 7), 365);
        const rows: any[] =
            source === "quo"
                ? await appDatabase.query(
                      `SELECT COALESCE(g.groupId, q.listingId) AS compoundId,
                              MAX(COALESCE(li_parent.internalListingName, li.internalListingName, g.name)) AS compoundName,
                              MAX(NULLIF(TRIM(q.listingName), '')) AS convoName
                       FROM quo_conversations q
                       JOIN ai_message_suggestions s ON s.threadId = q.id AND s.source = 'quo'
                       LEFT JOIN listing_group_map g ON g.listingId = q.listingId
                       LEFT JOIN listing_info li ON li.id = q.listingId
                       LEFT JOIN listing_info li_parent ON li_parent.id = COALESCE(g.groupId, q.listingId)
                       WHERE q.listingId IS NOT NULL
                         AND s.generatedAt >= (NOW() - INTERVAL ? DAY)
                       GROUP BY COALESCE(g.groupId, q.listingId)`,
                      [days]
                  )
                : await appDatabase.query(
                      `SELECT COALESCE(g.groupId, c.listingId) AS compoundId,
                              MAX(COALESCE(li_parent.internalListingName, li.internalListingName, g.name)) AS compoundName,
                              MAX(NULLIF(TRIM(c.listingName), '')) AS convoName
                       FROM inbox_conversations c
                       JOIN ai_message_suggestions s ON s.threadId = c.threadId AND s.source = 'hostify'
                       LEFT JOIN listing_group_map g ON g.listingId = c.listingId
                       LEFT JOIN listing_info li ON li.id = c.listingId
                       LEFT JOIN listing_info li_parent ON li_parent.id = COALESCE(g.groupId, c.listingId)
                       WHERE c.listingId IS NOT NULL
                         AND s.generatedAt >= (NOW() - INTERVAL ? DAY)
                       GROUP BY COALESCE(g.groupId, c.listingId)`,
                      [days]
                  );
        const listings = rows
            .filter((r) => r.compoundId != null)
            .map((r) => ({
                id: Number(r.compoundId),
                name: String(r.compoundName || r.convoName || `Property ${r.compoundId}`).trim(),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return { listings };
    }

    /** Distinct staff who have taught / resolved a miss in the window — powers the "user" filter. */
    async listTaughtByUsers(source: AnalyticsSource = "hostify", sinceDays = 60): Promise<any> {
        const days = Math.min(Math.max(sinceDays, 7), 365);
        const rows: any[] = await appDatabase.query(
            `SELECT DISTINCT s.missResolvedBy AS name
             FROM ai_message_suggestions s
             WHERE s.source = ?
               AND s.missResolvedBy IS NOT NULL AND s.missResolvedBy <> ''
               AND s.generatedAt >= (NOW() - INTERVAL ? DAY)
             ORDER BY s.missResolvedBy`,
            [source, days]
        );
        return {
            users: rows
                .map((r) => (r.name || "").trim())
                .filter((v) => v.length > 0)
                .filter((v, i, a) => a.indexOf(v) === i),
        };
    }

    /** Mark / unmark a miss as handled so the fix queue shrinks as it's worked. */
    async resolveMiss(
        suggestionId: number,
        resolved: boolean,
        userId?: string | null
    ): Promise<{ resolvedAt: Date | null; resolvedBy: string | null }> {
        const resolvedAt = resolved ? new Date() : null;
        const resolvedBy = resolved ? await this.resolveUserName(userId) : null;
        await appDatabase.query(
            `UPDATE ai_message_suggestions SET missResolvedAt = ?, missResolvedBy = ? WHERE id = ?`,
            [resolvedAt, resolvedBy, suggestionId]
        );
        return { resolvedAt, resolvedBy };
    }

    /**
     * Manager says the AI reply was better than the team reply (false "miss").
     * Overturns the audit verdict for grading, resolves the queue item, records
     * feedback so future prompts prefer the AI approach, and dismisses any
     * pending learning prompt tied to this suggestion/thread.
     */
    async preferAiMiss(
        suggestionId: number,
        userId?: string | null
    ): Promise<{ saved: boolean; resolvedBy: string | null }> {
        const rows: any[] = await appDatabase.query(
            `SELECT s.id, s.source, s.threadId, s.quoConversationId, s.messageId,
                    s.suggestedReply, s.actualReplyText, s.aiReplyQualityNote,
                    COALESCE(c.listingId, q.listingId) AS listingId,
                    COALESCE(c.reservationId, q.reservationId) AS reservationId
             FROM ai_message_suggestions s
             LEFT JOIN inbox_conversations c ON s.source = 'hostify' AND c.threadId = s.threadId
             LEFT JOIN quo_conversations q ON s.source = 'quo' AND q.id = s.threadId
             WHERE s.id = ?`,
            [suggestionId]
        );
        if (!rows.length) return { saved: false, resolvedBy: null };
        const r = rows[0];
        const byUser = await this.resolveUser(userId);
        const resolvedBy = byUser.name || "manager";
        const aiReply = String(r.suggestedReply || "").replace(/\s+/g, " ").trim();
        const teamReply = String(r.actualReplyText || "").replace(/\s+/g, " ").trim();
        const missNote = String(r.aiReplyQualityNote || "").replace(/\s+/g, " ").trim();

        // Overturn the miss for KPIs / future grading, and clear the root-cause
        // category so it no longer appears in the fix-queue breakdown.
        await appDatabase.query(
            `UPDATE ai_message_suggestions
             SET aiReplyQuality = 'addressed',
                 aiReplyQualityCategory = NULL,
                 aiReplyQualityNote = ?,
                 missResolvedAt = NOW(),
                 missResolvedBy = ?
             WHERE id = ?`,
            [
                `Manager preferred AI reply over team reply${missNote ? `: was flagged as "${missNote.slice(0, 160)}"` : ""}`.slice(
                    0,
                    255
                ),
                resolvedBy,
                suggestionId,
            ]
        );

        // Steering signal for future drafts: prefer this AI approach; do not treat
        // the team reply as the gold standard for similar asks.
        try {
            const { InboxAIService } = await import("./InboxAIService");
            const feedbackText = [
                "AI Response Preferred: a manager judged the AI reply better than the team reply for this guest ask.",
                "Do NOT copy the team's reply as the correct answer.",
                "Prefer the AI's approach/tone/caution for similar questions.",
                missNote ? `Audit had claimed: ${missNote.slice(0, 160)}` : null,
            ]
                .filter(Boolean)
                .join(" ");
            await new InboxAIService().recordFeedback({
                suggestionId,
                threadId: r.threadId != null ? Number(r.threadId) : null,
                messageId: r.messageId != null ? Number(r.messageId) : null,
                listingId: r.listingId != null ? Number(r.listingId) : null,
                reservationId: r.reservationId != null ? Number(r.reservationId) : null,
                userId: byUser.id,
                rating: "up",
                categories: ["AI Response Preferred"],
                feedbackText,
                correctedResponse: aiReply || null,
                targetType: "suggestion",
                originalMessage: teamReply || null,
            });
        } catch {
            /* feedback is best-effort; verdict flip already saved */
        }

        // Close pending learning prompts — the AI wasn't wrong, so don't wait
        // for staff to "teach" a correction based on this false miss.
        const isQuo = r.source === "quo";
        await appDatabase.query(
            `UPDATE ai_learning_prompts
             SET status = 'dismissed',
                 resolvedAt = NOW(),
                 resolvedVia = 'ai_preferred',
                 answerText = COALESCE(answerText, ?)
             WHERE source = ? AND status = 'pending'
               AND (sampleSuggestionId = ? OR threadId = ?)`,
            [
                "Dismissed — manager preferred the AI reply over the team reply.",
                isQuo ? "quo" : "hostify",
                suggestionId,
                r.threadId,
            ]
        ).catch(() => undefined);

        return { saved: true, resolvedBy };
    }

    /** Resolve a Supabase uid to the users row (numeric id + display name); name falls back to the raw uid. */
    private async resolveUser(userId?: string | null): Promise<{ id: number | null; name: string | null }> {
        const uid = String(userId || "").trim();
        if (!uid) return { id: null, name: null };
        try {
            const rows: any[] = await appDatabase.query(
                `SELECT id, firstName, lastName, email FROM users WHERE uid = ? LIMIT 1`,
                [uid]
            );
            const u = rows?.[0];
            const name = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();
            return { id: u?.id != null ? Number(u.id) : null, name: name || u?.email || uid };
        } catch {
            return { id: null, name: uid };
        }
    }

    private async resolveUserName(userId?: string | null): Promise<string | null> {
        return (await this.resolveUser(userId)).name;
    }

    /** Bounded on-demand semantic backfill so the page can populate the chart now. */
    async backfillSemantic(limit = 500): Promise<{ backfilled: number; remaining: number }> {
        const audit = new InboxAIAuditService();
        // Classify comparability too (cheap, no embeddings) so excluded pairs drop out immediately.
        await audit.backfillMatchQuality(3000).catch(() => ({ backfilled: 0 }));
        // Judge team-reply relevance for a bounded slice (LLM calls, so kept small
        // per click; the nightly job finishes the rest).
        await audit.backfillRelevance(150).catch(() => ({ backfilled: 0 }));
        const res = await audit.backfillSemantic(limit);
        const remainingRows: any[] = await appDatabase.query(
            `SELECT COUNT(*) c FROM ai_message_suggestions
             WHERE actualReplyText IS NOT NULL AND actualReplyText <> ''
               AND suggestedReply IS NOT NULL AND suggestedReply <> ''
               AND (replySemanticSimilarity IS NULL OR replyCoverageScore IS NULL)`
        );
        return { backfilled: res.backfilled, remaining: Number(remainingRows?.[0]?.c || 0) };
    }
}
