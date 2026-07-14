import { appDatabase } from "../utils/database.util";

/**
 * Admin-only insights: who trains the AI (feedback, learning answers, taught
 * facts, suggestion outcomes), who replies in the inboxes, whose replies grade
 * best, and a transparent per-user activity/time estimate. The heavier
 * AI-graded "hours worked" lives in AdminWorkloadService.
 */

const DEFAULT_ADMIN_EMAILS = [
    "dnovakovic21@gmail.com",
    "angelica@luxurylodgingpm.com",
    "admin@luxurylodgingpm.com",
];

export function adminEmails(): Set<string> {
    const extra = (process.env.ADMIN_INSIGHTS_EMAILS || "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
    return new Set([...DEFAULT_ADMIN_EMAILS, ...extra]);
}

export function isAdminEmail(email: string | null | undefined): boolean {
    return !!email && adminEmails().has(String(email).trim().toLowerCase());
}

export class AdminInsightsService {
    private sinceDate(days: number): Date {
        return new Date(Date.now() - Math.min(Math.max(days || 30, 1), 365) * 86400000);
    }

    /** users.id -> display name map for everything below. */
    private async userNames(): Promise<Map<number, string>> {
        const rows: any[] = await appDatabase.query(
            "SELECT id, firstName, lastName, email FROM users WHERE deletedAt IS NULL"
        );
        const map = new Map<number, string>();
        for (const u of rows) {
            const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
            map.set(Number(u.id), name || u.email || `user ${u.id}`);
        }
        return map;
    }

    // -------------------------------------------------------------------------
    // Overview: per-user AI-training + reply counts + quality + time estimate.
    // -------------------------------------------------------------------------
    async overview(days: number): Promise<any> {
        const since = this.sinceDate(days);
        const names = await this.userNames();
        const nameOf = (id: any) => (id != null && names.get(Number(id))) || null;

        type Row = Record<string, any>;
        const q = (sql: string, params: any[] = [since]): Promise<Row[]> =>
            appDatabase.query(sql, params).catch(() => [] as Row[]);

        const [
            feedback,
            prompts,
            factsTaught,
            factsReviewed,
            suggestionActions,
            missesResolved,
            discards,
            hostifyReplies,
            quoReplies,
            replyQuality,
        ] = await Promise.all([
            q(`SELECT userId, rating, COUNT(*) c,
                      SUM(feedbackText IS NOT NULL AND feedbackText <> '') withText,
                      SUM(correctedResponse IS NOT NULL AND correctedResponse <> '') withCorrection
               FROM ai_message_feedback WHERE userId IS NOT NULL AND createdAt >= ? GROUP BY userId, rating`),
            q(`SELECT answeredByUserId AS userId, status, COUNT(*) c
               FROM ai_learning_prompts WHERE answeredByUserId IS NOT NULL AND resolvedAt >= ? GROUP BY answeredByUserId, status`),
            q(`SELECT createdByUserId AS userId, COUNT(*) c
               FROM ai_learned_facts WHERE createdByUserId IS NOT NULL AND createdAt >= ? GROUP BY createdByUserId`),
            q(`SELECT reviewedByUserId AS userId, COUNT(*) c
               FROM ai_learned_facts WHERE reviewedByUserId IS NOT NULL AND updatedAt >= ? GROUP BY reviewedByUserId`),
            q(`SELECT acceptedByUserId AS userId, status, COUNT(*) c
               FROM ai_message_suggestions WHERE acceptedByUserId IS NOT NULL AND generatedAt >= ? GROUP BY acceptedByUserId, status`),
            q(`SELECT missResolvedBy AS name, COUNT(*) c
               FROM ai_message_suggestions WHERE missResolvedBy IS NOT NULL AND missResolvedAt >= ? GROUP BY missResolvedBy`),
            q(`SELECT discardedBy AS name, COUNT(*) c
               FROM ai_discard_feedback WHERE discardedBy IS NOT NULL AND createdAt >= ? GROUP BY discardedBy`),
            // Team replies land two ways: sent from our dashboard (sentByUserId)
            // or sent in Hostify itself and synced back with the rep's name in
            // senderName. Count both; exclude the AI's auto-sends.
            q(`SELECT sentByUserId AS userId, COALESCE(sentByName, senderName) AS name, COUNT(*) c,
                      COUNT(DISTINCT threadId) threads, MIN(sentAt) firstAt, MAX(sentAt) lastAt
               FROM inbox_messages
               WHERE direction = 'outgoing' AND sentVia <> 'ai_auto' AND sentAt >= ?
                 AND TRIM(COALESCE(sentByName, senderName, '')) <> ''
               GROUP BY sentByUserId, COALESCE(sentByName, senderName)`),
            q(`SELECT sentByUserId AS userId, senderName AS name, COUNT(*) c,
                      COUNT(DISTINCT conversationId) threads, MIN(sentAt) firstAt, MAX(sentAt) lastAt
               FROM quo_messages
               WHERE direction = 'outgoing' AND sentAt >= ? AND (sentByUserId IS NOT NULL OR senderName IS NOT NULL)
               GROUP BY sentByUserId, senderName`),
            // "Replied best": team replies captured by the nightly audit, joined
            // back to the sender. replyRelevance='relevant' means the judge said
            // their reply actually addressed the guest's message.
            q(`SELECT COALESCE(m.sentByName, m.senderName) AS name, m.sentByUserId AS userId,
                      COUNT(*) compared,
                      SUM(s.replyRelevance = 'relevant') answers,
                      SUM(s.replyRelevance = 'off_topic') offTopic,
                      AVG(NULLIF(s.replyCoverageScore, -1)) avgCoverage
               FROM ai_message_suggestions s
               JOIN inbox_messages m ON m.externalId = s.actualReplyMessageId AND m.threadId = s.threadId
               WHERE s.source = 'hostify' AND s.actualReplyAt >= ? AND s.actualReplyText IS NOT NULL
                 AND COALESCE(m.sentByName, m.senderName) IS NOT NULL
               GROUP BY COALESCE(m.sentByName, m.senderName), m.sentByUserId
               HAVING compared >= 3
               ORDER BY compared DESC`),
        ]);

        // ---- fold the AI-training rows into one record per user -------------
        const training = new Map<string, any>();
        const ensure = (key: string, userId: number | null, name: string | null) => {
            if (!training.has(key)) {
                training.set(key, {
                    userId,
                    name: name || (userId != null ? nameOf(userId) : null) || key,
                    thumbsUp: 0,
                    thumbsDown: 0,
                    textFeedback: 0,
                    corrections: 0,
                    promptsAnswered: 0,
                    promptsDismissed: 0,
                    factsTaught: 0,
                    factsReviewed: 0,
                    suggestionsAccepted: 0,
                    suggestionsEdited: 0,
                    suggestionsIgnored: 0,
                    missesResolved: 0,
                    itemsDiscarded: 0,
                });
            }
            return training.get(key);
        };
        const byUserId = (id: any) => ensure(`u${id}`, Number(id), nameOf(id));

        for (const r of feedback) {
            const t = byUserId(r.userId);
            if (r.rating === "up") t.thumbsUp += Number(r.c);
            else if (r.rating === "down") t.thumbsDown += Number(r.c);
            t.textFeedback += Number(r.withText || 0);
            t.corrections += Number(r.withCorrection || 0);
        }
        for (const r of prompts) {
            const t = byUserId(r.userId);
            if (r.status === "dismissed") t.promptsDismissed += Number(r.c);
            else t.promptsAnswered += Number(r.c);
        }
        for (const r of factsTaught) byUserId(r.userId).factsTaught += Number(r.c);
        for (const r of factsReviewed) byUserId(r.userId).factsReviewed += Number(r.c);
        for (const r of suggestionActions) {
            const t = byUserId(r.userId);
            if (r.status === "accepted" || r.status === "auto_sent") t.suggestionsAccepted += Number(r.c);
            else if (r.status === "edited") t.suggestionsEdited += Number(r.c);
            else if (r.status === "ignored" || r.status === "rejected") t.suggestionsIgnored += Number(r.c);
        }
        // Name-keyed sources (no numeric id stored) — merge by display name.
        const byName = (name: string) => {
            for (const t of training.values()) if (t.name === name) return t;
            return ensure(`n${name}`, null, name);
        };
        for (const r of missesResolved) byName(String(r.name)).missesResolved += Number(r.c);
        for (const r of discards) byName(String(r.name)).itemsDiscarded += Number(r.c);

        const trainingRows = [...training.values()]
            .map((t) => ({
                ...t,
                total:
                    t.thumbsUp + t.thumbsDown + t.textFeedback + t.promptsAnswered + t.promptsDismissed +
                    t.factsTaught + t.factsReviewed + t.missesResolved + t.itemsDiscarded,
            }))
            .filter((t) => t.total > 0 || t.suggestionsAccepted + t.suggestionsEdited + t.suggestionsIgnored > 0)
            .sort((a, b) => b.total - a.total);

        // ---- replies (merge hostify + quo per user) --------------------------
        const replies = new Map<string, any>();
        const repKey = (userId: any, name: any) => (userId != null ? `u${userId}` : `n${name}`);
        for (const src of [
            { rows: hostifyReplies, field: "hostify" },
            { rows: quoReplies, field: "quo" },
        ]) {
            for (const r of src.rows) {
                const k = repKey(r.userId, r.name);
                if (!replies.has(k)) {
                    replies.set(k, {
                        userId: r.userId != null ? Number(r.userId) : null,
                        name: (r.userId != null && nameOf(r.userId)) || r.name || "unknown",
                        hostify: 0,
                        quo: 0,
                        threads: 0,
                    });
                }
                const rec = replies.get(k);
                rec[src.field] += Number(r.c);
                rec.threads += Number(r.threads || 0);
            }
        }
        const replyRows = [...replies.values()]
            .map((r) => ({ ...r, total: r.hostify + r.quo }))
            .sort((a, b) => b.total - a.total);

        // ---- reply quality ("who replied best") ------------------------------
        const qualityRows = replyQuality.map((r) => ({
            userId: r.userId != null ? Number(r.userId) : null,
            name: (r.userId != null && nameOf(r.userId)) || r.name,
            compared: Number(r.compared),
            answers: Number(r.answers || 0),
            offTopic: Number(r.offTopic || 0),
            answerRate: Number(r.compared) ? Math.round((Number(r.answers || 0) / Number(r.compared)) * 100) : null,
            avgCoverage: r.avgCoverage != null ? Math.round(Number(r.avgCoverage)) : null,
        }));
        qualityRows.sort((a, b) => (b.answerRate ?? -1) - (a.answerRate ?? -1) || b.compared - a.compared);

        // ---- transparent time estimate (deterministic, per user) -------------
        // 2 min per inbox reply, 1.5 per Quo SMS, 2 per learning answer,
        // 1.5 per feedback, 3 per taught fact. The AI-graded hours (workload
        // tab) are the richer number; this is a quick same-page reference.
        const estimate = new Map<string, { name: string; minutes: number }>();
        const addMin = (key: string, name: string, min: number) => {
            if (!estimate.has(key)) estimate.set(key, { name, minutes: 0 });
            estimate.get(key)!.minutes += min;
        };
        for (const r of replyRows) addMin(repKey(r.userId, r.name), r.name, r.hostify * 2 + r.quo * 1.5);
        for (const t of trainingRows) {
            addMin(t.userId != null ? `u${t.userId}` : `n${t.name}`, t.name,
                t.promptsAnswered * 2 + (t.thumbsUp + t.thumbsDown + t.textFeedback) * 1.5 + t.factsTaught * 3);
        }
        const timeRows = [...estimate.values()]
            .map((e) => ({ name: e.name, estimatedHours: +(e.minutes / 60).toFixed(1) }))
            .filter((e) => e.estimatedHours > 0)
            .sort((a, b) => b.estimatedHours - a.estimatedHours);

        return {
            days,
            since: since.toISOString(),
            training: trainingRows,
            replies: replyRows,
            replyQuality: qualityRows,
            timeEstimate: timeRows,
        };
    }

    // -------------------------------------------------------------------------
    // Detailed feedback log ("who left what feedback").
    // -------------------------------------------------------------------------
    async feedbackLog(days: number, limit = 50, offset = 0): Promise<any> {
        const since = this.sinceDate(days);
        const names = await this.userNames();
        const rows: any[] = await appDatabase.query(
            `SELECT f.id, f.userId, f.rating, f.categories, f.feedbackText, f.correctedResponse,
                    f.createdAt, f.threadId, f.listingId, f.suggestionId,
                    LEFT(s.suggestedReply, 300) AS suggestedReply, s.source AS suggestionSource, s.quoConversationId
             FROM ai_message_feedback f
             LEFT JOIN ai_message_suggestions s ON s.id = f.suggestionId
             WHERE f.createdAt >= ?
             ORDER BY f.createdAt DESC
             LIMIT ? OFFSET ?`,
            [since, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0)]
        );
        const [{ total }] = (await appDatabase.query(
            `SELECT COUNT(*) total FROM ai_message_feedback WHERE createdAt >= ?`,
            [since]
        )) as any[];
        return {
            total: Number(total),
            items: rows.map((r) => ({
                id: r.id,
                userId: r.userId != null ? Number(r.userId) : null,
                userName: (r.userId != null && names.get(Number(r.userId))) || "unknown",
                rating: r.rating,
                categories: (() => {
                    try {
                        return JSON.parse(r.categories || "[]");
                    } catch {
                        return [];
                    }
                })(),
                feedbackText: r.feedbackText,
                correctedResponse: r.correctedResponse,
                suggestedReply: r.suggestedReply,
                suggestionSource: r.suggestionSource || null,
                threadId: r.threadId != null ? Number(r.threadId) : null,
                quoConversationId: r.quoConversationId || null,
                createdAt: r.createdAt,
            })),
        };
    }
}
