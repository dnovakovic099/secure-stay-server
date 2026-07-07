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
    relevance?: string | null;
    relevanceNote?: string | null;
    aiQuality?: string | null;
    aiQualityNote?: string | null;
    aiQualityCategory?: string | null;
    missResolvedAt?: Date | null;
    confidence?: number | null;
}

const words = (s: string) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
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
                        channel: p.channel,
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

    /** Load AI-vs-team pairs (Hostify-captured replies) for the last N days. */
    private async loadTeamPairs(days: number): Promise<Pair[]> {
        const teamRows: any[] = await appDatabase.query(
            `SELECT s.id, s.threadId, s.escalationRequired, s.suggestedReply, s.actualReplyText, s.confidence, s.verifierConfidence,
                    s.replySimilarity, s.replySemanticSimilarity, s.replyCoverageScore, s.auditMatchQuality,
                    s.replyRelevance, s.replyRelevanceNote, s.aiReplyQuality, s.aiReplyQualityNote,
                    s.aiReplyQualityCategory, s.missResolvedAt, s.generatedAt,
                    c.channel,
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
            relevance: r.replyRelevance ?? null,
            relevanceNote: r.replyRelevanceNote ?? null,
            aiQuality: r.aiReplyQuality ?? null,
            aiQualityNote: r.aiReplyQualityNote ?? null,
            aiQualityCategory: r.aiReplyQualityCategory ?? null,
            missResolvedAt: r.missResolvedAt ?? null,
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

    async report(sinceDays = 60, granularity: "day" | "week" | "month" = "day"): Promise<any> {
        const days = Math.min(Math.max(sinceDays, 7), 180);
        const gran = granularity === "week" || granularity === "month" ? granularity : "day";

        const teamPairs = await this.loadTeamPairs(days);
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

        // (b) vs USER edits/rejects sent from SecureStay.
        const userRows: any[] = await appDatabase.query(
            `SELECT s.id, s.threadId, s.status, s.escalationRequired, s.suggestedReply, s.generatedAt,
                    c.channel,
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
        // Pairs not yet relevance-judged (LLM): drives the "Compute now" nudge too,
        // since unjudged off-topic replies silently drag the coverage average down.
        const relevancePending = teamPairs.filter(
            (p) => p.relevance == null && p.matchQuality !== "guest_followup"
        ).length;

        return {
            sinceDays: days,
            granularity: gran,
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
                    channel: p.channel,
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
        limit = 50
    ): Promise<any> {
        const days = Math.min(Math.max(sinceDays, 7), 180);
        const cap = Math.min(Math.max(limit, 1), 100);
        const m = metric === "semantic" || metric === "jaccard" ? metric : "coverage";

        const teamPairs = await this.loadTeamPairs(days);
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
                channel: p.channel,
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
     * "Replies to fix" queue: every pair the LLM judged as a true AI miss
     * (guest asked for something specific, AI failed while the team delivered,
     * or the AI was wrong). Grouped counts by root cause so fixes can be routed
     * (missing_info → add KB fact, wrong_info → correct KB, deferral → behavior).
     */
    async misses(sinceDays = 60, includeResolved = false): Promise<any> {
        const days = Math.min(Math.max(sinceDays, 7), 180);
        const teamPairs = await this.loadTeamPairs(days);
        // Same fairness filters as the scores: a "miss" judged against a
        // follow-up or off-topic team reply isn't actionable.
        const { teamComparable } = this.filterComparable(teamPairs);

        const all = teamComparable.filter((p) => p.aiQuality === "missed");
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

        // Has the AI already taken steps on each miss? Two self-healing paths:
        //  - a learned fact for the same listing whose content matches the miss
        //    (nightly extraction or a staff answer already covered it), or
        //  - a learning prompt raised on the same thread (the bot asked the team).
        const threadIds = [...new Set(list.map((p) => p.threadId))];
        const listingRows: any[] = threadIds.length
            ? await appDatabase.query(
                  `SELECT threadId, listingId FROM inbox_conversations WHERE threadId IN (${threadIds.map(() => "?").join(",")})`,
                  threadIds
              )
            : [];
        const listingByThread = new Map<number, number | null>(
            listingRows.map((r) => [Number(r.threadId), r.listingId != null ? Number(r.listingId) : null])
        );
        const listingIds = [...new Set(listingRows.map((r) => Number(r.listingId)).filter(Boolean))];
        const facts: any[] = listingIds.length
            ? await appDatabase.query(
                  `SELECT listingId, scope, topic, question, answer, status, createdAt FROM ai_learned_facts
                   WHERE status IN ('approved','pending') AND (scope = 'portfolio' OR listingId IN (${listingIds.map(() => "?").join(",")}))`,
                  listingIds
              )
            : [];
        const prompts: any[] = threadIds.length
            ? await appDatabase.query(
                  `SELECT threadId, question, status, answerText FROM ai_learning_prompts
                   WHERE threadId IN (${threadIds.map(() => "?").join(",")})
                   ORDER BY createdAt DESC`,
                  threadIds
              )
            : [];
        const promptByThread = new Map<number, any>();
        for (const pr of prompts) {
            if (!promptByThread.has(Number(pr.threadId))) promptByThread.set(Number(pr.threadId), pr);
        }

        // Generic phrasing that matches everything and means nothing.
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
            // One shared word (e.g. just "check") is coincidence, not a match.
            if (inter < 2) return 0;
            return inter / Math.min(A.size, B.size);
        };

        const remediationOf = (p: Pair) => {
            const lid = listingByThread.get(p.threadId) ?? null;
            // Match on the judge's note (short, topical). The raw guest message is
            // full of generic conversational words that create false matches.
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
            if (best && bestScore >= 0.45) {
                return {
                    status: best.status === "approved" ? "learned" : "learned_pending_review",
                    detail: String(best.answer || best.question || best.topic).replace(/\s+/g, " ").slice(0, 220),
                };
            }
            const prompt = promptByThread.get(p.threadId);
            if (prompt) {
                return {
                    status: prompt.status === "pending" ? "asked" : "answered",
                    detail: String(prompt.status === "pending" ? prompt.question : prompt.answerText || prompt.question)
                        .replace(/\s+/g, " ")
                        .slice(0, 220),
                };
            }
            return { status: "none", detail: null as string | null };
        };

        return {
            sinceDays: days,
            total: all.length,
            unresolved: unresolved.length,
            resolved: all.length - unresolved.length,
            byCategory,
            examples: list.map((p) => ({
                id: p.id,
                threadId: p.threadId,
                channel: p.channel,
                guestMessage: (p.guestMsg || "").replace(/\s+/g, " ").slice(0, 240),
                aiReply: p.ai.replace(/\s+/g, " ").slice(0, 320),
                theirReply: p.other.replace(/\s+/g, " ").slice(0, 320),
                note: p.aiQualityNote || null,
                category: p.aiQualityCategory || "other",
                coverage: p.coverage,
                confidence: p.confidence ?? null,
                resolvedAt: p.missResolvedAt || null,
                generatedAt: p.generatedAt,
                remediation: remediationOf(p),
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
        scope: "property" | "portfolio" = "property"
    ): Promise<{ saved: boolean }> {
        const text = (answer || "").trim();
        if (!text) return { saved: false };
        const rows: any[] = await appDatabase.query(
            `SELECT s.id, s.threadId, s.aiReplyQualityNote, s.messageId, c.listingId
             FROM ai_message_suggestions s
             LEFT JOIN inbox_conversations c ON c.threadId = s.threadId
             WHERE s.id = ?`,
            [suggestionId]
        );
        if (!rows.length) return { saved: false };
        const r = rows[0];
        const guestRows: any[] = r.messageId
            ? await appDatabase.query(
                  `SELECT body FROM inbox_messages WHERE threadId = ? AND externalId = ? LIMIT 1`,
                  [r.threadId, r.messageId]
              )
            : [];
        const question = String(r.aiReplyQualityNote || guestRows?.[0]?.body || "guest question").slice(0, 500);

        const { AILearnedFactsService } = await import("./AILearnedFactsService");
        const { InboxAIAuditService } = await import("./InboxAIAuditService");
        const learned = new AILearnedFactsService();
        const listingId = r.listingId != null ? Number(r.listingId) : null;
        await learned.upsert(
            {
                scope: scope === "portfolio" ? "portfolio" : "property",
                listingId,
                topic: question.slice(0, 120),
                question,
                answer: text,
                sampleThreadId: Number(r.threadId),
                source: "manual",
            },
            { autoApprove: InboxAIAuditService.autoApproveFacts(), trustedSource: true }
        );
        await appDatabase.query(`UPDATE ai_message_suggestions SET missResolvedAt = NOW() WHERE id = ?`, [suggestionId]);
        // If the AI had raised a learning question on this thread, the manager's
        // answer covers it — close it so the team isn't asked again in the inbox.
        await appDatabase.query(
            `UPDATE ai_learning_prompts
             SET status = 'answered', answerText = ?, answerScope = ?, resolvedAt = NOW(), resolvedVia = 'staff'
             WHERE threadId = ? AND status = 'pending'`,
            [text, scope === "portfolio" ? "portfolio" : "property", r.threadId]
        );
        return { saved: true };
    }

    /** Mark / unmark a miss as handled so the fix queue shrinks as it's worked. */
    async resolveMiss(suggestionId: number, resolved: boolean): Promise<{ resolvedAt: Date | null }> {
        const resolvedAt = resolved ? new Date() : null;
        await appDatabase.query(
            `UPDATE ai_message_suggestions SET missResolvedAt = ? WHERE id = ?`,
            [resolvedAt, suggestionId]
        );
        return { resolvedAt };
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
