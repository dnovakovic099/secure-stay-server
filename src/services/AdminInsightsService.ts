import { appDatabase } from "../utils/database.util";
import { AdminWorkloadService } from "./AdminWorkloadService";

/**
 * Admin-only insights: who trains the AI (feedback, learning answers, taught
 * facts, suggestion outcomes), who responds in the inboxes and on calls,
 * whose replies grade best, and a transparent per-user activity/time estimate.
 *
 * Attribution rules (enforced everywhere below):
 *   - Reply/response counts credit an SS user ONLY when we have a numeric
 *     users.id on the row (via sentByUserId, quoUserId→email→users.id, or
 *     Quo call answeredBy/initiatedBy→email→users.id). Rows we cannot
 *     positively pin to an internal user are dropped — this stops external
 *     Hostify hosts, guests, or "same-name" collisions from padding an
 *     employee's numbers.
 *   - Name-only sources (missResolvedBy, discardedBy) are resolved to a
 *     userId via a strict full-name lookup. Ambiguous names (multiple SS
 *     users with the same firstName+lastName) are dropped rather than merged.
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

export interface InsightsFilters {
    days?: number;
    /** ISO date strings (inclusive start, exclusive end). Override `days` when set. */
    startDate?: string | null;
    endDate?: string | null;
    /** Restrict to a specific listing/property (applies where the source table carries it). */
    listingId?: number | null;
    /** Restrict to specific SS user ids. */
    userIds?: number[] | null;
    /** 'admin' | 'regular' — filters via join to users.userType. */
    userType?: string | null;
    /** Feedback-log kinds. */
    kinds?: string[] | null;
}

interface DateRange {
    start: Date;
    end: Date;
}

interface UserRecord {
    id: number;
    name: string;
    email: string | null;
    userType: string | null;
}

export class AdminInsightsService {
    private sinceDate(days: number): Date {
        return new Date(Date.now() - Math.min(Math.max(days || 30, 1), 365) * 86400000);
    }

    /** Resolve a filter range: honors startDate/endDate when given, else falls back to `days` (default 30). */
    private dateRange(f: InsightsFilters): DateRange {
        const now = new Date();
        let start: Date;
        let end: Date;
        if (f.startDate) {
            const s = new Date(f.startDate);
            start = isNaN(s.getTime()) ? this.sinceDate(f.days || 30) : s;
        } else {
            start = this.sinceDate(f.days || 30);
        }
        if (f.endDate) {
            const e = new Date(f.endDate);
            end = isNaN(e.getTime()) ? now : e;
        } else {
            end = now;
        }
        if (end < start) end = new Date(start.getTime() + 86400000);
        return { start, end };
    }

    /** Full user directory keyed by id. */
    private async userDirectory(): Promise<Map<number, UserRecord>> {
        const rows: any[] = await appDatabase.query(
            "SELECT id, firstName, lastName, email, userType FROM users WHERE deletedAt IS NULL"
        );
        const map = new Map<number, UserRecord>();
        for (const u of rows) {
            const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
            map.set(Number(u.id), {
                id: Number(u.id),
                name: name || u.email || `user ${u.id}`,
                email: u.email || null,
                userType: u.userType || null,
            });
        }
        return map;
    }

    /** Full-name (case-insensitive) -> userId when exactly one SS user matches. */
    private buildNameIndex(users: Map<number, UserRecord>): Map<string, number | null> {
        const buckets = new Map<string, number[]>();
        for (const u of users.values()) {
            const key = u.name.trim().toLowerCase();
            if (!key) continue;
            const arr = buckets.get(key) || [];
            arr.push(u.id);
            buckets.set(key, arr);
        }
        const out = new Map<string, number | null>();
        for (const [name, ids] of buckets) out.set(name, ids.length === 1 ? ids[0] : null); // null == ambiguous, drop
        return out;
    }

    /** Filter helper — apply userIds/userType to a row (post-query) by userId. */
    private makeUserGuard(f: InsightsFilters, users: Map<number, UserRecord>) {
        const wanted = new Set<number>((f.userIds || []).filter((n) => Number.isFinite(n)).map((n) => Number(n)));
        const type = (f.userType || "").trim().toLowerCase();
        return (userId: number | null | undefined): boolean => {
            if (userId == null) return false;
            const u = users.get(Number(userId));
            if (!u) return false;
            if (wanted.size && !wanted.has(u.id)) return false;
            if (type && type !== "all" && (u.userType || "").toLowerCase() !== type) return false;
            return true;
        };
    }

    // -------------------------------------------------------------------------
    // Overview: per-user AI-training + response counts + quality + time estimate.
    // -------------------------------------------------------------------------
    async overview(f: InsightsFilters = {}): Promise<any> {
        const { start, end } = this.dateRange(f);
        const users = await this.userDirectory();
        const nameIndex = this.buildNameIndex(users);
        const guard = this.makeUserGuard(f, users);
        const nameOf = (id: any) => (id != null && users.get(Number(id))?.name) || null;
        const listingId = f.listingId != null && Number.isFinite(Number(f.listingId)) ? Number(f.listingId) : null;

        type Row = Record<string, any>;
        const q = (sql: string, params: any[]): Promise<Row[]> =>
            appDatabase.query(sql, params).catch(() => [] as Row[]);

        // Property-filter (listingId) is applied wherever the source table
        // carries that column. Quo SMS and Quo calls have no listingId (Quo
        // is SMS/telephony) — a property filter drops those sources rather
        // than fabricating a link.
        const noListingScope = listingId != null;

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
            quoCalls,
            replyQuality,
        ] = await Promise.all([
            q(
                `SELECT userId, rating, COUNT(*) c,
                        SUM(feedbackText IS NOT NULL AND feedbackText <> '') withText,
                        SUM(correctedResponse IS NOT NULL AND correctedResponse <> '') withCorrection
                 FROM ai_message_feedback
                 WHERE userId IS NOT NULL AND createdAt >= ? AND createdAt < ?
                   ${listingId != null ? "AND listingId = ?" : ""}
                 GROUP BY userId, rating`,
                listingId != null ? [start, end, listingId] : [start, end]
            ),
            q(
                `SELECT answeredByUserId AS userId, status, COUNT(*) c
                 FROM ai_learning_prompts
                 WHERE answeredByUserId IS NOT NULL AND resolvedAt >= ? AND resolvedAt < ?
                   ${listingId != null ? "AND listingId = ?" : ""}
                 GROUP BY answeredByUserId, status`,
                listingId != null ? [start, end, listingId] : [start, end]
            ),
            q(
                `SELECT createdByUserId AS userId, COUNT(*) c
                 FROM ai_learned_facts
                 WHERE createdByUserId IS NOT NULL AND createdAt >= ? AND createdAt < ?
                   ${listingId != null ? "AND listingId = ?" : ""}
                 GROUP BY createdByUserId`,
                listingId != null ? [start, end, listingId] : [start, end]
            ),
            q(
                `SELECT reviewedByUserId AS userId, COUNT(*) c
                 FROM ai_learned_facts
                 WHERE reviewedByUserId IS NOT NULL AND updatedAt >= ? AND updatedAt < ?
                   ${listingId != null ? "AND listingId = ?" : ""}
                 GROUP BY reviewedByUserId`,
                listingId != null ? [start, end, listingId] : [start, end]
            ),
            q(
                `SELECT acceptedByUserId AS userId, status, COUNT(*) c
                 FROM ai_message_suggestions
                 WHERE acceptedByUserId IS NOT NULL AND generatedAt >= ? AND generatedAt < ?
                   ${listingId != null ? "AND listingId = ?" : ""}
                 GROUP BY acceptedByUserId, status`,
                listingId != null ? [start, end, listingId] : [start, end]
            ),
            q(
                `SELECT missResolvedBy AS name, COUNT(*) c
                 FROM ai_message_suggestions
                 WHERE missResolvedBy IS NOT NULL AND missResolvedAt >= ? AND missResolvedAt < ?
                   ${listingId != null ? "AND listingId = ?" : ""}
                 GROUP BY missResolvedBy`,
                listingId != null ? [start, end, listingId] : [start, end]
            ),
            q(
                `SELECT discardedBy AS name, COUNT(*) c
                 FROM ai_discard_feedback
                 WHERE discardedBy IS NOT NULL AND createdAt >= ? AND createdAt < ?
                   ${listingId != null ? "AND listingId = ?" : ""}
                 GROUP BY discardedBy`,
                listingId != null ? [start, end, listingId] : [start, end]
            ),
            // ---- HOSTIFY REPLIES: strict SS-user attribution -------------
            // Only counts messages where sentByUserId is populated AND that
            // user exists in our users table. `sentVia = 'inbox_v2'` proves
            // the reply originated from our dashboard (not a Hostify-only
            // send, and not the guest). Guest-name and same-name-host
            // collisions cannot occur under this rule.
            q(
                `SELECT m.sentByUserId AS userId, COUNT(*) c,
                        COUNT(DISTINCT m.threadId) threads
                 FROM inbox_messages m
                 JOIN users u ON u.id = m.sentByUserId AND u.deletedAt IS NULL
                 WHERE m.direction = 'outgoing'
                   AND m.sentVia = 'inbox_v2'
                   AND m.sentByUserId IS NOT NULL
                   AND m.sentAt >= ? AND m.sentAt < ?
                   ${listingId != null ? "AND m.listingId = ?" : ""}
                 GROUP BY m.sentByUserId`,
                listingId != null ? [start, end, listingId] : [start, end]
            ),
            // ---- QUO SMS: SS-user attribution via sentByUserId OR
            // quoUserId (resolved to SS user through the Quo directory
            // outside SQL). We fetch both columns and resolve in code.
            noListingScope
                ? Promise.resolve([] as Row[])
                : q(
                      `SELECT sentByUserId, quoUserId, COUNT(*) c,
                              COUNT(DISTINCT conversationId) threads
                       FROM quo_messages
                       WHERE direction = 'outgoing'
                         AND sentAt >= ? AND sentAt < ?
                         AND (sentByUserId IS NOT NULL OR quoUserId IS NOT NULL)
                       GROUP BY sentByUserId, quoUserId`,
                      [start, end]
                  ),
            // ---- QUO CALLS: attribute via answeredBy (incoming) or
            // initiatedBy/quoUserId (outgoing). Resolve to SS user in code.
            noListingScope
                ? Promise.resolve([] as Row[])
                : q(
                      `SELECT direction, initiatedBy, answeredBy, quoUserId,
                              COUNT(*) c, COALESCE(SUM(duration),0) totalSec
                       FROM quo_calls
                       WHERE occurredAt >= ? AND occurredAt < ?
                         AND (initiatedBy IS NOT NULL OR answeredBy IS NOT NULL OR quoUserId IS NOT NULL)
                       GROUP BY direction, initiatedBy, answeredBy, quoUserId`,
                      [start, end]
                  ),
            // ---- REPLY QUALITY: group strictly by sentByUserId; rows
            // where sentByUserId is null (Hostify-only sends) are dropped
            // to avoid same-name merges between employees and external
            // hosts.
            q(
                `SELECT m.sentByUserId AS userId,
                        COUNT(*) compared,
                        SUM(s.replyRelevance = 'relevant') answers,
                        SUM(s.replyRelevance = 'off_topic') offTopic,
                        AVG(NULLIF(s.replyCoverageScore, -1)) avgCoverage
                 FROM ai_message_suggestions s
                 JOIN inbox_messages m
                   ON m.externalId = s.actualReplyMessageId AND m.threadId = s.threadId
                 JOIN users u ON u.id = m.sentByUserId AND u.deletedAt IS NULL
                 WHERE s.source = 'hostify'
                   AND s.actualReplyAt >= ? AND s.actualReplyAt < ?
                   AND s.actualReplyText IS NOT NULL
                   AND m.sentByUserId IS NOT NULL
                   ${listingId != null ? "AND m.listingId = ?" : ""}
                 GROUP BY m.sentByUserId
                 HAVING compared >= 3
                 ORDER BY compared DESC`,
                listingId != null ? [start, end, listingId] : [start, end]
            ),
        ]);

        // ---- fold the AI-training rows into one record per user -------------
        const training = new Map<number, any>();
        const ensure = (userId: number) => {
            if (!training.has(userId)) {
                const u = users.get(userId);
                training.set(userId, {
                    userId,
                    name: u?.name || `user ${userId}`,
                    userType: u?.userType || null,
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
            return training.get(userId);
        };

        for (const r of feedback) {
            const id = Number(r.userId);
            if (!guard(id)) continue;
            const t = ensure(id);
            if (r.rating === "up") t.thumbsUp += Number(r.c);
            else if (r.rating === "down") t.thumbsDown += Number(r.c);
            t.textFeedback += Number(r.withText || 0);
            t.corrections += Number(r.withCorrection || 0);
        }
        for (const r of prompts) {
            const id = Number(r.userId);
            if (!guard(id)) continue;
            const t = ensure(id);
            if (r.status === "dismissed") t.promptsDismissed += Number(r.c);
            else t.promptsAnswered += Number(r.c);
        }
        for (const r of factsTaught) {
            const id = Number(r.userId);
            if (!guard(id)) continue;
            ensure(id).factsTaught += Number(r.c);
        }
        for (const r of factsReviewed) {
            const id = Number(r.userId);
            if (!guard(id)) continue;
            ensure(id).factsReviewed += Number(r.c);
        }
        for (const r of suggestionActions) {
            const id = Number(r.userId);
            if (!guard(id)) continue;
            const t = ensure(id);
            if (r.status === "accepted" || r.status === "auto_sent") t.suggestionsAccepted += Number(r.c);
            else if (r.status === "edited") t.suggestionsEdited += Number(r.c);
            else if (r.status === "ignored" || r.status === "rejected") t.suggestionsIgnored += Number(r.c);
        }
        // Name-keyed sources — resolve strictly to a unique SS user.
        // Ambiguous names (or names not in the directory) are dropped.
        for (const r of missesResolved) {
            const key = String(r.name || "").trim().toLowerCase();
            const uid = key ? nameIndex.get(key) : null;
            if (uid == null || !guard(uid)) continue;
            ensure(uid).missesResolved += Number(r.c);
        }
        for (const r of discards) {
            const key = String(r.name || "").trim().toLowerCase();
            const uid = key ? nameIndex.get(key) : null;
            if (uid == null || !guard(uid)) continue;
            ensure(uid).itemsDiscarded += Number(r.c);
        }

        const trainingRows = [...training.values()]
            .map((t) => ({
                ...t,
                total:
                    t.thumbsUp + t.thumbsDown + t.textFeedback + t.promptsAnswered + t.promptsDismissed +
                    t.factsTaught + t.factsReviewed + t.missesResolved + t.itemsDiscarded,
            }))
            .filter((t) => t.total > 0 || t.suggestionsAccepted + t.suggestionsEdited + t.suggestionsIgnored > 0)
            .sort((a, b) => b.total - a.total);

        // ---- responses (HF replies + Quo SMS + Quo calls per SS user) ------
        // Build Quo user -> SS user resolver, using the same directory the
        // workload page uses. Fetching the Quo user list hits the OpenPhone
        // API but is process-cached for 10 minutes.
        const workload = new AdminWorkloadService();
        let quoUserMap: Map<string, { email: string; name: string }> | null = null;
        try {
            quoUserMap = await workload.quoUsers();
        } catch {
            quoUserMap = null;
        }
        const emailToSsId = new Map<string, number>();
        for (const u of users.values()) {
            if (u.email) emailToSsId.set(u.email.trim().toLowerCase(), u.id);
        }
        const quoIdToSsId = (quoUid: string | null | undefined): number | null => {
            if (!quoUid || !quoUserMap) return null;
            const u = quoUserMap.get(quoUid);
            if (!u) return null;
            const ssId = emailToSsId.get(u.email);
            return ssId != null ? ssId : null;
        };

        interface ResponseRec {
            userId: number;
            name: string;
            userType: string | null;
            hostify: number;
            quo: number;
            calls: number;
            callMinutes: number;
            threads: number;
        }
        const responses = new Map<number, ResponseRec>();
        const ensureResp = (userId: number): ResponseRec => {
            if (!responses.has(userId)) {
                const u = users.get(userId);
                responses.set(userId, {
                    userId,
                    name: u?.name || `user ${userId}`,
                    userType: u?.userType || null,
                    hostify: 0,
                    quo: 0,
                    calls: 0,
                    callMinutes: 0,
                    threads: 0,
                });
            }
            return responses.get(userId)!;
        };

        for (const r of hostifyReplies) {
            const id = Number(r.userId);
            if (!guard(id)) continue;
            const rec = ensureResp(id);
            rec.hostify += Number(r.c);
            rec.threads += Number(r.threads || 0);
        }
        for (const r of quoReplies) {
            let id: number | null = null;
            if (r.sentByUserId != null && guard(Number(r.sentByUserId))) id = Number(r.sentByUserId);
            else {
                const mapped = quoIdToSsId(r.quoUserId);
                if (mapped != null && guard(mapped)) id = mapped;
            }
            if (id == null) continue;
            const rec = ensureResp(id);
            rec.quo += Number(r.c);
            rec.threads += Number(r.threads || 0);
        }
        for (const r of quoCalls) {
            const quoUid = r.direction === "outgoing" ? r.initiatedBy || r.quoUserId : r.answeredBy;
            const mapped = quoIdToSsId(quoUid);
            if (mapped == null || !guard(mapped)) continue;
            const rec = ensureResp(mapped);
            rec.calls += Number(r.c);
            rec.callMinutes += Math.round(Number(r.totalSec || 0) / 60);
        }

        const replyRows = [...responses.values()]
            .map((r) => ({ ...r, total: r.hostify + r.quo + r.calls }))
            .filter((r) => r.total > 0)
            .sort((a, b) => b.total - a.total);

        // ---- reply quality ("who replied best") ------------------------------
        const qualityRows = replyQuality
            .filter((r: any) => guard(Number(r.userId)))
            .map((r: any) => ({
                userId: Number(r.userId),
                name: nameOf(r.userId) || `user ${r.userId}`,
                compared: Number(r.compared),
                answers: Number(r.answers || 0),
                offTopic: Number(r.offTopic || 0),
                answerRate: Number(r.compared)
                    ? Math.round((Number(r.answers || 0) / Number(r.compared)) * 100)
                    : null,
                avgCoverage: r.avgCoverage != null ? Math.round(Number(r.avgCoverage)) : null,
            }));
        qualityRows.sort((a, b) => (b.answerRate ?? -1) - (a.answerRate ?? -1) || b.compared - a.compared);

        // ---- transparent time estimate (deterministic, per user) -------------
        // 2 min per inbox reply, 1.5 per Quo SMS, add real Quo call talk-time,
        // 2 per learning answer, 1.5 per feedback, 3 per taught fact.
        const estimate = new Map<number, { name: string; minutes: number }>();
        const addMin = (userId: number, name: string, min: number) => {
            if (!estimate.has(userId)) estimate.set(userId, { name, minutes: 0 });
            estimate.get(userId)!.minutes += min;
        };
        for (const r of replyRows) {
            addMin(r.userId, r.name, r.hostify * 2 + r.quo * 1.5 + r.callMinutes);
        }
        for (const t of trainingRows) {
            addMin(
                t.userId,
                t.name,
                t.promptsAnswered * 2 + (t.thumbsUp + t.thumbsDown + t.textFeedback) * 1.5 + t.factsTaught * 3
            );
        }
        const timeRows = [...estimate.values()]
            .map((e) => ({ name: e.name, estimatedHours: +(e.minutes / 60).toFixed(1) }))
            .filter((e) => e.estimatedHours > 0)
            .sort((a, b) => b.estimatedHours - a.estimatedHours);

        return {
            days: f.days || null,
            since: start.toISOString(),
            until: end.toISOString(),
            training: trainingRows,
            replies: replyRows,
            replyQuality: qualityRows,
            timeEstimate: timeRows,
        };
    }

    // -------------------------------------------------------------------------
    // Unified training-activity log.
    // -------------------------------------------------------------------------
    async feedbackLog(f: InsightsFilters, limit = 50, offset = 0): Promise<any> {
        const { start, end } = this.dateRange(f);
        const users = await this.userDirectory();
        const nameIndex = this.buildNameIndex(users);
        const guard = this.makeUserGuard(f, users);
        const nameOf = (id: any) => (id != null && users.get(Number(id))?.name) || "unknown";
        const lim = Math.min(Math.max(limit, 1), 200);
        const off = Math.max(offset, 0);
        const cap = off + lim;
        const listingId = f.listingId != null && Number.isFinite(Number(f.listingId)) ? Number(f.listingId) : null;
        const kinds = new Set((f.kinds || []).map((k) => String(k).toLowerCase()));
        const wantKind = (k: string) => (kinds.size === 0 ? true : kinds.has(k));

        const safeParse = (s: any) => {
            try {
                return JSON.parse(s || "[]");
            } catch {
                return [];
            }
        };
        const q = (sql: string, params: any[]): Promise<any[]> => appDatabase.query(sql, params).catch(() => []);

        const [feedback, facts, prompts, misses, counts] = await Promise.all([
            wantKind("feedback")
                ? q(
                      `SELECT f.id, f.userId, f.rating, f.categories, f.feedbackText, f.correctedResponse,
                              f.targetType, f.subjectUserId,
                              LEFT(f.originalMessage, 500) AS originalMessage,
                              f.createdAt, f.threadId, f.suggestionId,
                              LEFT(s.suggestedReply, 300) AS suggestedReply, s.source AS src, s.quoConversationId
                       FROM ai_message_feedback f
                       LEFT JOIN ai_message_suggestions s ON s.id = f.suggestionId
                       WHERE f.createdAt >= ? AND f.createdAt < ?
                         ${listingId != null ? "AND f.listingId = ?" : ""}
                       ORDER BY f.createdAt DESC LIMIT ${cap}`,
                      listingId != null ? [start, end, listingId] : [start, end]
                  )
                : Promise.resolve([]),
            wantKind("fact_taught")
                ? q(
                      `SELECT id, createdByUserId AS userId, question, answer, scope, listingId, source, createdAt
                       FROM ai_learned_facts
                       WHERE createdByUserId IS NOT NULL AND source NOT IN ('learning_prompt', 'nightly_audit')
                         AND createdAt >= ? AND createdAt < ?
                         ${listingId != null ? "AND listingId = ?" : ""}
                       ORDER BY createdAt DESC LIMIT ${cap}`,
                      listingId != null ? [start, end, listingId] : [start, end]
                  )
                : Promise.resolve([]),
            wantKind("prompt_answered") || wantKind("prompt_dismissed")
                ? q(
                      `SELECT id, answeredByUserId AS userId, question, answerText, answerScope, status,
                              threadId, source AS src, listingName, listingId, resolvedAt
                       FROM ai_learning_prompts
                       WHERE answeredByUserId IS NOT NULL AND status IN ('answered', 'dismissed')
                         AND resolvedAt >= ? AND resolvedAt < ?
                         ${listingId != null ? "AND listingId = ?" : ""}
                       ORDER BY resolvedAt DESC LIMIT ${cap}`,
                      listingId != null ? [start, end, listingId] : [start, end]
                  )
                : Promise.resolve([]),
            wantKind("miss_resolved")
                ? q(
                      `SELECT id, missResolvedBy, missResolvedAt, threadId, source AS src, quoConversationId,
                              LEFT(suggestedReply, 300) AS suggestedReply
                       FROM ai_message_suggestions
                       WHERE missResolvedBy IS NOT NULL AND missResolvedAt >= ? AND missResolvedAt < ?
                         ${listingId != null ? "AND listingId = ?" : ""}
                       ORDER BY missResolvedAt DESC LIMIT ${cap}`,
                      listingId != null ? [start, end, listingId] : [start, end]
                  )
                : Promise.resolve([]),
            q(
                `SELECT
                    (SELECT COUNT(*) FROM ai_message_feedback WHERE createdAt >= ? AND createdAt < ?) fb,
                    (SELECT COUNT(*) FROM ai_learned_facts
                       WHERE createdByUserId IS NOT NULL AND source NOT IN ('learning_prompt', 'nightly_audit')
                         AND createdAt >= ? AND createdAt < ?
                         ${listingId != null ? "AND listingId = ?" : ""}) facts,
                    (SELECT COUNT(*) FROM ai_learning_prompts
                       WHERE answeredByUserId IS NOT NULL AND status IN ('answered', 'dismissed')
                         AND resolvedAt >= ? AND resolvedAt < ?
                         ${listingId != null ? "AND listingId = ?" : ""}) prompts,
                    (SELECT COUNT(*) FROM ai_message_suggestions
                       WHERE missResolvedBy IS NOT NULL AND missResolvedAt >= ? AND missResolvedAt < ?) misses`,
                listingId != null
                    ? [start, end, start, end, listingId, start, end, listingId, start, end]
                    : [start, end, start, end, start, end, start, end]
            ),
        ]);

        const items: any[] = [];
        const passUser = (uid: number | null) => (uid == null ? false : guard(uid));

        for (const r of feedback) {
            const uid = r.userId != null ? Number(r.userId) : null;
            if (!passUser(uid)) continue;
            items.push({
                id: `fb-${r.id}`,
                rawId: Number(r.id),
                kind: "feedback",
                userId: uid,
                userName: nameOf(uid),
                rating: r.rating,
                categories: safeParse(r.categories),
                feedbackText: r.feedbackText,
                correctedResponse: r.correctedResponse,
                targetType: r.targetType || (r.suggestionId != null ? "suggestion" : "general"),
                originalMessage: r.originalMessage || null,
                subjectUserId: r.subjectUserId != null ? Number(r.subjectUserId) : null,
                subjectUserName: r.subjectUserId != null ? nameOf(Number(r.subjectUserId)) : null,
                suggestedReply: r.suggestedReply,
                source: r.src || "hostify",
                threadId: r.threadId != null ? Number(r.threadId) : null,
                quoConversationId: r.quoConversationId || null,
                createdAt: r.createdAt,
            });
        }
        for (const r of facts) {
            const uid = Number(r.userId);
            if (!passUser(uid)) continue;
            items.push({
                id: `fact-${r.id}`,
                rawId: Number(r.id),
                kind: "fact_taught",
                userId: uid,
                userName: nameOf(uid),
                question: r.question,
                answer: r.answer,
                scope: r.scope,
                listingId: r.listingId != null ? Number(r.listingId) : null,
                factSource: r.source,
                createdAt: r.createdAt,
            });
        }
        for (const r of prompts) {
            const uid = Number(r.userId);
            if (!passUser(uid)) continue;
            items.push({
                id: `prompt-${r.id}`,
                rawId: Number(r.id),
                kind: r.status === "dismissed" ? "prompt_dismissed" : "prompt_answered",
                userId: uid,
                userName: nameOf(uid),
                question: r.question,
                answer: r.answerText,
                scope: r.answerScope,
                listingId: r.listingId != null ? Number(r.listingId) : null,
                listingName: r.listingName,
                source: r.src || "hostify",
                threadId: r.src === "quo" ? null : r.threadId != null ? Number(r.threadId) : null,
                createdAt: r.resolvedAt,
            });
        }
        for (const r of misses) {
            const key = String(r.missResolvedBy || "").trim().toLowerCase();
            const uid = key ? nameIndex.get(key) : null;
            if (uid == null || !guard(uid)) continue;
            items.push({
                id: `miss-${r.id}`,
                rawId: Number(r.id),
                kind: "miss_resolved",
                userId: uid,
                userName: nameOf(uid),
                suggestedReply: r.suggestedReply,
                source: r.src || "hostify",
                threadId: r.src === "quo" ? null : r.threadId != null ? Number(r.threadId) : null,
                quoConversationId: r.quoConversationId || null,
                createdAt: r.missResolvedAt,
            });
        }

        items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const c = counts[0] || {};
        return {
            total: Number(c.fb || 0) + Number(c.facts || 0) + Number(c.prompts || 0) + Number(c.misses || 0),
            byKind: {
                feedback: Number(c.fb || 0),
                factsTaught: Number(c.facts || 0),
                promptsResolved: Number(c.prompts || 0),
                missesResolved: Number(c.misses || 0),
            },
            items: items.slice(off, off + lim),
        };
    }

    // -------------------------------------------------------------------------
    // Drill-down: raw entries behind a "Who trains the AI" cell.
    // metric names match TrainingRow keys.
    // -------------------------------------------------------------------------
    async trainingDetail(
        userId: number,
        metric: string,
        f: InsightsFilters,
        limit = 100,
        offset = 0
    ): Promise<any> {
        const { start, end } = this.dateRange(f);
        const lim = Math.min(Math.max(limit, 1), 500);
        const off = Math.max(offset, 0);
        const users = await this.userDirectory();
        const user = users.get(Number(userId));
        if (!user) return { total: 0, items: [] };
        const q = (sql: string, params: any[]) => appDatabase.query(sql, params).catch(() => [] as any[]);

        const safeParse = (s: any) => {
            try {
                return JSON.parse(s || "[]");
            } catch {
                return [];
            }
        };

        let rows: any[] = [];
        let total = 0;
        switch (metric) {
            case "thumbsUp":
            case "thumbsDown": {
                const rating = metric === "thumbsUp" ? "up" : "down";
                const cnt = await q(
                    `SELECT COUNT(*) c FROM ai_message_feedback
                       WHERE userId = ? AND rating = ? AND createdAt >= ? AND createdAt < ?`,
                    [user.id, rating, start, end]
                );
                total = Number(cnt[0]?.c || 0);
                rows = await q(
                    `SELECT f.id, f.rating, f.categories, f.feedbackText, f.correctedResponse,
                            f.createdAt, f.threadId, f.suggestionId,
                            LEFT(s.suggestedReply, 300) AS suggestedReply, s.source AS src, s.quoConversationId
                     FROM ai_message_feedback f
                     LEFT JOIN ai_message_suggestions s ON s.id = f.suggestionId
                     WHERE f.userId = ? AND f.rating = ? AND f.createdAt >= ? AND f.createdAt < ?
                     ORDER BY f.createdAt DESC LIMIT ? OFFSET ?`,
                    [user.id, rating, start, end, lim, off]
                );
                return {
                    total,
                    items: rows.map((r) => ({
                        id: `fb-${r.id}`,
                        rawId: Number(r.id),
                        table: "ai_message_feedback",
                        kind: "feedback",
                        userId: user.id,
                        userName: user.name,
                        rating: r.rating,
                        categories: safeParse(r.categories),
                        feedbackText: r.feedbackText,
                        correctedResponse: r.correctedResponse,
                        suggestedReply: r.suggestedReply,
                        source: r.src || "hostify",
                        threadId: r.threadId != null ? Number(r.threadId) : null,
                        quoConversationId: r.quoConversationId || null,
                        createdAt: r.createdAt,
                    })),
                };
            }
            case "textFeedback":
            case "corrections": {
                const col = metric === "textFeedback" ? "feedbackText" : "correctedResponse";
                const cnt = await q(
                    `SELECT COUNT(*) c FROM ai_message_feedback
                       WHERE userId = ? AND ${col} IS NOT NULL AND ${col} <> ''
                         AND createdAt >= ? AND createdAt < ?`,
                    [user.id, start, end]
                );
                total = Number(cnt[0]?.c || 0);
                rows = await q(
                    `SELECT f.id, f.rating, f.categories, f.feedbackText, f.correctedResponse,
                            f.createdAt, f.threadId, f.suggestionId,
                            LEFT(s.suggestedReply, 300) AS suggestedReply, s.source AS src, s.quoConversationId
                     FROM ai_message_feedback f
                     LEFT JOIN ai_message_suggestions s ON s.id = f.suggestionId
                     WHERE f.userId = ? AND f.${col} IS NOT NULL AND f.${col} <> ''
                       AND f.createdAt >= ? AND f.createdAt < ?
                     ORDER BY f.createdAt DESC LIMIT ? OFFSET ?`,
                    [user.id, start, end, lim, off]
                );
                return {
                    total,
                    items: rows.map((r) => ({
                        id: `fb-${r.id}`,
                        rawId: Number(r.id),
                        table: "ai_message_feedback",
                        kind: "feedback",
                        userId: user.id,
                        userName: user.name,
                        rating: r.rating,
                        categories: safeParse(r.categories),
                        feedbackText: r.feedbackText,
                        correctedResponse: r.correctedResponse,
                        suggestedReply: r.suggestedReply,
                        source: r.src || "hostify",
                        threadId: r.threadId != null ? Number(r.threadId) : null,
                        quoConversationId: r.quoConversationId || null,
                        createdAt: r.createdAt,
                    })),
                };
            }
            case "promptsAnswered":
            case "promptsDismissed": {
                const status = metric === "promptsAnswered" ? "answered" : "dismissed";
                const cnt = await q(
                    `SELECT COUNT(*) c FROM ai_learning_prompts
                       WHERE answeredByUserId = ? AND status = ?
                         AND resolvedAt >= ? AND resolvedAt < ?`,
                    [user.id, status, start, end]
                );
                total = Number(cnt[0]?.c || 0);
                rows = await q(
                    `SELECT id, question, answerText, answerScope, status,
                            threadId, source AS src, listingName, listingId, resolvedAt
                     FROM ai_learning_prompts
                     WHERE answeredByUserId = ? AND status = ?
                       AND resolvedAt >= ? AND resolvedAt < ?
                     ORDER BY resolvedAt DESC LIMIT ? OFFSET ?`,
                    [user.id, status, start, end, lim, off]
                );
                return {
                    total,
                    items: rows.map((r) => ({
                        id: `prompt-${r.id}`,
                        rawId: Number(r.id),
                        table: "ai_learning_prompts",
                        kind: metric === "promptsAnswered" ? "prompt_answered" : "prompt_dismissed",
                        userId: user.id,
                        userName: user.name,
                        question: r.question,
                        answer: r.answerText,
                        scope: r.answerScope,
                        listingId: r.listingId != null ? Number(r.listingId) : null,
                        listingName: r.listingName,
                        source: r.src || "hostify",
                        threadId: r.src === "quo" ? null : r.threadId != null ? Number(r.threadId) : null,
                        createdAt: r.resolvedAt,
                    })),
                };
            }
            case "factsTaught": {
                const cnt = await q(
                    `SELECT COUNT(*) c FROM ai_learned_facts
                       WHERE createdByUserId = ?
                         AND source NOT IN ('learning_prompt', 'nightly_audit')
                         AND createdAt >= ? AND createdAt < ?`,
                    [user.id, start, end]
                );
                total = Number(cnt[0]?.c || 0);
                rows = await q(
                    `SELECT id, question, answer, scope, listingId, source, createdAt
                     FROM ai_learned_facts
                     WHERE createdByUserId = ?
                       AND source NOT IN ('learning_prompt', 'nightly_audit')
                       AND createdAt >= ? AND createdAt < ?
                     ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
                    [user.id, start, end, lim, off]
                );
                return {
                    total,
                    items: rows.map((r) => ({
                        id: `fact-${r.id}`,
                        rawId: Number(r.id),
                        table: "ai_learned_facts",
                        kind: "fact_taught",
                        userId: user.id,
                        userName: user.name,
                        question: r.question,
                        answer: r.answer,
                        scope: r.scope,
                        listingId: r.listingId != null ? Number(r.listingId) : null,
                        factSource: r.source,
                        createdAt: r.createdAt,
                    })),
                };
            }
            case "factsReviewed": {
                const cnt = await q(
                    `SELECT COUNT(*) c FROM ai_learned_facts
                       WHERE reviewedByUserId = ? AND updatedAt >= ? AND updatedAt < ?`,
                    [user.id, start, end]
                );
                total = Number(cnt[0]?.c || 0);
                rows = await q(
                    `SELECT id, question, answer, scope, listingId, source, updatedAt
                     FROM ai_learned_facts
                     WHERE reviewedByUserId = ? AND updatedAt >= ? AND updatedAt < ?
                     ORDER BY updatedAt DESC LIMIT ? OFFSET ?`,
                    [user.id, start, end, lim, off]
                );
                return {
                    total,
                    items: rows.map((r) => ({
                        id: `fact-${r.id}`,
                        rawId: Number(r.id),
                        table: "ai_learned_facts",
                        kind: "fact_taught",
                        userId: user.id,
                        userName: user.name,
                        question: r.question,
                        answer: r.answer,
                        scope: r.scope,
                        listingId: r.listingId != null ? Number(r.listingId) : null,
                        factSource: r.source,
                        createdAt: r.updatedAt,
                    })),
                };
            }
            case "missesResolved": {
                // Name-keyed source — resolve back to this user's rows only if
                // the name maps uniquely. Otherwise there's nothing safe to show.
                if (!user.name) return { total: 0, items: [] };
                const nameForMatch = user.name;
                // Ambiguity check: if another SS user has the same name, refuse.
                const dupes: any[] = await q(
                    `SELECT COUNT(*) c FROM users
                       WHERE deletedAt IS NULL AND TRIM(CONCAT(COALESCE(firstName,''),' ',COALESCE(lastName,''))) = ?`,
                    [nameForMatch]
                );
                if (Number(dupes[0]?.c || 0) > 1) return { total: 0, items: [], ambiguous: true };
                const cnt = await q(
                    `SELECT COUNT(*) c FROM ai_message_suggestions
                       WHERE missResolvedBy = ? AND missResolvedAt >= ? AND missResolvedAt < ?`,
                    [nameForMatch, start, end]
                );
                total = Number(cnt[0]?.c || 0);
                rows = await q(
                    `SELECT id, missResolvedAt, threadId, source AS src, quoConversationId,
                            LEFT(suggestedReply, 300) AS suggestedReply
                     FROM ai_message_suggestions
                     WHERE missResolvedBy = ? AND missResolvedAt >= ? AND missResolvedAt < ?
                     ORDER BY missResolvedAt DESC LIMIT ? OFFSET ?`,
                    [nameForMatch, start, end, lim, off]
                );
                return {
                    total,
                    items: rows.map((r) => ({
                        id: `miss-${r.id}`,
                        rawId: Number(r.id),
                        table: "ai_message_suggestions",
                        kind: "miss_resolved",
                        userId: user.id,
                        userName: user.name,
                        suggestedReply: r.suggestedReply,
                        source: r.src || "hostify",
                        threadId: r.src === "quo" ? null : r.threadId != null ? Number(r.threadId) : null,
                        quoConversationId: r.quoConversationId || null,
                        createdAt: r.missResolvedAt,
                    })),
                };
            }
            case "suggestionsAccepted":
            case "suggestionsEdited":
            case "suggestionsIgnored": {
                const statuses =
                    metric === "suggestionsAccepted"
                        ? ["accepted", "auto_sent"]
                        : metric === "suggestionsEdited"
                        ? ["edited"]
                        : ["ignored", "rejected"];
                const placeholders = statuses.map(() => "?").join(",");
                const cnt = await q(
                    `SELECT COUNT(*) c FROM ai_message_suggestions
                       WHERE acceptedByUserId = ? AND status IN (${placeholders})
                         AND generatedAt >= ? AND generatedAt < ?`,
                    [user.id, ...statuses, start, end]
                );
                total = Number(cnt[0]?.c || 0);
                rows = await q(
                    `SELECT id, threadId, source AS src, quoConversationId, generatedAt,
                            LEFT(suggestedReply, 300) AS suggestedReply, status
                     FROM ai_message_suggestions
                     WHERE acceptedByUserId = ? AND status IN (${placeholders})
                       AND generatedAt >= ? AND generatedAt < ?
                     ORDER BY generatedAt DESC LIMIT ? OFFSET ?`,
                    [user.id, ...statuses, start, end, lim, off]
                );
                return {
                    total,
                    items: rows.map((r) => ({
                        id: `sugg-${r.id}`,
                        rawId: Number(r.id),
                        table: "ai_message_suggestions",
                        kind: metric,
                        userId: user.id,
                        userName: user.name,
                        suggestedReply: r.suggestedReply,
                        source: r.src || "hostify",
                        threadId: r.threadId != null ? Number(r.threadId) : null,
                        quoConversationId: r.quoConversationId || null,
                        status: r.status,
                        createdAt: r.generatedAt,
                    })),
                };
            }
            default:
                return { total: 0, items: [] };
        }
    }

    // -------------------------------------------------------------------------
    // Corrections: update an entry originally created by another user.
    // Writes an audit trail column so the correction is visible.
    // -------------------------------------------------------------------------
    async correctFeedback(
        id: number,
        correctorUserId: number,
        patch: { feedbackText?: string | null; correctedResponse?: string | null }
    ): Promise<boolean> {
        const fields: string[] = [];
        const params: any[] = [];
        if (patch.feedbackText !== undefined) {
            fields.push("feedbackText = ?");
            params.push(patch.feedbackText);
        }
        if (patch.correctedResponse !== undefined) {
            fields.push("correctedResponse = ?");
            params.push(patch.correctedResponse);
        }
        if (!fields.length) return false;
        fields.push("correctedByUserId = ?", "correctedAt = NOW()");
        params.push(correctorUserId, id);
        await appDatabase.query(`UPDATE ai_message_feedback SET ${fields.join(", ")} WHERE id = ?`, params);
        return true;
    }

    async correctLearnedFact(
        id: number,
        correctorUserId: number,
        patch: { question?: string; answer?: string; scope?: string }
    ): Promise<boolean> {
        const fields: string[] = [];
        const params: any[] = [];
        if (patch.question !== undefined) {
            fields.push("question = ?");
            params.push(patch.question);
        }
        if (patch.answer !== undefined) {
            fields.push("answer = ?");
            params.push(patch.answer);
        }
        if (patch.scope !== undefined) {
            fields.push("scope = ?");
            params.push(patch.scope);
        }
        if (!fields.length) return false;
        fields.push("correctedByUserId = ?", "correctedAt = NOW()");
        params.push(correctorUserId, id);
        await appDatabase.query(`UPDATE ai_learned_facts SET ${fields.join(", ")} WHERE id = ?`, params);
        return true;
    }

    async correctLearningPrompt(
        id: number,
        correctorUserId: number,
        patch: { answerText?: string; answerScope?: string }
    ): Promise<boolean> {
        const fields: string[] = [];
        const params: any[] = [];
        if (patch.answerText !== undefined) {
            fields.push("answerText = ?");
            params.push(patch.answerText);
        }
        if (patch.answerScope !== undefined) {
            fields.push("answerScope = ?");
            params.push(patch.answerScope);
        }
        if (!fields.length) return false;
        fields.push("correctedByUserId = ?", "correctedAt = NOW()");
        params.push(correctorUserId, id);
        await appDatabase.query(`UPDATE ai_learning_prompts SET ${fields.join(", ")} WHERE id = ?`, params);
        return true;
    }

    // -------------------------------------------------------------------------
    // Directory endpoints for filter UIs.
    /**
     * Per-rep performance for Admin Insights EVENT KINDS → "Per-rep performance".
     * Manager feedback is keyed by subjectUserId (the sender). Response / missed /
     * takeover use inbox_messages + Employees Schedule (America/New_York).
     */
    async repPerformance(f: InsightsFilters): Promise<{
        since: string;
        until: string;
        timezone: string;
        missedThresholdMinutes: number;
        definitions: Record<string, string>;
        reps: Array<{
            userId: number;
            name: string;
            userType: string | null;
            managerFeedback: {
                thumbsUp: number;
                thumbsDown: number;
                withText: number;
                withCorrection: number;
                netScore: number;
            };
            replies: number;
            avgResponseTimeMinutes: number | null;
            responseSamples: number;
            missedMessages: number;
            takeoverMessages: number;
        }>;
    }> {
        const { start, end } = this.dateRange(f);
        const users = await this.userDirectory();
        const listingId =
            f.listingId != null && Number.isFinite(Number(f.listingId)) ? Number(f.listingId) : null;
        const MISSED_MINUTES = 30;

        // Manager feedback on sent replies — credit the REP who sent (subjectUserId).
        const feedbackRows: any[] = await appDatabase.query(
            `SELECT subjectUserId AS userId,
                    SUM(rating = 'up') AS thumbsUp,
                    SUM(rating = 'down') AS thumbsDown,
                    SUM(feedbackText IS NOT NULL AND TRIM(feedbackText) <> '') AS withText,
                    SUM(correctedResponse IS NOT NULL AND TRIM(correctedResponse) <> '') AS withCorrection
             FROM ai_message_feedback
             WHERE targetType = 'sent_reply'
               AND subjectUserId IS NOT NULL
               AND createdAt >= ? AND createdAt < ?
               ${listingId != null ? "AND listingId = ?" : ""}
             GROUP BY subjectUserId`,
            listingId != null ? [start, end, listingId] : [start, end]
        );

        const byUser = new Map<
            number,
            {
                userId: number;
                name: string;
                userType: string | null;
                thumbsUp: number;
                thumbsDown: number;
                withText: number;
                withCorrection: number;
                replies: number;
                responseSumMin: number;
                responseSamples: number;
                missedMessages: number;
                takeoverMessages: number;
            }
        >();

        const ensure = (userId: number) => {
            if (byUser.has(userId)) return byUser.get(userId)!;
            const u = users.get(userId);
            const row = {
                userId,
                name: u?.name || `user ${userId}`,
                userType: u?.userType || null,
                thumbsUp: 0,
                thumbsDown: 0,
                withText: 0,
                withCorrection: 0,
                replies: 0,
                responseSumMin: 0,
                responseSamples: 0,
                missedMessages: 0,
                takeoverMessages: 0,
            };
            byUser.set(userId, row);
            return row;
        };

        for (const r of feedbackRows) {
            const uid = Number(r.userId);
            if (!Number.isFinite(uid) || uid <= 0) continue;
            const row = ensure(uid);
            row.thumbsUp = Number(r.thumbsUp) || 0;
            row.thumbsDown = Number(r.thumbsDown) || 0;
            row.withText = Number(r.withText) || 0;
            row.withCorrection = Number(r.withCorrection) || 0;
        }

        // Human Hostify replies attributed to SS users.
        const replyRows: any[] = await appDatabase.query(
            `SELECT sentByUserId AS userId, COUNT(*) AS c
             FROM inbox_messages
             WHERE direction = 'outgoing'
               AND sentByUserId IS NOT NULL
               AND COALESCE(isAutomatic, 0) = 0
               AND sentVia = 'inbox_v2'
               AND sentAt >= ? AND sentAt < ?
               ${listingId != null ? "AND listingId = ?" : ""}
             GROUP BY sentByUserId`,
            listingId != null ? [start, end, listingId] : [start, end]
        );
        for (const r of replyRows) {
            const uid = Number(r.userId);
            if (!Number.isFinite(uid) || uid <= 0) continue;
            ensure(uid).replies = Number(r.c) || 0;
        }

        // Shift-aware metrics (Guest Relations schedules).
        const { EmployeeShiftService } = await import("./EmployeeShiftService");
        const shiftSvc = new EmployeeShiftService();
        const shiftCtx = await shiftSvc.loadShiftContext(start, end);
        const grUserIds = [...shiftCtx.byUserId.keys()];

        // Seed GR employees so they appear even with zero activity.
        for (const uid of grUserIds) ensure(uid);

        const inbound: any[] = await appDatabase.query(
            `SELECT id, threadId, sentAt, listingId
             FROM inbox_messages
             WHERE direction = 'incoming'
               AND COALESCE(isAutomatic, 0) = 0
               AND sentAt >= ? AND sentAt < ?
               ${listingId != null ? "AND listingId = ?" : ""}
             ORDER BY threadId ASC, sentAt ASC, id ASC
             LIMIT 4000`,
            listingId != null ? [start, end, listingId] : [start, end]
        );

        // Include a little lookback so first reply after window-start inbound still pairs.
        const outboundStart = new Date(start.getTime() - 2 * 3600 * 1000);
        const outbound: any[] = await appDatabase.query(
            `SELECT id, threadId, sentAt, sentByUserId
             FROM inbox_messages
             WHERE direction = 'outgoing'
               AND sentByUserId IS NOT NULL
               AND COALESCE(isAutomatic, 0) = 0
               AND sentVia = 'inbox_v2'
               AND sentAt >= ? AND sentAt < ?
               ${listingId != null ? "AND listingId = ?" : ""}
             ORDER BY threadId ASC, sentAt ASC, id ASC
             LIMIT 8000`,
            listingId != null ? [outboundStart, end, listingId] : [outboundStart, end]
        );

        // Group outbound by thread; keep a per-thread pointer for O(n) next-reply scan.
        const outboundByThread = new Map<number, Array<{ sentAtMs: number; sentByUserId: number }>>();
        for (const o of outbound) {
            const tid = Number(o.threadId);
            if (!outboundByThread.has(tid)) outboundByThread.set(tid, []);
            outboundByThread.get(tid)!.push({
                sentAtMs: new Date(o.sentAt).getTime(),
                sentByUserId: Number(o.sentByUserId),
            });
        }
        const outboundPtr = new Map<number, number>();

        const missedThresholdMs = MISSED_MINUTES * 60 * 1000;

        for (const inn of inbound) {
            const tid = Number(inn.threadId);
            const inAt = new Date(inn.sentAt);
            const inMs = inAt.getTime();
            if (!Number.isFinite(inMs)) continue;
            const outs = outboundByThread.get(tid) || [];
            let ptr = outboundPtr.get(tid) || 0;
            while (ptr < outs.length && outs[ptr].sentAtMs <= inMs) ptr++;
            outboundPtr.set(tid, ptr);
            const next = ptr < outs.length ? outs[ptr] : null;

            const onShiftUserIds = shiftSvc.onShiftUserIdsAt(
                inAt,
                shiftCtx.byUserId,
                shiftCtx.overridesByEmployeeDate,
                shiftCtx.leaveByUserId
            );
            const onShiftSet = new Set(onShiftUserIds);

            if (next) {
                const mins = (next.sentAtMs - inMs) / 60000;
                if (Number.isFinite(mins) && mins >= 0 && mins < 24 * 60) {
                    const row = ensure(next.sentByUserId);
                    row.responseSumMin += mins;
                    row.responseSamples += 1;
                }
                // Takeover: this GR rep answered an inbound that arrived outside THEIR shift.
                if (
                    shiftCtx.byUserId.has(next.sentByUserId) &&
                    !onShiftSet.has(next.sentByUserId)
                ) {
                    ensure(next.sentByUserId).takeoverMessages += 1;
                }
            }

            // Missed: inbound while on shift, no human reply within threshold.
            const repliedInTime = !!next && next.sentAtMs - inMs <= missedThresholdMs;
            if (!repliedInTime && onShiftUserIds.length) {
                for (const uid of onShiftUserIds) {
                    ensure(uid).missedMessages += 1;
                }
            }
        }

        // Apply user / userType filters.
        let rows = [...byUser.values()];
        if (f.userIds?.length) {
            const allow = new Set(f.userIds.map(Number));
            rows = rows.filter((r) => allow.has(r.userId));
        }
        if (f.userType) {
            const want = String(f.userType).toLowerCase();
            rows = rows.filter((r) => String(r.userType || "regular").toLowerCase() === want);
        }

        rows.sort((a, b) => {
            const aScore = a.thumbsUp + a.thumbsDown + a.replies + a.missedMessages + a.takeoverMessages;
            const bScore = b.thumbsUp + b.thumbsDown + b.replies + b.missedMessages + b.takeoverMessages;
            if (bScore !== aScore) return bScore - aScore;
            return a.name.localeCompare(b.name);
        });

        return {
            since: start.toISOString(),
            until: end.toISOString(),
            timezone: shiftCtx.timezone,
            missedThresholdMinutes: MISSED_MINUTES,
            definitions: {
                managerFeedback:
                    "Thumbs / notes managers leave on sent replies, credited to the rep who sent the message.",
                avgResponseTime:
                    "Guest inbound → first human Inbox v2 reply by this rep in the same thread (minutes).",
                missedMessages: `Guest inbound while this rep was on shift (Employees → Schedule, ${shiftCtx.timezone}) with no human reply within ${MISSED_MINUTES} minutes.`,
                takeoverMessages:
                    "Human replies by this rep to a guest message that arrived outside their scheduled shift.",
            },
            reps: rows.map((r) => ({
                userId: r.userId,
                name: r.name,
                userType: r.userType,
                managerFeedback: {
                    thumbsUp: r.thumbsUp,
                    thumbsDown: r.thumbsDown,
                    withText: r.withText,
                    withCorrection: r.withCorrection,
                    netScore: r.thumbsUp - r.thumbsDown,
                },
                replies: r.replies,
                avgResponseTimeMinutes:
                    r.responseSamples > 0
                        ? Math.round((r.responseSumMin / r.responseSamples) * 10) / 10
                        : null,
                responseSamples: r.responseSamples,
                missedMessages: r.missedMessages,
                takeoverMessages: r.takeoverMessages,
            })),
        };
    }

    // -------------------------------------------------------------------------
    async listUsers(): Promise<any[]> {
        const rows: any[] = await appDatabase.query(
            `SELECT id, firstName, lastName, email, userType, isActive
             FROM users WHERE deletedAt IS NULL
             ORDER BY firstName, lastName`
        );
        return rows.map((u) => ({
            id: Number(u.id),
            name: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || `user ${u.id}`,
            email: u.email,
            userType: u.userType || "regular",
            isActive: !!u.isActive,
        }));
    }

    async listListings(): Promise<any[]> {
        // Pull distinct properties that show up in any of our attribution
        // tables, joining to a friendly name where possible.
        try {
            const rows: any[] = await appDatabase.query(
                `SELECT DISTINCT ic.listingId AS id, ic.listingName AS name
                 FROM inbox_conversations ic
                 WHERE ic.listingId IS NOT NULL AND ic.listingName IS NOT NULL
                 ORDER BY ic.listingName`
            );
            return rows.map((r) => ({ id: Number(r.id), name: String(r.name || "") }));
        } catch {
            return [];
        }
    }
}
