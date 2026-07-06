import axios from "axios";
import "dotenv/config";
import { appDatabase, initDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ResolutionsTeamSlackService } from "../services/ResolutionsTeamSlackService";
import { getSlackUsers } from "../utils/getSlackUsers";
import { replaceSlackIdsWithMentions } from "../helpers/helpers";

/**
 * Backfills review_checkout_updates and review_discussion_messages from Slack for
 * review_checkout rows whose related-table history was lost during the July 2 server
 * migration. Only the main review_checkout table was recovered on the new server, so
 * update/discussion history for pre-migration rows is missing locally even though the
 * corresponding Slack thread still holds the full conversation.
 *
 * The script iterates each affected review_checkout, pulls conversations.replies for
 * its stored slackThreadTs, and hands each human reply to
 * ResolutionsTeamSlackService.syncSlackReplyToSS — which is the same dedup-safe
 * primitive the live Slack → SS webhook uses. Root messages and bot messages are
 * skipped (bot messages describe app-originated status changes; the *current* state is
 * already correct in the main-table dump, and reconstructing that history from bot
 * text is too lossy for the effort). Human replies are the part that only lives in
 * Slack now, so that's what we recover.
 *
 * Dedup is enforced by syncSlackReplyToSS via existing slackMessageTs uniqueness
 * checks, so re-running the script is safe. The Slack-side per-reservation cooldown in
 * syncSlackThreadReplies is intentionally bypassed — this is an ops job, not a live
 * user request, and it isn't rate-sensitive.
 *
 * Usage:
 *   npx ts-node-dev src/scripts/backfillSlackThreadReplies.ts \
 *       [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--reservationId=123,456] [--dry-run]
 *
 * With no range flags, every review_checkout with a slackThreadTs is processed.
 */

interface BackfillOptions {
    fromDate?: string;
    toDate?: string;
    reservationIds?: number[];
    dryRun?: boolean;
    // Any thread whose root ts was posted at/after this date is flagged as a "likely
    // post-migration replacement thread" — because a fresh Slack root card was created
    // after the July 2 server migration, meaning the original pre-migration thread is
    // orphaned in Slack and this row's slackThreadTs no longer points at the real
    // history. Default matches the migration cutoff.
    migrationCutoff?: string;
}

interface AffectedRow {
    reviewCheckoutId: number;
    reservationId: number;
    slackChannelId: string | null;
    slackThreadTs: string;
}

const SLACK_API_PAUSE_MS = 350; // Stay well under Slack's Tier-3 (50 rpm) for conversations.replies.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseCliArgs = (): BackfillOptions => {
    const opts: BackfillOptions = {};
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith("--from=")) opts.fromDate = arg.slice("--from=".length);
        else if (arg.startsWith("--to=")) opts.toDate = arg.slice("--to=".length);
        else if (arg.startsWith("--reservationId=")) {
            opts.reservationIds = arg
                .slice("--reservationId=".length)
                .split(",")
                .map((value) => Number(value.trim()))
                .filter((value) => Number.isFinite(value));
        } else if (arg === "--dry-run" || arg === "--dryRun") {
            opts.dryRun = true;
        } else if (arg.startsWith("--migrationCutoff=")) {
            opts.migrationCutoff = arg.slice("--migrationCutoff=".length);
        }
    }
    return opts;
};

const DEFAULT_MIGRATION_CUTOFF_ISO = "2026-07-02T00:00:00Z";

const parseSlackTsToDate = (ts: string): Date | null => {
    // Slack ts strings are of the form "1783192637.810629" — seconds.microseconds since epoch.
    // Number.parseFloat handles both the integer and fractional part correctly for Date use.
    const seconds = Number.parseFloat(ts);
    if (!Number.isFinite(seconds)) return null;
    return new Date(seconds * 1000);
};

const findAffectedRows = async (options: BackfillOptions): Promise<AffectedRow[]> => {
    const clauses: string[] = [
        "rc.slackThreadTs IS NOT NULL",
        "rc.slackThreadTs <> ''",
        "rc.deletedAt IS NULL",
    ];
    const params: any[] = [];

    if (options.reservationIds?.length) {
        clauses.push(`ri.id IN (${options.reservationIds.map(() => "?").join(",")})`);
        params.push(...options.reservationIds);
    } else if (options.fromDate && options.toDate) {
        clauses.push("DATE(ri.departureDate) BETWEEN ? AND ?");
        params.push(options.fromDate, options.toDate);
    } else if (options.fromDate) {
        clauses.push("DATE(ri.departureDate) >= ?");
        params.push(options.fromDate);
    } else if (options.toDate) {
        clauses.push("DATE(ri.departureDate) <= ?");
        params.push(options.toDate);
    }

    const sql = `
        SELECT
            rc.id                AS reviewCheckoutId,
            ri.id                AS reservationId,
            rc.slackChannelId    AS slackChannelId,
            rc.slackThreadTs     AS slackThreadTs
        FROM review_checkout rc
        INNER JOIN reservation_info ri ON ri.id = rc.reservationInfoId
        WHERE ${clauses.join(" AND ")}
        ORDER BY rc.id ASC
    `;

    return appDatabase.query(sql, params);
};

/**
 * For any reservationId the caller passed on the CLI that didn't survive
 * findAffectedRows, run a follow-up query to figure out *why* it dropped —
 * unknown reservation, no review_checkout row yet, thread never created,
 * or the row is soft-deleted. Only meaningful when --reservationId was used.
 */
const diagnoseMissingReservationIds = async (
    requested: number[],
    matched: AffectedRow[],
): Promise<void> => {
    const matchedSet = new Set(matched.map((row) => row.reservationId));
    const missing = requested.filter((id) => !matchedSet.has(id));
    if (!missing.length) return;

    const placeholders = missing.map(() => "?").join(",");
    const rows: Array<{
        reservationId: number | null;
        reviewCheckoutId: number | null;
        slackThreadTs: string | null;
        deletedAt: string | null;
    }> = await appDatabase.query(
        `
            SELECT
                ri.id                     AS reservationId,
                rc.id                     AS reviewCheckoutId,
                rc.slackThreadTs          AS slackThreadTs,
                rc.deletedAt              AS deletedAt
            FROM reservation_info ri
            LEFT JOIN review_checkout rc ON rc.reservationInfoId = ri.id
            WHERE ri.id IN (${placeholders})
        `,
        missing,
    );

    const stateByReservation = new Map<number, typeof rows[number]>();
    for (const row of rows) {
        if (row.reservationId != null) stateByReservation.set(Number(row.reservationId), row);
    }

    console.log(`[backfillSlackThreadReplies] Diagnosing ${missing.length} filtered ID(s):`);
    for (const id of missing) {
        const state = stateByReservation.get(id);
        if (!state) {
            console.log(`  reservation=${id} → not found in reservation_info (typo, or record was deleted)`);
            continue;
        }
        if (state.reviewCheckoutId == null) {
            console.log(`  reservation=${id} → no review_checkout row (mitigation record was never created for this reservation)`);
            continue;
        }
        if (state.deletedAt) {
            console.log(`  reservation=${id} → review_checkout is soft-deleted (deletedAt=${state.deletedAt})`);
            continue;
        }
        if (!state.slackThreadTs || String(state.slackThreadTs).trim() === "") {
            console.log(`  reservation=${id} → review_checkout exists (id=${state.reviewCheckoutId}) but slackThreadTs is empty — no Slack thread to pull from`);
            continue;
        }
        // Row exists AND has a thread ts AND isn't soft-deleted, yet fell out of findAffectedRows.
        // That's unexpected; surface it so we don't silently miss it.
        console.log(
            `  reservation=${id} → unexpected drop (reviewCheckout=${state.reviewCheckoutId}, threadTs=${state.slackThreadTs}). Please report.`,
        );
    }
};

interface SyncCounters {
    threadsProcessed: number;
    threadsSkipped: number;
    repliesSynced: number;
    repliesSkipped: number;
    apiErrors: number;
    // Number of threads whose root ts is post-migration — flagged as likely
    // "duplicate replacement thread" so the operator can go verify in Slack whether the
    // original pre-migration thread lives somewhere else in the channel.
    suspiciousThreads: number;
}

const fetchSlackPermalink = async (channel: string, messageTs: string): Promise<string | null> => {
    try {
        const response = await axios.get("https://slack.com/api/chat.getPermalink", {
            headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
            params: { channel, message_ts: messageTs },
            timeout: 10_000,
        });
        if (!response.data?.ok) return null;
        return response.data.permalink || null;
    } catch {
        return null;
    }
};

const fetchThreadReplies = async (channel: string, threadTs: string): Promise<any[]> => {
    // conversations.replies paginates by cursor; walk it all so long threads aren't truncated.
    const collected: any[] = [];
    let cursor: string | undefined;
    // Hard cap on pagination loops to avoid runaway calls on a misbehaving thread.
    for (let page = 0; page < 20; page++) {
        const response = await axios.get("https://slack.com/api/conversations.replies", {
            headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
            params: {
                channel,
                ts: threadTs,
                limit: 200,
                ...(cursor ? { cursor } : {}),
            },
            timeout: 15_000,
        });

        if (!response.data?.ok) {
            throw new Error(`conversations.replies not ok: ${response.data?.error || "unknown"}`);
        }

        collected.push(...(response.data.messages || []));

        cursor = response.data.response_metadata?.next_cursor;
        if (!cursor) break;
        await sleep(SLACK_API_PAUSE_MS);
    }
    return collected;
};

export const backfillSlackThreadReplies = async (
    options: BackfillOptions = {},
): Promise<SyncCounters> => {
    // Direct console output alongside winston. winston is buffered / async, and on a fresh
    // ts-node-dev cold start we get no visible progress for 15–30s otherwise; the user just
    // sees the ts-node banner and thinks the script is stuck when it's actually mid-startup.
    console.log(
        `[backfillSlackThreadReplies] Starting with options=${JSON.stringify(options)} — connecting to DB…`,
    );
    logger.info(
        `[backfillSlackThreadReplies] Starting with options=${JSON.stringify(options)}`,
    );

    const dbStart = Date.now();
    await initDatabase();
    if (!appDatabase.isInitialized) {
        // initDatabase() swallows the connect error and just logs it. Fail loudly instead so
        // the ops runner doesn't stare at a mystery hang wondering if the query is slow.
        throw new Error(
            "Database failed to initialize — check DATABASE_URL / DATABASE_PORT / credentials in .env and re-run.",
        );
    }
    console.log(
        `[backfillSlackThreadReplies] DB ready in ${Date.now() - dbStart}ms — querying affected rows…`,
    );

    const affected = await findAffectedRows(options);
    console.log(
        `[backfillSlackThreadReplies] Found ${affected.length} review_checkout row(s) to backfill` +
        (options.dryRun ? " (dry-run)" : ""),
    );
    logger.info(
        `[backfillSlackThreadReplies] Found ${affected.length} review_checkout row(s) to backfill` +
        (options.dryRun ? " (dry-run)" : ""),
    );

    if (options.reservationIds?.length) {
        await diagnoseMissingReservationIds(options.reservationIds, affected);
    }

    const counters: SyncCounters = {
        threadsProcessed: 0,
        threadsSkipped: 0,
        repliesSynced: 0,
        repliesSkipped: 0,
        apiErrors: 0,
        suspiciousThreads: 0,
    };

    if (!affected.length) return counters;

    const slackService = new ResolutionsTeamSlackService();
    const slackUsers = await getSlackUsers();

    // Cutoff for the "post-migration replacement thread" heuristic. Any thread whose root
    // ts is at/after this instant is treated as suspicious — the operator should verify
    // manually in Slack that the original pre-migration thread isn't sitting elsewhere in
    // the same channel. The default matches the July 2 server migration.
    const migrationCutoff = new Date(options.migrationCutoff || DEFAULT_MIGRATION_CUTOFF_ISO);
    const migrationCutoffValid = !Number.isNaN(migrationCutoff.getTime());
    if (!migrationCutoffValid) {
        console.warn(
            `[backfillSlackThreadReplies] --migrationCutoff="${options.migrationCutoff}" is not a valid date; the suspicious-thread heuristic is disabled for this run.`,
        );
    }
    // Collect the flagged rows so we can print a consolidated report at the end. Iterating
    // one Slack message at a time in the loop above is fine for visibility, but the operator
    // wants a single "these are the suspects" block they can copy into a ticket.
    const suspiciousReport: Array<{
        reviewCheckoutId: number;
        reservationId: number;
        threadTs: string;
        rootDate: Date;
        permalink: string | null;
        rawMessageCount: number;
    }> = [];

    for (const row of affected) {
        if (!row.slackChannelId) {
            const message = `[backfillSlackThreadReplies] Skipping reviewCheckout=${row.reviewCheckoutId} — slackChannelId is null even though slackThreadTs is set. Investigate manually.`;
            console.warn(message);
            logger.warn(message);
            counters.threadsSkipped++;
            continue;
        }

        try {
            const messages = await fetchThreadReplies(row.slackChannelId, row.slackThreadTs);
            counters.threadsProcessed++;
            let humanRepliesInThisThread = 0;

            for (const msg of messages) {
                // Skip the parent status card and every bot-originated activity post. The
                // parent card is the "always there" root; bot messages describe app-side
                // events whose current state is already correct in the main-table dump.
                if (msg.ts === row.slackThreadTs) continue;
                if (msg.bot_id || msg.subtype === "bot_message") continue;
                if (!msg.user) continue;

                humanRepliesInThisThread++;

                if (options.dryRun) {
                    counters.repliesSkipped++;
                    const line = `[backfillSlackThreadReplies] (dry-run) would sync ts=${msg.ts} reviewCheckout=${row.reviewCheckoutId} reservation=${row.reservationId}`;
                    console.log(line);
                    logger.info(line);
                    continue;
                }

                const text = replaceSlackIdsWithMentions(msg.text || "", slackUsers);
                await slackService.syncSlackReplyToSS(
                    row.reviewCheckoutId,
                    msg.user,
                    text,
                    msg.ts,
                    msg.files || [],
                );
                counters.repliesSynced++;
            }

            // Post-migration replacement detection: convert the root ts to a Date and
            // compare against the cutoff. When the root was posted after the migration,
            // the current slackThreadTs is very likely a fresh thread the app created
            // after the DB dump landed on the new server — meaning the *real* pre-migration
            // thread is orphaned in Slack and this backfill can't reach it.
            const rootDate = parseSlackTsToDate(row.slackThreadTs);
            const isSuspicious = migrationCutoffValid
                && rootDate !== null
                && rootDate.getTime() >= migrationCutoff.getTime();

            let permalink: string | null = null;
            if (isSuspicious || options.dryRun) {
                // Fetch a permalink for the current root message so the operator can jump
                // to Slack from the log and eyeball the thread. Only done for suspicious
                // rows and in dry-run mode; not worth the extra Slack call on production
                // real runs where we're just refilling data.
                permalink = await fetchSlackPermalink(row.slackChannelId, row.slackThreadTs);
            }

            if (isSuspicious) {
                counters.suspiciousThreads++;
                suspiciousReport.push({
                    reviewCheckoutId: row.reviewCheckoutId,
                    reservationId: row.reservationId,
                    threadTs: row.slackThreadTs,
                    rootDate: rootDate as Date,
                    permalink,
                    rawMessageCount: messages.length,
                });
                const suspiciousLine =
                    `[backfillSlackThreadReplies] ⚠️  Suspicious thread — root posted ${rootDate?.toISOString()} (>= migration cutoff ${migrationCutoff.toISOString()}). ` +
                    `reviewCheckout=${row.reviewCheckoutId} reservation=${row.reservationId} threadTs=${row.slackThreadTs}` +
                    (permalink ? ` permalink=${permalink}` : "");
                console.warn(suspiciousLine);
                logger.warn(suspiciousLine);
            }

            // Per-thread summary. Mirror to console.log because winston's async transport can
            // batch these; the operator wants to see progress as each thread completes.
            const rootDateFragment = rootDate ? ` rootPostedAt=${rootDate.toISOString()}` : "";
            const permalinkFragment = permalink && options.dryRun ? ` permalink=${permalink}` : "";
            const summary =
                `[backfillSlackThreadReplies] Thread reviewCheckout=${row.reviewCheckoutId} reservation=${row.reservationId} — ` +
                `${messages.length} raw message(s), ${humanRepliesInThisThread} human reply(ies) in this thread ` +
                `(${options.dryRun ? counters.repliesSkipped : counters.repliesSynced} ${options.dryRun ? "would-sync" : "synced"} running total)` +
                rootDateFragment + permalinkFragment;
            console.log(summary);
            logger.info(summary);
        } catch (err: any) {
            counters.apiErrors++;
            const errorLine = `[backfillSlackThreadReplies] Failed reviewCheckout=${row.reviewCheckoutId} reservation=${row.reservationId}: ${err?.message || err}`;
            console.error(errorLine);
            logger.error(errorLine);
        }

        // Gentle pacing between distinct threads. syncSlackReplyToSS writes to the DB and
        // hits Slack indirectly via getSlackUserDisplayName / getSlackUsers cache, so a
        // small sleep prevents thundering the DB and Slack simultaneously on a very
        // large backfill run.
        await sleep(SLACK_API_PAUSE_MS);
    }

    // Consolidated end-of-run report for the flagged threads — easy to copy into a ticket
    // or paste back to me to decide whether to hunt for the original pre-migration threads.
    if (suspiciousReport.length) {
        console.warn(
            `[backfillSlackThreadReplies] ${suspiciousReport.length} thread(s) look like post-migration replacements (root ts >= ${migrationCutoff.toISOString()}). Full list:`,
        );
        for (const entry of suspiciousReport) {
            console.warn(
                `  reservation=${entry.reservationId} reviewCheckout=${entry.reviewCheckoutId} rootPostedAt=${entry.rootDate.toISOString()} rawMessages=${entry.rawMessageCount} threadTs=${entry.threadTs}` +
                (entry.permalink ? ` permalink=${entry.permalink}` : ""),
            );
        }
    }

    const done = `[backfillSlackThreadReplies] Done — threads processed: ${counters.threadsProcessed}, skipped: ${counters.threadsSkipped}, replies synced: ${counters.repliesSynced}, dry-run entries: ${counters.repliesSkipped}, API errors: ${counters.apiErrors}, suspicious (likely post-migration) threads: ${counters.suspiciousThreads}`;
    console.log(done);
    logger.info(done);

    return counters;
};

if (require.main === module) {
    const options = parseCliArgs();
    backfillSlackThreadReplies(options)
        .then(() => process.exit(0))
        .catch((error) => {
            logger.error("[backfillSlackThreadReplies] Failed:", error);
            process.exit(1);
        });
}
