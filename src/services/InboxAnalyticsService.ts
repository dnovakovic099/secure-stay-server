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

interface Pair {
    id: number;
    threadId: number;
    channel: string | null;
    guestMsg: string | null;
    ai: string;
    other: string;
    jaccard: number;
    semantic: number | null;
    coverage: number | null;
    escalation: boolean;
    generatedAt: Date;
    matchQuality?: string | null;
}

const words = (s: string) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const deferRe =
    /(i['’]?ll (check|confirm|look into|find out|get back|follow up)|let me (check|confirm|find out)|get back to you|reach out to|our team will|will forward|check with (the|our)|i will (check|confirm|get back)|property manager will|team will (get|reach|be in touch))/i;
const specificsRe = /(\d{1,2}:\d{2}|\d{1,2}\s?(am|pm)|\$\d|\d{3,}|https?:\/\/|\bcode\b|\bwifi\b|\bpassword\b)/i;
const nonLatinRe = /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\u0600-\u06FF]/;
const ackRe =
    /^(yes|no|yep|sure|ok|okay|great|perfect|thanks|thank you|sounds good|got it|will do|done|absolutely|of course|no problem|you['’]?re welcome|awesome|wonderful|glad)/i;

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

/** AI and team replies are in clearly different languages — skip grading. */
function isLanguageMismatch(ai: string, team: string): boolean {
    if (nonLatinRe.test(team) !== nonLatinRe.test(ai)) return true;
    const la = detectLang(ai);
    const lt = detectLang(team);
    return !!(la && lt && la !== lt);
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
                    .sort((a, b) => this.simOf(a) - this.simOf(b))
                    .slice(0, 3)
                    .map((p) => ({
                        threadId: p.threadId,
                        channel: p.channel,
                        guestMessage: (p.guestMsg || "").replace(/\s+/g, " ").slice(0, 240),
                        aiReply: p.ai.replace(/\s+/g, " ").slice(0, 320),
                        theirReply: p.other.replace(/\s+/g, " ").slice(0, 320),
                        coverage: p.coverage,
                        semantic: p.semantic,
                        jaccard: p.jaccard,
                    })),
            }))
            .sort((a, b) => b.count - a.count);

        return {
            count: pairs.length,
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
        const byBucket: Record<string, { sem: number[]; jac: number[]; cov: number[] }> = {};
        for (const p of pairs) {
            const key = this.bucketKey(new Date(p.generatedAt), granularity);
            const b = (byBucket[key] = byBucket[key] || { sem: [], jac: [], cov: [] });
            if (p.semantic != null) b.sem.push(p.semantic);
            if (p.coverage != null) b.cov.push(p.coverage);
            b.jac.push(p.jaccard);
        }
        const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
        return Object.keys(byBucket)
            .sort()
            .map((key) => ({
                bucket: key,
                avgCoverage: avg(byBucket[key].cov),
                avgSemantic: avg(byBucket[key].sem),
                avgJaccard: avg(byBucket[key].jac),
                count: byBucket[key].jac.length,
            }));
    }

    async report(sinceDays = 60, granularity: "day" | "week" | "month" = "day"): Promise<any> {
        const days = Math.min(Math.max(sinceDays, 7), 180);
        const gran = granularity === "week" || granularity === "month" ? granularity : "day";

        // (a) vs TEAM (Hostify-captured replies).
        const teamRows: any[] = await appDatabase.query(
            `SELECT s.id, s.threadId, s.escalationRequired, s.suggestedReply, s.actualReplyText,
                    s.replySimilarity, s.replySemanticSimilarity, s.replyCoverageScore, s.auditMatchQuality, s.generatedAt,
                    c.channel, gm.body AS guestMsg
             FROM ai_message_suggestions s
             LEFT JOIN inbox_conversations c ON c.threadId = s.threadId
             LEFT JOIN inbox_messages gm ON gm.threadId = s.threadId AND gm.externalId = s.messageId
             WHERE s.actualReplyText IS NOT NULL AND s.actualReplyText <> ''
               AND s.suggestedReply IS NOT NULL AND s.suggestedReply <> ''
               AND s.generatedAt >= (NOW() - INTERVAL ? DAY)
             ORDER BY s.generatedAt DESC`,
            [days]
        );
        const teamPairs: Pair[] = teamRows.map((r) => ({
            id: Number(r.id),
            threadId: Number(r.threadId),
            channel: r.channel ?? null,
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
        }));

        // Exclude pairs that are not a fair grade of AI answer quality:
        //  - guest_followup: team answered a NEWER guest message than the AI drafted against
        //  - ops_driven: team reply is an internal ops action (PM callback, payment auth link…)
        //  - ack_only: team reply is a pure pleasantry with no substance to cover
        //  - name_mismatch: greeting names differ → replies are clearly to different messages/guests
        let teamOpsDriven = 0;
        let teamAckOnly = 0;
        let teamNameMismatch = 0;
        let teamLangMismatch = 0;
        const teamComparable = teamPairs.filter((p) => {
            if (p.matchQuality === "guest_followup") return false;
            if (opsDrivenRe.test(p.other)) {
                teamOpsDriven++;
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
            // Different languages (e.g. AI replied in the guest's Spanish, team in
            // English): embeddings under-score cross-language pairs, so skip.
            if (isLanguageMismatch(p.ai, p.other)) {
                teamLangMismatch++;
                return false;
            }
            return true;
        });
        const teamNotComparable = teamPairs.length - teamComparable.length;

        // (b) vs USER edits/rejects sent from SecureStay.
        const userRows: any[] = await appDatabase.query(
            `SELECT s.id, s.threadId, s.status, s.escalationRequired, s.suggestedReply, s.generatedAt,
                    c.channel, gm.body AS guestMsg, sm.body AS sentBody
             FROM ai_message_suggestions s
             LEFT JOIN inbox_conversations c ON c.threadId = s.threadId
             LEFT JOIN inbox_messages gm ON gm.threadId = s.threadId AND gm.externalId = s.messageId
             LEFT JOIN inbox_messages sm ON sm.threadId = s.threadId AND sm.externalId = s.finalSentMessageId
             WHERE s.status IN ('accepted','edited','rejected')
               AND s.finalSentMessageId IS NOT NULL
               AND s.suggestedReply IS NOT NULL AND s.suggestedReply <> ''
               AND s.generatedAt >= (NOW() - INTERVAL ? DAY)
             ORDER BY s.generatedAt DESC`,
            [days]
        );
        const userPairs: Pair[] = userRows
            .filter((r) => r.sentBody && String(r.sentBody).trim())
            .map((r) => ({
                id: Number(r.id),
                threadId: Number(r.threadId),
                channel: r.channel ?? null,
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

        return {
            sinceDays: days,
            granularity: gran,
            generatedAt: new Date().toISOString(),
            semanticCoverage: { scored: totalSemantic, total: totalMatched },
            dataQuality: {
                teamMatched: teamPairs.length,
                teamComparable: teamComparable.length,
                teamNotComparable, // total excluded (followup + ops + ack + name mismatch)
                teamOpsDriven,
                teamAckOnly,
                teamNameMismatch,
                teamLangMismatch,
            },
            vsTeam: this.summarize(teamComparable),
            vsUser: this.summarize(userPairs),
            trend: this.buildTrend(teamComparable, gran),
        };
    }

    /** Bounded on-demand semantic backfill so the page can populate the chart now. */
    async backfillSemantic(limit = 500): Promise<{ backfilled: number; remaining: number }> {
        const audit = new InboxAIAuditService();
        // Classify comparability too (cheap, no embeddings) so excluded pairs drop out immediately.
        await audit.backfillMatchQuality(3000).catch(() => ({ backfilled: 0 }));
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
