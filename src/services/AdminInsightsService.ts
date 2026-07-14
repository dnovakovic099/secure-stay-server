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

export interface AdminInsightFilters {
    days?: number;
    startDate?: string | null;
    endDate?: string | null;
    listingId?: number | null;
    userId?: number | null;
}

type DateWindow = { from: Date; to: Date; days: number };
type Row = Record<string, any>;

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
    private window(filters: AdminInsightFilters): DateWindow {
        const days = Math.min(Math.max(Number(filters.days) || 30, 1), 365);
        const fallbackFrom = new Date(Date.now() - days * 86400000);
        const from = filters.startDate ? new Date(`${filters.startDate}T00:00:00.000Z`) : fallbackFrom;
        const to = filters.endDate ? new Date(`${filters.endDate}T23:59:59.999Z`) : new Date();
        const spanDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));
        return { from, to, days: spanDays };
    }

    private async userNames(): Promise<Map<number, string>> {
        const rows: Row[] = await appDatabase.query(
            "SELECT id, firstName, lastName, email FROM users WHERE deletedAt IS NULL"
        );
        const map = new Map<number, string>();
        for (const u of rows) {
            const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
            map.set(Number(u.id), name || u.email || `user ${u.id}`);
        }
        return map;
    }

    private range(column: string, w: DateWindow, params: any[]): string {
        params.push(w.from, w.to);
        return `${column} >= ? AND ${column} <= ?`;
    }

    private scoped(
        clauses: string[],
        params: any[],
        filters: AdminInsightFilters,
        opts: { listingColumn?: string; userColumn?: string; userNameColumn?: string; userName?: string | null } = {}
    ) {
        if (filters.listingId != null && opts.listingColumn) {
            clauses.push(`${opts.listingColumn} = ?`);
            params.push(filters.listingId);
        }
        if (filters.userId != null && opts.userColumn) {
            clauses.push(`${opts.userColumn} = ?`);
            params.push(filters.userId);
        } else if (filters.userId != null && opts.userNameColumn && opts.userName) {
            clauses.push(`${opts.userNameColumn} = ?`);
            params.push(opts.userName);
        }
    }

    private async q(sql: string, params: any[] = []): Promise<Row[]> {
        return appDatabase.query(sql, params).catch(() => [] as Row[]);
    }

    async filterOptions(): Promise<any> {
        const [users, listings] = await Promise.all([
            this.q(
                `SELECT id, firstName, lastName, email
                 FROM users
                 WHERE deletedAt IS NULL
                 ORDER BY firstName, lastName, email`
            ),
            this.q(
                `SELECT listingId AS id, MAX(listingName) AS name
                 FROM (
                    SELECT listingId, listingName FROM inbox_conversations WHERE listingId IS NOT NULL
                    UNION ALL
                    SELECT listingId, listingName FROM quo_conversations WHERE listingId IS NOT NULL
                    UNION ALL
                    SELECT listingId, listingName FROM ai_learning_prompts WHERE listingId IS NOT NULL
                    UNION ALL
                    SELECT listingId, NULL AS listingName FROM ai_learned_facts WHERE listingId IS NOT NULL
                 ) x
                 GROUP BY listingId
                 ORDER BY MAX(listingName), listingId
                 LIMIT 1000`
            ),
        ]);
        return {
            users: users.map((u) => ({
                id: Number(u.id),
                name: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || `user ${u.id}`,
                email: u.email || null,
            })),
            properties: listings.map((l) => ({
                id: Number(l.id),
                name: l.name || `Listing ${l.id}`,
            })),
        };
    }

    async overview(filters: AdminInsightFilters): Promise<any> {
        const w = this.window(filters);
        const names = await this.userNames();
        const nameOf = (id: any) => (id != null && names.get(Number(id))) || null;
        const selectedUserName = filters.userId != null ? nameOf(filters.userId) : null;

        const withRange = (column: string) => {
            const params: any[] = [];
            const clauses = [this.range(column, w, params)];
            return { clauses, params };
        };

        const feedbackScope = withRange("createdAt");
        this.scoped(feedbackScope.clauses, feedbackScope.params, filters, { listingColumn: "listingId", userColumn: "userId" });
        const promptScope = withRange("resolvedAt");
        this.scoped(promptScope.clauses, promptScope.params, filters, { listingColumn: "listingId", userColumn: "answeredByUserId" });
        const factsCreatedScope = withRange("createdAt");
        this.scoped(factsCreatedScope.clauses, factsCreatedScope.params, filters, { listingColumn: "listingId", userColumn: "createdByUserId" });
        const factsReviewedScope = withRange("updatedAt");
        this.scoped(factsReviewedScope.clauses, factsReviewedScope.params, filters, { listingColumn: "listingId", userColumn: "reviewedByUserId" });
        const suggestionScope = withRange("generatedAt");
        this.scoped(suggestionScope.clauses, suggestionScope.params, filters, { listingColumn: "listingId", userColumn: "acceptedByUserId" });
        const missesScope = withRange("missResolvedAt");
        this.scoped(missesScope.clauses, missesScope.params, filters, {
            listingColumn: "listingId",
            userNameColumn: "missResolvedBy",
            userName: selectedUserName,
        });
        const discardScope = withRange("createdAt");
        this.scoped(discardScope.clauses, discardScope.params, filters, {
            listingColumn: "listingId",
            userNameColumn: "discardedBy",
            userName: selectedUserName,
        });
        const autoFactsScope = withRange("createdAt");
        if (filters.listingId != null) {
            autoFactsScope.clauses.push("listingId = ?");
            autoFactsScope.params.push(filters.listingId);
        }

        const hostifyScope = withRange("m.sentAt");
        this.scoped(hostifyScope.clauses, hostifyScope.params, filters, { listingColumn: "m.listingId", userColumn: "m.sentByUserId" });
        const quoScope = withRange("m.sentAt");
        if (filters.listingId != null) {
            quoScope.clauses.push("c.listingId = ?");
            quoScope.params.push(filters.listingId);
        }
        if (filters.userId != null) {
            quoScope.clauses.push("m.sentByUserId = ?");
            quoScope.params.push(filters.userId);
        }
        const qualityScope = withRange("s.actualReplyAt");
        this.scoped(qualityScope.clauses, qualityScope.params, filters, { listingColumn: "s.listingId", userColumn: "m.sentByUserId" });
        const aiQualityScope = withRange("s.auditedAt");
        if (filters.listingId != null) {
            aiQualityScope.clauses.push("s.listingId = ?");
            aiQualityScope.params.push(filters.listingId);
        }

        const [
            feedback,
            prompts,
            factsTaught,
            factsReviewed,
            suggestionActions,
            missesResolved,
            discards,
            autoFacts,
            hostifyReplies,
            aiReplies,
            quoReplies,
            replyQuality,
            aiReplyQuality,
            responseSummary,
            responseUsers,
        ] = await Promise.all([
            this.q(
                `SELECT userId, rating, COUNT(*) c,
                        SUM(feedbackText IS NOT NULL AND feedbackText <> '') withText,
                        SUM(correctedResponse IS NOT NULL AND correctedResponse <> '') withCorrection
                 FROM ai_message_feedback WHERE ${feedbackScope.clauses.join(" AND ")} GROUP BY userId, rating`,
                feedbackScope.params
            ),
            this.q(
                `SELECT answeredByUserId AS userId, status, COUNT(*) c
                 FROM ai_learning_prompts WHERE ${promptScope.clauses.join(" AND ")} GROUP BY answeredByUserId, status`,
                promptScope.params
            ),
            this.q(
                `SELECT createdByUserId AS userId, COUNT(*) c
                 FROM ai_learned_facts WHERE ${factsCreatedScope.clauses.join(" AND ")} GROUP BY createdByUserId`,
                factsCreatedScope.params
            ),
            this.q(
                `SELECT reviewedByUserId AS userId, COUNT(*) c
                 FROM ai_learned_facts WHERE ${factsReviewedScope.clauses.join(" AND ")} GROUP BY reviewedByUserId`,
                factsReviewedScope.params
            ),
            this.q(
                `SELECT acceptedByUserId AS userId, status, COUNT(*) c
                 FROM ai_message_suggestions WHERE ${suggestionScope.clauses.join(" AND ")} GROUP BY acceptedByUserId, status`,
                suggestionScope.params
            ),
            this.q(
                `SELECT missResolvedBy AS name, COUNT(*) c
                 FROM ai_message_suggestions WHERE ${missesScope.clauses.join(" AND ")} GROUP BY missResolvedBy`,
                missesScope.params
            ),
            this.q(
                `SELECT discardedBy AS name, COUNT(*) c
                 FROM ai_discard_feedback WHERE ${discardScope.clauses.join(" AND ")} GROUP BY discardedBy`,
                discardScope.params
            ),
            this.q(
                `SELECT COUNT(*) c FROM ai_learned_facts
                 WHERE source = 'nightly_audit' AND createdByUserId IS NULL AND ${autoFactsScope.clauses.join(" AND ")}`,
                autoFactsScope.params
            ),
            this.q(
                `SELECT sentByUserId AS userId, COALESCE(sentByName, senderName) AS name, COUNT(*) c,
                        COUNT(DISTINCT threadId) threads,
                        SUM(sentByUserId IS NOT NULL) actualUserReplies,
                        SUM(sentByUserId IS NULL) sourceAccountReplies
                 FROM inbox_messages m
                 WHERE direction = 'outgoing' AND sentVia <> 'ai_auto' AND ${hostifyScope.clauses.join(" AND ")}
                   AND TRIM(COALESCE(sentByName, senderName, '')) <> ''
                 GROUP BY sentByUserId, COALESCE(sentByName, senderName)`,
                hostifyScope.params
            ),
            this.q(
                `SELECT COUNT(*) c, COUNT(DISTINCT threadId) threads
                 FROM inbox_messages m
                 WHERE direction = 'outgoing' AND sentVia = 'ai_auto' AND ${hostifyScope.clauses.join(" AND ")}`,
                hostifyScope.params
            ),
            this.q(
                `SELECT m.sentByUserId AS userId, m.senderName AS name, COUNT(*) c,
                        COUNT(DISTINCT m.conversationId) threads,
                        SUM(m.sentByUserId IS NOT NULL) actualUserReplies,
                        SUM(m.sentByUserId IS NULL) sourceAccountReplies
                 FROM quo_messages m
                 LEFT JOIN quo_conversations c ON c.conversationId = m.conversationId
                 WHERE m.direction = 'outgoing' AND (m.sentByUserId IS NOT NULL OR m.senderName IS NOT NULL)
                   AND ${quoScope.clauses.join(" AND ")}
                 GROUP BY m.sentByUserId, m.senderName`,
                quoScope.params
            ),
            this.q(
                `SELECT COALESCE(m.sentByName, m.senderName) AS name, m.sentByUserId AS userId,
                        COUNT(*) compared,
                        SUM(s.replyRelevance = 'relevant') answers,
                        SUM(s.replyRelevance = 'off_topic') offTopic,
                        AVG(NULLIF(s.replyCoverageScore, -1)) avgCoverage
                 FROM ai_message_suggestions s
                 JOIN inbox_messages m ON m.externalId = s.actualReplyMessageId AND m.threadId = s.threadId
                 WHERE s.source = 'hostify' AND s.actualReplyText IS NOT NULL
                   AND COALESCE(m.sentByName, m.senderName) IS NOT NULL
                   AND ${qualityScope.clauses.join(" AND ")}
                 GROUP BY COALESCE(m.sentByName, m.senderName), m.sentByUserId
                 HAVING compared >= 3`,
                qualityScope.params
            ),
            this.q(
                `SELECT COUNT(*) compared,
                        SUM(aiReplyQuality = 'addressed') answers,
                        SUM(aiReplyQuality = 'missed') offTopic,
                        AVG(NULLIF(verifierConfidence, -1)) avgCoverage
                 FROM ai_message_suggestions s
                 WHERE s.aiReplyQuality IS NOT NULL AND s.aiReplyQuality <> 'unknown'
                   AND ${aiQualityScope.clauses.join(" AND ")}`,
                aiQualityScope.params
            ),
            this.responseSummary(filters, w),
            this.responseUsers(filters, w, names),
        ]);

        const training = new Map<string, any>();
        const ensure = (key: string, userId: number | null, name: string | null, identityType: string = "user") => {
            if (!training.has(key)) {
                training.set(key, {
                    userId,
                    name: name || (userId != null ? nameOf(userId) : null) || key,
                    identityType,
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
        const byUserId = (id: any) => ensure(`u${id}`, Number(id), nameOf(id), "user");
        const byName = (name: string) => {
            for (const t of training.values()) if (t.name === name) return t;
            return ensure(`n${name}`, null, name, "source_account");
        };

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

        const teamTrainingTotal = trainingRows.reduce((sum, t) => sum + t.total, 0);
        const aiTrainingTotal = Number(autoFacts[0]?.c || 0);

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
                        identityType: r.userId != null ? "user" : "source_account",
                        hostify: 0,
                        quo: 0,
                        threads: 0,
                        actualUserReplies: 0,
                        sourceAccountReplies: 0,
                    });
                }
                const rec = replies.get(k);
                rec[src.field] += Number(r.c);
                rec.threads += Number(r.threads || 0);
                rec.actualUserReplies += Number(r.actualUserReplies || 0);
                rec.sourceAccountReplies += Number(r.sourceAccountReplies || 0);
            }
        }
        const replyRows = [...replies.values()]
            .map((r) => ({ ...r, total: r.hostify + r.quo }))
            .sort((a, b) => b.total - a.total);
        const teamReplies = replyRows.reduce((sum, r) => sum + r.total, 0);
        const aiReplyCount = Number(aiReplies[0]?.c || 0);

        const qualityRows = replyQuality.map((r) => ({
            userId: r.userId != null ? Number(r.userId) : null,
            name: (r.userId != null && nameOf(r.userId)) || r.name,
            identityType: r.userId != null ? "user" : "source_account",
            compared: Number(r.compared),
            answers: Number(r.answers || 0),
            offTopic: Number(r.offTopic || 0),
            answerRate: Number(r.compared) ? Math.round((Number(r.answers || 0) / Number(r.compared)) * 100) : null,
            avgCoverage: r.avgCoverage != null ? Math.round(Number(r.avgCoverage)) : null,
        }));
        qualityRows.sort((a, b) => (b.answerRate ?? -1) - (a.answerRate ?? -1) || b.compared - a.compared);
        const aiCompared = Number(aiReplyQuality[0]?.compared || 0);
        const aiAnswers = Number(aiReplyQuality[0]?.answers || 0);

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
            days: w.days,
            since: w.from.toISOString(),
            until: w.to.toISOString(),
            filters,
            training: trainingRows,
            trainingSummary: {
                team: teamTrainingTotal,
                ai: aiTrainingTotal,
                total: teamTrainingTotal + aiTrainingTotal,
            },
            replies: replyRows,
            replySummary: {
                team: teamReplies,
                ai: aiReplyCount,
                total: teamReplies + aiReplyCount,
            },
            replyQuality: qualityRows,
            replyQualitySummary: {
                teamCompared: qualityRows.reduce((s, r) => s + r.compared, 0),
                teamAnswerRate: qualityRows.length
                    ? Math.round(qualityRows.reduce((s, r) => s + (r.answers || 0), 0) / Math.max(1, qualityRows.reduce((s, r) => s + r.compared, 0)) * 100)
                    : null,
                aiCompared,
                aiAnswerRate: aiCompared ? Math.round((aiAnswers / aiCompared) * 100) : null,
            },
            responseTimes: {
                summary: responseSummary,
                users: responseUsers,
            },
            timeEstimate: timeRows,
        };
    }

    private async responseSummary(filters: AdminInsightFilters, w: DateWindow): Promise<any> {
        const base = (via: "team" | "ai") => {
            const outWhere = via === "ai" ? "o.sentVia = 'ai_auto'" : "o.sentVia <> 'ai_auto'";
            const params: any[] = [];
            const clauses = [this.range("o.sentAt", w, params), outWhere, "i.sentAt IS NOT NULL"];
            if (filters.listingId != null) {
                clauses.push("o.listingId = ?");
                params.push(filters.listingId);
            }
            if (filters.userId != null && via === "team") {
                clauses.push("o.sentByUserId = ?");
                params.push(filters.userId);
            }
            if (filters.userId != null && via === "ai") {
                clauses.push("1 = 0");
            }
            return this.q(
                `SELECT COUNT(*) responses,
                        AVG(TIMESTAMPDIFF(SECOND, i.sentAt, o.sentAt)) avgSec
                 FROM inbox_messages o
                 JOIN inbox_messages i ON i.id = (
                    SELECT i2.id FROM inbox_messages i2
                    WHERE i2.threadId = o.threadId AND i2.direction = 'incoming' AND i2.sentAt < o.sentAt
                    ORDER BY i2.sentAt DESC LIMIT 1
                 )
                 WHERE o.direction = 'outgoing' AND ${clauses.join(" AND ")}`,
                params
            );
        };
        const [teamRows, aiRows] = await Promise.all([base("team"), base("ai")]);
        const fmt = (r: Row | undefined) => ({
            responses: Number(r?.responses || 0),
            avgMinutes: r?.avgSec != null ? Math.round(Number(r.avgSec) / 60) : null,
        });
        return { team: fmt(teamRows[0]), ai: fmt(aiRows[0]) };
    }

    private async responseUsers(filters: AdminInsightFilters, w: DateWindow, names: Map<number, string>): Promise<any[]> {
        const params: any[] = [];
        const clauses = [this.range("o.sentAt", w, params), "o.sentVia <> 'ai_auto'", "i.sentAt IS NOT NULL"];
        if (filters.listingId != null) {
            clauses.push("o.listingId = ?");
            params.push(filters.listingId);
        }
        if (filters.userId != null) {
            clauses.push("o.sentByUserId = ?");
            params.push(filters.userId);
        }
        const rows = await this.q(
            `SELECT o.sentByUserId AS userId, COALESCE(o.sentByName, o.senderName) AS name,
                    COUNT(*) responses,
                    AVG(TIMESTAMPDIFF(SECOND, i.sentAt, o.sentAt)) avgSec
             FROM inbox_messages o
             JOIN inbox_messages i ON i.id = (
                SELECT i2.id FROM inbox_messages i2
                WHERE i2.threadId = o.threadId AND i2.direction = 'incoming' AND i2.sentAt < o.sentAt
                ORDER BY i2.sentAt DESC LIMIT 1
             )
             WHERE o.direction = 'outgoing' AND ${clauses.join(" AND ")}
               AND TRIM(COALESCE(o.sentByName, o.senderName, '')) <> ''
             GROUP BY o.sentByUserId, COALESCE(o.sentByName, o.senderName)
             ORDER BY avgSec ASC`,
            params
        );
        return rows.map((r) => ({
            userId: r.userId != null ? Number(r.userId) : null,
            name: (r.userId != null && names.get(Number(r.userId))) || r.name || "unknown",
            identityType: r.userId != null ? "user" : "source_account",
            responses: Number(r.responses || 0),
            avgMinutes: r.avgSec != null ? Math.round(Number(r.avgSec) / 60) : null,
        }));
    }

    async trainingDetails(filters: AdminInsightFilters, metric: string, userId?: number | null, limit = 50, offset = 0): Promise<any> {
        const w = this.window(filters);
        const names = await this.userNames();
        const nameOf = (id: any) => (id != null && names.get(Number(id))) || "unknown";
        const lim = Math.min(Math.max(limit, 1), 200);
        const off = Math.max(offset, 0);
        const selectedName = userId != null ? nameOf(userId) : null;
        const params: any[] = [];
        let sql = "";
        const addRange = (column: string) => this.range(column, w, params);
        const listingClause = (column: string) => {
            if (filters.listingId == null) return "";
            params.push(filters.listingId);
            return ` AND ${column} = ?`;
        };
        const userIdClause = (column: string) => {
            if (userId == null) return "";
            params.push(userId);
            return ` AND ${column} = ?`;
        };
        const userNameClause = (column: string) => {
            if (!selectedName) return "";
            params.push(selectedName);
            return ` AND ${column} = ?`;
        };
        const statusClause = (statuses: string[]) => {
            params.push(...statuses);
            return ` AND status IN (${statuses.map(() => "?").join(",")})`;
        };
        const page = ` ORDER BY createdAt DESC LIMIT ${lim} OFFSET ${off}`;

        if (["thumbsUp", "thumbsDown", "textFeedback", "corrections"].includes(metric)) {
            const rating = metric === "thumbsUp" ? " AND f.rating = 'up'" : metric === "thumbsDown" ? " AND f.rating = 'down'" : "";
            const extra =
                metric === "textFeedback" ? " AND f.feedbackText IS NOT NULL AND f.feedbackText <> ''" :
                metric === "corrections" ? " AND f.correctedResponse IS NOT NULL AND f.correctedResponse <> ''" : "";
            sql = `SELECT CONCAT('fb-', f.id) id, 'feedback' kind, f.userId, f.rating, f.feedbackText, f.correctedResponse,
                          LEFT(s.suggestedReply, 300) suggestedReply, s.source, f.threadId, s.quoConversationId, f.createdAt
                   FROM ai_message_feedback f
                   LEFT JOIN ai_message_suggestions s ON s.id = f.suggestionId
                   WHERE ${addRange("f.createdAt")}${userIdClause("f.userId")}${listingClause("f.listingId")}${rating}${extra}${page}`;
        } else if (["promptsAnswered", "promptsDismissed"].includes(metric)) {
            sql = `SELECT CONCAT('prompt-', id) id, IF(status = 'dismissed', 'prompt_dismissed', 'prompt_answered') kind,
                          answeredByUserId userId, question, answerText answer, answerScope scope, source, threadId, listingName,
                          resolvedAt createdAt
                   FROM ai_learning_prompts
                   WHERE ${addRange("resolvedAt")}${userIdClause("answeredByUserId")}
                     ${metric === "promptsDismissed" ? "AND status = 'dismissed'" : "AND status <> 'dismissed'"}${listingClause("listingId")}${page}`;
        } else if (["factsTaught", "factsReviewed"].includes(metric)) {
            const userColumn = metric === "factsTaught" ? "createdByUserId" : "reviewedByUserId";
            const dateColumn = metric === "factsTaught" ? "createdAt" : "updatedAt";
            sql = `SELECT CONCAT('fact-', id) id, '${metric === "factsTaught" ? "fact_taught" : "fact_reviewed"}' kind,
                          ${userColumn} userId, question, answer, scope, listingId, source, ${dateColumn} createdAt
                   FROM ai_learned_facts
                   WHERE ${addRange(dateColumn)}${userIdClause(userColumn)}${listingClause("listingId")}${page}`;
        } else if (metric === "missesResolved") {
            sql = `SELECT CONCAT('miss-', id) id, 'miss_resolved' kind, NULL userId, missResolvedBy userName,
                          LEFT(suggestedReply, 300) suggestedReply, source, threadId, quoConversationId, missResolvedAt createdAt
                   FROM ai_message_suggestions
                   WHERE ${addRange("missResolvedAt")}${userNameClause("missResolvedBy")}${listingClause("listingId")}${page}`;
        } else if (metric === "itemsDiscarded") {
            sql = `SELECT CONCAT('discard-', id) id, 'discarded' kind, NULL userId, discardedBy userName,
                          comment feedbackText, source, threadId, listingName, createdAt
                   FROM ai_discard_feedback
                   WHERE ${addRange("createdAt")}${userNameClause("discardedBy")}${listingClause("listingId")}${page}`;
        } else {
            const statuses =
                metric === "suggestionsAccepted" ? ["accepted", "auto_sent"] :
                metric === "suggestionsEdited" ? ["edited"] :
                metric === "suggestionsIgnored" ? ["ignored", "rejected"] : [];
            if (!statuses.length) return { total: 0, items: [] };
            sql = `SELECT CONCAT('suggestion-', id) id, 'suggestion_action' kind, acceptedByUserId userId, status,
                          LEFT(suggestedReply, 300) suggestedReply, source, threadId, quoConversationId, generatedAt createdAt
                   FROM ai_message_suggestions
                   WHERE ${addRange("generatedAt")}${userIdClause("acceptedByUserId")}${statusClause(statuses)}${listingClause("listingId")}${page}`;
        }

        const rows = await this.q(sql, params);
        return {
            total: rows.length,
            items: rows.map((r) => ({
                ...r,
                userId: r.userId != null ? Number(r.userId) : null,
                userName: r.userName || nameOf(r.userId),
            })),
        };
    }

    async replyQualityDetails(filters: AdminInsightFilters, userId?: number | null, name?: string | null): Promise<any> {
        const w = this.window(filters);
        const params: any[] = [];
        const clauses = [
            this.range("s.actualReplyAt", w, params),
            "s.source = 'hostify'",
            "s.actualReplyText IS NOT NULL",
        ];
        if (filters.listingId != null) {
            clauses.push("s.listingId = ?");
            params.push(filters.listingId);
        }
        if (userId != null) {
            clauses.push("m.sentByUserId = ?");
            params.push(userId);
        } else if (name) {
            clauses.push("COALESCE(m.sentByName, m.senderName) = ?");
            params.push(name);
        }
        const rows = await this.q(
            `SELECT s.id, m.sentByUserId userId, COALESCE(m.sentByName, m.senderName) name,
                    s.replyRelevance, s.replyRelevanceNote, s.replyCoverageScore,
                    s.aiReplyQuality, s.aiReplyQualityNote,
                    LEFT(s.suggestedReply, 400) suggestedReply,
                    LEFT(s.actualReplyText, 400) actualReplyText,
                    s.threadId, s.actualReplyAt createdAt
             FROM ai_message_suggestions s
             JOIN inbox_messages m ON m.externalId = s.actualReplyMessageId AND m.threadId = s.threadId
             WHERE ${clauses.join(" AND ")}
             ORDER BY s.actualReplyAt DESC
             LIMIT 100`,
            params
        );
        return {
            items: rows.map((r) => ({
                ...r,
                userId: r.userId != null ? Number(r.userId) : null,
                coverage: r.replyCoverageScore != null ? Math.round(Number(r.replyCoverageScore)) : null,
            })),
        };
    }

    async feedbackLog(filters: AdminInsightFilters, limit = 50, offset = 0): Promise<any> {
        const w = this.window(filters);
        const names = await this.userNames();
        const nameOf = (id: any) => (id != null && names.get(Number(id))) || "unknown";
        const lim = Math.min(Math.max(limit, 1), 200);
        const off = Math.max(offset, 0);
        const cap = off + lim;

        const q = (sql: string, params: any[]): Promise<any[]> => appDatabase.query(sql, params).catch(() => []);
        const scope = (column: string, params: any[], listingColumn?: string, userColumn?: string) => {
            const clauses = [this.range(column, w, params)];
            if (filters.listingId != null && listingColumn) {
                clauses.push(`${listingColumn} = ?`);
                params.push(filters.listingId);
            }
            if (filters.userId != null && userColumn) {
                clauses.push(`${userColumn} = ?`);
                params.push(filters.userId);
            }
            return clauses.join(" AND ");
        };

        const fbParams: any[] = [];
        const factParams: any[] = [];
        const promptParams: any[] = [];
        const missParams: any[] = [];
        const selectedName = filters.userId != null ? nameOf(filters.userId) : null;
        const [feedback, facts, prompts, misses] = await Promise.all([
            q(
                `SELECT f.id, f.userId, f.rating, f.categories, f.feedbackText, f.correctedResponse,
                        f.createdAt, f.threadId, f.suggestionId,
                        LEFT(s.suggestedReply, 300) AS suggestedReply, s.source AS src, s.quoConversationId
                 FROM ai_message_feedback f
                 LEFT JOIN ai_message_suggestions s ON s.id = f.suggestionId
                 WHERE ${scope("f.createdAt", fbParams, "f.listingId", "f.userId")}
                 ORDER BY f.createdAt DESC LIMIT ${cap}`,
                fbParams
            ),
            q(
                `SELECT id, createdByUserId AS userId, question, answer, scope, listingId, source, createdAt
                 FROM ai_learned_facts
                 WHERE createdByUserId IS NOT NULL AND source NOT IN ('learning_prompt', 'nightly_audit')
                   AND ${scope("createdAt", factParams, "listingId", "createdByUserId")}
                 ORDER BY createdAt DESC LIMIT ${cap}`,
                factParams
            ),
            q(
                `SELECT id, answeredByUserId AS userId, question, answerText, answerScope, status,
                        threadId, source AS src, listingName, resolvedAt
                 FROM ai_learning_prompts
                 WHERE answeredByUserId IS NOT NULL AND status IN ('answered', 'dismissed')
                   AND ${scope("resolvedAt", promptParams, "listingId", "answeredByUserId")}
                 ORDER BY resolvedAt DESC LIMIT ${cap}`,
                promptParams
            ),
            q(
                `SELECT id, missResolvedBy, missResolvedAt, threadId, source AS src, quoConversationId,
                        LEFT(suggestedReply, 300) AS suggestedReply
                 FROM ai_message_suggestions
                 WHERE missResolvedBy IS NOT NULL AND ${scope("missResolvedAt", missParams, "listingId")}
                   ${selectedName ? "AND missResolvedBy = ?" : ""}
                 ORDER BY missResolvedAt DESC LIMIT ${cap}`,
                selectedName ? [...missParams, selectedName] : missParams
            ),
        ]);

        const items: any[] = [];
        for (const r of feedback) {
            items.push({
                id: `fb-${r.id}`,
                kind: "feedback",
                userId: r.userId != null ? Number(r.userId) : null,
                userName: nameOf(r.userId),
                rating: r.rating,
                categories: (() => { try { return JSON.parse(r.categories || "[]"); } catch { return []; } })(),
                feedbackText: r.feedbackText,
                correctedResponse: r.correctedResponse,
                suggestedReply: r.suggestedReply,
                source: r.src || "hostify",
                threadId: r.threadId != null ? Number(r.threadId) : null,
                quoConversationId: r.quoConversationId || null,
                createdAt: r.createdAt,
            });
        }
        for (const r of facts) {
            items.push({
                id: `fact-${r.id}`,
                kind: "fact_taught",
                userId: Number(r.userId),
                userName: nameOf(r.userId),
                question: r.question,
                answer: r.answer,
                scope: r.scope,
                listingId: r.listingId != null ? Number(r.listingId) : null,
                factSource: r.source,
                createdAt: r.createdAt,
            });
        }
        for (const r of prompts) {
            items.push({
                id: `prompt-${r.id}`,
                kind: r.status === "dismissed" ? "prompt_dismissed" : "prompt_answered",
                userId: Number(r.userId),
                userName: nameOf(r.userId),
                question: r.question,
                answer: r.answerText,
                scope: r.answerScope,
                listingName: r.listingName,
                source: r.src || "hostify",
                threadId: r.src === "quo" ? null : r.threadId != null ? Number(r.threadId) : null,
                createdAt: r.resolvedAt,
            });
        }
        for (const r of misses) {
            items.push({
                id: `miss-${r.id}`,
                kind: "miss_resolved",
                userId: null,
                userName: r.missResolvedBy,
                suggestedReply: r.suggestedReply,
                source: r.src || "hostify",
                threadId: r.src === "quo" ? null : r.threadId != null ? Number(r.threadId) : null,
                quoConversationId: r.quoConversationId || null,
                createdAt: r.missResolvedAt,
            });
        }

        items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return {
            total: items.length,
            byKind: {
                feedback: feedback.length,
                factsTaught: facts.length,
                promptsResolved: prompts.length,
                missesResolved: misses.length,
            },
            items: items.slice(off, off + lim),
        };
    }
}
