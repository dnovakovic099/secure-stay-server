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
        }
    }
    return opts;
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

interface SyncCounters {
    threadsProcessed: number;
    threadsSkipped: number;
    repliesSynced: number;
    repliesSkipped: number;
    apiErrors: number;
}

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
    await initDatabase();

    const affected = await findAffectedRows(options);
    logger.info(
        `[backfillSlackThreadReplies] Found ${affected.length} review_checkout row(s) to backfill` +
        (options.dryRun ? " (dry-run)" : ""),
    );

    const counters: SyncCounters = {
        threadsProcessed: 0,
        threadsSkipped: 0,
        repliesSynced: 0,
        repliesSkipped: 0,
        apiErrors: 0,
    };

    if (!affected.length) return counters;

    const slackService = new ResolutionsTeamSlackService();
    const slackUsers = await getSlackUsers();

    for (const row of affected) {
        if (!row.slackChannelId) {
            logger.warn(
                `[backfillSlackThreadReplies] Skipping reviewCheckout=${row.reviewCheckoutId} — slackChannelId is null even though slackThreadTs is set. Investigate manually.`,
            );
            counters.threadsSkipped++;
            continue;
        }

        try {
            const messages = await fetchThreadReplies(row.slackChannelId, row.slackThreadTs);
            counters.threadsProcessed++;

            for (const msg of messages) {
                // Skip the parent status card and every bot-originated activity post. The
                // parent card is the "always there" root; bot messages describe app-side
                // events whose current state is already correct in the main-table dump.
                if (msg.ts === row.slackThreadTs) continue;
                if (msg.bot_id || msg.subtype === "bot_message") continue;
                if (!msg.user) continue;

                if (options.dryRun) {
                    counters.repliesSkipped++;
                    logger.info(
                        `[backfillSlackThreadReplies] (dry-run) would sync ts=${msg.ts} reviewCheckout=${row.reviewCheckoutId} reservation=${row.reservationId}`,
                    );
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

            logger.info(
                `[backfillSlackThreadReplies] Thread reviewCheckout=${row.reviewCheckoutId} reservation=${row.reservationId} — ${messages.length} raw message(s), ${counters.repliesSynced} synced running total`,
            );
        } catch (err: any) {
            counters.apiErrors++;
            logger.error(
                `[backfillSlackThreadReplies] Failed reviewCheckout=${row.reviewCheckoutId} reservation=${row.reservationId}: ${err?.message || err}`,
            );
        }

        // Gentle pacing between distinct threads. syncSlackReplyToSS writes to the DB and
        // hits Slack indirectly via getSlackUserDisplayName / getSlackUsers cache, so a
        // small sleep prevents thundering the DB and Slack simultaneously on a very
        // large backfill run.
        await sleep(SLACK_API_PAUSE_MS);
    }

    logger.info(
        `[backfillSlackThreadReplies] Done — threads processed: ${counters.threadsProcessed}, skipped: ${counters.threadsSkipped}, replies synced: ${counters.repliesSynced}, dry-run entries: ${counters.repliesSkipped}, API errors: ${counters.apiErrors}`,
    );

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
