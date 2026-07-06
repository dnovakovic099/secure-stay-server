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
    escalation: boolean;
    generatedAt: Date;
}

const words = (s: string) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const deferRe =
    /(i['’]?ll (check|confirm|look into|find out|get back|follow up)|let me (check|confirm|find out)|get back to you|reach out to|our team will|will forward|check with (the|our)|i will (check|confirm|get back)|property manager will|team will (get|reach|be in touch))/i;
const specificsRe = /(\d{1,2}:\d{2}|\d{1,2}\s?(am|pm)|\$\d|\d{3,}|https?:\/\/|\bcode\b|\bwifi\b|\bpassword\b)/i;
const nonLatinRe = /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\u0600-\u06FF]/;
const ackRe =
    /^(yes|no|yep|sure|ok|okay|great|perfect|thanks|thank you|sounds good|got it|will do|done|absolutely|of course|no problem|you['’]?re welcome|awesome|wonderful|glad)/i;

const REASON_LABELS: Record<string, string> = {
    team_ack_short: "They sent a short acknowledgement",
    ai_deferred_or_escalated: "AI deferred / escalated; they answered directly",
    team_specifics_ai_missing: "They gave specifics the AI didn't have",
    ai_verbose: "AI reply much longer than theirs",
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
    /** Primary similarity metric for a pair (semantic if available, else jaccard). */
    private simOf(p: Pair): number {
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
        if (wOther > 0 && words(ai) / Math.max(wOther, 1) >= 2.5) return "ai_verbose";
        return "other_wording";
    }

    private summarize(pairs: Pair[], lowThreshold = 45) {
        const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : 0);
        const sem = pairs.filter((p) => p.semantic != null).map((p) => p.semantic as number);
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
                        semantic: p.semantic,
                        jaccard: p.jaccard,
                    })),
            }))
            .sort((a, b) => b.count - a.count);

        return {
            count: pairs.length,
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
        const byBucket: Record<string, { sem: number[]; jac: number[] }> = {};
        for (const p of pairs) {
            const key = this.bucketKey(new Date(p.generatedAt), granularity);
            const b = (byBucket[key] = byBucket[key] || { sem: [], jac: [] });
            if (p.semantic != null) b.sem.push(p.semantic);
            b.jac.push(p.jaccard);
        }
        const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
        return Object.keys(byBucket)
            .sort()
            .map((key) => ({
                bucket: key,
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
                    s.replySimilarity, s.replySemanticSimilarity, s.generatedAt,
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
            escalation: Number(r.escalationRequired) === 1,
            generatedAt: r.generatedAt,
        }));

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
                escalation: Number(r.escalationRequired) === 1,
                generatedAt: r.generatedAt,
            }));

        // Overall totals for semantic coverage messaging.
        const totalMatched = teamPairs.length;
        const totalSemantic = teamPairs.filter((p) => p.semantic != null).length;

        return {
            sinceDays: days,
            granularity: gran,
            generatedAt: new Date().toISOString(),
            semanticCoverage: { scored: totalSemantic, total: totalMatched },
            vsTeam: this.summarize(teamPairs),
            vsUser: this.summarize(userPairs),
            trend: this.buildTrend(teamPairs, gran),
        };
    }

    /** Bounded on-demand semantic backfill so the page can populate the chart now. */
    async backfillSemantic(limit = 500): Promise<{ backfilled: number; remaining: number }> {
        const res = await new InboxAIAuditService().backfillSemantic(limit);
        const remainingRows: any[] = await appDatabase.query(
            `SELECT COUNT(*) c FROM ai_message_suggestions
             WHERE actualReplyText IS NOT NULL AND actualReplyText <> ''
               AND suggestedReply IS NOT NULL AND suggestedReply <> ''
               AND replySemanticSimilarity IS NULL`
        );
        return { backfilled: res.backfilled, remaining: Number(remainingRows?.[0]?.c || 0) };
    }
}
