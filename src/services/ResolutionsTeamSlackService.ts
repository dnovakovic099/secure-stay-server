import axios from "axios";
import { addDays, format } from "date-fns";
import { appDatabase } from "../utils/database.util";
import { ReviewCheckout } from "../entity/ReviewCheckout";
import { ReviewCheckoutUpdates } from "../entity/ReviewCheckoutUpdates";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Listing } from "../entity/Listing";
import { ReviewEntity } from "../entity/Review";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { ReviewDiscussionAttachment, ReviewDiscussionMessageEntity } from "../entity/ReviewDiscussionMessage";
import { UsersEntity } from "../entity/Users";
import { Employee } from "../entity/Employee";
import { FileInfo } from "../entity/FileInfo";
import { ReservationInfoLog } from "../entity/ReservationInfologs";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { GuestAnalysisService } from "./GuestAnalysisService";
import {
    buildResolutionsCheckoutMessage,
    buildResolutionsActivityMessage,
    RESOLUTIONS_TEAM_CHANNEL,
    RESOLUTIONS_TEAM_ICON_URL,
    ResolutionsActivityType,
} from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import updateSlackMessage from "../utils/updateSlackMsg";
import logger from "../utils/logger.utils";
import { ReviewService } from "./ReviewService";
import { formatCurrency, replaceSlackIdsWithMentions } from "../helpers/helpers";
import { getSlackUsers } from "../utils/getSlackUsers";
import { UsersService } from "./UsersService";
import { ListingService } from "./ListingService";
import { supabaseAdmin } from "../utils/supabase";
import { In } from "typeorm";
import { isCancelledAfterListingLocalCheckIn, isCancelledStatus } from "../utils/reservationCancellation.util";
import { getEasternDateString } from "../utils/easternTime.util";
import { findMatchingHostifyChildListing, isUnlistedListingStatus } from "../utils/listingListedStatus.util";
import { getListingChannelUrl } from "../utils/listingChannelLinks.util";

interface ActivityPayload {
    type: ResolutionsActivityType;
    actor?: string;
    details?: string;
    oldValue?: string | null;
    newValue?: string | null;
    notificationMentions?: string[];
    rating?: number | null;
    reviewSentiment?: string | null;
    reviewSentimentReason?: string | null;
}

interface SlackThreadFileAttachment {
    id?: string;
    name?: string;
    title?: string;
    mimetype?: string;
    filetype?: string;
    size?: number;
    url_private?: string;
    url_private_download?: string;
    permalink_public?: string;
    permalink?: string;
    thumb_1024?: string;
    thumb_720?: string;
    thumb_480?: string;
    thumb_360?: string;
}

const EMOJI_MAP: Record<string, { emoji: string; sortOrder: number }> = {
    own:    { emoji: "🔴", sortOrder: 1 },
    arb:    { emoji: "🟣", sortOrder: 2 },
    full:   { emoji: "🟠", sortOrder: 3 },
    pro:    { emoji: "🔵", sortOrder: 4 },
    launch: { emoji: "🟤", sortOrder: 5 },
};

// Module-level rate-limit: at most one Slack thread sync per reservation per minute
const slackThreadSyncTimestamps = new Map<number, number>();
const SLACK_SYNC_INTERVAL_MS = 60_000;
const RESOLUTIONS_TEAM_SUBTEAM_MENTION = "<!subteam^S0A79UGQG0H>";
const MITIGATION_INACTIVITY_REMINDER_EVENT = "mitigation_inactivity_reminder";

// Evict entries older than one sync interval every minute
setInterval(() => {
    const cutoff = Date.now() - SLACK_SYNC_INTERVAL_MS;
    for (const [id, ts] of slackThreadSyncTimestamps) {
        if (ts < cutoff) slackThreadSyncTimestamps.delete(id);
    }
}, 60_000);

export class ResolutionsTeamSlackService {
    private reviewCheckoutRepo = appDatabase.getRepository(ReviewCheckout);
    private reviewCheckoutUpdatesRepo = appDatabase.getRepository(ReviewCheckoutUpdates);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private reviewRepo = appDatabase.getRepository(ReviewEntity);
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private reviewDiscussionMessageRepo = appDatabase.getRepository(ReviewDiscussionMessageEntity);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private employeeRepo = appDatabase.getRepository(Employee);
    private fileInfoRepo = appDatabase.getRepository(FileInfo);
    private reservationInfoLogsRepo = appDatabase.getRepository(ReservationInfoLog);
    private refundRequestRepo = appDatabase.getRepository(RefundRequestEntity);
    private listingService = new ListingService();
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

    private getPublicBaseUrl() {
        const configuredBaseUrl = String(process.env.BASE_URL || "").trim();
        return (
            configuredBaseUrl && !/localhost|127\.0\.0\.1/i.test(configuredBaseUrl)
                ? configuredBaseUrl
                : "https://securestay.ai"
        ).replace(/\/$/, "");
    }

    private getCheckoutLocalDateFromDeadline(deadline: string): Date {
        const [year, month, day] = String(deadline || "").split("-").map((value) => Number(value));
        if (!year || !month || !day) return addDays(new Date(), -14);
        return addDays(new Date(year, month - 1, day), -14);
    }

    private async hasMitigationActivitySince(reviewCheckoutId: number, reservationId: number, sinceDate: Date): Promise<boolean> {
        const [discussionMessages, updateCount, refundActivityCount] = await Promise.all([
            this.reviewDiscussionMessageRepo
                .createQueryBuilder("message")
                .where("message.reservation_id = :reservationId", { reservationId })
                .andWhere("message.created_at >= :sinceDate", { sinceDate })
                .getMany(),
            this.reviewCheckoutUpdatesRepo
                .createQueryBuilder("checkoutUpdate")
                .innerJoin("checkoutUpdate.reviewCheckout", "reviewCheckout")
                .where("reviewCheckout.id = :reviewCheckoutId", { reviewCheckoutId })
                .andWhere("checkoutUpdate.deletedAt IS NULL")
                .andWhere("(checkoutUpdate.createdAt >= :sinceDate OR checkoutUpdate.updatedAt >= :sinceDate)", { sinceDate })
                .getCount(),
            this.refundRequestRepo
                .createQueryBuilder("refundRequest")
                .where("refundRequest.reservationId = :reservationId", { reservationId })
                .andWhere("refundRequest.deletedAt IS NULL")
                .andWhere("(refundRequest.createdAt >= :sinceDate OR refundRequest.updatedAt >= :sinceDate)", { sinceDate })
                .getCount(),
        ]);

        const relevantDiscussionMessages = discussionMessages.filter((message) => {
            const eventType = String(message.metadata?.eventType || "");
            return eventType !== MITIGATION_INACTIVITY_REMINDER_EVENT;
        });

        return relevantDiscussionMessages.length > 0 || updateCount > 0 || refundActivityCount > 0;
    }

    private buildSlackDiscussionAttachments(files?: SlackThreadFileAttachment[] | null): ReviewDiscussionAttachment[] {
        return (files || [])
            .map((file, index) => {
                const rawUrl =
                    file.url_private_download ||
                    file.url_private ||
                    file.permalink_public ||
                    file.permalink ||
                    "";
                if (!rawUrl) return null;

                const previewRawUrl =
                    file.thumb_1024 ||
                    file.thumb_720 ||
                    file.thumb_480 ||
                    file.thumb_360 ||
                    rawUrl;
                const fileName = file.name || `slack_file_${file.id || index + 1}`;
                return {
                    fileName,
                    originalName: file.title || fileName,
                    mimeType: file.mimetype || file.filetype || "",
                    size: Number(file.size || 0),
                    url: `${this.getPublicBaseUrl()}/issues/slack-file?url=${encodeURIComponent(previewRawUrl)}`,
                };
            })
            .filter((attachment): attachment is ReviewDiscussionAttachment => Boolean(attachment));
    }

    private buildEmployeePhotoUrl(fileInfo?: FileInfo | null) {
        if (!fileInfo) return null;
        const baseUrl = this.getPublicBaseUrl();

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

    private async getSupabaseUserDisplayName(userId: string): Promise<string | null> {
        try {
            const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
            if (error || !data?.user) return null;

            const metadata = data.user.user_metadata || {};
            const fullName = String(metadata.full_name || metadata.name || "").trim();
            const firstName = String(metadata.first_name || metadata.firstName || "").trim();
            const lastName = String(metadata.last_name || metadata.lastName || "").trim();

            return fullName
                || [firstName, lastName].filter(Boolean).join(" ").trim()
                || data.user.email
                || null;
        } catch {
            return null;
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
            const supabaseDisplayName = await this.getSupabaseUserDisplayName(rawActor);
            return {
                displayName: supabaseDisplayName || (this.looksLikeInternalIdentifier(rawActor) ? "SecureStay User" : rawActor),
                iconUrl: null as string | null,
            };
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

    private looksLikeInternalIdentifier(value: string) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
            || /^[A-Za-z0-9_-]{20,}$/.test(value);
    }

    private async getAssigneeActivityLabel(assigneeValue?: string | null) {
        const rawValue = String(assigneeValue || "").trim();
        if (!rawValue) {
            return "Unassigned";
        }

        const user = await this.usersRepo.findOne({ where: { uid: rawValue } });
        if (!user) {
            return this.looksLikeInternalIdentifier(rawValue) ? "Unknown assignee" : rawValue;
        }

        const employee = await this.employeeRepo.findOne({
            where: { userId: user.id, deletedAt: null as any },
            select: ["userId", "preferredName", "slackUserId", "slackId"],
        });

        const displayName =
            String(employee?.preferredName || "").trim()
            || String(user.firstName || "").trim()
            || user.email
            || "Unknown assignee";

        const slackMemberId = String(employee?.slackUserId || employee?.slackId || "").trim();
        if (slackMemberId) {
            return `<@${slackMemberId}>`;
        }

        return displayName;
    }

    private normalizeReviewRatingToStars(rating?: number | null) {
        const value = Number(rating || 0);
        if (!Number.isFinite(value) || value <= 0) return null;
        return Math.max(1, Math.min(5, Math.round(value > 5 ? value / 2 : value)));
    }

    private async getAssigneeSlackMention(assigneeValue?: string | null) {
        const rawValue = String(assigneeValue || "").trim();
        if (!rawValue) return null;

        const user = await this.usersRepo.findOne({ where: { uid: rawValue } });
        if (!user) return null;

        const employee = await this.employeeRepo.findOne({
            where: { userId: user.id, deletedAt: null as any },
            select: ["userId", "slackUserId", "slackId"],
        });
        const slackMemberId = String(employee?.slackUserId || employee?.slackId || "").trim();
        return slackMemberId ? `<@${slackMemberId}>` : null;
    }

    private async getLowReviewAssessmentMentions(assigneeValue?: string | null) {
        const mentions = new Set<string>();
        const assigneeMention = await this.getAssigneeSlackMention(assigneeValue);
        if (assigneeMention) mentions.add(assigneeMention);

        const anjSlackId = await this.getAnjSlackUserId();
        if (anjSlackId) mentions.add(`<@${anjSlackId}>`);

        return [...mentions];
    }

    private async getResolutionTagAddedMentions(assigneeValue?: string | null) {
        const mentions = new Set<string>();
        const anjSlackId = await this.getAnjSlackUserId();
        if (anjSlackId) {
            mentions.add(`<@${anjSlackId}>`);
        }

        const assigneeLabel = await this.getAssigneeActivityLabel(assigneeValue);
        if (assigneeLabel && !["Unassigned", "Unknown assignee"].includes(assigneeLabel)) {
            mentions.add(assigneeLabel);
        }

        return [...mentions];
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

    private extractPropertyTypeFromTags(tags?: string | null) {
        const tagList = String(tags || "").split(",").map((tag) => tag.trim().toLowerCase());
        if (tagList.includes("own")) return "Own";
        if (tagList.includes("arb")) return "Arb";
        if (tagList.includes("pm")) return "PM";
        return null;
    }

    private extractServiceTypeFromTags(tags?: string | null) {
        const tagList = String(tags || "").split(",").map((tag) => tag.trim().toLowerCase());
        if (tagList.includes("full")) return "Full";
        if (tagList.includes("pro")) return "Pro";
        if (tagList.includes("launch")) return "Launch";
        return null;
    }

    private isEligibleReminderChannel(channelName?: string | null) {
        const normalized = String(channelName || "").toLowerCase();
        return normalized.includes("airbnb") || normalized.includes("vrbo");
    }

    private isEligibleReminderListing(propertyType?: string | null, serviceType?: string | null) {
        if (propertyType === "Own" || propertyType === "Arb") return true;
        return propertyType === "PM" && (serviceType === "Full" || serviceType === "Pro");
    }

    private async getResolutionsAssigneeOptions() {
        const assigneeData = await this.usersService.fetchUserListByDepartment("resolutions");
        const groups = [
            ...(assigneeData.priorityDepartments || []),
            ...(assigneeData.otherDepartments || []),
        ];

        return groups.flatMap((department) =>
            department.users.map((user) => ({
                label: user.displayName || user.name,
                value: user.uid,
                department: department.name,
            }))
        );
    }

    private parseJsonValue<T>(value: any, fallback: T): T {
        if (value == null || value === "") return fallback;
        if (typeof value !== "string") return value as T;
        try {
            return JSON.parse(value) as T;
        } catch {
            return fallback;
        }
    }

    private normalizeReservationTags(value: any): string[] {
        const source = Array.isArray(value) ? value : value == null ? [] : [value];
        const seen = new Set<string>();
        return source
            .map((tag) => String(tag || "").trim().replace(/\s+/g, " "))
            .filter((tag) => {
                if (!tag) return false;
                const key = tag.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    private async getResolutionTagOptions() {
        const reservations = await this.reservationRepo
            .createQueryBuilder("reservation")
            .select(["reservation.id", "reservation.tags"])
            .where("reservation.tags IS NOT NULL")
            .andWhere("reservation.tags != :empty", { empty: "" })
            .getMany();

        const discoveredTags = reservations.flatMap((reservation) =>
            this.normalizeReservationTags(this.parseJsonValue<any>(reservation.tags, []))
        );

        const settingsRows = await appDatabase.query(
            "SELECT tag_order AS tagOrder FROM reservation_tag_settings WHERE id = 1 LIMIT 1"
        );
        const tagOrder = this.normalizeReservationTags(
            this.parseJsonValue<string[]>(settingsRows?.[0]?.tagOrder, [])
        );

        const seen = new Set<string>();
        return [...tagOrder, ...discoveredTags]
            .filter((tag) => {
                const key = tag.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .map((tag) => ({ label: tag, value: tag }));
    }

    private async getMatchingChannelListing(
        reservation: ReservationInfoEntity,
        childListingsCache?: Map<number, any[]>,
    ): Promise<any | null> {
        const parentListingId = Number(reservation.listingMapId);
        if (!parentListingId) return null;

        let childListings = childListingsCache?.get(parentListingId);
        if (!childListings) {
            try {
                childListings = await this.listingService.getChildListings(parentListingId);
                if (childListingsCache) {
                    childListingsCache.set(parentListingId, Array.isArray(childListings) ? childListings : []);
                }
            } catch (error) {
                logger.warn(`Unable to resolve child listing listed status for listing ${parentListingId}:`, error);
                childListings = [];
                if (childListingsCache) {
                    childListingsCache.set(parentListingId, []);
                }
            }
        }

        return findMatchingHostifyChildListing(Array.isArray(childListings) ? childListings : [], {
            externalPropertyId: reservation.externalPropertyId,
            integration_nickname: reservation.integration_nickname,
            channelName: reservation.channelName,
        });
    }

    private async resolveListingListedStatus(
        reservation: ReservationInfoEntity,
        listing: Listing | null,
        childListingsCache?: Map<number, any[]>,
    ): Promise<unknown> {
        const parentStatus = (listing as any)?.is_listed ?? null;
        const matchedChildListing = await this.getMatchingChannelListing(reservation, childListingsCache);

        return matchedChildListing?.is_listed ?? parentStatus;
    }

    private async resolveIntegrationUrl(
        reservation: ReservationInfoEntity,
        listing: Listing | null,
        childListingsCache?: Map<number, any[]>,
    ): Promise<string> {
        const matchedChildListing = await this.getMatchingChannelListing(reservation, childListingsCache);
        const linkRecord = matchedChildListing || {
            ...(listing || {}),
            id: reservation.listingMapId || listing?.id,
            channelName: reservation.channelName,
            channel_listing_id: reservation.externalPropertyId,
            integration_name: reservation.integration_nickname,
            nickname: reservation.integration_nickname,
        };

        return getListingChannelUrl(linkRecord);
    }

    private async updateRootMessage(
        reviewCheckout: ReviewCheckout,
        reservation: ReservationInfoEntity,
        listing: Listing | null,
        isLateCancelledOverride?: boolean,
    ): Promise<void> {
        if (!reviewCheckout.slackThreadTs || !reviewCheckout.slackChannelId) return;

        try {
            const { emoji } = this.getListingEmoji(listing?.tags);
            const isLateCancelled = isLateCancelledOverride ?? await this.isLateCancelledReservation(reservation, listing);
            const [listingListedStatus, integrationUrl] = await Promise.all([
                this.resolveListingListedStatus(reservation, listing),
                this.resolveIntegrationUrl(reservation, listing),
            ]);
            const reviewService = new ReviewService();
            const [statusData, assigneeOptions, tagOptions] = await Promise.all([
                reviewService.getMitigationStatusOptions(),
                this.getResolutionsAssigneeOptions(),
                this.getResolutionTagOptions(),
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
                integrationName: reservation.integration_nickname || "",
                integrationUrl,
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
                visibility: reviewCheckout.visibility || "Awaiting Review",
                ssUrl,
                reviewCheckoutId: reviewCheckout.id,
                statusOptions: statusData.options,
                assigneeOptions,
                tagOptions,
                selectedTags: this.normalizeReservationTags(this.parseJsonValue<any>(reservation.tags, [])),
                isCancelled: isLateCancelled,
                isListingUnlisted: isUnlistedListingStatus(listingListedStatus),
            });

            // chat.update needs its response inspected. When we don't the way we didn't
            // before, transient failures (rate limits, `message_not_found` on a stale ts,
            // `channel_not_found` on a bad channel, etc.) are entirely invisible — the root
            // card silently stays out of sync with the DB, which is how "assignee changed
            // 17 minutes ago in-thread but root still shows Jade" happens. We now check
            // `ok`, retry once for retryable errors, and log a clear line so the failure
            // surfaces in the server log next time it happens.
            const requestBody = {
                channel: reviewCheckout.slackChannelId,
                ts: reviewCheckout.slackThreadTs,
                text: msgPayload.text,
                blocks: msgPayload.blocks,
            };
            const requestConfig = {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                },
            };

            let response = await axios.post("https://slack.com/api/chat.update", requestBody, requestConfig);
            if (!response.data?.ok) {
                const retryableErrors = ["ratelimited", "rate_limited", "internal_error", "service_unavailable", "fatal_error"];
                if (retryableErrors.includes(String(response.data?.error))) {
                    // Small backoff before a single retry; Slack's rate-limit retry-after
                    // is 1s by default and internal_error is usually transient.
                    await new Promise((resolve) => setTimeout(resolve, 1200));
                    response = await axios.post("https://slack.com/api/chat.update", requestBody, requestConfig);
                }
            }
            if (!response.data?.ok) {
                logger.error(
                    `[ResolutionsTeam] chat.update rejected for reviewCheckout=${reviewCheckout.id} channel=${reviewCheckout.slackChannelId} ts=${reviewCheckout.slackThreadTs}: error=${response.data?.error} response_metadata=${JSON.stringify(response.data?.response_metadata || {})}`,
                );
            }
        } catch (err) {
            logger.error(`[ResolutionsTeam] Failed to update root message for reviewCheckout ${reviewCheckout.id}:`, err);
        }
    }

    async syncRootMessageForReviewCheckout(reviewCheckoutId: number): Promise<void> {
        const reviewCheckout = await this.reviewCheckoutRepo.findOne({
            where: { id: reviewCheckoutId },
            relations: ["reservationInfo"],
        });
        const reservation = reviewCheckout?.reservationInfo;
        if (!reviewCheckout || !reservation) return;

        const listing = reservation.listingMapId
            ? await this.listingRepo.findOne({ where: { id: reservation.listingMapId } })
            : null;
        await this.updateRootMessage(reviewCheckout, reservation, listing);
    }

    private async getCancellationChangedAt(reservationId: number): Promise<Date | null> {
        const logs = await this.reservationInfoLogsRepo.find({
            where: { reservationInfoId: reservationId, action: "UPDATE" as any },
            order: { changedAt: "ASC", id: "ASC" },
        });

        const cancellationLog = logs.find((log) => {
            const statusDiff = log.diff?.status;
            const newStatus = statusDiff?.new ?? log.newData?.status;
            const oldStatus = statusDiff?.old ?? log.oldData?.status;
            return isCancelledStatus(newStatus) && !isCancelledStatus(oldStatus);
        });

        return cancellationLog?.changedAt || null;
    }

    private async isLateCancelledReservation(
        reservation: ReservationInfoEntity,
        listing: Listing | null,
        cancelledAtOverride?: Date | null,
    ) {
        if (!isCancelledStatus(reservation.status)) return false;
        const cancelledAt = cancelledAtOverride || await this.getCancellationChangedAt(Number(reservation.id));
        if (!cancelledAt) return false;
        return isCancelledAfterListingLocalCheckIn(reservation, listing, cancelledAt);
    }

    async ensureThreadForReservation(reservationId: number, userId?: string | null) {
        try {
        const existing = await this.reviewCheckoutRepo.findOne({
            where: { reservationInfo: { id: reservationId } },
            relations: ["reservationInfo"],
        });

        if (existing?.slackThreadTs && existing?.slackChannelId) {
            return existing;
        }

        const reviewService = new ReviewService();
        const reviewCheckout = existing || await reviewService.ensureReviewCheckout(reservationId, userId || "system");
        const reservation = reviewCheckout.reservationInfo || await this.reservationRepo.findOne({ where: { id: reservationId } });
        if (!reservation) {
            throw new Error(`Reservation ${reservationId} not found`);
        }

        const listing = reservation.listingMapId
            ? await this.listingRepo.findOne({ where: { id: reservation.listingMapId } })
            : null;
        const { emoji } = this.getListingEmoji(listing?.tags);
        const isLateCancelled = await this.isLateCancelledReservation(reservation, listing);
        const [listingListedStatus, integrationUrl] = await Promise.all([
            this.resolveListingListedStatus(reservation, listing),
            this.resolveIntegrationUrl(reservation, listing),
        ]);
        const [statusData, assigneeOptions, tagOptions] = await Promise.all([
            reviewService.getMitigationStatusOptions(),
            this.getResolutionsAssigneeOptions(),
            this.getResolutionTagOptions(),
        ]);

        const hostifyUrl = reservation.reservationId
            ? `https://us.hostify.com/reservations/view/${reservation.reservationId}`
            : "";
        const ssUrl = `https://securestay.ai/mitigation?reservationId=${reservation.id}`;

        const selectedTags = this.normalizeReservationTags(this.parseJsonValue<any>(reservation.tags, []));
        const buildMessagePayload = (includeTags: boolean) => buildResolutionsCheckoutMessage({
            emoji,
            listingName: reservation.listingName || "Unknown Property",
            guestName: reservation.guestName || "Guest",
            hostifyUrl,
            channelName: reservation.channelName || "",
            integrationName: reservation.integration_nickname || "",
            integrationUrl,
            checkIn: reservation.arrivalDate ? format(new Date(reservation.arrivalDate), "MMM d") : "",
            checkOut: reservation.departureDate ? format(new Date(reservation.departureDate), "MMM d") : "",
            totalPaid: this.getTotalPaidDisplay(reservation),
            ownerRevenue: this.getOwnerRevenueDisplay(reservation),
            status: reviewCheckout.status || "New",
            assignee: reviewCheckout.assignee || "",
            visibility: reviewCheckout.visibility || "Awaiting Review",
            ssUrl,
            reviewCheckoutId: reviewCheckout.id,
            statusOptions: statusData.options,
            assigneeOptions,
            tagOptions: includeTags ? tagOptions : [],
            selectedTags: includeTags ? selectedTags : [],
            isCancelled: isLateCancelled,
            isListingUnlisted: isUnlistedListingStatus(listingListedStatus),
        });

        let msgPayload = buildMessagePayload(true);
        let result = await sendSlackMessage(msgPayload);
        if (!result?.ok || !result?.ts) {
            // Log the exact blocks that Slack rejected so we can diagnose the problem
            logger.error(
                `[ResolutionsTeam] Slack rejected message for reservation ${reservationId} (error: ${result?.error}). Blocks payload:\n${JSON.stringify(msgPayload.blocks, null, 2)}`
            );
            if (tagOptions.length > 0) {
                logger.warn(`[ResolutionsTeam] Retrying reservation ${reservationId} Slack thread without Tags select while keeping Status, Assignee, and View controls.`);
                msgPayload = buildMessagePayload(false);
                result = await sendSlackMessage(msgPayload);
            }
        }
        if (!result?.ok || !result?.ts) {
            throw new Error(`Failed to create Slack thread for reservation ${reservationId}: ${result?.error || "unknown error"}`);
        }

        reviewCheckout.slackThreadTs = result.ts;
        reviewCheckout.slackChannelId = result.channel || RESOLUTIONS_TEAM_CHANNEL;
        await this.reviewCheckoutRepo.save(reviewCheckout);

        const existingSlackRecord = await this.slackMessageRepo.findOne({
            where: { entityType: "review_checkout", entityId: reviewCheckout.id, messageTs: result.ts },
        });

        if (!existingSlackRecord) {
            const slackMsgRecord = this.slackMessageRepo.create({
                channel: reviewCheckout.slackChannelId,
                messageTs: result.ts,
                threadTs: result.ts,
                entityType: "review_checkout",
                entityId: reviewCheckout.id,
                originalMessage: JSON.stringify({ reservationId: reservation.id }),
            });
            await this.slackMessageRepo.save(slackMsgRecord);
        }

        return reviewCheckout;
        } catch (error: any) {
            const msg = error?.message || 'Unknown error';
            throw new Error(`Slack thread creation failed for reservation ${reservationId}: ${msg}`);
        }
    }

    async handleLateCancelledReservation(reservationId: number, cancelledAt: Date = new Date()) {
        try {
            const reservation = await this.reservationRepo.findOne({ where: { id: reservationId } });
            if (!reservation) return;

            const listing = reservation.listingMapId
                ? await this.listingRepo.findOne({ where: { id: reservation.listingMapId } })
                : null;
            const isLateCancelled = isCancelledAfterListingLocalCheckIn(reservation, listing, cancelledAt);
            if (!isLateCancelled) return;

            const reviewCheckout = await this.ensureThreadForReservation(reservationId, "system");
            const hydratedReservation = reviewCheckout.reservationInfo || reservation;

            await this.updateRootMessage(reviewCheckout, hydratedReservation, listing, true);
            await this.postActivityToThread(reviewCheckout.id, {
                type: "reservation_cancelled",
                actor: "SecureStay",
                details: `Reservation for ${reservation.guestName || "Guest"} was cancelled after check-in time.`,
            });
        } catch (error) {
            logger.error(`[ResolutionsTeam] Failed to process late cancellation for reservation ${reservationId}:`, error);
        }
    }

    // ─── Daily check-in message posting ───────────────────────────────────────

    async postDailyCheckoutMessages(): Promise<void> {
        const today = getEasternDateString();
        logger.info(`[ResolutionsTeam] Posting daily check-in messages for ${today}`);

        const reviewService = new ReviewService();
        try {
            await reviewService.processReviewCheckout();
        } catch (error) {
            logger.error("[ResolutionsTeam] Failed to ensure review checkout records before daily Slack post:", error);
        }

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
            logger.info("[ResolutionsTeam] No check-in reservations to post for today");
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
        const [statusData, assigneeOptions, tagOptions] = await Promise.all([
            reviewService.getMitigationStatusOptions(),
            this.getResolutionsAssigneeOptions(),
            this.getResolutionTagOptions(),
        ]);

        let posted = 0;
        let skipped = 0;
        const childListingsCache = new Map<number, any[]>();

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

                const selectedTags = this.normalizeReservationTags(this.parseJsonValue<any>(reservation.tags, []));
                const [listingListedStatus, integrationUrl] = await Promise.all([
                    this.resolveListingListedStatus(reservation, listing, childListingsCache),
                    this.resolveIntegrationUrl(reservation, listing, childListingsCache),
                ]);
                const buildMsgPayload = (includeTags: boolean) => buildResolutionsCheckoutMessage({
                    emoji,
                    listingName: reservation.listingName || "Unknown Property",
                    guestName: reservation.guestName || "Guest",
                    hostifyUrl,
                    channelName: reservation.channelName || "",
                    integrationName: reservation.integration_nickname || "",
                    integrationUrl,
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
                    visibility: rc.visibility || "Awaiting Review",
                    ssUrl,
                    reviewCheckoutId: rc.id,
                    statusOptions: statusData.options,
                    assigneeOptions,
                    tagOptions: includeTags ? tagOptions : [],
                    selectedTags: includeTags ? selectedTags : [],
                    isListingUnlisted: isUnlistedListingStatus(listingListedStatus),
                });

                let msgPayload = buildMsgPayload(true);
                let result = await sendSlackMessage(msgPayload);

                if (!result?.ok || !result?.ts) {
                    logger.error(
                        `[ResolutionsTeam] Slack rejected message for reservation ${reservation.id} (error: ${result?.error}). Blocks:\n${JSON.stringify(msgPayload.blocks, null, 2)}`
                    );
                    if (tagOptions.length > 0) {
                        logger.warn(`[ResolutionsTeam] Retrying reservation ${reservation.id} without Tags select while keeping Status, Assignee, and View controls.`);
                        msgPayload = buildMsgPayload(false);
                        result = await sendSlackMessage(msgPayload);
                    }
                }

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
    ): Promise<string | null> {
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
            const assigneeLabels = activity.type === "assignee"
                ? {
                    oldValue: await this.getAssigneeActivityLabel(activity.oldValue),
                    newValue: await this.getAssigneeActivityLabel(activity.newValue || activity.details),
                }
                : {};
            const resolutionTagMentions = activity.type === "resolution_tag" && !activity.oldValue && (activity.newValue || activity.details)
                ? await this.getResolutionTagAddedMentions(rc.assignee)
                : [];
            const normalizedReviewRating = this.normalizeReviewRatingToStars(activity.rating);
            const needsReviewSentimentMentions = activity.type === "review_posted"
                && Boolean(activity.reviewSentiment)
                && String(activity.reviewSentiment).toLowerCase() !== "positive";
            const reviewAssessmentMentions = activity.type === "review_posted"
                && ((normalizedReviewRating !== null && normalizedReviewRating < 5) || needsReviewSentimentMentions)
                ? await this.getLowReviewAssessmentMentions(rc.assignee)
                : [];

            const msgPayload = buildResolutionsActivityMessage({
                ...activity,
                actor: actorPresentation.displayName,
                actorIconUrl: actorPresentation.iconUrl,
                ...assigneeLabels,
                anjSlackId: anjSlackId || undefined,
                notificationMentions: activity.notificationMentions?.length
                    ? activity.notificationMentions
                    : resolutionTagMentions.length
                        ? resolutionTagMentions
                        : reviewAssessmentMentions,
            });

            const channelId = rc.slackChannelId || RESOLUTIONS_TEAM_CHANNEL;

            let result = await sendSlackMessage(
                { ...msgPayload, channel: channelId },
                rc.slackThreadTs
            );

            // Slack may silently drop `thread_ts` when the parent message no longer exists
            // (e.g. this row's slackThreadTs came from the July 2 main-table dump and points
            // at a message that's no longer resolvable in the current workspace/channel).
            // The API still returns `ok: true` and posts as a top-level channel message —
            // which is why yesterday's status/notes/tag/visibility updates for pre-migration
            // rows showed up as free-floating messages instead of thread replies.
            //
            // Detect it by comparing the requested thread_ts against message.thread_ts on the
            // response. If they mismatch (or Slack returned thread_not_found / message_not_found),
            // the current slackThreadTs is stale — clear it, spin up a fresh thread via
            // ensureThreadForReservation, and re-post the activity into the new thread so this
            // activity is threaded. The orphaned top-level message we just posted is left in
            // the channel intentionally; auto-deleting historical Slack messages is destructive
            // enough that we'd rather keep it visible while the operator understands the state.
            const requestedThreadTs = rc.slackThreadTs;
            const responseThreadTs = result?.message?.thread_ts;
            const staleThreadErrorCode = ["thread_not_found", "message_not_found"];
            const slackReportedStaleError = result && result.ok === false && result.error && staleThreadErrorCode.includes(String(result.error));
            const slackSilentlyUnthreaded = Boolean(result?.ok && requestedThreadTs && !responseThreadTs);

            if ((slackReportedStaleError || slackSilentlyUnthreaded) && rc.reservationInfo?.id) {
                logger.warn(
                    `[ResolutionsTeam] slackThreadTs=${requestedThreadTs} for reviewCheckout=${reviewCheckoutId} is stale (Slack ${slackReportedStaleError ? `error=${result?.error}` : "silently dropped thread_ts"}); recreating thread and re-posting`,
                );
                // Clear so ensureThreadForReservation goes through its create path instead of
                // its early-return short-circuit at line 644.
                rc.slackThreadTs = null;
                rc.slackChannelId = null;
                try {
                    await this.reviewCheckoutRepo.save(rc);
                    const refreshedRc = await this.ensureThreadForReservation(
                        Number(rc.reservationInfo.id),
                        activity.actor || null,
                    );
                    if (refreshedRc?.slackThreadTs) {
                        rc.slackThreadTs = refreshedRc.slackThreadTs;
                        rc.slackChannelId = refreshedRc.slackChannelId;
                        result = await sendSlackMessage(
                            { ...msgPayload, channel: refreshedRc.slackChannelId || RESOLUTIONS_TEAM_CHANNEL },
                            refreshedRc.slackThreadTs,
                        );
                    } else {
                        logger.error(
                            `[ResolutionsTeam] Recreated thread lookup returned no slackThreadTs for reviewCheckout=${reviewCheckoutId}; original orphan post remains as-is`,
                        );
                    }
                } catch (recreateErr) {
                    logger.error(
                        `[ResolutionsTeam] Thread recreation failed for reviewCheckout=${reviewCheckoutId}; original orphan post remains as-is:`,
                        recreateErr,
                    );
                }
            }

            // Keep root controls in sync after edits from Slack or the app.
            if (activity.type === "status" || activity.type === "assignee" || activity.type === "visibility" || activity.type === "resolution_tag") {
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
            return result?.ts || null;
        } catch (err) {
            logger.error(
                `[ResolutionsTeam] Failed to post activity to thread for reviewCheckout ${reviewCheckoutId}:`,
                err
            );
            return null;
        }
    }

    async updateActivityMessageInThread(
        reviewCheckoutId: number,
        messageTs: string,
        activity: ActivityPayload
    ): Promise<void> {
        try {
            const rc = await this.reviewCheckoutRepo.findOne({
                where: { id: reviewCheckoutId },
                select: ["id", "slackThreadTs", "slackChannelId"],
            });

            if (!rc?.slackThreadTs || !rc.slackChannelId || !messageTs || messageTs === rc.slackThreadTs) {
                return;
            }

            const actorPresentation = await this.getActorPresentation(activity.actor);
            const assigneeLabels = activity.type === "assignee"
                ? {
                    oldValue: await this.getAssigneeActivityLabel(activity.oldValue),
                    newValue: await this.getAssigneeActivityLabel(activity.newValue || activity.details),
                }
                : {};
            const msgPayload = buildResolutionsActivityMessage({
                ...activity,
                actor: actorPresentation.displayName,
                actorIconUrl: actorPresentation.iconUrl,
                ...assigneeLabels,
            });

            const payload: Record<string, any> = {
                channel: rc.slackChannelId,
                ts: messageTs,
                text: msgPayload.text,
                blocks: msgPayload.blocks,
                unfurl_links: false,
                unfurl_media: false,
            };

            if (msgPayload.bot_name) {
                payload.username = msgPayload.bot_name;
            }
            if (msgPayload.bot_icon) {
                payload.icon_url = msgPayload.bot_icon;
            }

            await axios.post("https://slack.com/api/chat.update", payload, {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                },
            });
        } catch (err) {
            logger.error(
                `[ResolutionsTeam] Failed to update activity message ${messageTs} for reviewCheckout ${reviewCheckoutId}:`,
                err
            );
        }
    }

    async deleteActivityMessageInThread(
        reviewCheckoutId: number,
        messageTs: string
    ): Promise<void> {
        try {
            const rc = await this.reviewCheckoutRepo.findOne({
                where: { id: reviewCheckoutId },
                select: ["id", "slackThreadTs", "slackChannelId"],
            });

            if (!rc?.slackThreadTs || !rc.slackChannelId || !messageTs || messageTs === rc.slackThreadTs) {
                return;
            }

            const response = await axios.post(
                "https://slack.com/api/chat.delete",
                {
                    channel: rc.slackChannelId,
                    ts: messageTs,
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                    },
                }
            );

            if (!response.data?.ok && !["message_not_found", "message_deleted"].includes(response.data?.error)) {
                logger.warn(
                    `[ResolutionsTeam] Slack refused delete for activity message ${messageTs}: ${response.data?.error || "unknown error"}`
                );
            }
        } catch (err) {
            logger.error(
                `[ResolutionsTeam] Failed to delete activity message ${messageTs} for reviewCheckout ${reviewCheckoutId}:`,
                err
            );
        }
    }

    // ─── Sync Slack reply → SS ─────────────────────────────────────────────────

    async syncSlackReplyToSS(
        reviewCheckoutId: number,
        slackUserId: string,
        text: string,
        slackMessageTs: string,
        files: SlackThreadFileAttachment[] = []
    ): Promise<void> {
        try {
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

            // Save to review_checkout_updates only if not already there (independent dedup)
            const existingUpdate = await this.reviewCheckoutUpdatesRepo.findOne({
                where: { slackMessageTs },
            });
            if (!existingUpdate) {
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
            } else {
                logger.debug(
                    `[ResolutionsTeam] Duplicate Slack reply for review_checkout_updates, skipping: ${slackMessageTs}`
                );
            }

            const discussionAttachments = this.buildSlackDiscussionAttachments(files);

            // Sync to review_discussion_messages — always attempted, with its own independent dedup
            let reservationId = rc.reservationInfo?.id ?? null;
            if (!reservationId) {
                // Fallback: recover reservationId from the SlackMessageEntity originalMessage field
                const slackRecord = await this.slackMessageRepo.findOne({
                    where: { entityType: "review_checkout", entityId: reviewCheckoutId },
                });
                if (slackRecord?.originalMessage) {
                    try {
                        const parsed = JSON.parse(slackRecord.originalMessage);
                        reservationId = parsed.reservationId ?? null;
                    } catch { /* ignore parse errors */ }
                }
            }

            if (reservationId) {
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
                        metadata: {
                            source: "slack",
                            slackMessageTs,
                            attachments: discussionAttachments,
                        },
                    });
                    await this.reviewDiscussionMessageRepo.save(discussionMsg);
                    logger.info(
                        `[ResolutionsTeam] Synced Slack reply to review_discussion_messages for reservation ${reservationId}`
                    );
                } else {
                    const existingAttachments = Array.isArray(existingDiscussionMsg.metadata?.attachments)
                        ? existingDiscussionMsg.metadata?.attachments
                        : [];
                    if (discussionAttachments.length && existingAttachments.length === 0) {
                        existingDiscussionMsg.metadata = {
                            ...(existingDiscussionMsg.metadata || {}),
                            attachments: discussionAttachments,
                        };
                        await this.reviewDiscussionMessageRepo.save(existingDiscussionMsg);
                    }
                    logger.debug(
                        `[ResolutionsTeam] Duplicate Slack reply for review_discussion_messages, skipping: ${slackMessageTs}`
                    );
                }
            } else {
                logger.warn(
                    `[ResolutionsTeam] Could not resolve reservationId for reviewCheckout ${reviewCheckoutId} — skipping review_discussion_messages sync`
                );
            }
        } catch (err) {
            logger.error(
                `[ResolutionsTeam] Failed to sync Slack reply to SS:`,
                err
            );
        }
    }

    // ─── Pull Slack thread replies → SS (active sync fallback) ───────────────

    async syncSlackThreadReplies(reservationId: number): Promise<void> {
        const now = Date.now();
        const lastSync = slackThreadSyncTimestamps.get(reservationId) || 0;
        if (now - lastSync < SLACK_SYNC_INTERVAL_MS) {
            logger.debug(`[ResolutionsTeam] Skipping Slack thread sync for reservation ${reservationId} — synced ${Math.round((now - lastSync) / 1000)}s ago`);
            return;
        }
        slackThreadSyncTimestamps.set(reservationId, now);

        try {
            const rc = await this.reviewCheckoutRepo.findOne({
                where: { reservationInfo: { id: reservationId } },
                relations: ["reservationInfo"],
            });
            if (!rc?.slackThreadTs || !rc.slackChannelId) {
                logger.debug(`[ResolutionsTeam] No Slack thread for reservation ${reservationId} — skipping thread sync`);
                return;
            }

            const response = await axios.get("https://slack.com/api/conversations.replies", {
                headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
                params: { channel: rc.slackChannelId, ts: rc.slackThreadTs, limit: 100 },
                timeout: 8000,
            });

            if (!response.data?.ok) {
                logger.warn(`[ResolutionsTeam] conversations.replies not ok for reservation ${reservationId}: ${response.data?.error}`);
                return;
            }

            const slackUsers = await getSlackUsers();
            const messages: any[] = response.data.messages || [];
            let synced = 0;

            for (const msg of messages) {
                if (msg.ts === rc.slackThreadTs) continue;           // skip root message
                if (msg.bot_id || msg.subtype === "bot_message") continue; // skip bot messages
                if (!msg.user) continue;                              // skip anonymous messages

                const processedText = replaceSlackIdsWithMentions(msg.text || "", slackUsers);
                await this.syncSlackReplyToSS(rc.id, msg.user, processedText, msg.ts, msg.files || []);
                synced++;
            }

            logger.info(`[ResolutionsTeam] Pulled ${synced} new reply(ies) from Slack thread for reservation ${reservationId}`);
        } catch (err) {
            logger.error(`[ResolutionsTeam] Failed to pull Slack thread replies for reservation ${reservationId}:`, err);
        }
    }

    // ─── AI Analysis trigger from Slack ───────────────────────────────────────

    async triggerAIAnalysisFromSlack(
        reservationId: number,
        channel: string,
        threadTs: string
    ): Promise<void> {
        let loadingMessageTs: string | null = null;
        try {
            logger.info(
                `[ResolutionsTeam] AI analysis triggered from Slack for reservation ${reservationId}`
            );

            const loadingMessage = await sendSlackMessage(
                { channel, text: "🔄 Running AI analysis…" },
                threadTs
            );
            loadingMessageTs = loadingMessage?.ts || null;

            const guestAnalysisService = new GuestAnalysisService();
            const analysis = await guestAnalysisService.analyzeGuestCommunication(
                reservationId,
                undefined,
                "slack",
                { skipSlackPost: Boolean(loadingMessageTs) }
            );

            const analysisText = guestAnalysisService.buildAnalysisGeneratedSlackText(analysis);
            if (loadingMessageTs) {
                await updateSlackMessage({ text: analysisText }, loadingMessageTs, channel);
            } else {
                await sendSlackMessage({ channel, text: analysisText }, threadTs);
            }

            logger.info(
                `[ResolutionsTeam] AI analysis posted to thread for reservation ${reservationId}`
            );
        } catch (err) {
            logger.error(
                `[ResolutionsTeam] AI analysis failed for reservation ${reservationId}:`,
                err
            );
            try {
                const errorText = "❌ AI analysis encountered an error. Please check the server logs.";
                if (loadingMessageTs) {
                    await updateSlackMessage({ text: errorText }, loadingMessageTs, channel);
                } else {
                    await sendSlackMessage({ channel, text: errorText }, threadTs);
                }
            } catch (_) {
                // best-effort
            }
        }
    }

    async sendDaysLeftReviewReminders(): Promise<void> {
        const today = new Date();
        const reminderTargets = [2, 1, 0].map((daysLeft) => ({
            daysLeft,
            deadline: format(addDays(today, daysLeft), "yyyy-MM-dd"),
        }));
        const deadlines = reminderTargets.map((target) => target.deadline);
        const daysLeftByDeadline = new Map(reminderTargets.map((target) => [target.deadline, target.daysLeft]));

        const reviewCheckouts = await this.reviewCheckoutRepo.find({
            where: { deletedAt: null as any },
            relations: ["reservationInfo"],
        });

        const candidates = reviewCheckouts.filter((rc) =>
            Boolean(
                rc.slackThreadTs
                && rc.reservationInfo
                && deadlines.includes(String(rc.fourteenDaysAfterCheckout || "").slice(0, 10))
            )
        );

        if (!candidates.length) {
            logger.info("[ResolutionsTeam] No days-left reminder candidates found.");
            return;
        }

        const reservationIds = candidates
            .map((rc) => Number(rc.reservationInfo?.id))
            .filter((id) => Number.isFinite(id));
        const listingIds = candidates
            .map((rc) => Number(rc.reservationInfo?.listingMapId))
            .filter((id) => Number.isFinite(id));

        const [reviews, listings] = await Promise.all([
            reservationIds.length
                ? this.reviewRepo.find({ where: { reservationId: In(reservationIds) } })
                : [],
            listingIds.length
                ? this.listingRepo.find({ where: { id: In(listingIds) }, select: ["id", "tags"] })
                : [],
        ]);

        const postedReviewReservationIds = new Set(
            reviews
                .filter((review) => Boolean(review.submittedAt || review.publicReview || review.rating))
                .map((review) => Number(review.reservationId))
        );
        const listingTagMap = new Map<number, string | null | undefined>(
            listings.map((listing) => [Number(listing.id), listing.tags] as [number, string | null | undefined])
        );

        let sent = 0;
        let skipped = 0;

        for (const rc of candidates) {
            const reservation = rc.reservationInfo;
            const reservationId = Number(reservation?.id);
            const deadline = String(rc.fourteenDaysAfterCheckout || "").slice(0, 10);
            const daysLeft = daysLeftByDeadline.get(deadline);

            if (!reservation || daysLeft == null || postedReviewReservationIds.has(reservationId)) {
                skipped++;
                continue;
            }

            const listingTags = listingTagMap.get(Number(reservation.listingMapId)) || "";
            const propertyType = this.extractPropertyTypeFromTags(listingTags);
            const serviceType = this.extractServiceTypeFromTags(listingTags);
            if (!this.isEligibleReminderListing(propertyType, serviceType)) {
                skipped++;
                continue;
            }

            if (!this.isEligibleReminderChannel(reservation.channelName)) {
                skipped++;
                continue;
            }

            const reminderEntityType = `review_checkout_days_left_${daysLeft}`;
            const existingReminder = await this.slackMessageRepo.findOne({
                where: {
                    entityType: reminderEntityType,
                    entityId: rc.id,
                },
            });
            if (existingReminder) {
                skipped++;
                continue;
            }

            const checkoutDate = this.getCheckoutLocalDateFromDeadline(deadline);
            const hasActivity = await this.hasMitigationActivitySince(Number(rc.id), reservationId, checkoutDate);
            if (hasActivity) {
                skipped++;
                continue;
            }

            const mention = rc.assignee
                ? await this.getAssigneeActivityLabel(rc.assignee)
                : RESOLUTIONS_TEAM_SUBTEAM_MENTION;
            const dayLabel = daysLeft === 0 ? "0 days left (expires today)" : daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
            const text = `⚠️ ${mention} ${dayLabel} until the mitigation ends for ${reservation.guestName || "Guest"} at ${reservation.listingName || "Unknown Property"}. The Resolution case needs to be reviewed due to inactivity.`;

            const result = await sendSlackMessage(
                {
                    channel: rc.slackChannelId || RESOLUTIONS_TEAM_CHANNEL,
                    text,
                    blocks: [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text
                            }
                        },
                        {
                            type: "actions",
                            elements: [
                                {
                                    type: "button",
                                    action_id: "view_mitigation_detail",
                                    text: { type: "plain_text", text: "View Mitigation Detail", emoji: true },
                                    url: `https://securestay.ai/mitigation?reservationId=${reservationId}`,
                                }
                            ]
                        }
                    ],
                    unfurl_links: false,
                    unfurl_media: false,
                },
                rc.slackThreadTs
            );

            if (result?.ok && result?.ts) {
                try {
                    await this.reviewDiscussionMessageRepo.save(this.reviewDiscussionMessageRepo.create({
                        reviewId: null,
                        reservationId,
                        parentMessageId: null,
                        sourceType: "system",
                        authorId: null,
                        authorName: "SecureStay",
                        authorAvatar: null,
                        content: text,
                        mentions: [],
                        metadata: {
                            source: "resolutions_team",
                            eventType: MITIGATION_INACTIVITY_REMINDER_EVENT,
                            reviewCheckoutId: rc.id,
                            daysLeft,
                            deadline,
                            slackMessageTs: result.ts,
                        },
                    }));
                } catch (error) {
                    logger.error(`[ResolutionsTeam] Failed to create SecureStay inactivity reminder for reviewCheckout ${rc.id}:`, error);
                }

                const slackMsgRecord = this.slackMessageRepo.create({
                    channel: result.channel || rc.slackChannelId || RESOLUTIONS_TEAM_CHANNEL,
                    messageTs: result.ts,
                    threadTs: rc.slackThreadTs,
                    entityType: reminderEntityType,
                    entityId: rc.id,
                    originalMessage: JSON.stringify({ reservationId, daysLeft, deadline }),
                });
                await this.slackMessageRepo.save(slackMsgRecord);
                sent++;
            } else {
                skipped++;
                logger.error(`[ResolutionsTeam] Failed to send ${daysLeft}-day review reminder for reviewCheckout ${rc.id}: ${result?.error || "unknown error"}`);
            }
        }

        logger.info(`[ResolutionsTeam] Days-left reminders complete — sent: ${sent}, skipped: ${skipped}`);
    }
}
