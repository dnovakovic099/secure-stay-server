import axios from "axios";
import { format } from "date-fns";
import { appDatabase } from "../utils/database.util";
import { ReviewCheckout } from "../entity/ReviewCheckout";
import { ReviewCheckoutUpdates } from "../entity/ReviewCheckoutUpdates";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Listing } from "../entity/Listing";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { ReviewDiscussionMessageEntity } from "../entity/ReviewDiscussionMessage";
import { UsersEntity } from "../entity/Users";
import { Employee } from "../entity/Employee";
import { FileInfo } from "../entity/FileInfo";
import { GuestAnalysisService } from "./GuestAnalysisService";
import {
    buildResolutionsCheckoutMessage,
    buildResolutionsActivityMessage,
    RESOLUTIONS_TEAM_CHANNEL,
    RESOLUTIONS_TEAM_ICON_URL,
    ResolutionsActivityType,
} from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import logger from "../utils/logger.utils";
import { ReviewService } from "./ReviewService";
import { formatCurrency } from "../helpers/helpers";
import { UsersService } from "./UsersService";

interface ActivityPayload {
    type: ResolutionsActivityType;
    actor?: string;
    details?: string;
    oldValue?: string | null;
    newValue?: string | null;
}

const EMOJI_MAP: Record<string, { emoji: string; sortOrder: number }> = {
    own:    { emoji: "🔴", sortOrder: 1 },
    arb:    { emoji: "🟣", sortOrder: 2 },
    full:   { emoji: "🟠", sortOrder: 3 },
    pro:    { emoji: "🔵", sortOrder: 4 },
    launch: { emoji: "🟤", sortOrder: 5 },
};

export class ResolutionsTeamSlackService {
    private reviewCheckoutRepo = appDatabase.getRepository(ReviewCheckout);
    private reviewCheckoutUpdatesRepo = appDatabase.getRepository(ReviewCheckoutUpdates);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private reviewDiscussionMessageRepo = appDatabase.getRepository(ReviewDiscussionMessageEntity);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private employeeRepo = appDatabase.getRepository(Employee);
    private fileInfoRepo = appDatabase.getRepository(FileInfo);
    private usersService = new UsersService();

    // ─── Helpers ──────────────────────────────────────────────────────────────

    getListingEmoji(tags: string | null | undefined): { emoji: string; sortOrder: number } {
        if (!tags) return { emoji: "⚪", sortOrder: 99 };
        const lower = tags.toLowerCase();
        for (const [key, val] of Object.entries(EMOJI_MAP)) {
            // Match whole word: the tag segment equals the key exactly after splitting by comma
            const segments = lower.split(",").map((s) => s.trim());
            if (segments.includes(key)) return val;
        }
        return { emoji: "⚪", sortOrder: 99 };
    }

    async getAnjSlackUserId(): Promise<string | null> {
        return "U08END0JTBM";
    }

    private buildEmployeePhotoUrl(fileInfo?: FileInfo | null) {
        if (!fileInfo) return null;
        const configuredBaseUrl = String(process.env.BASE_URL || "").trim();
        const baseUrl = (
            configuredBaseUrl && !/localhost|127\.0\.0\.1/i.test(configuredBaseUrl)
                ? configuredBaseUrl
                : "https://securestay.ai"
        ).replace(/\/$/, "");

        if (fileInfo.status === "uploaded" && fileInfo.driveFileId) {
            return `${baseUrl}/getdriveimage/${fileInfo.driveFileId}`;
        }

        if (fileInfo.localPath && fileInfo.fileName) {
            return `${baseUrl}/getimage/employees/${fileInfo.fileName}`;
        }

        return null;
    }

    private async getSlackUserDisplayName(userId: string): Promise<string> {
        try {
            if (!userId) return "Unknown User";
            const response = await axios.get("https://slack.com/api/users.info", {
                headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
                params: { user: userId },
            });
            if (response.data.ok && response.data.user) {
                return (
                    response.data.user.profile?.display_name ||
                    response.data.user.profile?.real_name ||
                    response.data.user.name ||
                    "Unknown User"
                );
            }
            return "Unknown User";
        } catch {
            return "Unknown User";
        }
    }

    private async getActorPresentation(actor?: string | null) {
        const rawActor = String(actor || "").trim();
        if (!rawActor) {
            return { displayName: "SecureStay", iconUrl: null as string | null };
        }

        if (rawActor.toLowerCase() === "system") {
            return { displayName: "System", iconUrl: null as string | null };
        }

        const slackMentionMatch = rawActor.match(/^<@([A-Z0-9]+)>$/i);
        if (slackMentionMatch?.[1]) {
            return {
                displayName: await this.getSlackUserDisplayName(slackMentionMatch[1]),
                iconUrl: null as string | null,
            };
        }

        const user = await this.usersRepo.findOne({ where: { uid: rawActor } });
        if (!user) {
            return { displayName: rawActor, iconUrl: null as string | null };
        }

        const employee = await this.employeeRepo.findOne({
            where: { userId: user.id, deletedAt: null as any },
            select: ["userId", "preferredName", "profilePhoto"],
        });
        const preferredName = String(employee?.preferredName || "").trim();
        const displayName = [preferredName || user.firstName, user.lastName].filter(Boolean).join(" ").trim()
            || user.email
            || user.uid
            || "SecureStay User";

        const profilePhotoId = Number(employee?.profilePhoto);
        const fileInfo = !Number.isNaN(profilePhotoId) && profilePhotoId > 0
            ? await this.fileInfoRepo.findOne({ where: { id: profilePhotoId } })
            : null;

        return {
            displayName,
            iconUrl: this.buildEmployeePhotoUrl(fileInfo),
        };
    }

    private getTotalPaidDisplay(reservation: ReservationInfoEntity) {
        const totalPaidValue = reservation.airbnbTotalPaidAmount ?? reservation.totalPrice ?? null;
        if (totalPaidValue === null || totalPaidValue === undefined || totalPaidValue === "") return "—";
        return formatCurrency(Number(totalPaidValue));
    }

    private getOwnerRevenueDisplay(reservation: ReservationInfoEntity) {
        if (reservation.owner_revenue === null || reservation.owner_revenue === undefined || reservation.owner_revenue === ("" as any)) {
            return "—";
        }
        return formatCurrency(Number(reservation.owner_revenue));
    }

    private async getResolutionsAssigneeOptions() {
        const assigneeData = await this.usersService.fetchUserListByDepartment("resolutions");
        return assigneeData.allUsers.map((user) => ({
            label: user.displayName || user.name,
            value: user.uid,
        }));
    }

    private async updateRootMessage(
        reviewCheckout: ReviewCheckout,
        reservation: ReservationInfoEntity,
        listing: Listing | null
    ): Promise<void> {
        if (!reviewCheckout.slackThreadTs || !reviewCheckout.slackChannelId) return;

        try {
            const { emoji } = this.getListingEmoji(listing?.tags);
            const reviewService = new ReviewService();
            const [statusData, assigneeOptions] = await Promise.all([
                reviewService.getMitigationStatusOptions(),
                this.getResolutionsAssigneeOptions(),
            ]);

            const ssUrl = `https://securestay.ai/mitigation?reservationId=${reservation.id}`;
            const hostifyUrl = reservation.reservationId
                ? `https://us.hostify.com/reservations/view/${reservation.reservationId}`
                : "";

            const msgPayload = buildResolutionsCheckoutMessage({
                emoji,
                listingName: reservation.listingName || "Unknown Property",
                guestName: reservation.guestName || "Guest",
                hostifyUrl,
                channelName: reservation.channelName || "",
                checkIn: reservation.arrivalDate
                    ? format(new Date(reservation.arrivalDate), "MMM d")
                    : "",
                checkOut: reservation.departureDate
                    ? format(new Date(reservation.departureDate), "MMM d")
                    : "",
                totalPaid: this.getTotalPaidDisplay(reservation),
                ownerRevenue: this.getOwnerRevenueDisplay(reservation),
                status: reviewCheckout.status || "New",
                assignee: reviewCheckout.assignee || "",
                ssUrl,
                reviewCheckoutId: reviewCheckout.id,
                statusOptions: statusData.options,
                assigneeOptions,
            });

            await axios.post(
                "https://slack.com/api/chat.update",
                {
                    channel: reviewCheckout.slackChannelId,
                    ts: reviewCheckout.slackThreadTs,
                    text: msgPayload.text,
                    blocks: msgPayload.blocks,
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                    },
                }
            );
        } catch (err) {
            logger.error(`[ResolutionsTeam] Failed to update root message for reviewCheckout ${reviewCheckout.id}:`, err);
        }
    }

    // ─── Daily checkout message posting ───────────────────────────────────────

    async postDailyCheckoutMessages(): Promise<void> {
        const today = format(new Date(), "yyyy-MM-dd");
        logger.info(`[ResolutionsTeam] Posting daily checkout messages for ${today}`);

        // Fetch all reservations checking in today that have a ReviewCheckout record
        const reviewCheckouts = await this.reviewCheckoutRepo
            .createQueryBuilder("rc")
            .leftJoinAndSelect("rc.reservationInfo", "reservation")
            .leftJoin(Listing, "listing", "listing.id = reservation.listingMapId")
            .addSelect(["listing.tags", "listing.ownerName"])
            .where("DATE(reservation.arrivalDate) = :today", { today })
            .andWhere("rc.deletedAt IS NULL")
            .andWhere("rc.slackThreadTs IS NULL") // Don't re-post if already sent today
            .getMany();

        if (reviewCheckouts.length === 0) {
            logger.info("[ResolutionsTeam] No checkout reservations to post for today");
            return;
        }

        // Fetch listing data separately for tags/emoji sorting
        const listingIds = reviewCheckouts
            .map((rc) => rc.reservationInfo?.listingMapId)
            .filter(Boolean);
        const listings = listingIds.length
            ? await this.listingRepo
                  .createQueryBuilder("l")
                  .select(["l.id", "l.tags", "l.ownerName"])
                  .where("l.id IN (:...ids)", { ids: listingIds })
                  .getMany()
            : [];
        // Use String keys — Listing.id is bigint (TypeORM returns string), listingMapId is int (number)
        const listingMap = new Map(listings.map((l) => [String(l.id), l]));

        // Sort by emoji order
        const sorted = reviewCheckouts
            .map((rc) => {
                const listing = listingMap.get(String(rc.reservationInfo?.listingMapId)) || null;
                const { emoji, sortOrder } = this.getListingEmoji(listing?.tags);
                return { rc, listing, emoji, sortOrder };
            })
            .sort((a, b) => a.sortOrder - b.sortOrder);

        // Get status options and assignees once
        const reviewService = new ReviewService();
        const [statusData, assigneeOptions] = await Promise.all([
            reviewService.getMitigationStatusOptions(),
            this.getResolutionsAssigneeOptions(),
        ]);

        let posted = 0;
        let skipped = 0;

        for (const { rc, listing, emoji } of sorted) {
            const reservation = rc.reservationInfo;
            if (!reservation) {
                skipped++;
                continue;
            }

            try {
                const hostifyUrl = reservation.reservationId
                    ? `https://us.hostify.com/reservations/view/${reservation.reservationId}`
                    : "";
                const ssUrl = `https://securestay.ai/mitigation?reservationId=${reservation.id}`;

                const msgPayload = buildResolutionsCheckoutMessage({
                    emoji,
                    listingName: reservation.listingName || "Unknown Property",
                    guestName: reservation.guestName || "Guest",
                    hostifyUrl,
                    channelName: reservation.channelName || "",
                    checkIn: reservation.arrivalDate
                        ? format(new Date(reservation.arrivalDate), "MMM d")
                        : "",
                    checkOut: reservation.departureDate
                        ? format(new Date(reservation.departureDate), "MMM d")
                        : "",
                    totalPaid: this.getTotalPaidDisplay(reservation),
                    ownerRevenue: this.getOwnerRevenueDisplay(reservation),
                    status: rc.status || "New",
                    assignee: rc.assignee || "",
                    ssUrl,
                    reviewCheckoutId: rc.id,
                    statusOptions: statusData.options,
                    assigneeOptions,
                });

                const result = await sendSlackMessage(msgPayload);

                if (!result?.ok || !result?.ts) {
                    logger.error(
                        `[ResolutionsTeam] Slack API error for reservation ${reservation.id}: ${result?.error}`
                    );
                    skipped++;
                    continue;
                }

                // Save thread_ts back to ReviewCheckout
                rc.slackThreadTs = result.ts;
                rc.slackChannelId = result.channel || RESOLUTIONS_TEAM_CHANNEL;
                await this.reviewCheckoutRepo.save(rc);

                // Track in slack_messages for bidirectional sync
                const slackMsgRecord = this.slackMessageRepo.create({
                    channel: rc.slackChannelId,
                    messageTs: result.ts,
                    threadTs: result.ts,
                    entityType: "review_checkout",
                    entityId: rc.id,
                    originalMessage: JSON.stringify({ reservationId: reservation.id }),
                });
                await this.slackMessageRepo.save(slackMsgRecord);

                logger.info(
                    `[ResolutionsTeam] Posted message for reservation ${reservation.id} (rc ${rc.id}) ts=${result.ts}`
                );
                posted++;
            } catch (err) {
                logger.error(
                    `[ResolutionsTeam] Failed to post message for reservation ${reservation.id}:`,
                    err
                );
                skipped++;
            }
        }

        logger.info(
            `[ResolutionsTeam] Daily checkout posting complete — posted: ${posted}, skipped: ${skipped}`
        );
    }

    // ─── Post activity to thread ───────────────────────────────────────────────

    async postActivityToThread(
        reviewCheckoutId: number,
        activity: ActivityPayload
    ): Promise<void> {
        try {
            const rc = await this.reviewCheckoutRepo.findOne({
                where: { id: reviewCheckoutId },
                relations: ["reservationInfo"],
            });

            if (!rc?.slackThreadTs) {
                logger.debug(
                    `[ResolutionsTeam] No Slack thread for reviewCheckout ${reviewCheckoutId} — skipping activity post`
                );
                return;
            }

            const anjSlackId = await this.getAnjSlackUserId();
            const actorPresentation = await this.getActorPresentation(activity.actor);

            const msgPayload = buildResolutionsActivityMessage({
                ...activity,
                actor: actorPresentation.displayName,
                actorIconUrl: actorPresentation.iconUrl,
                anjSlackId: anjSlackId || undefined,
            });

            const channelId = rc.slackChannelId || RESOLUTIONS_TEAM_CHANNEL;

            await sendSlackMessage(
                { ...msgPayload, channel: channelId },
                rc.slackThreadTs
            );

            // If status or assignee changed, update the root message blocks too
            if (activity.type === "status" || activity.type === "assignee") {
                const listing = rc.reservationInfo?.listingMapId
                    ? await this.listingRepo.findOne({
                          where: { id: rc.reservationInfo.listingMapId },
                      })
                    : null;
                await this.updateRootMessage(rc, rc.reservationInfo, listing);
            }

            logger.info(
                `[ResolutionsTeam] Posted ${activity.type} activity to thread ${rc.slackThreadTs}`
            );
        } catch (err) {
            logger.error(
                `[ResolutionsTeam] Failed to post activity to thread for reviewCheckout ${reviewCheckoutId}:`,
                err
            );
        }
    }

    // ─── Sync Slack reply → SS ─────────────────────────────────────────────────

    async syncSlackReplyToSS(
        reviewCheckoutId: number,
        slackUserId: string,
        text: string,
        slackMessageTs: string
    ): Promise<void> {
        try {
            // Dedup: check if we already saved this Slack message
            const existing = await this.reviewCheckoutUpdatesRepo.findOne({
                where: { slackMessageTs },
            });
            if (existing) {
                logger.debug(
                    `[ResolutionsTeam] Duplicate Slack reply detected, skipping: ${slackMessageTs}`
                );
                return;
            }

            const rc = await this.reviewCheckoutRepo.findOne({
                where: { id: reviewCheckoutId },
                relations: ["reservationInfo"],
            });
            if (!rc) {
                logger.error(
                    `[ResolutionsTeam] ReviewCheckout not found for id ${reviewCheckoutId}`
                );
                return;
            }

            const displayName = await this.getSlackUserDisplayName(slackUserId);

            const newUpdate = this.reviewCheckoutUpdatesRepo.create({
                updates: text,
                createdBy: `${displayName} (via Slack)`,
                reviewCheckout: rc,
                source: "slack",
                slackMessageTs,
            });

            await this.reviewCheckoutUpdatesRepo.save(newUpdate);
            logger.info(
                `[ResolutionsTeam] Synced Slack reply to reviewCheckout ${reviewCheckoutId}`
            );

            // Also sync to review_discussion_messages for the "Updates & Discussions" feed
            const reservationId = rc.reservationInfo?.id ?? null;
            if (reservationId) {
                // Dedup: skip if this Slack message was already saved to the discussion feed
                const existingDiscussionMsg = await this.reviewDiscussionMessageRepo
                    .createQueryBuilder("msg")
                    .where("msg.reservationId = :reservationId", { reservationId })
                    .andWhere(
                        "JSON_UNQUOTE(JSON_EXTRACT(msg.metadata, '$.slackMessageTs')) = :ts",
                        { ts: slackMessageTs }
                    )
                    .getOne();

                if (!existingDiscussionMsg) {
                    const discussionMsg = this.reviewDiscussionMessageRepo.create({
                        reviewId: null,
                        reservationId,
                        parentMessageId: null,
                        sourceType: "note",
                        authorId: null,
                        authorName: `${displayName} (via Slack)`,
                        authorAvatar: null,
                        content: text,
                        mentions: [],
                        metadata: { source: "slack", slackMessageTs },
                    });
                    await this.reviewDiscussionMessageRepo.save(discussionMsg);
                    logger.info(
                        `[ResolutionsTeam] Synced Slack reply to review_discussion_messages for reservation ${reservationId}`
                    );
                }
            }
        } catch (err) {
            logger.error(
                `[ResolutionsTeam] Failed to sync Slack reply to SS:`,
                err
            );
        }
    }

    // ─── AI Analysis trigger from Slack ───────────────────────────────────────

    async triggerAIAnalysisFromSlack(
        reservationId: number,
        channel: string,
        threadTs: string
    ): Promise<void> {
        try {
            logger.info(
                `[ResolutionsTeam] AI analysis triggered from Slack for reservation ${reservationId}`
            );

            await sendSlackMessage(
                { channel, text: "🔄 Running AI analysis…" },
                threadTs
            );

            const guestAnalysisService = new GuestAnalysisService();
            const analysis = await guestAnalysisService.analyzeGuestCommunication(
                reservationId,
                undefined,
                "slack"
            );

            const flags = Array.isArray(analysis.flags) && analysis.flags.length > 0
                ? `\n*Flags:* ${analysis.flags.map((f: any) => f.category || f).join(", ")}`
                : "";

            const details =
                `*Summary:* ${analysis.summary}\n` +
                `*Sentiment:* ${analysis.sentiment}\n` +
                `*Reason:* ${analysis.sentimentReason}` +
                flags;

            const msgPayload = buildResolutionsActivityMessage({
                type: "ai_analysis",
                actor: "System",
                details,
            });

            await sendSlackMessage(
                { ...msgPayload, channel },
                threadTs
            );

            logger.info(
                `[ResolutionsTeam] AI analysis posted to thread for reservation ${reservationId}`
            );
        } catch (err) {
            logger.error(
                `[ResolutionsTeam] AI analysis failed for reservation ${reservationId}:`,
                err
            );
            try {
                await sendSlackMessage(
                    {
                        channel,
                        text: "❌ AI analysis encountered an error. Please check the server logs.",
                    },
                    threadTs
                );
            } catch (_) {
                // best-effort
            }
        }
    }
}
