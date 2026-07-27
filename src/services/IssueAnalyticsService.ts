import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";

/**
 * Issue Resolution Analytics — how well IR Copilot is doing on Guest Issues,
 * measured against the feedback the team gives it.
 *
 * Three data sources feed the page:
 *   - `issue_ai_suggestions` — every playbook the bot produced (+ lifecycle status)
 *   - `issue_ai_feedback`    — thumbs / categories / corrections the team submitted
 *   - `issue_ai_actions`     — the actions the bot actually executed on a ticket
 *
 * Rows are pulled for the window and aggregated in JS (ticket-scale volumes),
 * mirroring InboxAnalyticsService rather than fanning out GROUP BY queries.
 */

export type IssueAnalyticsGranularity = "day" | "week" | "month";

export interface IssueAnalyticsFilters {
    startDate?: string | null;
    endDate?: string | null;
    listingIds?: number[] | null;
    /** Restrict to feedback submitted by one SecureStay user. */
    reviewerId?: number | null;
    /** "IR" (maintenance/vendor lane), "GR" (guest relations lane), or all. */
    lane?: string | null;
    /** Exact ticket category, e.g. "MAINTENANCE". */
    category?: string | null;
}

/** Guest Relations categories — quote/policy/guest comms lane. */
const GR_CATEGORIES = new Set([
    "RESERVATION CHANGES",
    "PROPERTY ACCESS",
    "PAYMENTS",
    "REFUNDS",
    "SAFETY",
    "COMMUNICATION AND ESCALATION",
    "LISTING",
    "LOST AND FOUND",
]);

/** Issue Resolution categories — vendor/cleaner dispatch lane. */
const IR_CATEGORIES = new Set([
    "MAINTENANCE",
    "HVAC",
    "CLEANLINESS",
    "SUPPLIES",
    "POOL AND SPA",
    "PEST CONTROL",
    "LANDSCAPING",
]);

const ACTION_LABELS: Record<string, string> = {
    guest_message: "Guest message sent (Inbox)",
    guest_sms: "Guest SMS sent (Quo)",
    vendor_sms: "Vendor SMS",
    internal_note: "Internal note logged",
    follow_up: "Follow-up scheduled",
    vendor_taught: "Vendor taught",
    auto_assign: "Auto-assigned",
    auto_ack: "Auto-acknowledged guest",
};

type UserRecord = { id: number; name: string; email: string | null };

export class IssueAnalyticsService {
    // -------------------------------------------------------------------------
    // Shared helpers
    // -------------------------------------------------------------------------

    private clampDays(days: any): number {
        const n = Number(days);
        if (!Number.isFinite(n) || n <= 0) return 60;
        return Math.min(Math.max(Math.round(n), 1), 365);
    }

    /**
     * Window clause for `<alias>.<column>` based on an explicit start/end range
     * (inclusive of the end day) or a fallback "last N days" window.
     */
    private windowClause(column: string, days: number, f?: IssueAnalyticsFilters) {
        const start = (f?.startDate || "").trim();
        const end = (f?.endDate || "").trim();
        if (start && end) {
            return {
                sql: `AND ${column} >= ? AND ${column} < DATE_ADD(?, INTERVAL 1 DAY)`,
                params: [start, end] as any[],
            };
        }
        if (start) return { sql: `AND ${column} >= ?`, params: [start] as any[] };
        if (end) return { sql: `AND ${column} < DATE_ADD(?, INTERVAL 1 DAY)`, params: [end] as any[] };
        return { sql: `AND ${column} >= (NOW() - INTERVAL ? DAY)`, params: [days] as any[] };
    }

    /** Listing / lane / category clauses against the joined `issues i` row. */
    private issueClause(f?: IssueAnalyticsFilters) {
        const parts: string[] = [];
        const params: any[] = [];
        const ids = (f?.listingIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
        if (ids.length) {
            parts.push(`AND CAST(i.listing_id AS UNSIGNED) IN (${ids.map(() => "?").join(",")})`);
            params.push(...ids);
        }
        const category = (f?.category || "").trim();
        if (category) {
            parts.push("AND i.category = ?");
            params.push(category);
        }
        const lane = (f?.lane || "").trim().toUpperCase();
        if (lane === "IR" || lane === "GR") {
            const set = lane === "IR" ? IR_CATEGORIES : GR_CATEGORIES;
            const list = [...set];
            parts.push(`AND UPPER(COALESCE(i.category, '')) IN (${list.map(() => "?").join(",")})`);
            params.push(...list);
        }
        return { sql: parts.join(" "), params };
    }

    private laneOf(category: any): "IR" | "GR" | "unknown" {
        const c = String(category || "").trim().toUpperCase();
        if (IR_CATEGORIES.has(c)) return "IR";
        if (GR_CATEGORIES.has(c)) return "GR";
        return "unknown";
    }

    private async userDirectory(): Promise<Map<number, UserRecord>> {
        const rows: any[] = await appDatabase
            .query("SELECT id, firstName, lastName, email FROM users WHERE deletedAt IS NULL")
            .catch(() => []);
        const map = new Map<number, UserRecord>();
        for (const u of rows) {
            const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
            map.set(Number(u.id), {
                id: Number(u.id),
                name: name || u.email || `user ${u.id}`,
                email: u.email || null,
            });
        }
        return map;
    }

    private parseCategories(raw: any): string[] {
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.map((c) => String(c)) : [];
        } catch {
            return [];
        }
    }

    private parseJson<T>(raw: any, fallback: T): T {
        if (!raw) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return (parsed ?? fallback) as T;
        } catch {
            return fallback;
        }
    }

    private pct(part: number, whole: number): number | null {
        if (!whole) return null;
        return Math.round((part / whole) * 1000) / 10;
    }

    private avg(values: number[]): number | null {
        if (!values.length) return null;
        return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
    }

    private bucketKey(d: Date, granularity: IssueAnalyticsGranularity): string {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        if (granularity === "month") return `${y}-${m}`;
        if (granularity === "day") return `${y}-${m}-${String(d.getDate()).padStart(2, "0")}`;
        const onejan = new Date(y, 0, 1);
        const wk = String(
            Math.ceil((((d as any) - (onejan as any)) / 86400000 + onejan.getDay() + 1) / 7)
        ).padStart(2, "0");
        return `${y}-W${wk}`;
    }

    /**
     * A failing panel degrades to an empty section rather than 500-ing the whole
     * report — but it still gets logged, otherwise a broken query looks like
     * "no data" forever.
     */
    private q(sql: string, params: any[]): Promise<any[]> {
        return appDatabase.query(sql, params).catch((err: any) => {
            logger.warn(`[IssueAnalyticsService] query failed: ${err?.message}`);
            return [] as any[];
        });
    }

    // -------------------------------------------------------------------------
    // Main report
    // -------------------------------------------------------------------------

    async report(
        sinceDays: number,
        granularity: IssueAnalyticsGranularity = "day",
        filters: IssueAnalyticsFilters = {}
    ) {
        const days = this.clampDays(sinceDays);
        const gran: IssueAnalyticsGranularity =
            granularity === "week" || granularity === "month" ? granularity : "day";
        const issueWhere = this.issueClause(filters);
        const reviewerId =
            filters.reviewerId != null && Number.isFinite(Number(filters.reviewerId))
                ? Number(filters.reviewerId)
                : null;

        const sugWin = this.windowClause("s.generatedAt", days, filters);
        const fbWin = this.windowClause("f.createdAt", days, filters);
        const actWin = this.windowClause("a.createdAt", days, filters);
        const issueWin = this.windowClause("i.created_at", days, filters);

        const [suggestions, suggestionFeedback, windowFeedback, actions, tickets] = await Promise.all([
            // Every playbook generated in the window.
            this.q(
                `SELECT s.id, s.issueId, s.listingId, s.severity, s.confidence, s.status,
                        s.generatedAt, s.promptVersion, s.modelName,
                        i.category, i.listing_name AS listingName
                 FROM issue_ai_suggestions s
                 JOIN issues i ON i.id = s.issueId
                 WHERE i.deleted_at IS NULL ${sugWin.sql} ${issueWhere.sql}`,
                [...sugWin.params, ...issueWhere.params]
            ),
            // All feedback on those suggestions, whenever it was submitted —
            // rating a two-week-old playbook still grades that playbook.
            this.q(
                `SELECT f.id, f.suggestionId, f.userId, f.rating, f.categories,
                        f.correctedResponse, f.createdAt
                 FROM issue_ai_feedback f
                 JOIN issue_ai_suggestions s ON s.id = f.suggestionId
                 JOIN issues i ON i.id = s.issueId
                 WHERE i.deleted_at IS NULL ${sugWin.sql} ${issueWhere.sql}`,
                [...sugWin.params, ...issueWhere.params]
            ),
            // Reviewer activity is windowed on when the feedback was given.
            this.q(
                `SELECT f.id, f.suggestionId, f.issueId, f.userId, f.rating, f.categories,
                        f.feedbackText, f.correctedResponse, f.createdAt, i.category
                 FROM issue_ai_feedback f
                 LEFT JOIN issues i ON i.id = f.issueId
                 WHERE (i.id IS NULL OR i.deleted_at IS NULL) ${fbWin.sql} ${issueWhere.sql}`,
                [...fbWin.params, ...issueWhere.params]
            ),
            this.q(
                `SELECT a.id, a.issueId, a.suggestionId, a.userId, a.actionType, a.channel,
                        a.status, a.automated, a.createdAt, i.category
                 FROM issue_ai_actions a
                 JOIN issues i ON i.id = a.issueId
                 WHERE i.deleted_at IS NULL ${actWin.sql} ${issueWhere.sql}`,
                [...actWin.params, ...issueWhere.params]
            ),
            this.q(
                `SELECT i.id, i.category, i.status, i.ai_resolution_status, i.ai_guest_sentiment,
                        i.resolution_refreshed_at, i.manager_feedback, i.manager_ai_feedback,
                        i.created_at, i.completed_at
                 FROM issues i
                 WHERE i.deleted_at IS NULL ${issueWin.sql} ${issueWhere.sql}`,
                [...issueWin.params, ...issueWhere.params]
            ),
        ]);

        const users = await this.userDirectory();

        // --- Feedback indexed by suggestion (optionally scoped to one reviewer)
        const scopedFeedback = reviewerId
            ? suggestionFeedback.filter((f) => Number(f.userId) === reviewerId)
            : suggestionFeedback;
        const fbBySuggestion = new Map<number, any[]>();
        for (const f of scopedFeedback) {
            const key = Number(f.suggestionId);
            if (!fbBySuggestion.has(key)) fbBySuggestion.set(key, []);
            fbBySuggestion.get(key)!.push(f);
        }

        // Latest rating wins when a suggestion was rated more than once.
        // Resolved once up front: the breakdowns and the trend each walk the
        // whole suggestion list, and re-sorting per lookup made this quadratic.
        const verdicts = new Map<number, "up" | "down">();
        for (const f of [...scopedFeedback]
            .filter((f) => f.rating === "up" || f.rating === "down")
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
            verdicts.set(Number(f.suggestionId), f.rating);
        }
        const verdictOf = (suggestionId: number) => verdicts.get(suggestionId) ?? null;

        // --- Headline suggestion metrics
        //
        // The reviewer filter scopes feedback-derived numbers (approval, rated
        // counts, tag themes) but deliberately NOT bot activity: how many
        // playbooks the bot produced and what it executed are facts about the
        // bot, not about who happened to grade it. So the suggestion list stays
        // whole and only `verdictOf` narrows — "rated" then reads as "rated by
        // this reviewer" and "unrated" as "still needs their review".
        //
        // Superseded drafts are excluded from every rate: they were replaced by
        // a newer playbook, never appear in the review queue, and counting them
        // would permanently depress review coverage. The count is still
        // reported on its own, since frequent regeneration is a signal itself.
        const regenerated = suggestions.filter((s) => s.status === "regenerated").length;
        const scoped = suggestions.filter((s) => s.status !== "regenerated");

        let up = 0;
        let down = 0;
        let withCorrection = 0;
        const confAll: number[] = [];
        const confUp: number[] = [];
        const confDown: number[] = [];
        const statusCounts: Record<string, number> = {};

        for (const s of scoped) {
            const conf = s.confidence == null ? null : Number(s.confidence);
            if (conf != null && Number.isFinite(conf)) confAll.push(conf);
            statusCounts[s.status || "suggested"] = (statusCounts[s.status || "suggested"] || 0) + 1;
            const verdict = verdictOf(Number(s.id));
            if (verdict === "up") {
                up++;
                if (conf != null && Number.isFinite(conf)) confUp.push(conf);
            } else if (verdict === "down") {
                down++;
                if (conf != null && Number.isFinite(conf)) confDown.push(conf);
            }
            if ((fbBySuggestion.get(Number(s.id)) || []).some((f) => (f.correctedResponse || "").trim())) {
                withCorrection++;
            }
        }

        const rated = up + down;
        const total = scoped.length;

        // --- Feedback tag breakdown (why the team pushed back)
        const tagCounts = new Map<string, { count: number; up: number; down: number }>();
        for (const f of scopedFeedback) {
            for (const tag of this.parseCategories(f.categories)) {
                const entry = tagCounts.get(tag) || { count: 0, up: 0, down: 0 };
                entry.count++;
                if (f.rating === "up") entry.up++;
                else if (f.rating === "down") entry.down++;
                tagCounts.set(tag, entry);
            }
        }
        const totalTagged = [...tagCounts.values()].reduce((a, b) => a + b.count, 0);
        const categories = [...tagCounts.entries()]
            .map(([category, v]) => ({
                category,
                count: v.count,
                up: v.up,
                down: v.down,
                pct: this.pct(v.count, totalTagged) ?? 0,
            }))
            .sort((a, b) => b.count - a.count);

        // --- Who is reviewing, and how much
        const reviewerMap = new Map<
            number,
            {
                userId: number;
                name: string;
                total: number;
                up: number;
                down: number;
                withText: number;
                withCorrection: number;
                issues: Set<number>;
                lastAt: string | null;
            }
        >();
        for (const f of windowFeedback) {
            const id = Number(f.userId);
            if (!Number.isFinite(id) || id <= 0) continue;
            if (reviewerId && id !== reviewerId) continue;
            if (!reviewerMap.has(id)) {
                reviewerMap.set(id, {
                    userId: id,
                    name: users.get(id)?.name || `user ${id}`,
                    total: 0,
                    up: 0,
                    down: 0,
                    withText: 0,
                    withCorrection: 0,
                    issues: new Set<number>(),
                    lastAt: null,
                });
            }
            const r = reviewerMap.get(id)!;
            r.total++;
            if (f.rating === "up") r.up++;
            else if (f.rating === "down") r.down++;
            if ((f.feedbackText || "").trim()) r.withText++;
            if ((f.correctedResponse || "").trim()) r.withCorrection++;
            if (f.issueId != null) r.issues.add(Number(f.issueId));
            const at = new Date(f.createdAt).toISOString();
            if (!r.lastAt || at > r.lastAt) r.lastAt = at;
        }
        const reviewers = [...reviewerMap.values()]
            .map((r) => ({
                userId: r.userId,
                name: r.name,
                total: r.total,
                up: r.up,
                down: r.down,
                withText: r.withText,
                withCorrection: r.withCorrection,
                ticketsReviewed: r.issues.size,
                approvalPct: this.pct(r.up, r.up + r.down),
                lastAt: r.lastAt,
            }))
            .sort((a, b) => b.total - a.total);

        // --- Actions the bot actually executed (never reviewer-scoped, see above)
        const actionScoped = actions;
        const actionTypes = new Map<string, { count: number; automated: number; skipped: number; issues: Set<number> }>();
        const issuesWithAction = new Set<number>();
        for (const a of actionScoped) {
            const key = String(a.actionType);
            if (!actionTypes.has(key)) {
                actionTypes.set(key, { count: 0, automated: 0, skipped: 0, issues: new Set<number>() });
            }
            const entry = actionTypes.get(key)!;
            entry.count++;
            if (Number(a.automated) === 1) entry.automated++;
            if (a.status === "skipped") entry.skipped++;
            entry.issues.add(Number(a.issueId));
            issuesWithAction.add(Number(a.issueId));
        }
        const suggestedIssues = new Set(scoped.map((s) => Number(s.issueId)));
        const actedOn = [...suggestedIssues].filter((id) => issuesWithAction.has(id)).length;

        const actionSummary = {
            total: actionScoped.length,
            automated: actionScoped.filter((a) => Number(a.automated) === 1).length,
            humanConfirmed: actionScoped.filter((a) => Number(a.automated) !== 1).length,
            ticketsTouched: issuesWithAction.size,
            ticketsWithSuggestion: suggestedIssues.size,
            ticketsActedOn: actedOn,
            actionRatePct: this.pct(actedOn, suggestedIssues.size),
            byType: [...actionTypes.entries()]
                .map(([key, v]) => ({
                    key,
                    label: ACTION_LABELS[key] || key,
                    count: v.count,
                    automated: v.automated,
                    skipped: v.skipped,
                    tickets: v.issues.size,
                }))
                .sort((a, b) => b.count - a.count),
        };

        // --- Breakdowns by severity and by ticket category
        const bySeverity = this.breakdown(scoped, (s) => String(s.severity || "unknown").toLowerCase(), verdictOf);
        const byCategory = this.breakdown(scoped, (s) => String(s.category || "Uncategorized"), verdictOf);
        const byLane = this.breakdown(scoped, (s) => this.laneOf(s.category), verdictOf);

        // --- Retrospective resolution analysis coverage
        const analyzed = tickets.filter((t) => !!t.resolution_refreshed_at);
        const statusTally = new Map<string, number>();
        const sentimentTally = new Map<string, number>();
        for (const t of analyzed) {
            const st = String(t.ai_resolution_status || "—").trim() || "—";
            statusTally.set(st, (statusTally.get(st) || 0) + 1);
            const sent = String(t.ai_guest_sentiment || "—").trim() || "—";
            sentimentTally.set(sent, (sentimentTally.get(sent) || 0) + 1);
        }
        const resolution = {
            tickets: tickets.length,
            analyzed: analyzed.length,
            analyzedPct: this.pct(analyzed.length, tickets.length),
            resolved: statusTally.get("Resolved") || 0,
            notResolved: statusTally.get("Not Resolved") || 0,
            resolvedPct: this.pct(
                statusTally.get("Resolved") || 0,
                (statusTally.get("Resolved") || 0) + (statusTally.get("Not Resolved") || 0)
            ),
            managerReviewed: tickets.filter((t) => (t.manager_feedback || "").trim()).length,
            statuses: [...statusTally.entries()]
                .map(([label, count]) => ({ label, count, pct: this.pct(count, analyzed.length) ?? 0 }))
                .sort((a, b) => b.count - a.count),
            sentiment: [...sentimentTally.entries()]
                .map(([label, count]) => ({ label, count, pct: this.pct(count, analyzed.length) ?? 0 }))
                .sort((a, b) => b.count - a.count),
        };

        // --- Trend
        const trend = this.buildTrend(scoped, actionScoped, gran, verdictOf);

        return {
            sinceDays: days,
            granularity: gran,
            generatedAt: new Date().toISOString(),
            /** True when ratings shown are one reviewer's, not the whole team's. */
            reviewerScoped: reviewerId != null,
            suggestions: {
                total,
                tickets: suggestedIssues.size,
                rated,
                unrated: Math.max(total - rated, 0),
                ratedPct: this.pct(rated, total),
                thumbsUp: up,
                thumbsDown: down,
                approvalPct: this.pct(up, rated),
                withCorrection,
                accepted: statusCounts.accepted || 0,
                edited: statusCounts.edited || 0,
                ignored: statusCounts.ignored || 0,
                regenerated,
                pending: statusCounts.suggested || 0,
                avgConfidence: this.avg(confAll),
                avgConfidenceUp: this.avg(confUp),
                avgConfidenceDown: this.avg(confDown),
            },
            actions: actionSummary,
            categories,
            reviewers,
            bySeverity,
            byCategory,
            byLane,
            resolution,
            trend,
        };
    }

    /** Group suggestions by an arbitrary key and score each group's approval. */
    private breakdown(
        rows: any[],
        keyOf: (row: any) => string,
        verdictOf: (suggestionId: number) => "up" | "down" | null
    ) {
        const map = new Map<string, { suggestions: number; up: number; down: number; conf: number[] }>();
        for (const row of rows) {
            const key = keyOf(row);
            if (!map.has(key)) map.set(key, { suggestions: 0, up: 0, down: 0, conf: [] });
            const entry = map.get(key)!;
            entry.suggestions++;
            const conf = row.confidence == null ? null : Number(row.confidence);
            if (conf != null && Number.isFinite(conf)) entry.conf.push(conf);
            const verdict = verdictOf(Number(row.id));
            if (verdict === "up") entry.up++;
            else if (verdict === "down") entry.down++;
        }
        return [...map.entries()]
            .map(([key, v]) => ({
                key,
                suggestions: v.suggestions,
                rated: v.up + v.down,
                up: v.up,
                down: v.down,
                approvalPct: this.pct(v.up, v.up + v.down),
                avgConfidence: this.avg(v.conf),
            }))
            .sort((a, b) => b.suggestions - a.suggestions);
    }

    private buildTrend(
        suggestions: any[],
        actions: any[],
        granularity: IssueAnalyticsGranularity,
        verdictOf: (suggestionId: number) => "up" | "down" | null
    ) {
        const buckets = new Map<
            string,
            { suggestions: number; up: number; down: number; conf: number[]; actions: number }
        >();
        const ensure = (key: string) => {
            if (!buckets.has(key)) {
                buckets.set(key, { suggestions: 0, up: 0, down: 0, conf: [], actions: 0 });
            }
            return buckets.get(key)!;
        };

        for (const s of suggestions) {
            const b = ensure(this.bucketKey(new Date(s.generatedAt), granularity));
            b.suggestions++;
            const conf = s.confidence == null ? null : Number(s.confidence);
            if (conf != null && Number.isFinite(conf)) b.conf.push(conf);
            const verdict = verdictOf(Number(s.id));
            if (verdict === "up") b.up++;
            else if (verdict === "down") b.down++;
        }
        for (const a of actions) {
            ensure(this.bucketKey(new Date(a.createdAt), granularity)).actions++;
        }

        return [...buckets.keys()]
            .sort()
            .map((bucket) => {
                const b = buckets.get(bucket)!;
                const rated = b.up + b.down;
                return {
                    bucket,
                    suggestions: b.suggestions,
                    rated,
                    up: b.up,
                    down: b.down,
                    approvalPct: this.pct(b.up, rated),
                    avgConfidence: this.avg(b.conf),
                    actions: b.actions,
                };
            });
    }

    // -------------------------------------------------------------------------
    // Review queue — the suggestions you rate from the analytics page
    // -------------------------------------------------------------------------

    /**
     * @param state "unrated" (default) | "down" | "up" | "all"
     *
     * The rated/unrated split depends on the latest feedback per suggestion,
     * which is cheaper to resolve in JS than as a correlated subquery — so a
     * bounded page of suggestions is loaded and partitioned here. `truncated`
     * tells the caller the tab counts only cover that page.
     */
    async queue(
        sinceDays: number,
        state = "unrated",
        limit = 40,
        filters: IssueAnalyticsFilters = {}
    ) {
        const days = this.clampDays(sinceDays);
        const lim = Math.min(Math.max(Number(limit) || 40, 1), 200);
        const SCAN_CAP = 1000;
        const issueWhere = this.issueClause(filters);
        const win = this.windowClause("s.generatedAt", days, filters);
        const reviewerId =
            filters.reviewerId != null && Number.isFinite(Number(filters.reviewerId))
                ? Number(filters.reviewerId)
                : null;

        // Pass 1 — identifiers only. Suggestion rows carry several mediumtext
        // JSON blobs; pulling a thousand of those to compute three tab counts
        // and then render forty of them wastes most of the transfer.
        const scan = await this.q(
            `SELECT s.id, s.issueId
             FROM issue_ai_suggestions s
             JOIN issues i ON i.id = s.issueId
             WHERE i.deleted_at IS NULL AND s.status <> 'regenerated'
               ${win.sql} ${issueWhere.sql}
             ORDER BY s.generatedAt DESC
             LIMIT ${SCAN_CAP}`,
            [...win.params, ...issueWhere.params]
        );
        if (!scan.length) {
            return {
                sinceDays: days,
                state,
                total: 0,
                truncated: false,
                counts: { unrated: 0, up: 0, down: 0 },
                items: [],
            };
        }

        const scanIds = scan.map((r) => Number(r.id));
        const ratingRows = await this.q(
            `SELECT suggestionId, userId, rating
             FROM issue_ai_feedback
             WHERE rating IN ('up','down')
               AND suggestionId IN (${scanIds.map(() => "?").join(",")})
             ORDER BY createdAt ASC`,
            scanIds
        );

        // With a reviewer selected the queue answers "what's left for them to
        // review", so only their verdict counts. Last write wins.
        const verdicts = new Map<number, "up" | "down">();
        for (const f of ratingRows) {
            if (reviewerId && Number(f.userId) !== reviewerId) continue;
            verdicts.set(Number(f.suggestionId), f.rating);
        }
        const latestRating = (suggestionId: number) => verdicts.get(suggestionId) ?? null;

        const counts = { unrated: 0, up: 0, down: 0 };
        for (const r of scan) {
            const rating = latestRating(Number(r.id));
            if (rating === "up") counts.up++;
            else if (rating === "down") counts.down++;
            else counts.unrated++;
        }

        const wanted = scan.filter((r) => {
            const rating = latestRating(Number(r.id));
            if (state === "up") return rating === "up";
            if (state === "down") return rating === "down";
            if (state === "all") return true;
            return rating === null;
        });

        const page = wanted.slice(0, lim);
        if (!page.length) {
            return {
                sinceDays: days,
                state,
                total: wanted.length,
                truncated: scan.length >= SCAN_CAP,
                counts,
                items: [],
            };
        }

        // Pass 2 — hydrate only what is actually rendered.
        const ids = page.map((r) => Number(r.id));
        const issueIds = [...new Set(page.map((r) => Number(r.issueId)))];
        const [rows, feedback, actions] = await Promise.all([
            this.q(
                `SELECT s.id, s.issueId, s.listingId, s.severity, s.confidence, s.status,
                        s.summary, s.primaryAction, s.playbookJson, s.warningsJson,
                        s.recommendedContactsJson, s.draftGuestMessage, s.draftInternalNote,
                        s.draftVendorMessage, s.generatedAt,
                        i.category, i.status AS issueStatus, i.listing_name AS listingName,
                        i.issue_description, i.ai_short_title, i.guest_name,
                        i.ai_resolution_status, i.ai_guest_sentiment
                 FROM issue_ai_suggestions s
                 JOIN issues i ON i.id = s.issueId
                 WHERE s.id IN (${ids.map(() => "?").join(",")})
                 ORDER BY s.generatedAt DESC`,
                ids
            ),
            this.q(
                `SELECT id, suggestionId, issueId, userId, rating, categories, feedbackText,
                        correctedResponse, createdAt
                 FROM issue_ai_feedback
                 WHERE suggestionId IN (${ids.map(() => "?").join(",")})
                 ORDER BY createdAt ASC`,
                ids
            ),
            this.q(
                `SELECT issueId, actionType, channel, status, automated, createdAt
                 FROM issue_ai_actions
                 WHERE issueId IN (${issueIds.map(() => "?").join(",")})
                 ORDER BY createdAt ASC`,
                issueIds
            ),
        ]);

        const users = await this.userDirectory();
        const fbBy = new Map<number, any[]>();
        for (const f of feedback) {
            const key = Number(f.suggestionId);
            if (!fbBy.has(key)) fbBy.set(key, []);
            fbBy.get(key)!.push(f);
        }
        const actionsBy = new Map<number, any[]>();
        for (const a of actions) {
            const key = Number(a.issueId);
            if (!actionsBy.has(key)) actionsBy.set(key, []);
            actionsBy.get(key)!.push(a);
        }

        const items = rows.map((r) => ({
            suggestionId: Number(r.id),
            issueId: Number(r.issueId),
            listingId: r.listingId == null ? null : Number(r.listingId),
            listingName: r.listingName || null,
            guestName: r.guest_name || null,
            title: r.ai_short_title || r.issue_description || `Ticket #${r.issueId}`,
            issueDescription: r.issue_description || null,
            category: r.category || null,
            lane: this.laneOf(r.category),
            issueStatus: r.issueStatus || null,
            severity: r.severity || null,
            confidence: r.confidence == null ? null : Number(r.confidence),
            suggestionStatus: r.status,
            summary: r.summary || null,
            primaryAction: r.primaryAction || null,
            playbook: this.parseJson<any[]>(r.playbookJson, []),
            warnings: this.parseJson<string[]>(r.warningsJson, []),
            recommendedContacts: this.parseJson<any[]>(r.recommendedContactsJson, []),
            draftGuestMessage: r.draftGuestMessage || null,
            draftInternalNote: r.draftInternalNote || null,
            draftVendorMessage: r.draftVendorMessage || null,
            aiResolutionStatus: r.ai_resolution_status || null,
            aiGuestSentiment: r.ai_guest_sentiment || null,
            generatedAt: new Date(r.generatedAt).toISOString(),
            rating: latestRating(Number(r.id)),
            actionsTaken: (actionsBy.get(Number(r.issueId)) || []).map((a) => ({
                key: a.actionType,
                label: ACTION_LABELS[a.actionType] || a.actionType,
                channel: a.channel,
                status: a.status,
                automated: Number(a.automated) === 1,
                at: new Date(a.createdAt).toISOString(),
            })),
            feedback: (fbBy.get(Number(r.id)) || []).map((f) => ({
                id: Number(f.id),
                userId: f.userId == null ? null : Number(f.userId),
                userName: f.userId != null ? users.get(Number(f.userId))?.name || null : null,
                rating: f.rating,
                categories: this.parseCategories(f.categories),
                feedbackText: f.feedbackText,
                correctedResponse: f.correctedResponse,
                createdAt: new Date(f.createdAt).toISOString(),
            })),
        }));

        return {
            sinceDays: days,
            state,
            total: wanted.length,
            truncated: scan.length >= SCAN_CAP,
            counts,
            items,
        };
    }

    // -------------------------------------------------------------------------
    // Feedback log — who said what, most recent first
    // -------------------------------------------------------------------------

    async feedbackLog(sinceDays: number, limit = 50, offset = 0, filters: IssueAnalyticsFilters = {}) {
        const days = this.clampDays(sinceDays);
        const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
        const off = Math.max(Number(offset) || 0, 0);
        const issueWhere = this.issueClause(filters);
        const win = this.windowClause("f.createdAt", days, filters);
        const reviewerId =
            filters.reviewerId != null && Number.isFinite(Number(filters.reviewerId))
                ? Number(filters.reviewerId)
                : null;
        const reviewerSql = reviewerId ? "AND f.userId = ?" : "";
        const reviewerParams = reviewerId ? [reviewerId] : [];

        const params = [...win.params, ...issueWhere.params, ...reviewerParams];
        const [countRows, rows] = await Promise.all([
            this.q(
                `SELECT COUNT(*) c
                 FROM issue_ai_feedback f
                 LEFT JOIN issues i ON i.id = f.issueId
                 WHERE (i.id IS NULL OR i.deleted_at IS NULL) ${win.sql} ${issueWhere.sql} ${reviewerSql}`,
                params
            ),
            this.q(
                `SELECT f.id, f.suggestionId, f.issueId, f.userId, f.rating, f.categories,
                        f.feedbackText, f.correctedResponse, f.createdAt,
                        i.category, i.listing_name AS listingName, i.ai_short_title,
                        i.issue_description,
                        s.severity, s.primaryAction, s.summary
                 FROM issue_ai_feedback f
                 LEFT JOIN issues i ON i.id = f.issueId
                 LEFT JOIN issue_ai_suggestions s ON s.id = f.suggestionId
                 WHERE (i.id IS NULL OR i.deleted_at IS NULL) ${win.sql} ${issueWhere.sql} ${reviewerSql}
                 ORDER BY f.createdAt DESC
                 LIMIT ? OFFSET ?`,
                [...params, lim, off]
            ),
        ]);

        const users = await this.userDirectory();
        return {
            sinceDays: days,
            total: Number(countRows[0]?.c || 0),
            items: rows.map((f) => ({
                id: Number(f.id),
                suggestionId: f.suggestionId == null ? null : Number(f.suggestionId),
                issueId: f.issueId == null ? null : Number(f.issueId),
                userId: f.userId == null ? null : Number(f.userId),
                userName: f.userId != null ? users.get(Number(f.userId))?.name || `user ${f.userId}` : "unknown",
                rating: f.rating,
                categories: this.parseCategories(f.categories),
                feedbackText: f.feedbackText,
                correctedResponse: f.correctedResponse,
                title: f.ai_short_title || f.issue_description || null,
                listingName: f.listingName || null,
                category: f.category || null,
                severity: f.severity || null,
                primaryAction: f.primaryAction || null,
                summary: f.summary || null,
                createdAt: new Date(f.createdAt).toISOString(),
            })),
        };
    }

    // -------------------------------------------------------------------------
    // Filter dropdown lookups
    // -------------------------------------------------------------------------

    async listListings(sinceDays: number) {
        const days = this.clampDays(sinceDays);
        const rows = await this.q(
            `SELECT DISTINCT CAST(i.listing_id AS UNSIGNED) AS id, i.listing_name AS name
             FROM issue_ai_suggestions s
             JOIN issues i ON i.id = s.issueId
             WHERE i.deleted_at IS NULL
               AND i.listing_id IS NOT NULL AND i.listing_id <> ''
               AND s.generatedAt >= (NOW() - INTERVAL ? DAY)
             ORDER BY name ASC`,
            [days]
        );
        return {
            listings: rows
                .filter((r) => Number(r.id) > 0)
                .map((r) => ({ id: Number(r.id), name: r.name || `Listing ${r.id}` })),
        };
    }

    async listReviewers(sinceDays: number) {
        const days = this.clampDays(sinceDays);
        const rows = await this.q(
            `SELECT f.userId, COUNT(*) c
             FROM issue_ai_feedback f
             WHERE f.userId IS NOT NULL AND f.createdAt >= (NOW() - INTERVAL ? DAY)
             GROUP BY f.userId
             ORDER BY c DESC`,
            [days]
        );
        const users = await this.userDirectory();
        return {
            reviewers: rows.map((r) => ({
                userId: Number(r.userId),
                name: users.get(Number(r.userId))?.name || `user ${r.userId}`,
                count: Number(r.c),
            })),
        };
    }

    async listCategories(sinceDays: number) {
        const days = this.clampDays(sinceDays);
        const rows = await this.q(
            `SELECT DISTINCT i.category AS category
             FROM issue_ai_suggestions s
             JOIN issues i ON i.id = s.issueId
             WHERE i.deleted_at IS NULL AND i.category IS NOT NULL AND i.category <> ''
               AND s.generatedAt >= (NOW() - INTERVAL ? DAY)
             ORDER BY category ASC`,
            [days]
        );
        return { categories: rows.map((r) => String(r.category)) };
    }
}
