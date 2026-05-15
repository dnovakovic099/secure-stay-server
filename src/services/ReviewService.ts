import { Between, Brackets, In, IsNull, Like, LessThan, LessThanOrEqual, Not, MoreThanOrEqual, Equal } from "typeorm";
import { HostAwayClient } from "../client/HostAwayClient";
import { ReviewEntity } from "../entity/Review";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ReservationService } from "./ReservationService";
import { OwnerInfoEntity } from "../entity/OwnerInfo";
import sendEmail from "../utils/sendEmai";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ReservationInfoService } from "./ReservationInfoService";
import { v4 as uuidv4 } from 'uuid';
import axios from "axios";
import { Claim } from "../entity/Claim";
import { buildClaimReviewReceivedMessage } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import { ListingService } from "./ListingService";
import { addDays, endOfDay, format, getDay, startOfDay, subMonths } from "date-fns";
import { ActionItemsService } from "./ActionItemsService";
import { IssuesService } from "./IssuesService";
import { UsersEntity } from "../entity/Users";
import { ReviewCheckout } from "../entity/ReviewCheckout";
import { ReviewCheckoutUpdates } from "../entity/ReviewCheckoutUpdates";
import { BadReviewEntity } from "../entity/BadReview";
import { BadReviewUpdatesEntity } from "../entity/BadReviewUpdates";
import { LiveIssue, LiveIssueStatus } from "../entity/LiveIssue";
import { LiveIssueUpdates } from "../entity/LiveIssueUpdates";
import { Listing } from "../entity/Listing";
import { Hostify } from "../client/Hostify";
import { GuestAnalysisEntity } from "../entity/GuestAnalysis";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Issue } from "../entity/Issue";
import { EscalationSettings } from "../entity/EscalationSettings";
import { ReviewDiscussionMessageEntity } from "../entity/ReviewDiscussionMessage";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { ResolutionsTeamSlackService } from "./ResolutionsTeamSlackService";
import { ReservationHistoryService, ReservationHistoryDiff } from "./ReservationHistoryService";
import { Employee } from "../entity/Employee";
import { FileInfo } from "../entity/FileInfo";
import { getSlackUsers } from "../utils/getSlackUsers";
import { generateSlackMessageLink } from "../helpers/helpers";
import { supabaseAdmin } from "../utils/supabase";

interface ProcessedReview extends ReviewEntity {
    unresolvedForMoreThanThreeDays: boolean;
    unresolvedForMoreThanSevenDays: boolean;
}

interface CreateReview {
    reservationId: number;
    reviewerName: string;
    rating: number;
    publicReview: string;
    status: string;
}

interface Filter {
    currentlyStaying?: boolean | string | null | undefined;
    listingMapId?: string[];
    guestName?: string;
    page?: number;
    limit?: number;
    userId?: string;
    actionItemsStatus?: string[] | null | undefined;
    issuesStatus?: string[] | null | undefined;
    channel?: string[] | null | undefined;
    payment?: string[] | null | undefined;
    keyword?: string | undefined;
    todayDate?: string | undefined;
    status?: string[] | null | undefined;
    isActive?: boolean | null | undefined;
    tab?: string | null | undefined;
    propertyType?: string[] | null | undefined;
    serviceType?: string[] | null | undefined;
    integration?: string[] | null | undefined;
    fromDate?: string | undefined;
    toDate?: string | undefined;
    dateType?: string | undefined;
    sentiment?: string[] | null | undefined;
    latestUpdate?: string[] | null | undefined;
    visibility?: string[] | null | undefined;
    operationalFlags?: string[] | null | undefined;
    owner?: string[] | null | undefined;
    assignee?: string[] | null | undefined;
    isClaimOnly?: boolean | string | null | undefined;
    refundStatus?: string[] | null | undefined;
    rating?: number[] | null | undefined;
    reservationId?: string | number | null | undefined;
    confirmationCode?: string | null | undefined;
    totalPaidOperator?: string | null | undefined;
    totalPaidMin?: string | number | null | undefined;
    totalPaidMax?: string | number | null | undefined;
    ownerPayoutOperator?: string | null | undefined;
    ownerPayoutMin?: string | number | null | undefined;
    ownerPayoutMax?: string | number | null | undefined;
    latestUpdateSearch?: string | null | undefined;
    resolutionNotes?: string[] | null | undefined;
    resolutionNotesSearch?: string | null | undefined;
    issuesEntry?: string[] | null | undefined;
    issueCategory?: string[] | null | undefined;
    issueDescriptionSearch?: string | null | undefined;
    aiRedFlag?: string[] | null | undefined;
    aiGreenFlag?: string[] | null | undefined;
    aiAnalysis?: string[] | null | undefined;
    aiAnalysisSearch?: string | null | undefined;
    publicReviewSearch?: string | null | undefined;
}


interface FilterBadReviews {
    listingMapId?: string[];
    guestName?: string;
    page?: number;
    limit?: number;
    userId?: string;
    actionItemsStatus?: string[] | null | undefined;
    issuesStatus?: string[] | null | undefined;
    channel?: string[] | null | undefined;
    payment?: string[] | null | undefined;
    keyword?: string | undefined;
    todayDate?: string | undefined;
    status?: string[] | null | undefined;
    isActive?: boolean | null | undefined;
    tab?: string | null | undefined;
}

interface DashboardFilters {
    listingId?: Array<string | number> | null | undefined;
    propertyType?: string[] | null | undefined;
    channel?: Array<string | number> | null | undefined;
    fromDate?: string | undefined;
    toDate?: string | undefined;
    dateType?: string | undefined;
}

type DashboardDrilldownDimension =
    | 'review_rating'
    | 'review_channel'
    | 'review_month'
    | 'mitigation_status'
    | 'mitigation_month'
    | 'mitigation_property_type'
    | 'mitigation_assignee';

interface DashboardDrilldownFilters extends DashboardFilters {
    dimension?: DashboardDrilldownDimension | string | undefined;
    value?: string | undefined;
}

interface DashboardUserSummary {
    uid: string | null;
    displayName: string;
    fullNameTooltip: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    photoUrl: string | null;
}

export enum ReviewCheckoutStatus {
    NEW = "New",
    IN_PROGRESS = "In Progress",
    COMPLETED = "Completed",
    ARCHIVED = "Archived",
}


export enum BadReviewStatus {
    NEW = 'New',
    CALL_PHASE = 'Call Phase',
    PENDING_REMOVAL = 'Pending Removal',
    CLOSED_NO_ACTION_REQUIRED = 'Closed - No Action Required',
    CLOSED_REMOVED = 'Closed - Removed',
    CLOSED_FAILED = 'Closed - Failed'
}



export class ReviewService {
    private hostawayClient = new HostAwayClient();
    private reviewRepository = appDatabase.getRepository(ReviewEntity);
    private ownerInfoRepository = appDatabase.getRepository(OwnerInfoEntity);
    private claimRepo = appDatabase.getRepository(Claim);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private reviewCheckoutRepo = appDatabase.getRepository(ReviewCheckout);
    private reviewCheckoutUpdatesRepo = appDatabase.getRepository(ReviewCheckoutUpdates);
    private employeeRepo = appDatabase.getRepository(Employee);
    private fileInfoRepo = appDatabase.getRepository(FileInfo);
    private badReviewRepo = appDatabase.getRepository(BadReviewEntity);
    private badReviewUpdatesRepo = appDatabase.getRepository(BadReviewUpdatesEntity);
    private liveIssueRepo = appDatabase.getRepository(LiveIssue);
    private liveIssueUpdatesRepo = appDatabase.getRepository(LiveIssueUpdates);
    private settingsRepo = appDatabase.getRepository(EscalationSettings);
    private readonly reviewUiSettingsKeys = {
        reviews: 'ui-settings:reviews',
        mitigation: 'ui-settings:mitigation',
        issues: 'ui-settings:issues',
        'issues-grouped': 'ui-settings:issues-grouped',
        vendors: 'ui-settings:vendors',
        'vendor-contacts': 'ui-settings:vendor-contacts',
        mitigationStatuses: 'ui-settings:mitigation-statuses',
    } as const;

    private getDefaultMitigationStatuses() {
        return ['New', 'In Progress', 'Completed'];
    }

    private async ensureSecureStayAdmin(userId: string) {
        const user = await this.usersRepo.findOne({ where: { uid: userId, deletedAt: null as any } });
        if (!user || (user.userType !== 'admin' && user.userType !== 'super admin' && !user.isSuperAdmin)) {
            throw CustomErrorHandler.forbidden('Only SecureStay admin users can update shared review settings.');
        }
        return user;
    }

    private parseSettingPayload<T>(setting?: EscalationSettings | null, fallback: T | null = null): T | null {
        if (!setting?.aiInstructions) return fallback;
        try {
            return JSON.parse(setting.aiInstructions) as T;
        } catch {
            return fallback;
        }
    }

    private async upsertJsonSetting(settingKey: string, displayName: string, payload: unknown) {
        let setting = await this.settingsRepo.findOne({ where: { settingKey } });
        if (!setting) {
            setting = this.settingsRepo.create({
                settingKey,
                displayName,
                slackChannel: null,
                eventType: null,
                aiInstructions: JSON.stringify(payload),
                aiEnabled: false,
                isActive: true,
            });
        } else {
            setting.displayName = displayName;
            setting.aiInstructions = JSON.stringify(payload);
            setting.aiEnabled = false;
            setting.isActive = true;
        }
        return this.settingsRepo.save(setting);
    }

    async getReviewUiSettings(pageKey: 'reviews' | 'mitigation' | 'issues' | 'issues-grouped' | 'vendors' | 'vendor-contacts') {
        const settingKey = this.reviewUiSettingsKeys[pageKey];
        const payload = this.parseSettingPayload<{ defaultView?: any; defaultFilter?: any }>(
            await this.settingsRepo.findOne({ where: { settingKey } }),
            {}
        ) || {};

        return {
            defaultView: payload.defaultView ?? null,
            defaultFilter: payload.defaultFilter ?? null,
        };
    }

    async updateReviewUiSettings(pageKey: 'reviews' | 'mitigation' | 'issues' | 'issues-grouped' | 'vendors' | 'vendor-contacts', payload: { defaultView?: any; defaultFilter?: any }, userId: string) {
        await this.ensureSecureStayAdmin(userId);
        const displayNames: Record<typeof pageKey, string> = {
            reviews: 'Shared Reviews UI Settings',
            mitigation: 'Shared Mitigation UI Settings',
            issues: 'Shared Issues UI Settings',
            'issues-grouped': 'Shared Grouped Issues UI Settings',
            vendors: 'Shared Vendors UI Settings',
            'vendor-contacts': 'Shared Vendor Contacts UI Settings',
        };
        await this.upsertJsonSetting(
            this.reviewUiSettingsKeys[pageKey],
            displayNames[pageKey],
            {
                defaultView: payload.defaultView ?? null,
                defaultFilter: payload.defaultFilter ?? null,
            }
        );
        return this.getReviewUiSettings(pageKey);
    }

    async getMitigationStatusOptions() {
        const payload = this.parseSettingPayload<{ options?: string[] }>(
            await this.settingsRepo.findOne({ where: { settingKey: this.reviewUiSettingsKeys.mitigationStatuses } }),
            {}
        ) || {};
        const options = Array.from(new Set((payload.options || this.getDefaultMitigationStatuses()).map((status) => String(status).trim()).filter(Boolean)));
        const usageRows = await this.reviewCheckoutRepo
            .createQueryBuilder('reviewCheckout')
            .select('reviewCheckout.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .where('reviewCheckout.deletedAt IS NULL')
            .groupBy('reviewCheckout.status')
            .getRawMany();

        const usageCounts = usageRows.reduce<Record<string, number>>((accumulator, row: { status: string; count: string }) => {
            accumulator[String(row.status || '')] = Number(row.count || 0);
            return accumulator;
        }, {});

        return {
            options,
            usageCounts,
        };
    }

    async addMitigationStatusOption(status: string, userId: string) {
        await this.ensureSecureStayAdmin(userId);
        const trimmedStatus = String(status || '').trim();
        if (!trimmedStatus) {
            throw CustomErrorHandler.validationError('Status is required.');
        }

        const current = await this.getMitigationStatusOptions();
        if (current.options.some((entry) => entry.toLowerCase() === trimmedStatus.toLowerCase())) {
            throw CustomErrorHandler.alreadyExists('That mitigation status already exists.');
        }

        await this.upsertJsonSetting(
            this.reviewUiSettingsKeys.mitigationStatuses,
            'Shared Mitigation Statuses',
            { options: [...current.options, trimmedStatus] }
        );
        return this.getMitigationStatusOptions();
    }

    async renameMitigationStatusOption(currentStatus: string, nextStatus: string, replaceExisting: boolean, userId: string) {
        await this.ensureSecureStayAdmin(userId);
        const currentName = String(currentStatus || '').trim();
        const nextName = String(nextStatus || '').trim();
        if (!currentName || !nextName) {
            throw CustomErrorHandler.validationError('Both currentStatus and nextStatus are required.');
        }

        const current = await this.getMitigationStatusOptions();
        if (!current.options.includes(currentName)) {
            throw CustomErrorHandler.notFound('Mitigation status not found.');
        }
        if (current.options.some((entry) => entry !== currentName && entry.toLowerCase() === nextName.toLowerCase())) {
            throw CustomErrorHandler.alreadyExists('That mitigation status already exists.');
        }

        const usageCount = current.usageCounts[currentName] || 0;
        if (usageCount > 0 && !replaceExisting) {
            throw CustomErrorHandler.validationError('Existing mitigation entries use this status. Confirm replacing them before editing it.');
        }

        if (usageCount > 0) {
            await this.reviewCheckoutRepo
                .createQueryBuilder()
                .update(ReviewCheckout)
                .set({ status: nextName })
                .where('status = :currentStatus', { currentStatus: currentName })
                .execute();
        }

        await this.upsertJsonSetting(
            this.reviewUiSettingsKeys.mitigationStatuses,
            'Shared Mitigation Statuses',
            {
                options: current.options.map((entry) => (entry === currentName ? nextName : entry)),
            }
        );
        return this.getMitigationStatusOptions();
    }

    async deleteMitigationStatusOption(status: string, replacementStatus: string | undefined, userId: string) {
        await this.ensureSecureStayAdmin(userId);
        const statusName = String(status || '').trim();
        const replacementName = String(replacementStatus || '').trim();
        if (!statusName) {
            throw CustomErrorHandler.validationError('Status is required.');
        }

        const current = await this.getMitigationStatusOptions();
        if (!current.options.includes(statusName)) {
            throw CustomErrorHandler.notFound('Mitigation status not found.');
        }
        if (current.options.length === 1) {
            throw CustomErrorHandler.validationError('At least one mitigation status must remain.');
        }

        const usageCount = current.usageCounts[statusName] || 0;
        if (usageCount > 0) {
            if (!replacementName || !current.options.includes(replacementName) || replacementName === statusName) {
                throw CustomErrorHandler.validationError('A valid replacementStatus is required before deleting a status that is in use.');
            }

            await this.reviewCheckoutRepo
                .createQueryBuilder()
                .update(ReviewCheckout)
                .set({ status: replacementName })
                .where('status = :statusName', { statusName })
                .execute();
        }

        await this.upsertJsonSetting(
            this.reviewUiSettingsKeys.mitigationStatuses,
            'Shared Mitigation Statuses',
            {
                options: current.options.filter((entry) => entry !== statusName),
            }
        );
        return this.getMitigationStatusOptions();
    }
    private hostifyClient = new Hostify();
    private listingRepo = appDatabase.getRepository(Listing);
    private guestAnalysisRepo = appDatabase.getRepository(GuestAnalysisEntity);
    private reservationInfoRepo = appDatabase.getRepository(ReservationInfoEntity);
    private issueRepo = appDatabase.getRepository(Issue);
    private discussionMessageRepo = appDatabase.getRepository(ReviewDiscussionMessageEntity);
    private refundRequestRepo = appDatabase.getRepository(RefundRequestEntity);
    private reservationHistoryService = new ReservationHistoryService();

    private async logReservationFieldChanges(
        reservationInfoId: number | null | undefined,
        changedBy: string,
        diff: ReservationHistoryDiff
    ) {
        if (!reservationInfoId) return;
        await this.reservationHistoryService.logChanges({
            reservationInfoId: Number(reservationInfoId),
            diff,
            changedBy,
            action: "UPDATE",
        });
    }

    private async getLatestReservationNotes(reservationIds: number[]) {
        if (!reservationIds.length) return new Map<number, ReviewDiscussionMessageEntity>();
        const messages = await this.discussionMessageRepo.find({
            where: {
                reservationId: In(reservationIds),
                sourceType: Equal("note"),
            },
            order: {
                updatedAt: "DESC",
                createdAt: "DESC",
            },
        });
        const latestByReservation = new Map<number, ReviewDiscussionMessageEntity>();
        messages.forEach((message) => {
            const reservationId = Number(message.reservationId);
            if (!reservationId || latestByReservation.has(reservationId)) return;
            latestByReservation.set(reservationId, message);
        });
        return latestByReservation;
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

    private buildSlackThreadPermalink(channelId?: string | null, messageTs?: string | null) {
        const workspaceUrl = String(process.env.SLACK_WORKSPACE_URL || "").trim();
        if (!workspaceUrl || !channelId || !messageTs) return null;
        return generateSlackMessageLink(workspaceUrl.replace(/\/$/, ""), channelId, messageTs);
    }

    private async buildLatestUpdatePayload(message: ReviewDiscussionMessageEntity | null) {
        if (!message) return null;

        let authorName = message.authorName;
        let authorAvatar = message.authorAvatar;
        if (message.authorId && message.metadata?.source !== "slack") {
            const user = await this.usersRepo.findOne({ where: { uid: message.authorId } });
            if (user) {
                const slackUsers = await getSlackUsers();
                const employee = await this.employeeRepo.findOne({
                    where: { userId: user.id, deletedAt: null as any },
                    select: ["userId", "preferredName", "profilePhoto", "slackUserId"],
                });
                const preferredName = String(employee?.preferredName || "").trim();
                authorName = preferredName || String(user.firstName || "").trim() || user.email || user.uid || message.authorName;

                const profilePhotoId = Number(employee?.profilePhoto);
                const fileInfo = !Number.isNaN(profilePhotoId) && profilePhotoId > 0
                    ? await this.fileInfoRepo.findOne({ where: { id: profilePhotoId } })
                    : null;
                const slackAvatarUrl = employee?.slackUserId
                    ? slackUsers.find((member: any) => member.id === employee.slackUserId)?.image || null
                    : null;
                authorAvatar = this.buildEmployeePhotoUrl(fileInfo) || slackAvatarUrl || authorAvatar;
            } else {
                authorName = await this.getSupabaseUserDisplayName(message.authorId) || authorName;
            }
        }

        return {
            content: message.content,
            createdAt: message.updatedAt || message.createdAt,
            authorName,
            authorAvatar,
            authorId: message.authorId || null,
        };
    }

    private async getSupabaseUserDisplayName(userId?: string | null): Promise<string | null> {
        const rawUserId = String(userId || "").trim();
        if (!rawUserId || rawUserId === "system") return rawUserId === "system" ? "System" : null;

        try {
            const { data, error } = await supabaseAdmin.auth.admin.getUserById(rawUserId);
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

    private async getLatestRefundRequests(reservationIds: number[]) {
        if (!reservationIds.length) return new Map<number, RefundRequestEntity>();
        const refunds = await this.refundRequestRepo.find({
            where: {
                reservationId: In(reservationIds),
                deletedAt: IsNull(),
            },
            order: {
                updatedAt: "DESC",
                createdAt: "DESC",
            },
        });
        const latestByReservation = new Map<number, RefundRequestEntity>();
        refunds.forEach((refund) => {
            const reservationId = Number(refund.reservationId);
            if (!reservationId || latestByReservation.has(reservationId)) return;
            latestByReservation.set(reservationId, refund);
        });
        return latestByReservation;
    }

    /**
     * Expands display-level status labels (New, In Progress, Completed) into their
     * actual DB values. Passes through any unrecognized values unchanged.
     */
    private expandMitigationStatuses(statuses: string[]): string[] {
        return Array.from(new Set(statuses));
    }

    private normalizePropertyTypeFilters(values?: string[] | string | null) {
        const arr = Array.isArray(values) ? values : (values ? [String(values)] : []);
        return Array.from(
            new Set(
                arr
                    .map((value) => String(value || '').trim().toLowerCase())
                    .flatMap((value) => {
                        if (!value) return [];
                        if (value === 'own-arb' || value === 'own / arb' || value === 'own,arb' || value === 'own+arb') {
                            return ['own', 'arb'];
                        }
                        if (value === 'own') return ['own'];
                        if (value === 'arb') return ['arb'];
                        if (value === 'pm') return ['pm'];
                        return [];
                    })
            )
        );
    }

    private normalizeServiceTypeFilters(values?: string[] | string | null) {
        const arr = Array.isArray(values) ? values : (values ? [String(values)] : []);
        return Array.from(
            new Set(
                arr
                    .map((value) => String(value || '').trim().toLowerCase())
                    .flatMap((value) => {
                        if (!value) return [];
                        if (value === 'full') return ['full'];
                        if (value === 'pro') return ['pro'];
                        if (value === 'launch') return ['launch'];
                        return [];
                    })
            )
        );
    }

    private extractServiceTypeFromTags(tags: string | null | undefined): string | null {
        const tagList = this.getNormalizedListingTagTokens(tags);
        if (tagList.includes('full') || tagList.includes('fullservice')) return 'Full';
        if (tagList.includes('pro')) return 'Pro';
        if (tagList.includes('launch')) return 'Launch';
        return null;
    }

    private mergeListingIds(current: number[] | null, incoming: Array<number | string>) {
        const normalizedIncoming = Array.from(
            new Set((incoming || []).map((value) => Number(value)).filter(Boolean))
        );

        if (current === null) return normalizedIncoming;
        return current.filter((value) => normalizedIncoming.includes(value));
    }

    private mergeNumberFilters(current: number[] | null, incoming: Array<number | string>) {
        const normalizedIncoming = Array.from(
            new Set((incoming || []).map((value) => Number(value)).filter(Boolean))
        );

        if (current === null) return normalizedIncoming;
        return current.filter((value) => normalizedIncoming.includes(value));
    }

    private getTimeZoneSnapshot(timeZoneName?: string | null) {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timeZoneName || 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const parts = formatter.formatToParts(new Date());
        const readPart = (type: string) => parts.find((part) => part.type === type)?.value || '';
        return {
            date: `${readPart('year')}-${readPart('month')}-${readPart('day')}`,
        };
    }

    private toDateString(value: unknown): string | null {
        if (!value) return null;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
            const parsed = new Date(trimmed);
            return Number.isNaN(parsed.getTime()) ? null : format(parsed, 'yyyy-MM-dd');
        }
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : format(value, 'yyyy-MM-dd');
        }
        const parsed = new Date(value as any);
        return Number.isNaN(parsed.getTime()) ? null : format(parsed, 'yyyy-MM-dd');
    }

    private isReservationCurrentlyStaying(
        reservation: Pick<ReservationInfoEntity, 'arrivalDate' | 'departureDate'>,
        listingTimeZoneName?: string | null,
    ) {
        const arrivalDate = this.toDateString(reservation.arrivalDate);
        const departureDate = this.toDateString(reservation.departureDate);
        if (!arrivalDate || !departureDate) return false;

        const timeZoneName = typeof listingTimeZoneName === 'string' && listingTimeZoneName.trim()
            ? listingTimeZoneName
            : 'America/New_York';
        const snapshot = this.getTimeZoneSnapshot(timeZoneName);
        return snapshot.date >= arrivalDate && snapshot.date <= departureDate;
    }

    private async getCurrentlyStayingReservationIds(baseReservationIds: number[] | null = null, listingIds: number[] | null = null) {
        if (baseReservationIds && baseReservationIds.length === 0) return [];
        if (listingIds && listingIds.length === 0) return [];

        const today = new Date();
        const minDate = format(addDays(today, -1), 'yyyy-MM-dd');
        const maxDate = format(addDays(today, 1), 'yyyy-MM-dd');

        const query = this.reservationInfoRepo
            .createQueryBuilder('reservation')
            .select([
                'reservation.id',
                'reservation.listingMapId',
                'reservation.arrivalDate',
                'reservation.departureDate',
                'reservation.checkInTime',
                'reservation.checkOutTime',
            ])
            .where('DATE(reservation.arrivalDate) <= :maxDate', { maxDate })
            .andWhere('DATE(reservation.departureDate) >= :minDate', { minDate });

        if (baseReservationIds !== null) {
            query.andWhere('reservation.id IN (:...baseReservationIds)', { baseReservationIds: baseReservationIds.length ? baseReservationIds : [-1] });
        }
        if (listingIds !== null) {
            query.andWhere('reservation.listingMapId IN (:...listingIds)', { listingIds: listingIds.length ? listingIds : [-1] });
        }

        const reservations = await query.getMany();
        if (!reservations.length) return [];

        const uniqueListingIds = Array.from(new Set(reservations.map((reservation) => Number(reservation.listingMapId)).filter(Boolean)));
        const listings = uniqueListingIds.length
            ? await this.listingRepo.find({ where: { id: In(uniqueListingIds) }, select: ['id', 'timeZoneName'] })
            : [];
        const listingTimeZoneMap = new Map(listings.map((listing) => [Number(listing.id), listing.timeZoneName || null]));

        return reservations
            .filter((reservation) => this.isReservationCurrentlyStaying(
                reservation,
                listingTimeZoneMap.get(Number(reservation.listingMapId)) || null,
            ))
            .map((reservation) => Number(reservation.id))
            .filter(Boolean);
    }

    private async resolveDashboardListingIds({
        listingId,
        propertyType,
    }: Pick<DashboardFilters, 'listingId' | 'propertyType'>) {
        let listingIds: number[] | null = null;

        const normalizedPropertyTypes = this.normalizePropertyTypeFilters(propertyType as string[] | null | undefined);
        if (normalizedPropertyTypes.length > 0) {
            const listingService = new ListingService();
            const propertyTypeListingIds = (await listingService.getListingsByPropertyTypes(normalizedPropertyTypes as any)).map((listing) => listing.id);
            listingIds = this.mergeListingIds(listingIds, propertyTypeListingIds);
        }

        if (listingId && listingId.length > 0) {
            listingIds = this.mergeListingIds(listingIds, listingId);
        }

        return listingIds;
    }

    private applyDashboardReservationFilters(query: any, filters: DashboardFilters, listingIds: number[] | null) {
        if (listingIds !== null) {
            query.andWhere('ri.listingMapId IN (:...listingIds)', { listingIds: listingIds.length ? listingIds : [-1] });
        }

        if (filters.channel && filters.channel.length > 0) {
            const channelIds = Array.from(new Set((filters.channel || []).map((value) => Number(value)).filter(Boolean)));
            query.andWhere('ri.channelId IN (:...channelIds)', { channelIds: channelIds.length ? channelIds : [-1] });
        }

        if (filters.fromDate && filters.toDate) {
            switch (filters.dateType) {
                case 'arrivalDate':
                    query.andWhere('DATE(ri.arrivalDate) BETWEEN :fromDate AND :toDate', { fromDate: filters.fromDate, toDate: filters.toDate });
                    break;
                case 'updatedAt':
                case 'submittedAt':
                case 'departureDate':
                default:
                    query.andWhere('DATE(ri.departureDate) BETWEEN :fromDate AND :toDate', { fromDate: filters.fromDate, toDate: filters.toDate });
                    break;
            }
        }

        return query;
    }

    private async buildDashboardUserSummaryMap(userIds: Array<string | null | undefined>) {
        const normalizedUserIds = Array.from(new Set(userIds.map((value) => String(value || '').trim()).filter(Boolean)));
        if (!normalizedUserIds.length) return new Map<string, DashboardUserSummary>();

        const users = await this.usersRepo.find({
            where: { uid: In(normalizedUserIds as any) },
            select: ['id', 'uid', 'firstName', 'lastName', 'email'],
        });
        const userByUid = new Map(users.map((user) => [user.uid, user]));
        const employees = users.length > 0
            ? await this.employeeRepo.find({
                where: { userId: In(users.map((user) => user.id)), deletedAt: null as any },
                select: ['userId', 'preferredName', 'profilePhoto', 'slackUserId'],
            })
            : [];
        const employeeByUserId = new Map(employees.map((employee) => [employee.userId, employee]));

        const profilePhotoIds = Array.from(new Set(
            employees
                .map((employee) => Number(employee.profilePhoto))
                .filter((photoId) => !Number.isNaN(photoId) && photoId > 0)
        ));
        const photoInfos = profilePhotoIds.length > 0
            ? await this.fileInfoRepo.find({ where: { id: In(profilePhotoIds) } })
            : [];
        const photoInfoById = new Map(photoInfos.map((fileInfo) => [fileInfo.id, fileInfo]));

        const slackUsers = await getSlackUsers() as Array<{ id: string; image?: string | null }>;
        const slackUserById = new Map(slackUsers.map((user) => [user.id, user]));

        const summaryMap = new Map<string, DashboardUserSummary>();
        normalizedUserIds.forEach((uid) => {
            const user = userByUid.get(uid);
            if (!user) {
                summaryMap.set(uid, {
                    uid,
                    displayName: uid,
                    fullNameTooltip: uid,
                    firstName: '',
                    lastName: '',
                    preferredName: null,
                    photoUrl: null,
                });
                return;
            }

            const employee = employeeByUserId.get(user.id);
            const firstName = String(user.firstName || '').trim();
            const lastName = String(user.lastName || '').trim();
            const preferredName = String(employee?.preferredName || '').trim() || null;
            const displayName = preferredName || firstName || user.email || uid;
            const fullNameTooltip = preferredName
                ? [firstName, `"${preferredName}"`, lastName].filter(Boolean).join(' ').trim()
                : [firstName, lastName].filter(Boolean).join(' ').trim() || user.email || uid;

            const profilePhotoId = Number(employee?.profilePhoto);
            const employeePhotoUrl = !Number.isNaN(profilePhotoId) && profilePhotoId > 0
                ? this.buildEmployeePhotoUrl(photoInfoById.get(profilePhotoId) || null)
                : null;
            const slackPhotoUrl = employee?.slackUserId
                ? slackUserById.get(employee.slackUserId)?.image || null
                : null;

            summaryMap.set(uid, {
                uid,
                displayName,
                fullNameTooltip,
                firstName,
                lastName,
                preferredName,
                photoUrl: employeePhotoUrl || slackPhotoUrl,
            });
        });

        return summaryMap;
    }

    private applyDashboardReviewFilters(query: any, filters: DashboardFilters, listingIds: number[] | null) {
        if (listingIds !== null) {
            query.andWhere('r.listingMapId IN (:...listingIds)', { listingIds: listingIds.length ? listingIds : [-1] });
        }

        if (filters.channel && filters.channel.length > 0) {
            const channelIds = Array.from(new Set((filters.channel || []).map((value) => Number(value)).filter(Boolean)));
            query.andWhere('r.channelId IN (:...channelIds)', { channelIds: channelIds.length ? channelIds : [-1] });
        }

        const allowedDateTypes = ['submittedAt', 'arrivalDate', 'departureDate', 'updatedAt'];
        if (filters.fromDate && filters.toDate && filters.dateType && allowedDateTypes.includes(filters.dateType)) {
            if (filters.dateType === 'updatedAt') {
                query.andWhere('r.updatedAt BETWEEN :fromDate AND :toDate', {
                    fromDate: `${filters.fromDate} 00:00:00`,
                    toDate: `${filters.toDate} 23:59:59`,
                });
            } else if (filters.dateType === 'submittedAt') {
                query.andWhere('DATE(r.submittedAt) BETWEEN :fromDate AND :toDate', {
                    fromDate: filters.fromDate,
                    toDate: filters.toDate,
                });
            } else {
                query.andWhere(`DATE(r.${filters.dateType}) BETWEEN :fromDate AND :toDate`, {
                    fromDate: filters.fromDate,
                    toDate: filters.toDate,
                });
            }
        }

        return query;
    }

    private applyDashboardMitigationFilters(query: any, filters: DashboardFilters, listingIds: number[] | null) {
        query.leftJoin('rc.reservationInfo', 'ri');

        if (listingIds !== null) {
            query.andWhere('ri.listingMapId IN (:...listingIds)', { listingIds: listingIds.length ? listingIds : [-1] });
        }

        if (filters.channel && filters.channel.length > 0) {
            const channelIds = Array.from(new Set((filters.channel || []).map((value) => Number(value)).filter(Boolean)));
            query.andWhere('ri.channelId IN (:...channelIds)', { channelIds: channelIds.length ? channelIds : [-1] });
        }

        if (filters.fromDate && filters.toDate) {
            switch (filters.dateType) {
                case 'arrivalDate':
                    query.andWhere('DATE(ri.arrivalDate) BETWEEN :fromDate AND :toDate', { fromDate: filters.fromDate, toDate: filters.toDate });
                    break;
                case 'departureDate':
                    query.andWhere('DATE(ri.departureDate) BETWEEN :fromDate AND :toDate', { fromDate: filters.fromDate, toDate: filters.toDate });
                    break;
                case 'updatedAt':
                    query.andWhere('rc.updatedAt BETWEEN :fromDate AND :toDate', {
                        fromDate: `${filters.fromDate} 00:00:00`,
                        toDate: `${filters.toDate} 23:59:59`,
                    });
                    break;
                case 'submittedAt':
                default:
                    query.andWhere('rc.createdAt BETWEEN :fromDate AND :toDate', {
                        fromDate: `${filters.fromDate} 00:00:00`,
                        toDate: `${filters.toDate} 23:59:59`,
                    });
                    break;
            }
        }

        return query;
    }

    public async getReviews({
        fromDate,
        toDate,
        listingId,
        page,
        limit,
        rating,
        owner,
        assignee,
        latestUpdate,
        claimResolutionStatus,
        status,
        isClaimOnly,
        keyword,
        propertyType,
        serviceType,
        dateType,
        channel,
        integration,
        sortField,
        sortDir,
        currentlyStaying,
    }) {
        try {
            let listingIds: number[] | null = null;
            const normalizedPropertyTypes = this.normalizePropertyTypeFilters(propertyType as string[] | null | undefined);
            const normalizedServiceTypes = this.normalizeServiceTypeFilters(serviceType as string[] | null | undefined);
            const selectedStatuses = Array.isArray(status)
                ? status.map((value) => String(value || '').trim()).filter(Boolean)
                : String(status || '').trim()
                    ? [String(status).trim()]
                    : [];

            // Determine listing IDs from owner name(s) if provided
            if ((!listingId || listingId.length === 0) && owner && owner.length > 0) {
                const ownerNames = Array.isArray(owner) ? owner : [owner];
                const results = await Promise.all(ownerNames.map(o => this.getListingIdsByOwnerName(o)));
                listingIds = this.mergeListingIds(listingIds, results.flat());
            }

            if (normalizedPropertyTypes.length > 0) {
                const listingService = new ListingService();
                const propertyTypeListingIds = (await listingService.getListingsByPropertyTypes(normalizedPropertyTypes as any)).map(l => l.id);
                listingIds = this.mergeListingIds(listingIds, propertyTypeListingIds);
            }

            if (normalizedServiceTypes.length > 0) {
                const listingService = new ListingService();
                const serviceTypeListingIds = (await listingService.getListingsByServiceTypes(normalizedServiceTypes as any)).map(l => l.id);
                listingIds = this.mergeListingIds(listingIds, serviceTypeListingIds);
            }

            // Add listingId(s) if provided
            if (listingId && listingId.length > 0) {
                const ids = Array.isArray(listingId) ? listingId : [listingId];
                listingIds = this.mergeListingIds(listingIds, ids);
            }

            let filteredReservationIds: number[] | null = null;

            const condition: Record<string, any> = {
                ...(listingIds !== null ? { listingMapId: In(listingIds.length > 0 ? listingIds : [-1]) } : {}),
                ...(Array.isArray(rating) && rating.length > 0 ? { rating: In(rating) } : { rating: Not(IsNull()) }),
                ...(channel && channel.length > 0 ? { channelId: In(channel) } : {}),
            };

            if (integration && integration.length > 0) {
                const integrationReservations = await this.reservationInfoRepo
                    .createQueryBuilder("reservation")
                    .select("reservation.id", "id")
                    .where(new Brackets((qb) => {
                        qb.where("reservation.integration_nickname IN (:...integration)", { integration })
                            .orWhere("reservation.source IN (:...integration)", { integration })
                            .orWhere("reservation.channelName IN (:...integration)", { integration });
                    }))
                    .getRawMany();

                const integrationReservationIds = integrationReservations.map((item: any) => Number(item.id)).filter(Boolean);
                filteredReservationIds = this.mergeNumberFilters(filteredReservationIds, integrationReservationIds);
            }

            if (assignee && assignee.length > 0) {
                const assigneeRows = await this.reviewCheckoutRepo.find({
                    where: { assignee: In(assignee as string[]) },
                    relations: ['reservationInfo'],
                });
                const assigneeReservationIds = assigneeRows
                    .map((item) => Number(item.reservationInfo?.id))
                    .filter(Boolean);
                filteredReservationIds = this.mergeNumberFilters(filteredReservationIds, assigneeReservationIds);
            }

            if (currentlyStaying === true || currentlyStaying === 'true') {
                const currentStayReservationIds = await this.getCurrentlyStayingReservationIds(filteredReservationIds, listingIds);
                filteredReservationIds = this.mergeNumberFilters(filteredReservationIds, currentStayReservationIds);
            }

            if (latestUpdate && latestUpdate.length > 0) {
                const normalizedLatestUpdate = Array.from(new Set(latestUpdate.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)));
                const hasWithUpdates = normalizedLatestUpdate.includes('with-updates');
                const hasNoUpdates = normalizedLatestUpdate.includes('no-updates');
                if (hasWithUpdates !== hasNoUpdates) {
                    const updateRows = await this.discussionMessageRepo
                        .createQueryBuilder('message')
                        .select('DISTINCT message.reservationId', 'reservationId')
                        .where('message.sourceType = :sourceType', { sourceType: 'note' })
                        .getRawMany();
                    const updateReservationIds = updateRows
                        .map((row: { reservationId: string | number | null }) => Number(row.reservationId))
                        .filter((id) => !Number.isNaN(id));

                    if (hasWithUpdates) {
                        filteredReservationIds = this.mergeNumberFilters(filteredReservationIds, updateReservationIds);
                    } else if (filteredReservationIds !== null) {
                        filteredReservationIds = filteredReservationIds.filter((id) => !updateReservationIds.includes(id));
                    } else if (updateReservationIds.length > 0) {
                        condition.reservationId = Not(In(updateReservationIds));
                    }
                }
            }

            if (filteredReservationIds !== null) {
                condition.reservationId = In(filteredReservationIds.length > 0 ? filteredReservationIds : [-1]);
            }

            const allowedDateTypes = ["submittedAt", "arrivalDate", "departureDate"];

            if (fromDate !== undefined && fromDate !== null && toDate !== undefined && toDate !== null && dateType && allowedDateTypes.includes(dateType)) {
                condition[dateType] = Between(fromDate, toDate);
            }

            const reviewDetailCondition: Record<string, any> = {};
            if (claimResolutionStatus !== undefined) {
                reviewDetailCondition.claimResolutionStatus = claimResolutionStatus;
            }

            if (selectedStatuses.length) {
                const normalizedStatuses = selectedStatuses.map((value) => value.toLowerCase());
                const explicitVisibilityMap: Record<string, string> = {
                    'awaiting review': 'Awaiting Review',
                    awaiting: 'Awaiting Review',
                    submitted: 'Submitted',
                    visible: 'Visible',
                    'no review': 'No Review',
                    'no-review': 'No Review',
                    keep: 'Keep',
                    removed: 'Removed',
                };
                const explicitVisibilityStates = Array.from(
                    new Set(
                        normalizedStatuses
                            .map((value) => explicitVisibilityMap[value])
                            .filter(Boolean)
                    )
                );

                if (normalizedStatuses.includes('hidden') && !normalizedStatuses.includes('active')) {
                    condition.isHidden = 1;
                } else if (explicitVisibilityStates.length) {
                    condition.visibility = In(explicitVisibilityStates);
                } else if (normalizedStatuses.includes('active') || normalizedStatuses.includes('keep')) {
                    condition.isHidden = 0;
                }
            }

            if (isClaimOnly && claimResolutionStatus === undefined) {
                reviewDetailCondition.claimResolutionStatus = Not("N/A");
            }

            const allowedSortFields = ['rating', 'submittedAt', 'arrivalDate', 'departureDate', 'guestName', 'channelName', 'listingName', 'createdAt', 'updatedAt'];
            const order: Record<string, 'ASC' | 'DESC'> = {};

            if (sortField && allowedSortFields.includes(sortField)) {
                order[sortField] = (sortDir === 'DESC' ? 'DESC' : 'ASC');
            } else {
                const dateColumn = (dateType && allowedDateTypes.includes(dateType)) ? dateType : "submittedAt";
                order[dateColumn] = 'DESC';
            }

            const hasReviewDetailCondition = Object.keys(reviewDetailCondition).length > 0;
            let whereClause: any = hasReviewDetailCondition
                ? { ...condition, reviewDetail: reviewDetailCondition }
                : { ...condition };

            if (keyword) {
                const keywordPattern = `%${keyword}%`;

                const [matchingReservations, matchingAnalyses, matchingIssues] = await Promise.all([
                    this.reservationInfoRepo
                        .createQueryBuilder('reservation')
                        .select('reservation.id', 'id')
                        .where(new Brackets((qb) => {
                            qb.where('reservation.guestName LIKE :keyword', { keyword: keywordPattern })
                                .orWhere('reservation.listingName LIKE :keyword', { keyword: keywordPattern })
                                .orWhere('reservation.confirmation_code LIKE :keyword', { keyword: keywordPattern })
                                .orWhere('reservation.integration_nickname LIKE :keyword', { keyword: keywordPattern })
                                .orWhere('reservation.channelName LIKE :keyword', { keyword: keywordPattern })
                                .orWhere('reservation.source LIKE :keyword', { keyword: keywordPattern });
                        }))
                        .getRawMany(),
                    this.guestAnalysisRepo
                        .createQueryBuilder('analysis')
                        .select('analysis.reservationId', 'reservationId')
                        .where(new Brackets((qb) => {
                            qb.where('analysis.summary LIKE :keyword', { keyword: keywordPattern })
                                .orWhere('analysis.sentimentReason LIKE :keyword', { keyword: keywordPattern })
                                .orWhere('CAST(analysis.flags AS CHAR) LIKE :keyword', { keyword: keywordPattern });
                        }))
                        .getRawMany(),
                    this.issueRepo
                        .createQueryBuilder('issue')
                        .select('issue.reservation_id', 'reservationId')
                        .where(new Brackets((qb) => {
                            qb.where('issue.issue_description LIKE :keyword', { keyword: keywordPattern })
                                .orWhere('issue.owner_notes LIKE :keyword', { keyword: keywordPattern })
                                .orWhere('issue.next_steps LIKE :keyword', { keyword: keywordPattern });
                        }))
                        .getRawMany(),
                ]);

                const keywordReservationIds = Array.from(new Set([
                    ...matchingReservations.map((item: any) => Number(item.id)),
                    ...matchingAnalyses.map((item: any) => Number(item.reservationId)),
                    ...matchingIssues.map((item: any) => Number(item.reservationId)),
                ].filter(Boolean)));

                const keywordConditions: any[] = [
                    { ...condition, publicReview: Like(keywordPattern), ...(hasReviewDetailCondition && { reviewDetail: reviewDetailCondition }) },
                    { ...condition, privateReview: Like(keywordPattern), ...(hasReviewDetailCondition && { reviewDetail: reviewDetailCondition }) },
                    { ...condition, guestName: Like(keywordPattern), ...(hasReviewDetailCondition && { reviewDetail: reviewDetailCondition }) },
                    { ...condition, reviewerName: Like(keywordPattern), ...(hasReviewDetailCondition && { reviewDetail: reviewDetailCondition }) },
                    { ...condition, listingName: Like(keywordPattern), ...(hasReviewDetailCondition && { reviewDetail: reviewDetailCondition }) },
                    { ...condition, channelName: Like(keywordPattern), ...(hasReviewDetailCondition && { reviewDetail: reviewDetailCondition }) },
                ];

                if (keywordReservationIds.length > 0) {
                    keywordConditions.push({
                        ...condition,
                        reservationId: In(keywordReservationIds),
                        ...(hasReviewDetailCondition && { reviewDetail: reviewDetailCondition }),
                    });
                }

                whereClause = keywordConditions;
            }

            const [reviews, totalCount] = await this.reviewRepository.findAndCount({
                where: whereClause,
                relations: ['reviewDetail', 'reviewDetail.removalAttempts'],
                skip: (page - 1) * limit,
                take: limit,
                order
            });

            // Fetch users for name mapping
            const users = await this.usersRepo.find();
            const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));

            const reservationInfoService = new ReservationInfoService();
            const reservationInfoList = await Promise.all(
                reviews.map((review) => reservationInfoService.getReservationById(review.reservationId))
            );

            const reservationIds = reviews.map((review) => Number(review.reservationId)).filter(Boolean);
            const [issues, guestAnalyses, latestNotesByReservation, latestRefundsByReservation] = await Promise.all([
                reservationIds.length > 0
                    ? this.issueRepo.find({ where: { reservation_id: In(reservationIds) } })
                    : Promise.resolve([]),
                reservationIds.length > 0
                    ? this.guestAnalysisRepo.find({ where: { reservationId: In(reservationIds) }, order: { analyzedAt: 'DESC' } })
                    : Promise.resolve([]),
                this.getLatestReservationNotes(reservationIds),
                this.getLatestRefundRequests(reservationIds),
            ]);
            const reviewCheckouts = reservationIds.length > 0
                ? await this.reviewCheckoutRepo.find({
                    where: { reservationInfo: { id: In(reservationIds) } } as any,
                    relations: ['reservationInfo'],
                })
                : [];
            const reviewCheckoutMap = new Map(reviewCheckouts.map((checkout) => [Number(checkout.reservationInfo?.id), checkout]));

            const reviewListingIds = [...new Set([
                ...reviews.map((review) => review.listingMapId),
                ...reservationInfoList.map((r) => r?.listingMapId),
            ].filter(Boolean))];
            const listings = reviewListingIds.length > 0
                ? await this.listingRepo.find({ where: { id: In(reviewListingIds) } })
                : [];
            const listingMap = new Map(listings.map((listing) => [Number(listing.id), listing]));

            const reviewList = await Promise.all(reviews.map(async (review, index) => {
                const reservationInfo = reservationInfoList[index];
                const reviewCheckout = reviewCheckoutMap.get(Number(review.reservationId));
                if (!reservationInfo) {
                    logger.warn(`Reservation not found for review with ID: ${review.id}`);
                }

                const listing = listingMap.get(Number(review.listingMapId))
                    || listingMap.get(Number(reservationInfo?.listingMapId));
                const propertyType = this.getReviewPropertyType(listing);
                const serviceType = this.extractServiceTypeFromTags(listing?.tags);
                const confirmationCode = this.getReviewConfirmationCode(review as any, reservationInfo as any);
                const integration = this.getReviewIntegration(review as any, reservationInfo as any);
                const arrivalDate = this.normalizeReviewDate(reservationInfo?.arrivalDate || review.arrivalDate);
                const departureDate = this.normalizeReviewDate(reservationInfo?.departureDate || review.departureDate);
                const latestUpdate = await this.buildLatestUpdatePayload(
                    latestNotesByReservation.get(Number(review.reservationId)) || null
                );
                const latestRefund = latestRefundsByReservation.get(Number(review.reservationId)) || null;
                const slackThreadPermalink = this.buildSlackThreadPermalink(reviewCheckout?.slackChannelId || null, reviewCheckout?.slackThreadTs || null);
                const ownerRevenue = reservationInfo?.owner_revenue ?? null;
                const refundAmount = latestRefund?.refundAmount ?? null;
                const refundPercent = ownerRevenue && refundAmount
                    ? Math.round((Number(refundAmount) / Number(ownerRevenue)) * 100)
                    : null;

                return {
                    ...review,
                    arrivalDate,
                    departureDate,
                    propertyType,
                    serviceType,
                    confirmationCode,
                    integration,
                    status: reviewCheckout?.status || null,
                    issues: issues.filter((issue) => Number(issue.reservation_id) === Number(review.reservationId)) || [],
                    aiAnalysis: guestAnalyses.find((analysis) => Number(analysis.reservationId) === Number(review.reservationId)) || null,
                    guestPhone: reservationInfo?.phone || null,
                    bookingAmount: reservationInfo?.totalPrice || null,
                    ownerRevenue,
                    checkInTime: reservationInfo?.checkInTime ?? null,
                    checkOutTime: reservationInfo?.checkOutTime ?? listing?.checkOutTime ?? null,
                    timeZoneName: listing?.timeZoneName ?? 'America/New_York',
                    guestEmail: reservationInfo?.guestEmail || null,
                    createdByName: userMap.get(review.createdBy) || review.createdBy || null,
                    updatedByName: userMap.get(review.updatedBy) || review.updatedBy || null,
                    reviewCheckoutId: reviewCheckout?.id || null,
                    slackThreadPermalink,
                    assignee: reviewCheckout?.assignee || null,
                    assigneeName: reviewCheckout?.assignee ? (userMap.get(reviewCheckout.assignee) || reviewCheckout.assignee) : null,
                    resolutionNotes: reviewCheckout?.comments || null,
                    latestUpdate,
                    refundAmount,
                    refundRequestId: latestRefund?.id ?? null,
                    refundStatus: latestRefund?.status ?? null,
                    refundExplanation: latestRefund?.explaination ?? null,
                    refundPercent,
                };
            }));

            return { reviewList, totalCount };
        } catch (error) {
            logger.error(`Failed to get reviews`, error);
            throw error;
        }
    }

    private normalizeReviewDate(value?: string | Date | null) {
        if (!value) return null;
        try {
            if (typeof value === 'string') {
                const dateOnlyMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
                if (dateOnlyMatch) return dateOnlyMatch[1];
            }
            return format(new Date(value), 'yyyy-MM-dd');
        } catch {
            return typeof value === 'string' ? value : null;
        }
    }

    private getReviewPropertyType(listing?: Listing | null) {
        return this.extractPropertyTypeFromTags(listing?.tags);
    }

    private getReviewIntegration(review?: any, reservationInfo?: any) {
        return reservationInfo?.integration_nickname || reservationInfo?.source || reservationInfo?.channelName || review?.channelName || null;
    }

    private getReviewConfirmationCode(review?: any, reservationInfo?: any) {
        return review?.externalReservationId || reservationInfo?.channelReservationId || reservationInfo?.hostawayReservationId || null;
    }



    private extractPropertyTypeFromTags(tags: string | null | undefined): string | null {
        const tagList = this.getNormalizedListingTagTokens(tags);
        if (tagList.includes('own') || tagList.includes('owned') || tagList.includes('owner') || tagList.includes('ownarb')) return 'Own';
        if (tagList.includes('arb') || tagList.includes('arbitrage')) return 'Arb';
        if (tagList.includes('pm')) return 'PM';
        return null;
    }

    private getNormalizedListingTagTokens(tags: string | null | undefined): string[] {
        return String(tags || '')
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[;/]/g, ',')
            .split(',')
            .map((tag) => tag.replace(/-/g, ''))
            .filter(Boolean);
    }

    private applyNumberRangeFilter(
        query: any,
        column: string,
        paramPrefix: string,
        operator?: string | null,
        minValue?: string | number | null,
        maxValue?: string | number | null,
    ) {
        const op = String(operator || '').trim();
        if (!op) return;
        const min = Number(minValue);
        const max = Number(maxValue);
        if ((op === 'gt' || op === 'lt' || op === 'eq') && Number.isNaN(min)) return;
        if (op === 'between' && (Number.isNaN(min) || Number.isNaN(max))) return;
        if (op === 'gt') query.andWhere(`${column} > :${paramPrefix}Min`, { [`${paramPrefix}Min`]: min });
        if (op === 'lt') query.andWhere(`${column} < :${paramPrefix}Min`, { [`${paramPrefix}Min`]: min });
        if (op === 'eq') query.andWhere(`${column} = :${paramPrefix}Min`, { [`${paramPrefix}Min`]: min });
        if (op === 'between') query.andWhere(`${column} BETWEEN :${paramPrefix}Min AND :${paramPrefix}Max`, { [`${paramPrefix}Min`]: min, [`${paramPrefix}Max`]: max });
    }

    private async getListingIdsByOwnerName(ownerName: string) {
        const listingIds = await this.ownerInfoRepository
            .createQueryBuilder("owner")
            .select("owner.listingId", "listingId") // Select only listingId
            .where("owner.ownerName = :ownerName", { ownerName })
            .andWhere("owner.ownerName IS NOT NULL AND owner.ownerName != ''") // Ensure ownerName is valid
            .getRawMany();

        return listingIds.map(item => item.listingId); // Extract listingId values as an array
    }


    public async updateReviewVisibility(reviewVisibility: string, id: string, userId: string) {
        const VALID_STATUSES = ['Awaiting Review', 'Submitted', 'Visible', 'No Review', 'Keep', 'Removed', 'Archived'];
        if (!VALID_STATUSES.includes(reviewVisibility)) {
            throw CustomErrorHandler.validationError(`Invalid visibility status: ${reviewVisibility}`);
        }
        const review = await this.reviewRepository.findOne({ where: { id } });
        if (!review) {
            throw CustomErrorHandler.notFound(`Review not found with id: ${id}`);
        }

        const previousVisibility = review.visibility ?? null;
        const previousHiddenState = review.isHidden;
        review.visibility = reviewVisibility;
        review.isHidden = reviewVisibility === 'Removed' ? 1 : 0;
        review.updatedAt = new Date();
        review.updatedBy = userId;
        await this.reviewRepository.save(review);

        await this.logReservationFieldChanges(review.reservationId, userId, {
            visibility: { old: previousVisibility, new: review.visibility ?? null },
            isHidden: { old: previousHiddenState, new: review.isHidden },
        });

        if (previousVisibility !== review.visibility) {
            const reviewCheckout = await this.reviewCheckoutRepo.findOne({
                where: { reservationInfo: { id: Number(review.reservationId) } },
            });
            if (reviewCheckout?.slackThreadTs) {
                new ResolutionsTeamSlackService().postActivityToThread(reviewCheckout.id, {
                    type: 'visibility',
                    actor: userId,
                    oldValue: previousVisibility,
                    newValue: review.visibility ?? '',
                }).catch((err) => logger.error('[ReviewService] Slack visibility activity post failed:', err));
            }
        }

        return review;
    }

    private applyAutoVisibility(review: ReviewEntity): void {
        // Only auto-assign if no one has manually set it (updatedBy is null/undefined)
        if (review.updatedBy) return;

        const today = new Date();
        const checkout = review.departureDate ? new Date(review.departureDate) : null;
        if (!checkout) return;

        const daysSinceCheckout = Math.floor((today.getTime() - checkout.getTime()) / (1000 * 60 * 60 * 24));
        const isVrbo = (review.channelName || '').toLowerCase().includes('vrbo');
        const noReviewThreshold = isVrbo ? 180 : 14;
        const hasReview = !!(review.publicReview || review.privateReview || review.rating);

        if (hasReview) {
            review.visibility = 'Visible';
            review.isHidden = 0;
        } else if (daysSinceCheckout <= 14) {
            review.visibility = 'Awaiting Review';
            review.isHidden = 0;
        } else if (daysSinceCheckout > noReviewThreshold) {
            review.visibility = 'No Review';
            review.isHidden = 0;
        }
        // else: between 14 days and VRBO threshold — leave as Awaiting Review
    }

    private async postReviewPublishedToSlack(review: ReviewEntity) {
        const reviewText = String(review.publicReview || "").trim();
        const ratingValue = Number(review.rating);
        if (!review.reservationId || !reviewText || !Number.isFinite(ratingValue)) {
            return;
        }

        try {
            const reviewCheckout = await this.reviewCheckoutRepo.findOne({
                where: { reservationInfo: { id: Number(review.reservationId) } },
                select: ["id", "slackThreadTs"],
            });

            if (!reviewCheckout?.slackThreadTs) {
                return;
            }

            await new ResolutionsTeamSlackService().postActivityToThread(reviewCheckout.id, {
                type: "review_posted",
                details: reviewText,
                rating: ratingValue,
            });
        } catch (error) {
            logger.error("[ReviewService] Failed to post review-published message to Slack:", error);
        }
    }


    // fetch all reviews from the hostaway and save it in the database
    public async syncReviews() {

        try {
            const CLIENT_ID = process.env.HOST_AWAY_CLIENT_ID;
            const CLIENT_SECRET = process.env.HOST_AWAY_CLIENT_SECRET;

            const reviews = await this.hostawayClient.getAllReviews(
                CLIENT_ID,
                CLIENT_SECRET
            );

            // Check if reviews were fetched successfully
            if (!reviews || reviews.length === 0) {
                logger.info("No reviews fetched from HostAway.");
                return;
            }

            const reservationService = new ReservationService();
            const channelList = await reservationService.getChannelList();

            // save the reviews in the database
            for (const reviewData of reviews) {
                // Check if the review already exists in the database
                const existingReview = await this.reviewRepository.findOne({
                    where: { id: reviewData.id },
                });

                if (existingReview) {
                    const hadPostedReview = Boolean(existingReview.publicReview && existingReview.rating);
                    // Update the existing review
                    existingReview.reviewerName = reviewData.reviewerName;
                    existingReview.channelId = reviewData.channelId;
                    existingReview.rating = reviewData.rating;
                    existingReview.externalReservationId = reviewData.externalReservationId;
                    existingReview.publicReview = reviewData.publicReview;
                    existingReview.submittedAt = reviewData.submittedAt;
                    existingReview.arrivalDate = reviewData.arrivalDate;
                    existingReview.departureDate = reviewData.departureDate;
                    existingReview.listingName = reviewData.listingName;
                    existingReview.externalListingName = reviewData.externalListingName;
                    existingReview.guestName = reviewData.guestName;
                    existingReview.listingMapId = reviewData.listingMapId;
                    existingReview.channelName = channelList.find(channel => channel.channelId == reviewData.channelId).channelName;
                    existingReview.isHidden = existingReview.updatedBy ? existingReview.isHidden : (reviewData?.isHidden || 0);
                    existingReview.reservationId = reviewData?.reservationId || null;
                    this.applyAutoVisibility(existingReview);
                    await this.reviewRepository.save(existingReview);
                    if (!hadPostedReview && existingReview.publicReview && existingReview.rating) {
                        await this.postReviewPublishedToSlack(existingReview);
                    }

                    if (existingReview.rating != 10 && reviewData.rating == 10) {
                        await this.process5StarRatings(reviewData);
                    }

                } else {
                    // Create a new review entity and save it
                    const newReview = this.reviewRepository.create({
                        id: reviewData.id,
                        reviewerName: reviewData.reviewerName,
                        channelId: reviewData.channelId,
                        rating: reviewData.rating,
                        externalReservationId: reviewData.externalReservationId,
                        publicReview: reviewData.publicReview,
                        submittedAt: reviewData.submittedAt,
                        arrivalDate: reviewData.arrivalDate,
                        departureDate: reviewData.departureDate,
                        listingName: reviewData.listingName,
                        externalListingName: reviewData.externalListingName,
                        guestName: reviewData.guestName,
                        listingMapId: reviewData.listingMapId,
                        channelName: channelList.find(channel => channel.channelId == reviewData.channelId).channelName,
                        isHidden: reviewData?.isHidden || 0,
                        reservationId: reviewData?.reservationId || null,
                    });
                    this.applyAutoVisibility(newReview);
                    await this.reviewRepository.save(newReview);
                    if (newReview.publicReview && newReview.rating) {
                        await this.postReviewPublishedToSlack(newReview);
                    }

                    //check if there is active claim of the reviewer
                    await this.checkForActiveClaim(newReview);

                    if (reviewData.rating == 10) {
                        await this.process5StarRatings(reviewData);
                    }
                }
            }
        } catch (error) {
            logger.error("Error syncing reviews:", error);
            throw error;
        }
    }

    public async syncHostifyReviews() {

        try {
            const apiKey = process.env.HOSTIFY_API_KEY;

            const reviews = await this.hostifyClient.getReviews(apiKey);

            // Check if reviews were fetched successfully
            if (!reviews || reviews.length === 0) {
                logger.info("No reviews fetched from Hostify.");
                return;
            }

            const reservationInfoService = new ReservationInfoService();

            // save the reviews in the database
            for (const reviewData of reviews) {
                // Check if the review already exists in the database
                const existingReview = await this.reviewRepository.findOne({
                    where: { id: reviewData.id },
                });

                if (!existingReview) {
                    const reservationInfo = await reservationInfoService.getReservationById(reviewData.reservation_id);
                    if (!reservationInfo) {
                        logger.warn(`Reservation not found for review with ID: ${reviewData.id}`);
                        continue;
                    }
                    // Create a new review entity and save it
                    const newReview = this.reviewRepository.create({
                        id: reviewData.id,
                        reviewerName: reservationInfo.guestName,
                        channelId: reservationInfo.channelId,
                        rating: reservationInfo.channelName == "Booking.com" ? reviewData.rating / 2 : reviewData.rating,
                        externalReservationId: null,
                        publicReview: reviewData.comments,
                        submittedAt: reviewData.review_published_at,
                        arrivalDate: format(reservationInfo.arrivalDate, "yyyy-MM-dd"),
                        departureDate: format(reservationInfo.departureDate, "yyyy-MM-dd"),
                        listingName: reservationInfo.listingName,
                        externalListingName: null,
                        guestName: reservationInfo.guestName,
                        listingMapId: reservationInfo.listingMapId,
                        channelName: reservationInfo.channelName,
                        isHidden: reviewData?.isHidden || 0,
                        reservationId: reviewData?.reservation_id || null,
                        privateReview: reviewData?.feedback || null,
                    });
                    this.applyAutoVisibility(newReview);
                    await this.reviewRepository.save(newReview);
                    if (newReview.publicReview && newReview.rating) {
                        await this.postReviewPublishedToSlack(newReview);
                    }

                    //check if there is active claim of the reviewer
                    await this.checkForActiveClaim(newReview);

                    if (
                        (reservationInfo.channelName == "Booking.com" && reviewData.rating == 10) ||
                        (reservationInfo.channelName != "Booking.com" && reviewData.rating == 5)
                    ) {
                        await this.process5StarRatings(reviewData);
                    }
                }
            }
        } catch (error) {
            logger.error("Error syncing reviews:", error);
            throw error;
        }
    }

    async checkForActiveClaim(review: ReviewEntity) {
        const claim = await this.claimRepo.findOne({
            where: {
                reservation_id: String(review.reservationId),
                status: "In Progress"
            }
        });
        if (!claim) return;
        const slackMessage = buildClaimReviewReceivedMessage(claim, review);
        await sendSlackMessage(slackMessage);
    }

    async checkForUnresolvedReviews() {
        const reviews = await this.reviewRepository.find({
            where: {
                isHidden: 0
            },
            order: {
                rating: 'ASC',
                submittedAt: 'DESC',
            },
        });
        const processedReviews = this.processUnresolvedReviews(reviews);
        const unresolvedReviewsFor3PlusDays = processedReviews.filter(review => review.unresolvedForMoreThanThreeDays);
        if (unresolvedReviewsFor3PlusDays.length > 0) {
            //send email
            await this.sendEmailForUnresolvedReviews(unresolvedReviewsFor3PlusDays);
        }
    }

    processUnresolvedReviews(reviews: ReviewEntity[]): ProcessedReview[] {
        return reviews
            .filter(review => review.submittedAt) // Exclude reviews without submittedAt
            .map(review => {
                const submittedDate = new Date(review.submittedAt);
                const currentDate = new Date();
                const diffInDays = Math.floor((currentDate.getTime() - submittedDate.getTime()) / (1000 * 60 * 60 * 24));

                return {
                    ...review,
                    unresolvedForMoreThanThreeDays: diffInDays > 3 && review.rating < 5,
                    unresolvedForMoreThanSevenDays: diffInDays > 7 && review.rating < 5,
                };
            });
    };

    private async sendEmailForUnresolvedReviews(reviews: ProcessedReview[]) {

        const subject = `Reminder: You Have ${reviews.length} Unresolved Reviews Awaiting Action`;
        const html = `
<html>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333; margin: 0;">
    <div style="width: 100%; background: #fff; padding: 30px; border-bottom: 1px solid #ddd;">
      <h2 style="color: #0056b3; font-size: 22px; margin-bottom: 20px; text-align: center; border-bottom: 2px solid #0056b3; padding-bottom: 10px;">
        Notification: Unresolved Guest Reviews
      </h2>
      <p style="margin: 20px 0; font-size: 16px; color: #555; text-align: center;">
        The following guest reviews require your attention. Please review them and take necessary action.
      </p>

      <!-- Scrollable Table Wrapper (Full Width) -->
      <div style="overflow-x: auto; width: 100%;">
        <table style="min-width: 1000px; border-collapse: collapse; width: 100%;">
          <thead>
            <tr>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Guest Name</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Arrival Date</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Departure Date</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Rating</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Public Review</th>
            </tr>
          </thead>
          <tbody>
            ${reviews.map(review => `
              <tr>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${review.guestName}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${review.arrivalDate}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${review.departureDate}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; font-weight: bold; color: ${review.rating < 5 ? 'red' : 'green'}; white-space: nowrap;">${review.rating}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd;">${review.publicReview}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <p style="margin: 20px 0; font-size: 16px; color: #555; text-align: center;">
        Please take action on these unresolved reviews as soon as possible.
      </p>
    </div>
  </body>
</html>
        `;

        await sendEmail(subject, html, process.env.EMAIL_FROM, "admin@luxurylodgingpm.com");
    }

    public async saveReview(body: CreateReview, userId: string) {
        const { reservationId, reviewerName, rating, publicReview, status } = body;

        const reservationInfoService = new ReservationInfoService();
        const reservationInfo = await reservationInfoService.getReservationById(reservationId);
        if (!reservationInfo) {
            throw CustomErrorHandler.notFound('Reservation not found');
        }

        const reviewObj = {
            id: uuidv4(),
            reviewerName,
            listingMapId: reservationInfo.listingMapId,
            channelId: reservationInfo.channelId,
            channelName: reservationInfo.channelName,
            rating,
            publicReview,
            arrivalDate: String(reservationInfo.arrivalDate),
            departureDate: String(reservationInfo.departureDate),
            listingName: reservationInfo.listingName,
            guestName: reservationInfo.guestName,
            isHidden: status == "active" ? 0 : 1,
            bookingAmount: reservationInfo.totalPrice,
            reservationId,
            createdBy: userId
        };
        return await this.createReview(reviewObj);
    }

    private async createReview(obj: any) {
        const newReview = this.reviewRepository.create(obj);
        return await this.reviewRepository.save(newReview);
    }

    private async process5StarRatings(review) {
        const reviewerName = review.reviewerName;
        const listingMapId = review.listingMapId;
        const rating = 5.0;
        const reviewId = review.id;

        try {
            const url = `${process.env.OWNER_PORTAL_API_BASE_URL}/new-review`;
            const body = {
                reviewerName,
                listingMapId,
                rating,
                reviewId
            };
            const response = await axios.post(url, body, {
                headers: {
                    "x-internal-source": "securestay.ai"
                }
            });

            if (response.status !== 200) {
                logger.error(`[process5StarRatings] Response status: ${response.status}`);
                logger.error(`[process5StarRatings] Failed to send notification to mobile user for new review by ${reviewerName}`);
            }

            logger.info(`[process5StarRatings] Processed notification to mobile user for new review by ${reviewerName}`);
            return response.data;
        } catch (error) {
            logger.error(error);
            logger.error('[process5StarRatings] Failed to send notification to mobile user for new review');
            return null;
        }

    }

    /**
     * Get reviews for checkout with tab-based filtering
     * 
     * API Usage Examples:
     * 
     * 1. TODAY TAB:
     *    - Shows status = 'New'
     *    - Parameters: { tab: 'today', page: 1, limit: 10 }
     *
     * 2. ACTIVE TAB:
     *    - Shows status = 'In Progress'
     *    - Parameters: { tab: 'active', page: 1, limit: 10 }
     *
     * 3. CLOSED TAB:
     *    - Shows status = 'Completed'
     *    - Parameters: { tab: 'closed', page: 1, limit: 10 }
     * 
     * Additional filters work with all tabs:
     * - listingMapId: Filter by specific listing IDs
     * - guestName: Filter by guest name (partial match)
     * - channel: Filter by channel IDs
     * - actionItemsStatus: Filter action items by status
     * - issuesStatus: Filter issues by status
     */
    async getReviewsForCheckout(filters: Filter, userId: string) {
        const {
            page, limit,
            listingMapId: rawListingMapId,
            guestName,
            actionItemsStatus: rawActionItemsStatus,
            issuesStatus: rawIssuesStatus,
            channel: rawChannel,
            todayDate, status: rawStatus, isActive, tab, keyword,
            propertyType, serviceType,
            integration: rawIntegration,
            assignee: rawAssignee,
            fromDate, toDate, dateType,
            sentiment: rawSentiment,
            latestUpdate: rawLatestUpdate,
            visibility: rawVisibility,
            operationalFlags: rawOperationalFlags,
            owner: rawOwner,
            isClaimOnly,
            refundStatus: rawRefundStatus,
            rating: rawRating,
            currentlyStaying,
            reservationId,
            confirmationCode,
            totalPaidOperator,
            totalPaidMin,
            totalPaidMax,
            ownerPayoutOperator,
            ownerPayoutMin,
            ownerPayoutMax,
            latestUpdateSearch,
            resolutionNotes: rawResolutionNotes,
            resolutionNotesSearch,
            issuesEntry: rawIssuesEntry,
            issueCategory: rawIssueCategory,
            issueDescriptionSearch,
            aiRedFlag: rawAiRedFlag,
            aiGreenFlag: rawAiGreenFlag,
            aiAnalysis: rawAiAnalysis,
            aiAnalysisSearch,
            publicReviewSearch,
        } = filters;

        // qs parses a single repeated query param as a string, not an array.
        // Normalize every array filter here so the rest of the function can
        // safely call .map(), .forEach(), and TypeORM IN bindings on them.
        const toArr = <T>(v: T | T[] | null | undefined): T[] =>
            v == null || (v as any) === '' ? [] : Array.isArray(v) ? v : [v as T];
        const listingMapId = toArr(rawListingMapId);
        const channel = toArr(rawChannel);
        const integration = toArr(rawIntegration);
        const assignee = toArr(rawAssignee);
        const status = toArr(rawStatus);
        const sentiment = toArr(rawSentiment);
        const latestUpdate = toArr(rawLatestUpdate);
        const visibility = toArr(rawVisibility);
        const operationalFlags = toArr(rawOperationalFlags);
        const owner = toArr(rawOwner);
        const refundStatus = toArr(rawRefundStatus);
        const rating = toArr(rawRating);
        const resolutionNotes = toArr(rawResolutionNotes);
        const issuesEntry = toArr(rawIssuesEntry);
        const issueCategory = toArr(rawIssueCategory);
        const aiRedFlag = toArr(rawAiRedFlag);
        const aiGreenFlag = toArr(rawAiGreenFlag);
        const aiAnalysis = toArr(rawAiAnalysis);
        const actionItemsStatus = toArr(rawActionItemsStatus);
        const issuesStatus = toArr(rawIssuesStatus);
        const requestedReservationId = reservationId != null && reservationId !== ''
            ? Number(reservationId)
            : null;

        const normalizedPropertyTypes = this.normalizePropertyTypeFilters(propertyType as string[] | null | undefined);
        const normalizedServiceTypes = this.normalizeServiceTypeFilters(serviceType as string[] | null | undefined);

        //fetch reviewCheckoutList
        const query = this.reviewCheckoutRepo
            .createQueryBuilder("reviewCheckout")
            .leftJoinAndSelect("reviewCheckout.reservationInfo", "reservationInfo")
            .leftJoinAndSelect("reviewCheckout.reviewCheckoutUpdates", "reviewCheckoutUpdates");

        if (requestedReservationId && Number.isFinite(requestedReservationId)) {
            query.andWhere("reservationInfo.id = :requestedReservationId", { requestedReservationId });
        }

        if (currentlyStaying === true || currentlyStaying === 'true') {
            const currentStayReservationIds = await this.getCurrentlyStayingReservationIds(
                null,
                listingMapId.length > 0 ? listingMapId.map((id) => Number(id)).filter(Boolean) : null,
            );
            query.andWhere(
                currentStayReservationIds.length > 0 ? 'reservationInfo.id IN (:...currentStayReservationIds)' : '1 = 0',
                currentStayReservationIds.length > 0 ? { currentStayReservationIds } : {},
            );
        }

        // Tab-based filtering logic
        if (tab) {
            switch (tab.toLowerCase()) {
                case 'today':
                    query.andWhere("reviewCheckout.status = :newStatus", { newStatus: ReviewCheckoutStatus.NEW });
                    break;

                case 'active':
                    query.andWhere("reviewCheckout.status = :inProgressStatus", { inProgressStatus: ReviewCheckoutStatus.IN_PROGRESS });
                    break;

                case 'closed':
                    query.andWhere("reviewCheckout.status = :completedStatus", { completedStatus: ReviewCheckoutStatus.COMPLETED });
                    break;

                default:
                    // If tab is provided but not recognized, use existing status filter logic
                    if (status && status.length > 0) {
                        const expandedStatuses = this.expandMitigationStatuses(status as string[]);
                        query.andWhere("reviewCheckout.status IN (:...status)", { status: expandedStatuses });
                    }
                    break;
            }
        } else {
            // Legacy status filter (when no tab is specified)
            if (status && status.length > 0) {
                const expandedStatuses = this.expandMitigationStatuses(status as string[]);
                query.andWhere("reviewCheckout.status IN (:...status)", { status: expandedStatuses });
            } else {
                // By default, exclude Archived records unless explicitly requested
                query.andWhere("(reviewCheckout.status != :archivedStatus OR reviewCheckout.status IS NULL)", { archivedStatus: 'Archived' });
            }
        }

        // Property type filter — resolve to listing IDs first, then apply listing filter
        if (normalizedPropertyTypes.length > 0) {
            const listingService = new ListingService();
            const propertyTypeListings = await listingService.getListingsByPropertyTypes(normalizedPropertyTypes as any);
            const propertyTypeListingIds = propertyTypeListings.map((l: any) => Number(l.id));
            if (listingMapId && listingMapId.length > 0) {
                const requestedIds = listingMapId.map(id => Number(id));
                const intersected = requestedIds.filter(id => propertyTypeListingIds.includes(id));
                query.andWhere("reservationInfo.listingMapId IN (:...ptListingIds)", { ptListingIds: intersected.length > 0 ? intersected : [-1] });
            } else {
                query.andWhere(
                    propertyTypeListingIds.length > 0
                        ? "reservationInfo.listingMapId IN (:...ptListingIds)"
                        : "1 = 0",
                    propertyTypeListingIds.length > 0 ? { ptListingIds: propertyTypeListingIds } : {}
                );
            }
        } else if (listingMapId && listingMapId.length > 0) {
            query.andWhere("reservationInfo.listingMapId IN (:...listingMapId)", { listingMapId: listingMapId.map(id => Number(id)) });
        }

        // Service type filter — independently resolves to listing IDs and applies as additional AND constraint
        if (normalizedServiceTypes.length > 0) {
            const listingService = new ListingService();
            const serviceTypeListings = await listingService.getListingsByServiceTypes(normalizedServiceTypes as any);
            const serviceTypeListingIds = serviceTypeListings.map((l: any) => Number(l.id));
            query.andWhere(
                serviceTypeListingIds.length > 0
                    ? "reservationInfo.listingMapId IN (:...stListingIds)"
                    : "1 = 0",
                serviceTypeListingIds.length > 0 ? { stListingIds: serviceTypeListingIds } : {}
            );
        }

        // Guest name filter
        if (guestName) {
            query.andWhere("reservationInfo.guestName LIKE :guestName", { guestName: `${guestName}%` });
        }

        if (confirmationCode) {
            query.andWhere("reservationInfo.confirmation_code LIKE :confirmationCode", { confirmationCode: `%${confirmationCode}%` });
        }

        this.applyNumberRangeFilter(query, "reservationInfo.totalPrice", "totalPaid", totalPaidOperator, totalPaidMin, totalPaidMax);
        this.applyNumberRangeFilter(query, "reservationInfo.owner_revenue", "ownerPayout", ownerPayoutOperator, ownerPayoutMin, ownerPayoutMax);

        // Channel filter
        if (channel && channel.length > 0) {
            query.andWhere("reservationInfo.channelId IN (:...channel)", { channel: channel.map(id => Number(id)) });
        }

        if (integration && integration.length > 0) {
            query.andWhere(new Brackets(qb => {
                qb.where("reservationInfo.integration_nickname IN (:...integration)", { integration })
                    .orWhere("reservationInfo.source IN (:...integration)", { integration })
                    .orWhere("reservationInfo.channelName IN (:...integration)", { integration });
            }));
        }

        if (assignee && assignee.length > 0) {
            query.andWhere("reviewCheckout.assignee IN (:...assignee)", { assignee });
        }

        if (latestUpdate && latestUpdate.length > 0) {
            const normalizedLatestUpdate = Array.from(new Set(latestUpdate.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)));
            const hasWithUpdates = normalizedLatestUpdate.includes('with-updates');
            const hasNoUpdates = normalizedLatestUpdate.includes('no-updates');
            if (hasWithUpdates !== hasNoUpdates) {
                const updateRows = await this.discussionMessageRepo
                    .createQueryBuilder('message')
                    .select('DISTINCT message.reservationId', 'reservationId')
                    .where('message.sourceType = :sourceType', { sourceType: 'note' })
                    .getRawMany();
                const updateReservationIds = updateRows.map((row: { reservationId: string | number | null }) => Number(row.reservationId)).filter((id) => !Number.isNaN(id));
                if (hasWithUpdates) {
                    query.andWhere(
                        updateReservationIds.length > 0 ? 'reservationInfo.id IN (:...updateReservationIds)' : '1 = 0',
                        updateReservationIds.length > 0 ? { updateReservationIds } : {},
                    );
                } else if (updateReservationIds.length > 0) {
                    query.andWhere('reservationInfo.id NOT IN (:...updateReservationIds)', { updateReservationIds });
                }
            }
        }

        if (latestUpdateSearch) {
            const updateRows = await this.discussionMessageRepo
                .createQueryBuilder('message')
                .select('DISTINCT message.reservationId', 'reservationId')
                .where('message.sourceType = :sourceType', { sourceType: 'note' })
                .andWhere('message.body LIKE :latestUpdateSearch', { latestUpdateSearch: `%${latestUpdateSearch}%` })
                .getRawMany();
            const updateReservationIds = updateRows.map((row: { reservationId: string | number | null }) => Number(row.reservationId)).filter((id) => !Number.isNaN(id));
            query.andWhere(
                updateReservationIds.length > 0 ? 'reservationInfo.id IN (:...latestUpdateSearchIds)' : '1 = 0',
                updateReservationIds.length > 0 ? { latestUpdateSearchIds: updateReservationIds } : {},
            );
        }

        if (resolutionNotes.length > 0) {
            const wantsWith = resolutionNotes.includes('with-entry');
            const wantsNo = resolutionNotes.includes('no-entry');
            if (wantsWith !== wantsNo) {
                query.andWhere(wantsWith
                    ? "(reviewCheckout.comments IS NOT NULL AND TRIM(reviewCheckout.comments) != '')"
                    : "(reviewCheckout.comments IS NULL OR TRIM(reviewCheckout.comments) = '')");
            }
        }

        if (resolutionNotesSearch) {
            query.andWhere("reviewCheckout.comments LIKE :resolutionNotesSearch", { resolutionNotesSearch: `%${resolutionNotesSearch}%` });
        }

        if (fromDate && toDate && ['submittedAt', 'updatedAt'].includes(String(dateType))) {
            const matchingReviewRows = await this.reviewRepository
                .createQueryBuilder('review')
                .select('DISTINCT review.reservationId', 'reservationId')
                .where('review.isHidden = :isHidden', { isHidden: 0 })
                .andWhere(`DATE(review.${dateType}) BETWEEN :fromDate AND :toDate`, { fromDate, toDate })
                .getRawMany();

            const matchingReservationIds = matchingReviewRows
                .map((row: { reservationId: string | number | null }) => Number(row.reservationId))
                .filter((id) => !Number.isNaN(id));

            if (!matchingReservationIds.length) {
                query.andWhere('1 = 0');
            } else {
                query.andWhere('reservationInfo.id IN (:...matchingReservationIds)', { matchingReservationIds });
            }
        } else if (fromDate && toDate && ['arrivalDate', 'departureDate'].includes(String(dateType))) {
            query.andWhere(`DATE(reservationInfo.${dateType}) BETWEEN :fromDate AND :toDate`, { fromDate, toDate });
        } else if (fromDate && toDate && dateType === 'refundedAt') {
            const refundDateRows = await this.refundRequestRepo
                .createQueryBuilder('refund')
                .select('DISTINCT refund.reservationId', 'reservationId')
                .where('DATE(refund.updatedAt) BETWEEN :fromDate AND :toDate', { fromDate, toDate })
                .getRawMany();
            const refundDateIds = refundDateRows.map((r: any) => Number(r.reservationId)).filter(Boolean);
            query.andWhere(
                refundDateIds.length > 0 ? 'reservationInfo.id IN (:...refundDateIds)' : '1 = 0',
                refundDateIds.length > 0 ? { refundDateIds } : {}
            );
        }

        // Rating filter — subquery from review table
        if (rating && Array.isArray(rating) && rating.length > 0) {
            const ratingRows = await this.reviewRepository
                .createQueryBuilder('review')
                .select('DISTINCT review.reservationId', 'reservationId')
                .where('review.rating IN (:...ratings)', { ratings: rating.map(Number) })
                .getRawMany();
            const ratingIds = ratingRows.map((r: any) => Number(r.reservationId)).filter(Boolean);
            query.andWhere(
                ratingIds.length > 0 ? 'reservationInfo.id IN (:...ratingIds)' : '1 = 0',
                ratingIds.length > 0 ? { ratingIds } : {}
            );
        }

        if (publicReviewSearch) {
            const publicReviewRows = await this.reviewRepository
                .createQueryBuilder('review')
                .select('DISTINCT review.reservationId', 'reservationId')
                .where('review.publicReview LIKE :publicReviewSearch', { publicReviewSearch: `%${publicReviewSearch}%` })
                .getRawMany();
            const publicReviewIds = publicReviewRows.map((r: any) => Number(r.reservationId)).filter(Boolean);
            query.andWhere(
                publicReviewIds.length > 0 ? 'reservationInfo.id IN (:...publicReviewIds)' : '1 = 0',
                publicReviewIds.length > 0 ? { publicReviewIds } : {}
            );
        }

        if (issuesEntry.length > 0 || issueCategory.length > 0 || issueDescriptionSearch) {
            const wantsWithIssues = issuesEntry.includes('with-entry');
            const wantsNoIssues = issuesEntry.includes('no-entry');
            const issueQb = this.issueRepo
                .createQueryBuilder('issue')
                .select('DISTINCT issue.reservation_id', 'reservationId');
            let hasIssuePredicate = false;
            if (issueCategory.length > 0) {
                issueQb.where('issue.category IN (:...issueCategory)', { issueCategory });
                hasIssuePredicate = true;
            }
            if (issueDescriptionSearch) {
                const clause = 'issue.issue_description LIKE :issueDescriptionSearch';
                const params = { issueDescriptionSearch: `%${issueDescriptionSearch}%` };
                if (hasIssuePredicate) issueQb.andWhere(clause, params);
                else issueQb.where(clause, params);
                hasIssuePredicate = true;
            }
            const issueRows = await issueQb.getRawMany();
            const issueIds = issueRows.map((r: any) => Number(r.reservationId)).filter(Boolean);
            if (wantsNoIssues && !wantsWithIssues && !issueCategory.length && !issueDescriptionSearch) {
                query.andWhere(issueIds.length > 0 ? 'reservationInfo.id NOT IN (:...issueIds)' : '1 = 1', issueIds.length > 0 ? { issueIds } : {});
            } else {
                query.andWhere(issueIds.length > 0 ? 'reservationInfo.id IN (:...issueIds)' : '1 = 0', issueIds.length > 0 ? { issueIds } : {});
            }
        }

        // Keyword search filter (searches reservation, review, AI analysis, and issue data)
        if (keyword) {
            const keywordPattern = `%${keyword}%`;
            const [matchingReviewRows, matchingAnalyses, matchingIssues] = await Promise.all([
                this.reviewRepository
                    .createQueryBuilder('review')
                    .select('DISTINCT review.reservationId', 'reservationId')
                    .where(new Brackets((qb) => {
                        qb.where('review.guestName LIKE :keyword', { keyword: keywordPattern })
                            .orWhere('review.reviewerName LIKE :keyword', { keyword: keywordPattern })
                            .orWhere('review.publicReview LIKE :keyword', { keyword: keywordPattern })
                            .orWhere('review.privateReview LIKE :keyword', { keyword: keywordPattern })
                            .orWhere('review.listingName LIKE :keyword', { keyword: keywordPattern })
                            .orWhere('review.channelName LIKE :keyword', { keyword: keywordPattern });
                    }))
                    .getRawMany(),
                this.guestAnalysisRepo
                    .createQueryBuilder('analysis')
                    .select('DISTINCT analysis.reservationId', 'reservationId')
                    .where(new Brackets((qb) => {
                        qb.where('analysis.summary LIKE :keyword', { keyword: keywordPattern })
                            .orWhere('analysis.sentimentReason LIKE :keyword', { keyword: keywordPattern })
                            .orWhere('CAST(analysis.flags AS CHAR) LIKE :keyword', { keyword: keywordPattern });
                    }))
                    .getRawMany(),
                this.issueRepo
                    .createQueryBuilder('issue')
                    .select('DISTINCT issue.reservation_id', 'reservationId')
                    .where(new Brackets((qb) => {
                        qb.where('issue.issue_description LIKE :keyword', { keyword: keywordPattern })
                            .orWhere('issue.owner_notes LIKE :keyword', { keyword: keywordPattern })
                            .orWhere('issue.next_steps LIKE :keyword', { keyword: keywordPattern });
                    }))
                    .getRawMany(),
            ]);

            const keywordReservationIds = Array.from(new Set([
                ...matchingReviewRows.map((item: any) => Number(item.reservationId)),
                ...matchingAnalyses.map((item: any) => Number(item.reservationId)),
                ...matchingIssues.map((item: any) => Number(item.reservationId)),
            ].filter((id) => !Number.isNaN(id))));

            query.andWhere(new Brackets((qb) => {
                qb.where("reservationInfo.guestName LIKE :keyword", { keyword: keywordPattern })
                    .orWhere("reservationInfo.listingName LIKE :keyword", { keyword: keywordPattern })
                    .orWhere("reservationInfo.confirmation_code LIKE :keyword", { keyword: keywordPattern })
                    .orWhere("reservationInfo.integration_nickname LIKE :keyword", { keyword: keywordPattern })
                    .orWhere("reservationInfo.channelName LIKE :keyword", { keyword: keywordPattern })
                    .orWhere("reservationInfo.source LIKE :keyword", { keyword: keywordPattern });

                if (keywordReservationIds.length > 0) {
                    qb.orWhere("reservationInfo.id IN (:...keywordReservationIds)", { keywordReservationIds });
                }
            }));
        }

        // Status filter (works alongside tab filtering to further narrow results)
        if (status && status.length > 0) {
            const expandedStatuses = this.expandMitigationStatuses(status as string[]);
            query.andWhere("reviewCheckout.status IN (:...statusFilter)", { statusFilter: expandedStatuses });
        }

        // Sentiment filter — subquery from guest_analysis (latest analysis per reservation only)
        // A reservation can have multiple analyses (different bookingPhase or re-analyses). We must
        // match only the most recent one so the filter agrees with what the table displays.
        if (sentiment && (sentiment as string[]).length > 0) {
            const sentimentRows = await this.guestAnalysisRepo
                .createQueryBuilder('a')
                .select('DISTINCT a.reservationId', 'reservationId')
                .where('a.sentiment IN (:...sentiment)', { sentiment })
                .andWhere('a.analyzedAt = (SELECT MAX(a2.analyzedAt) FROM guest_analysis a2 WHERE a2.reservationId = a.reservationId)')
                .getRawMany();
            const sentimentIds = sentimentRows.map((r: any) => Number(r.reservationId)).filter(Boolean);
            query.andWhere(
                sentimentIds.length > 0 ? 'reservationInfo.id IN (:...sentimentIds)' : '1 = 0',
                sentimentIds.length > 0 ? { sentimentIds } : {}
            );
        }

        // Visibility filter
        // The frontend derives effective visibility from stored review.visibility using the same rules as applyAutoVisibility:
        //   • "Visible"         → review.visibility = 'Visible'
        //                          OR review.visibility IN ('Awaiting Review','No Review') AND review.rating > 0
        //                          OR reviewCheckout.visibility = 'Visible'
        //   • "Awaiting Review" → review.visibility = 'Awaiting Review' AND (review.rating IS NULL OR review.rating = 0)
        //                          OR reviewCheckout.visibility = 'Awaiting Review'
        //   • "No Review"       → review.visibility = 'No Review' AND (review.rating IS NULL OR review.rating = 0)
        //                          OR reviewCheckout.visibility = 'No Review'
        //   • "Removed"         → review.visibility = 'Removed' OR review.isHidden = 1
        //   • all others        → review.visibility = value OR reviewCheckout.visibility = value
        if (visibility && (visibility as string[]).length > 0) {
            const visibilityList = visibility as string[];

            const reviewQb = this.reviewRepository.createQueryBuilder('review').select('DISTINCT review.reservationId', 'reservationId');
            const reviewConditions: string[] = [];
            const reviewParams: Record<string, any> = {};

            if (visibilityList.includes('Visible')) {
                reviewConditions.push("(review.visibility = 'Visible')");
                reviewConditions.push("(review.visibility = 'Keep')");
                reviewConditions.push("(review.visibility IN ('Awaiting Review','No Review') AND review.rating IS NOT NULL AND review.rating > 0)");
            }
            if (visibilityList.includes('Awaiting Review')) {
                reviewConditions.push("(review.visibility = 'Awaiting Review' AND (review.rating IS NULL OR review.rating = 0))");
            }
            if (visibilityList.includes('No Review')) {
                reviewConditions.push("(review.visibility = 'No Review' AND (review.rating IS NULL OR review.rating = 0))");
            }
            if (visibilityList.includes('Removed')) {
                reviewConditions.push("(review.visibility = 'Removed' OR review.isHidden = 1)");
            }
            // For other values (Submitted, Keep, Archived, etc.) match explicitly
            const otherValues = visibilityList.filter(v => !['Visible', 'Awaiting Review', 'No Review', 'Removed'].includes(v));
            if (otherValues.length > 0) {
                reviewConditions.push('review.visibility IN (:...otherVisibility)');
                reviewParams.otherVisibility = otherValues;
            }

            let visibilityIds: number[] = [];
            if (reviewConditions.length > 0) {
                const combinedCondition = reviewConditions.map(c => `(${c})`).join(' OR ');
                reviewQb.where(`(${combinedCondition})`, reviewParams);
                const rows = await reviewQb.getRawMany();
                visibilityIds = rows.map((r: any) => Number(r.reservationId)).filter(Boolean);
            }

            // Also match checkout-level visibility (rows without a linked review)
            const checkoutVisibilityConditions: string[] = [];
            if (visibilityList.includes('Visible')) {
                checkoutVisibilityConditions.push("reviewCheckout.visibility = 'Visible'");
                checkoutVisibilityConditions.push("reviewCheckout.visibility = 'Keep'");
            }
            if (visibilityList.includes('Awaiting Review')) {
                checkoutVisibilityConditions.push("reviewCheckout.visibility = 'Awaiting Review'");
                checkoutVisibilityConditions.push("reviewCheckout.visibility IS NULL");
            }
            if (visibilityList.includes('No Review')) {
                checkoutVisibilityConditions.push("reviewCheckout.visibility = 'No Review'");
            }
            const otherCheckoutValues = visibilityList.filter(v => !['Visible', 'Awaiting Review', 'No Review'].includes(v));
            if (otherCheckoutValues.length > 0) {
                checkoutVisibilityConditions.push(`reviewCheckout.visibility IN (:...rcOtherVisibility)`);
            }

            query.andWhere(new Brackets((qb) => {
                let started = false;
                if (visibilityIds.length > 0) {
                    qb.where('reservationInfo.id IN (:...visibilityIds)', { visibilityIds });
                    started = true;
                }
                checkoutVisibilityConditions.forEach((cond) => {
                    const params = cond.includes(':...rcOtherVisibility')
                        ? { rcOtherVisibility: otherCheckoutValues }
                        : {};
                    if (!started) { qb.where(cond, params); started = true; }
                    else { qb.orWhere(cond, params); }
                });
                // If nothing matched at all, return no results
                if (!started) {
                    qb.where('1 = 0');
                }
            }));
        }

        // Operational flags filter — subquery from guest_analysis using JSON flag search (latest analysis per reservation only)
        if (operationalFlags && (operationalFlags as string[]).length > 0) {
            const flagList = operationalFlags as string[];
            const flagQb = this.guestAnalysisRepo.createQueryBuilder('analysis')
                .select('DISTINCT analysis.reservationId', 'reservationId');
            flagQb.where(new Brackets((qb) => {
                flagList.forEach((flag, index) => {
                    qb.orWhere(`CAST(analysis.flags AS CHAR) LIKE :flagPattern${index}`, { [`flagPattern${index}`]: `%${flag}%` });
                });
            }));
            flagQb.andWhere('analysis.analyzedAt = (SELECT MAX(a2.analyzedAt) FROM guest_analysis a2 WHERE a2.reservationId = analysis.reservationId)');
            const flagRows = await flagQb.getRawMany();
            const flagIds = flagRows.map((r: any) => Number(r.reservationId)).filter(Boolean);
            query.andWhere(
                flagIds.length > 0 ? 'reservationInfo.id IN (:...flagIds)' : '1 = 0',
                flagIds.length > 0 ? { flagIds } : {}
            );
        }

        if (aiRedFlag.length > 0 || aiGreenFlag.length > 0 || aiAnalysis.length > 0 || aiAnalysisSearch) {
            const analysisQb = this.guestAnalysisRepo
                .createQueryBuilder('analysis')
                .select('DISTINCT analysis.reservationId', 'reservationId')
                .where('analysis.analyzedAt = (SELECT MAX(a2.analyzedAt) FROM guest_analysis a2 WHERE a2.reservationId = analysis.reservationId)');
            const analysisClauses: string[] = [];
            const analysisParams: Record<string, any> = {};
            const pushPresenceClause = (fieldValues: string[], withClause: string, noClause: string) => {
                const wantsWith = fieldValues.includes('with-entry');
                const wantsNo = fieldValues.includes('no-entry');
                if (wantsWith !== wantsNo) analysisClauses.push(wantsWith ? withClause : noClause);
            };
            pushPresenceClause(aiAnalysis, "(analysis.summary IS NOT NULL AND TRIM(analysis.summary) != '')", "(analysis.summary IS NULL OR TRIM(analysis.summary) = '')");
            pushPresenceClause(aiRedFlag, "(CAST(analysis.flags AS CHAR) LIKE '%\"polarity\":\"negative\"%' OR CAST(analysis.flags AS CHAR) NOT LIKE '%\"polarity\":\"positive\"%')", "(analysis.flags IS NULL OR CAST(analysis.flags AS CHAR) = '[]' OR CAST(analysis.flags AS CHAR) NOT LIKE '%\"polarity\":\"negative\"%')");
            pushPresenceClause(aiGreenFlag, "CAST(analysis.flags AS CHAR) LIKE '%\"polarity\":\"positive\"%'", "(analysis.flags IS NULL OR CAST(analysis.flags AS CHAR) NOT LIKE '%\"polarity\":\"positive\"%')");
            if (aiAnalysisSearch) {
                analysisClauses.push("(analysis.summary LIKE :aiAnalysisSearch OR analysis.sentimentReason LIKE :aiAnalysisSearch OR CAST(analysis.flags AS CHAR) LIKE :aiAnalysisSearch)");
                analysisParams.aiAnalysisSearch = `%${aiAnalysisSearch}%`;
            }
            analysisClauses.forEach((clause) => analysisQb.andWhere(clause, analysisParams));
            const analysisRows = await analysisQb.getRawMany();
            const analysisIds = analysisRows.map((r: any) => Number(r.reservationId)).filter(Boolean);
            query.andWhere(analysisIds.length > 0 ? 'reservationInfo.id IN (:...analysisIds)' : '1 = 0', analysisIds.length > 0 ? { analysisIds } : {});
        }

        // Owner filter — resolve owner name to listing IDs
        if (owner && (owner as string[]).length > 0) {
            const ownerNames = owner as string[];
            const listings = await this.listingRepo
                .createQueryBuilder('listing')
                .select('listing.id')
                .where(new Brackets((qb) => {
                    ownerNames.forEach((ownerName, index) => {
                        qb.orWhere(`listing.ownerName LIKE :ownerPattern${index}`, { [`ownerPattern${index}`]: `%${ownerName}%` });
                    });
                }))
                .getMany();
            const ownerListingIds = listings.map((l: any) => Number(l.id)).filter(Boolean);
            query.andWhere(
                ownerListingIds.length > 0 ? 'reservationInfo.listingMapId IN (:...ownerListingIds)' : '1 = 0',
                ownerListingIds.length > 0 ? { ownerListingIds } : {}
            );
        }

        // Refund status filter — subquery from refund_request_info table
        if (refundStatus && (refundStatus as string[]).length > 0) {
            const refundRows = await this.refundRequestRepo
                .createQueryBuilder('refund')
                .select('DISTINCT refund.reservationId', 'reservationId')
                .where('LOWER(refund.status) IN (:...refundStatuses)', {
                    refundStatuses: (refundStatus as string[]).map((s: string) => s.toLowerCase()),
                })
                .getRawMany();
            const refundIds = refundRows.map((r: any) => Number(r.reservationId)).filter(Boolean);
            query.andWhere(
                refundIds.length > 0 ? 'reservationInfo.id IN (:...refundIds)' : '1 = 0',
                refundIds.length > 0 ? { refundIds } : {}
            );
        }

        // Claim only filter — only show reservations that have a refund/claim request
        if (isClaimOnly === 'true' || isClaimOnly === true) {
            const claimRows = await this.refundRequestRepo
                .createQueryBuilder('refund')
                .select('DISTINCT refund.reservationId', 'reservationId')
                .where('refund.deletedAt IS NULL')
                .getRawMany();
            const claimIds = claimRows.map((r: any) => Number(r.reservationId)).filter(Boolean);
            query.andWhere(
                claimIds.length > 0 ? 'reservationInfo.id IN (:...claimIds)' : '1 = 0',
                claimIds.length > 0 ? { claimIds } : {}
            );
        }

        query.skip((page - 1) * limit).take(limit);
        query.orderBy("reviewCheckout.createdAt", "DESC");

        // Debug logging - remove after debugging
        logger.info(`[getReviewsForCheckout] Filters received:`, JSON.stringify({
            page, limit, listingMapId, guestName, channel, keyword, tab, status
        }));
        logger.info(`[getReviewsForCheckout] Generated SQL: ${query.getSql()}`);
        logger.info(`[getReviewsForCheckout] Query parameters: ${JSON.stringify(query.getParameters())}`);

        const [reviewCheckoutList, total] = await query.getManyAndCount();

        const reservationIds = reviewCheckoutList.map(rc => rc.reservationInfo.id);
        const latestReservationUpdates = await this.reservationHistoryService.getLatestUpdatesForReservations(reservationIds);

        // Collect all user IDs referenced in the data to avoid fetching ALL users
        const userIds = new Set<string>();
        reviewCheckoutList.forEach(rc => {
            if (rc.assignee) userIds.add(rc.assignee);
            if (rc.createdBy) userIds.add(rc.createdBy);
            if (rc.updatedBy) userIds.add(rc.updatedBy);
            if (rc.deletedBy) userIds.add(rc.deletedBy);
            rc.reviewCheckoutUpdates?.forEach(update => {
                if (update.createdBy) userIds.add(update.createdBy);
                if (update.updatedBy) userIds.add(update.updatedBy);
            });
            const latestReservationUpdate = latestReservationUpdates.get(Number(rc.reservationInfo?.id));
            if (latestReservationUpdate?.changedBy && latestReservationUpdate.changedBy !== 'system') {
                userIds.add(latestReservationUpdate.changedBy);
            }
        });

        const issueServices = new IssuesService();
        const actionItemServices = new ActionItemsService();

        // Run all secondary queries in parallel for better performance
        const [reviews, users, issuesResult, actionItemsResult, guestAnalyses, latestNotesByReservation, latestRefundsByReservation] = await Promise.all([
            // Fetch reviews
            this.reviewRepository.find({
                where: {
                    reservationId: In(reservationIds),
                },
                relations: ['reviewDetail', 'reviewDetail.removalAttempts'],
                order: {
                    createdAt: 'DESC',
                },
            }),
            // Fetch only referenced users (not all users)
            userIds.size > 0
                ? this.usersRepo.find({ where: { uid: In([...userIds]) } })
                : Promise.resolve([]),
            // Fetch issues
            issueServices.getGuestIssues({ page: 1, limit: 500, reservationId: reservationIds, status: issuesStatus }, userId),
            // Fetch action items
            actionItemServices.getActionItems({ page: 1, limit: 500, reservationId: reservationIds, status: actionItemsStatus }),
            // Fetch guest analyses (latest per reservation)
            this.guestAnalysisRepo.find({
                where: {
                    reservationId: In(reservationIds),
                },
                order: { analyzedAt: 'DESC' },
            }),
            this.getLatestReservationNotes(reservationIds),
            this.getLatestRefundRequests(reservationIds),
        ]);

        const userMap = new Map(users.map(user => [
            user.uid,
            [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || user.uid,
        ]));
        const userDisplayNameCache = new Map<string, string>();
        const resolveUserDisplayName = async (value?: string | null) => {
            const raw = String(value || "").trim();
            if (!raw) return raw;
            if (raw === "system") return "System";
            if (userDisplayNameCache.has(raw)) return userDisplayNameCache.get(raw) || raw;

            const localName = String(userMap.get(raw) || "").trim();
            if (localName) {
                userDisplayNameCache.set(raw, localName);
                return localName;
            }

            const authName = await this.getSupabaseUserDisplayName(raw);
            const displayName = authName || raw;
            userDisplayNameCache.set(raw, displayName);
            return displayName;
        };
        const issues = issuesResult.issues;
        const actionItems = actionItemsResult.actionItems;

        // Build listing tag map to resolve propertyType — include IDs from both reviews and reservations
        const uniqueListingIds = [...new Set([
            ...reviews.map(r => Number(r.listingMapId)),
            ...reviewCheckoutList.map(rc => Number(rc.reservationInfo?.listingMapId)),
        ].filter(Boolean))];
            const listingTagRecords = uniqueListingIds.length > 0
            ? await this.listingRepo.find({ where: { id: In(uniqueListingIds as number[]) }, select: ['id', 'tags', 'timeZoneName', 'checkOutTime'] })
            : [];
        const listingTagMap = new Map(listingTagRecords.map(l => [Number(l.id), l]));

        const transformedData = await Promise.all(reviewCheckoutList.map(async (rc) => {
            const matchedReview = reviews.find(r => r.reservationId == rc.reservationInfo?.id) || null;
            const enrichedReview = matchedReview
                ? {
                    ...matchedReview,
                    propertyType: this.extractPropertyTypeFromTags(listingTagMap.get(Number(matchedReview.listingMapId))?.tags),
                    serviceType: this.extractServiceTypeFromTags(listingTagMap.get(Number(matchedReview.listingMapId))?.tags),
                    checkOutTime: rc.reservationInfo?.checkOutTime ?? listingTagMap.get(Number(matchedReview.listingMapId))?.checkOutTime ?? null,
                    timeZoneName: listingTagMap.get(Number(matchedReview.listingMapId))?.timeZoneName ?? 'America/New_York',
                }
                : null;
            const enrichedReviews = reviews
                .filter(r => r.reservationId == rc.reservationInfo?.id)
                .map(r => ({
                    ...r,
                    propertyType: this.extractPropertyTypeFromTags(listingTagMap.get(Number(r.listingMapId))?.tags),
                    serviceType: this.extractServiceTypeFromTags(listingTagMap.get(Number(r.listingMapId))?.tags),
                    checkOutTime: rc.reservationInfo?.checkOutTime ?? listingTagMap.get(Number(r.listingMapId))?.checkOutTime ?? null,
                    timeZoneName: listingTagMap.get(Number(r.listingMapId))?.timeZoneName ?? 'America/New_York',
                }));
            const reservationId = Number(rc.reservationInfo?.id);
            const latestReservationUpdate = latestReservationUpdates.get(reservationId);
            const latestUpdate = await this.buildLatestUpdatePayload(
                latestNotesByReservation.get(reservationId) || null
            );
            const latestRefund = latestRefundsByReservation.get(reservationId) || null;
            const slackThreadPermalink = this.buildSlackThreadPermalink(rc.slackChannelId || null, rc.slackThreadTs || null);
            const ownerRevenue = rc.reservationInfo?.owner_revenue ?? null;
            const refundAmount = latestRefund?.refundAmount ?? null;
            const refundPercent = ownerRevenue && refundAmount
                ? Math.round((Number(refundAmount) / Number(ownerRevenue)) * 100)
                : null;
            return {
                ...rc,
                assignee: rc.assignee || null,
                assigneeName: rc.assignee ? await resolveUserDisplayName(rc.assignee) : null,
                createdBy: await resolveUserDisplayName(rc.createdBy),
                updatedBy: await resolveUserDisplayName(latestReservationUpdate?.changedBy || rc.updatedBy),
                deletedBy: await resolveUserDisplayName(rc.deletedBy),
                createdByName: await resolveUserDisplayName(rc.createdBy),
                updatedByName: await resolveUserDisplayName(latestReservationUpdate?.changedBy || rc.updatedBy),
                updatedAt: latestReservationUpdate?.changedAt || rc.updatedAt,
                reservationInfo: {
                    ...rc.reservationInfo,
                    propertyType: this.extractPropertyTypeFromTags(listingTagMap.get(Number(rc.reservationInfo?.listingMapId))?.tags),
                    serviceType: this.extractServiceTypeFromTags(listingTagMap.get(Number(rc.reservationInfo?.listingMapId))?.tags),
                    review: enrichedReview,
                    issues: issues.filter(issue => Number(issue.reservation_id) == rc.reservationInfo?.id) || null,
                    actionItems: actionItems.filter(item => item.reservationId == rc.reservationInfo?.id) || null,
                    aiAnalysis: guestAnalyses.find(a => a.reservationId == rc.reservationInfo?.id) || null,
                    latestUpdate,
                    slackThreadPermalink,
                    resolutionNotes: rc.comments || null,
                    refundAmount,
                    refundRequestId: latestRefund?.id ?? null,
                    refundStatus: latestRefund?.status ?? null,
                    refundExplanation: latestRefund?.explaination ?? null,
                    refundPercent,
                    checkOutTime: rc.reservationInfo?.checkOutTime ?? listingTagMap.get(Number(rc.reservationInfo?.listingMapId))?.checkOutTime ?? null,
                    timeZoneName: listingTagMap.get(Number(rc.reservationInfo?.listingMapId))?.timeZoneName ?? 'America/New_York',
                },
                reviewCheckoutUpdates: rc.reviewCheckoutUpdates.map(update => {
                    return {
                        ...update,
                        createdBy: userMap.get(update.createdBy) || update.createdBy,
                        updatedBy: userMap.get(update.updatedBy) || update.updatedBy,
                    };
                }),
                reviews: enrichedReviews,
            };
        }));

        return { result: transformedData, total };
    }


    getAdjustedDepartureDate(departureDate: Date): string {
        const dayOfWeek = getDay(departureDate); // Sunday = 0, Monday = 1, ..., Saturday = 6
        let adjustedDate = departureDate;

        if (dayOfWeek === 6) {
            // Saturday → move to Monday
            adjustedDate = addDays(departureDate, 2);
        } else if (dayOfWeek === 0) {
            // Sunday → move to Monday
            adjustedDate = addDays(departureDate, 1);
        }

        return format(adjustedDate, "yyyy-MM-dd");
    }

    async processReviewCheckout() {
        // Create review checkout entries for today's checkins and checkouts with default status "New"
        const reservationInfoService = new ReservationInfoService();
        const [{ reservations: checkinReservations }, { reservations: checkoutReservations }] = await Promise.all([
            reservationInfoService.getCheckinReservations(),
            reservationInfoService.getCheckoutReservations(),
        ]);
        const seen = new Set<number>();
        const reservations = [...checkinReservations, ...checkoutReservations].filter((r) => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
        });

        for (const reservation of reservations) {
            const listingId = reservation.listingMapId;
            const listingDetail = await this.listingRepo.findOne({ where: { id: listingId } });
            if (!listingDetail) {
                logger.warn(`Listing detail not found for listing ID: ${listingId}`);
                continue;
            }

            logger.info(`Processing review checkout for reservation ID: ${reservation.guestName}`);
            const existing = await this.reviewCheckoutRepo.findOne({
                where: { reservationInfo: { id: reservation.id } },
            });

            if (!existing) {
                const newReviewCheckout = this.reviewCheckoutRepo.create({
                    reservationInfo: reservation,
                    adjustedCheckoutDate: this.getAdjustedDepartureDate(reservation.departureDate),
                    sevenDaysAfterCheckout: format(addDays(reservation.departureDate, 7), 'yyyy-MM-dd'),
                    fourteenDaysAfterCheckout: format(addDays(reservation.departureDate, 14), 'yyyy-MM-dd'),
                    status: ReviewCheckoutStatus.NEW,
                    createdBy: "system",
                });
                await this.reviewCheckoutRepo.save(newReviewCheckout);
            }
        }
    }

    async processReviewCheckoutForDateRange(startDate: string, endDate: string): Promise<{ created: number; skipped: number; errors: number }> {
        let created = 0;
        let skipped = 0;
        let errors = 0;

        const validStatus = ["new", "accepted", "modified", "ownerStay", "moved"];

        const reservations = await this.reservationInfoRepo.find({
            where: {
                departureDate: Between(startOfDay(new Date(startDate)), endOfDay(new Date(endDate))),
                status: In(validStatus),
            },
            order: { departureDate: "ASC" },
        });

        logger.info(`[BackfillReviewCheckout] Found ${reservations.length} reservations between ${startDate} and ${endDate}`);

        for (const reservation of reservations) {
            try {
                const listingDetail = await this.listingRepo.findOne({ where: { id: reservation.listingMapId } });
                if (!listingDetail) {
                    logger.warn(`[BackfillReviewCheckout] Listing not found for reservation ID: ${reservation.id}, skipping`);
                    skipped++;
                    continue;
                }

                const existingReviewCheckout = await this.reviewCheckoutRepo.findOne({
                    where: { reservationInfo: { id: reservation.id } },
                });

                if (existingReviewCheckout) {
                    skipped++;
                    continue;
                }

                const newReviewCheckout = this.reviewCheckoutRepo.create({
                    reservationInfo: reservation,
                    adjustedCheckoutDate: this.getAdjustedDepartureDate(reservation.departureDate),
                    sevenDaysAfterCheckout: format(addDays(reservation.departureDate, 7), 'yyyy-MM-dd'),
                    fourteenDaysAfterCheckout: format(addDays(reservation.departureDate, 14), 'yyyy-MM-dd'),
                    status: ReviewCheckoutStatus.NEW,
                    createdBy: "system",
                });
                newReviewCheckout.createdAt = new Date(reservation.departureDate);
                await this.reviewCheckoutRepo.save(newReviewCheckout);
                created++;
                logger.info(`[BackfillReviewCheckout] Created review checkout for reservation ID: ${reservation.id} (${reservation.guestName})`);
            } catch (err) {
                logger.error(`[BackfillReviewCheckout] Error processing reservation ID: ${reservation.id}`, err);
                errors++;
            }
        }

        logger.info(`[BackfillReviewCheckout] Completed — created: ${created}, skipped: ${skipped}, errors: ${errors}`);
        return { created, skipped, errors };
    }

    async updateReviewCheckout(id: number, data: { status?: string; comments?: string; assignee?: string | null; isActive?: boolean; visibility?: string }, userId: string) {
        const reviewCheckout = await this.reviewCheckoutRepo.findOne({ where: { id }, relations: ['reservationInfo'] });
        if (!reviewCheckout) {
            throw CustomErrorHandler.notFound(`Review checkout not found with id: ${id}`);
        }

        const prevStatus = reviewCheckout.status;
        const prevAssignee = reviewCheckout.assignee;
        const previousState = {
            status: reviewCheckout.status ?? null,
            comments: reviewCheckout.comments ?? null,
            assignee: reviewCheckout.assignee ?? null,
            isActive: reviewCheckout.isActive ?? null,
            visibility: reviewCheckout.visibility ?? null,
        };

        if (data.status !== undefined) {
            reviewCheckout.status = data.status;
        }
        if (data.comments !== undefined) {
            reviewCheckout.comments = data.comments;
        }
        if (data.assignee !== undefined) {
            reviewCheckout.assignee = data.assignee || null;
        }
        reviewCheckout.updatedAt = new Date();
        reviewCheckout.updatedBy = userId;
        if (data.isActive !== undefined) {
            reviewCheckout.isActive = data.isActive;
        }
        if (data.visibility !== undefined) {
            reviewCheckout.visibility = data.visibility;
        }
        await this.reviewCheckoutRepo.save(reviewCheckout);

        await this.logReservationFieldChanges(reviewCheckout.reservationInfo?.id, userId, {
            status: { old: previousState.status, new: reviewCheckout.status ?? null },
            resolutionNotes: { old: previousState.comments, new: reviewCheckout.comments ?? null },
            assignee: { old: previousState.assignee, new: reviewCheckout.assignee ?? null },
            isActive: { old: previousState.isActive, new: reviewCheckout.isActive ?? null },
            visibility: { old: previousState.visibility, new: reviewCheckout.visibility ?? null },
        });

        // Post activity to Slack thread (fire-and-forget, never blocks the main flow)
        if (reviewCheckout.slackThreadTs) {
            const slackService = new ResolutionsTeamSlackService();
            if (data.status !== undefined && data.status !== prevStatus) {
                slackService.postActivityToThread(id, {
                    type: 'status',
                    actor: userId,
                    oldValue: prevStatus,
                    newValue: data.status,
                }).catch((err) => logger.error('[ReviewService] Slack status activity post failed:', err));
            }
            if (data.assignee !== undefined && (data.assignee || null) !== prevAssignee) {
                slackService.postActivityToThread(id, {
                    type: 'assignee',
                    actor: userId,
                    oldValue: prevAssignee,
                    newValue: data.assignee || '',
                }).catch((err) => logger.error('[ReviewService] Slack assignee activity post failed:', err));
            }
            if (data.comments !== undefined && (data.comments ?? null) !== (previousState.comments ?? null)) {
                slackService.postActivityToThread(id, {
                    type: 'resolution_notes',
                    actor: userId,
                    oldValue: previousState.comments,
                    newValue: data.comments ?? '',
                }).catch((err) => logger.error('[ReviewService] Slack resolution notes activity post failed:', err));
            }
            if (data.visibility !== undefined && (data.visibility ?? null) !== (previousState.visibility ?? null)) {
                slackService.postActivityToThread(id, {
                    type: 'visibility',
                    actor: userId,
                    oldValue: previousState.visibility,
                    newValue: data.visibility ?? '',
                }).catch((err) => logger.error('[ReviewService] Slack visibility activity post failed:', err));
            }
        }

        return reviewCheckout;
    }

    async ensureReviewCheckout(reservationId: number, userId: string) {
        const reservation = await this.reservationInfoRepo.findOne({ where: { id: reservationId } });
        if (!reservation) {
            throw CustomErrorHandler.notFound(`Reservation not found with id: ${reservationId}`);
        }

        let reviewCheckout = await this.reviewCheckoutRepo.findOne({
            where: { reservationInfo: { id: reservationId } },
            relations: ['reservationInfo'],
        });

        if (!reviewCheckout) {
            const departureDate = reservation.departureDate;
            reviewCheckout = this.reviewCheckoutRepo.create({
                reservationInfo: reservation,
                adjustedCheckoutDate: this.getAdjustedDepartureDate(departureDate),
                sevenDaysAfterCheckout: format(addDays(departureDate, 7), 'yyyy-MM-dd'),
                fourteenDaysAfterCheckout: format(addDays(departureDate, 14), 'yyyy-MM-dd'),
                status: ReviewCheckoutStatus.NEW,
                createdBy: userId || "system",
                updatedBy: userId || "system",
            });
            reviewCheckout = await this.reviewCheckoutRepo.save(reviewCheckout);
        }

        return reviewCheckout;
    }

    async createReviewCheckoutUpdate(reviewCheckoutId: number, updates: string, userId: string) {
        const reviewCheckout = await this.reviewCheckoutRepo.findOne({ where: { id: reviewCheckoutId } });
        if (!reviewCheckout) {
            throw CustomErrorHandler.notFound(`Review checkout not found with id: ${reviewCheckoutId}`);
        }

        const newUpdate = {
            updates,
            createdBy: userId,
            reviewCheckout,
            source: 'app',
        };

        const reviewCheckoutUpdate = this.reviewCheckoutUpdatesRepo.create(newUpdate);
        const saved = await this.reviewCheckoutUpdatesRepo.save(reviewCheckoutUpdate);

        // Post comment to Slack thread (fire-and-forget)
        if (reviewCheckout.slackThreadTs) {
            new ResolutionsTeamSlackService()
                .postActivityToThread(reviewCheckoutId, {
                    type: 'comment',
                    actor: userId,
                    details: updates,
                })
                .catch((err) => logger.error('[ReviewService] Slack comment post failed:', err));
        }

        return saved;
    }

    async deleteLaunchReviewCheckouts() {
        // No-op: "Launch" status no longer exists; kept for API compatibility
        const launchReviewCheckouts: any[] = [];

        for (const reviewCheckout of launchReviewCheckouts) {
            reviewCheckout.deletedAt = new Date();
            reviewCheckout.deletedBy = "system";
            await this.reviewCheckoutRepo.save(reviewCheckout);
        }

        logger.info(`Deleted ${launchReviewCheckouts.length} review checkouts with 'Launch' status.`);
    }

    private async createBadReview(obj: any) {
        const existingBadReviewLog = await this.badReviewRepo.findOne({ where: { reservationInfo: { id: obj.reservationInfo.id } } });
        if(existingBadReviewLog) {
            logger.info(`Bad review log already exists for reservation id: ${obj.reservationInfo.id}`);
            return existingBadReviewLog;
        }

        // Check for existing review and populate publicReview/rating
        const existingReview = await this.reviewRepository.findOne({
            where: { reservationId: obj.reservationInfo.id },
            order: { createdAt: 'DESC' }
        });

        if (existingReview) {
            obj.publicReview = existingReview.publicReview || null;
            obj.rating = existingReview.rating || null;
            obj.isManuallyEntered = false;
        }

        const newReview = this.badReviewRepo.create(obj);
        return await this.badReviewRepo.save(newReview);
    }

    async updateBadReviewStatus(id: number, status: BadReviewStatus, userId: string) {
        const badReview = await this.badReviewRepo.findOne({ where: { id } });
        if (!badReview) {
            throw CustomErrorHandler.notFound(`Bad review not found with id: ${id}`);
        }
        badReview.status = status;
        badReview.isTodayActive = false;;
        badReview.updatedAt = new Date();
        badReview.updatedBy = userId;
        await this.badReviewRepo.save(badReview);
        return badReview;
    }

    async updateBadReviewFields(id: number, data: { publicReview?: string; rating?: number; }, userId: string) {
        const badReview = await this.badReviewRepo.findOne({ where: { id } });
        if (!badReview) {
            throw CustomErrorHandler.notFound(`Bad review not found with id: ${id}`);
        }

        if (data.publicReview !== undefined) {
            badReview.publicReview = data.publicReview;
        }
        if (data.rating !== undefined) {
            badReview.rating = data.rating;
        }

        // Mark as manually entered when user updates
        badReview.isManuallyEntered = true;
        badReview.updatedAt = new Date();
        badReview.updatedBy = userId;

        return await this.badReviewRepo.save(badReview);
    }

    async getBadReviews(filters: FilterBadReviews, userId: string) {
        const {
            page, limit, listingMapId, guestName,
            actionItemsStatus, issuesStatus, channel,
            todayDate, status, tab, keyword,
        } = filters;

        //fetch bad reviews list
        const query = this.badReviewRepo
            .createQueryBuilder("badReview")
            .leftJoinAndSelect("badReview.reservationInfo", "reservationInfo")
            .leftJoinAndSelect("badReview.badReviewUpdates", "badReviewUpdates");

        // Tab-based filtering logic
        if (tab) {
            switch (tab.toLowerCase()) {
                case 'today':
                    // Today tab: Show 'New' status + follow up statuses with active today with status call phase
                    query.andWhere(new Brackets(qb => {
                        qb.where("badReview.status = :toCallStatus", { toCallStatus: BadReviewStatus.NEW })
                            .orWhere("(badReview.status IN (:...followUpStatuses) AND badReview.isTodayActive = true)", {
                                followUpStatuses: [BadReviewStatus.CALL_PHASE],
                            });
                    }));
                    break;

                case 'active':
                    // Active tab: Show follow up statuses + Issue + No Further Action
                    // Special condition: If sevenDaysAfterCheckout <= todayDate for follow up statuses, 
                    // only show if isActive is true
                    query.andWhere(new Brackets(qb => {
                        qb.where("badReview.status IN (:...followUpStatuses)", {
                            followUpStatuses: [BadReviewStatus.PENDING_REMOVAL],
                        })
                            .orWhere("(badReview.status IN (:...followUpStatuses2) AND badReview.isTodayActive = false)", {
                                followUpStatuses2: [BadReviewStatus.PENDING_REMOVAL],
                            })
                            .orWhere("badReview.status IN (:...activeStatuses)", {
                              activeStatuses: [BadReviewStatus.CALL_PHASE],
                          });
                    }));
                    break;

                case 'closed':
                    // Closed tab: Show all closed statuses
                    query.andWhere("badReview.status IN (:...closedStatuses)", {
                        closedStatuses: [
                            BadReviewStatus.CLOSED_FAILED,
                            BadReviewStatus.CLOSED_NO_ACTION_REQUIRED,
                            BadReviewStatus.CLOSED_REMOVED,
                        ]
                    });
                    break;

                default:
                    // If tab is provided but not recognized, use existing status filter logic
                    if (status && status.length > 0) {
                        query.andWhere("badReview.status IN (:...status)", { status });
                    }
                    break;
            }
        } else {
            // Legacy status filter (when no tab is specified)
            if (status && status.length > 0) {
                query.andWhere("badReview.status IN (:...status)", { status });
            }
        }

        // Listing filter
        if (listingMapId && listingMapId.length > 0) {
            query.andWhere("reservationInfo.listingMapId IN (:...listingMapId)", { listingMapId: listingMapId.map(id => Number(id)) });
        }

        // Guest name filter
        if (guestName) {
            query.andWhere("reservationInfo.guestName LIKE :guestName", { guestName: `${guestName}%` });
        }

        // Channel filter
        if (channel && channel.length > 0) {
            query.andWhere("reservationInfo.channelId IN (:...channel)", { channel: channel.map(id => Number(id)) });
        }

        // Keyword search filter (searches guest name)
        if (keyword) {
            query.andWhere("reservationInfo.guestName LIKE :keyword", { keyword: `%${keyword}%` });
        }

        // Status filter (works alongside tab filtering to further narrow results)
        if (status && status.length > 0) {
            query.andWhere("badReview.status IN (:...statusFilter)", { statusFilter: status });
        }

        query.skip((page - 1) * limit).take(limit);
        query.orderBy("badReview.createdAt", "DESC");

        const [badReviewList, total] = await query.getManyAndCount();

        const reservationIds = badReviewList.map(rc => rc.reservationInfo.id);

        // append reviews for each reservations
        const reviews = await this.reviewRepository.find({
            where: {
                reservationId: In(reservationIds),
                isHidden: 0,
            },
            relations: ['reviewDetail', 'reviewDetail.removalAttempts'],
            order: {
                createdAt: 'DESC',
            },
        });

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));

        const issueServices = new IssuesService();
        const actionItemServices = new ActionItemsService();

        const issues = (await issueServices.getGuestIssues({ page: 1, limit: 500, reservationId: reservationIds, status: issuesStatus }, userId)).issues;
        const actionItems = (await actionItemServices.getActionItems({ page: 1, limit: 500, reservationId: reservationIds, status: actionItemsStatus })).actionItems;
        const guestAnalyses = await this.guestAnalysisRepo.find({
            where: {
                reservationId: In(reservationIds),
            },
            order: { analyzedAt: 'DESC' },
        });

        const transformedData = badReviewList.map(rc => {
            return {
                ...rc,
                assignee: userMap.get(rc.assignee) || rc.assignee,
                createdBy: userMap.get(rc.createdBy) || rc.createdBy,
                updatedBy: userMap.get(rc.updatedBy) || rc.updatedBy,
                reservationInfo: {
                    ...rc.reservationInfo,
                    review: reviews.find(r => r.reservationId == rc.reservationInfo?.id) || null,
                    issues: issues.filter(issue => Number(issue.reservation_id) == rc.reservationInfo?.id) || null,
                    actionItems: actionItems.filter(item => item.reservationId == rc.reservationInfo?.id) || null,
                    aiAnalysis: guestAnalyses.find(a => a.reservationId == rc.reservationInfo?.id) || null,
                },
                badReviewUpdates: rc.badReviewUpdates.map(update => {
                    return {
                        ...update,
                        createdBy: userMap.get(update.createdBy) || update.createdBy,
                        updatedBy: userMap.get(update.updatedBy) || update.updatedBy,
                    };
                }),
                reviews: reviews.filter(r => r.reservationId == rc.reservationInfo?.id) || [],
            };
        });

        return { result: transformedData, total };
    }

    async createBadReviewUpdate(badReviewId: number, updates: string, userId: string) {
        const badReview = await this.badReviewRepo.findOne({ where: { id: badReviewId } });
        if (!badReview) {
            throw CustomErrorHandler.notFound(`Bad review not found with id: ${badReviewId}`);
        }

        const newUpdate = {
            updates,
            createdBy: userId,
            badReview,
        };

        const badReviewUpdate = this.badReviewUpdatesRepo.create(newUpdate);
        return await this.badReviewUpdatesRepo.save(badReviewUpdate);
    }

    async updateBadReviewStatusForCallPhaseDaily() {
        await this.badReviewRepo
            .createQueryBuilder()
            .update(BadReviewEntity)
            .set({ isTodayActive: true })
            .where('status = :status', { status: BadReviewStatus.CALL_PHASE })
            .execute();
    }

    async getLiveIssues(filters: {
        page: number;
        limit: number;
        propertyId?: number[];
        keyword?: string;
        status?: string[];
        tab?: string;
        assignee?: string;
        guestName?: string;
    }, userId: string) {
        const {
            page, limit, propertyId, keyword, status, tab, assignee, guestName
        } = filters;

        const query = this.liveIssueRepo
            .createQueryBuilder("liveIssue")
            .leftJoinAndSelect("liveIssue.liveIssueUpdates", "liveIssueUpdates")
            .where("liveIssue.deletedAt IS NULL");

        // Tab-based filtering logic
        if (tab) {
            switch (tab.toLowerCase()) {
                case 'new':
                    // New tab: Show only 'New' status
                    query.andWhere("liveIssue.status = :newStatus", {
                        newStatus: LiveIssueStatus.NEW
                    });
                    break;

                case 'active':
                    // Active tab: Show 'In Progress' status
                    query.andWhere("liveIssue.status IN (:...activeStatus)", {
                        activeStatus: [
                            LiveIssueStatus.IN_PROGRESS,
                            LiveIssueStatus.TO_BE_TRAPPED,
                            LiveIssueStatus.NEGOTIATING
                        ]
                    });
                    break;

                case 'closed':
                    // Closed tab: Show all closed statuses
                    query.andWhere("liveIssue.status IN (:...closedStatuses)", {
                        closedStatuses: [
                            LiveIssueStatus.CLOSED_RESOLVED,
                            LiveIssueStatus.CLOSED_FAILED,
                            LiveIssueStatus.CLOSED_NEGOTIATED,
                            LiveIssueStatus.CLOSED_TRAPPED,
                        ]
                    });
                    break;

                default:
                    // If tab is provided but not recognized, use existing status filter logic
                    if (status && status.length > 0) {
                        query.andWhere("liveIssue.status IN (:...status)", { status });
                    }
                    break;
            }
        } else {
            // Legacy status filter (when no tab is specified)
            if (status && status.length > 0) {
                query.andWhere("liveIssue.status IN (:...status)", { status });
            }
        }

        // Property filter
        if (propertyId && propertyId.length > 0) {
            query.andWhere("liveIssue.propertyId IN (:...propertyId)", { 
                propertyId: propertyId.map(id => Number(id)) 
            });
        }

        // Assignee filter
        if (assignee) {
            query.andWhere("liveIssue.assignee = :assignee", { assignee });
        }

        // Keyword filter (search in summary)
        if (keyword) {
            query.andWhere(
                "LOWER(liveIssue.summary) LIKE :keyword",
                { keyword: `%${keyword.toLowerCase()}%` }
            );
        }

        if (guestName) {
            query.andWhere(
                "LOWER(liveIssue.guestName) LIKE :guestName",
                { guestName: `%${guestName.toLowerCase()}%` }
            );
        }

        query.skip((page - 1) * limit).take(limit);
        query.orderBy("liveIssue.createdAt", "DESC");

        const [liveIssueList, total] = await query.getManyAndCount();

        // Get users for assignee mapping
        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));

        // Get listing information for properties

        const propertyIds = [...new Set(liveIssueList.map(li => li.propertyId).filter(Boolean))];
        const propertyMap = new Map<string, string>();

        if (propertyIds.length > 0) {
            try {
                const listings = await this.listingRepo.find({
                    where: { id: In(propertyIds) },
                    withDeleted: true
                });

                listings.forEach(listing => {
                    propertyMap.set(String(listing.id), listing.internalListingName || listing.name || listing.externalListingName || `Property ${listing.id}`);
                });
            } catch (error) {
                logger.error(`Error fetching listing info:`, error);
            }
        }

        const reservationIds = liveIssueList.map(li => li.reservationId).filter(Boolean);
        const guestAnalyses = await this.guestAnalysisRepo.find({
            where: {
                reservationId: In(reservationIds as number[]),
            },
            order: { analyzedAt: 'DESC' },
        });

        const transformedData = liveIssueList.map(li => {
            const propertyId = String(li.propertyId);
            const propertyName = propertyMap.get(propertyId);
            
            return {
                ...li,
                assigneeName: userMap.get(li.assignee) || li.assignee,
                assigneeList: users.map((user) => {
                    return { uid: user.uid, name: `${user.firstName} ${user.lastName}` };
                }),
                propertyName: propertyName,
                createdBy: userMap.get(li.createdBy) || li.createdBy,
                updatedBy: userMap.get(li.updatedBy) || li.updatedBy,
                aiAnalysis: guestAnalyses.find(a => a.reservationId == li.reservationId) || null,
                liveIssueUpdates: li.liveIssueUpdates ? li.liveIssueUpdates.map(update => {
                    return {
                        ...update,
                        createdBy: userMap.get(update.createdBy) || update.createdBy,
                        updatedBy: userMap.get(update.updatedBy) || update.updatedBy,
                    };
                }) : [],
            };
        });

        return { result: transformedData, total };
    }

    async createLiveIssue(liveIssueData: {
        status: string;
        assignee?: string;
        propertyId: number;
        summary: string;
        followUp?: Date | string;
        guestName: string;
        reservationId: number;
    }, userId: string) {
        const newLiveIssue = this.liveIssueRepo.create({
            status: liveIssueData.status,
            assignee: liveIssueData.assignee,
            propertyId: liveIssueData.propertyId,
            summary: liveIssueData.summary,
            followUp: liveIssueData.followUp ? new Date(liveIssueData.followUp) : null,
            guestName: liveIssueData.guestName,
            reservationId: liveIssueData.reservationId,
            createdBy: userId,
        });

        return await this.liveIssueRepo.save(newLiveIssue);
    }

    async updateLiveIssue(id: number, liveIssueData: {
        status?: string;
        assignee?: string;
        propertyId?: number;
        summary?: string;
        followUp?: Date | string | null;
        guestName?: string;
        reservationId?: number;
    }, userId: string) {
        const liveIssue = await this.liveIssueRepo.findOne({ where: { id } });
        if (!liveIssue) {
            throw CustomErrorHandler.notFound(`Live issue not found with id: ${id}`);
        }

        if (liveIssueData.status !== undefined) {
            liveIssue.status = liveIssueData.status;
        }
        if (liveIssueData.assignee !== undefined) {
            liveIssue.assignee = liveIssueData.assignee;
        }
        if (liveIssueData.propertyId !== undefined) {
            liveIssue.propertyId = liveIssueData.propertyId;
        }
        if (liveIssueData.summary !== undefined) {
            liveIssue.summary = liveIssueData.summary;
        }
        if (liveIssueData.followUp !== undefined) {
            liveIssue.followUp = liveIssueData.followUp ? new Date(liveIssueData.followUp) : null;
        }
        if (liveIssueData.guestName !== undefined) {
            liveIssue.guestName = liveIssueData.guestName;
        }
        if (liveIssueData.reservationId !== undefined) {
            liveIssue.reservationId = liveIssueData.reservationId;
        }

        liveIssue.updatedAt = new Date();
        liveIssue.updatedBy = userId;

        return await this.liveIssueRepo.save(liveIssue);
    }

    async createLiveIssueUpdate(liveIssueId: number, updates: string, userId: string) {
        const liveIssue = await this.liveIssueRepo.findOne({ where: { id: liveIssueId } });
        if (!liveIssue) {
            throw CustomErrorHandler.notFound(`Live issue not found with id: ${liveIssueId}`);
        }

        const newUpdate = {
            updates,
            createdBy: userId,
            liveIssue,
        };

        const liveIssueUpdate = this.liveIssueUpdatesRepo.create(newUpdate);
        return await this.liveIssueUpdatesRepo.save(liveIssueUpdate);
    }

    async getReviewsDashboardStats(filters: DashboardFilters = {}) {
        const sixMonthsAgo = subMonths(new Date(), 6);
        const listingIds = await this.resolveDashboardListingIds(filters);

        const [ratingDistribution, channelBreakdown, reviewMonthlyTrend, visibilityStats] = await Promise.all([
            this.applyDashboardReviewFilters(
                this.reviewRepository
                .createQueryBuilder('r')
                .select('r.rating', 'rating')
                .addSelect('COUNT(*)', 'count')
                .where('r.rating IS NOT NULL')
                .groupBy('r.rating')
                .orderBy('r.rating', 'ASC'),
                filters,
                listingIds
            ).getRawMany(),
            this.applyDashboardReviewFilters(
                this.reviewRepository
                .createQueryBuilder('r')
                .select('r.channelId', 'channelId')
                .addSelect('r.channelName', 'channelName')
                .addSelect('COUNT(DISTINCT IFNULL(NULLIF(r.reservationId, 0), CONCAT(\'review-\', r.id)))', 'count')
                .addSelect('ROUND(AVG(r.rating), 2)', 'avgRating')
                .where('r.rating IS NOT NULL')
                .groupBy('r.channelId')
                .addGroupBy('r.channelName')
                .orderBy('count', 'DESC')
                .limit(50),
                filters,
                listingIds
            ).getRawMany(),
            this.applyDashboardReviewFilters(
                this.reviewRepository
                .createQueryBuilder('r')
                .select("DATE_FORMAT(r.submittedAt, '%Y-%m')", 'month')
                .addSelect('COUNT(*)', 'count')
                .addSelect('ROUND(AVG(r.rating), 2)', 'avgRating')
                .where('r.submittedAt >= :sixMonthsAgo', { sixMonthsAgo })
                .andWhere('r.submittedAt IS NOT NULL')
                .groupBy("DATE_FORMAT(r.submittedAt, '%Y-%m')")
                .orderBy("DATE_FORMAT(r.submittedAt, '%Y-%m')", 'ASC'),
                filters,
                listingIds
            ).getRawMany(),
            this.applyDashboardReviewFilters(
                this.reviewRepository
                .createQueryBuilder('r')
                .select('r.isHidden', 'isHidden')
                .addSelect('COUNT(*)', 'count')
                .groupBy('r.isHidden'),
                filters,
                listingIds
            ).getRawMany(),
        ]);

        const [mitigationByStatus, mitigationMonthlyTrend, checkoutCountsByListing] = await Promise.all([
            this.applyDashboardMitigationFilters(
                this.reviewCheckoutRepo
                .createQueryBuilder('rc')
                .select('rc.status', 'status')
                .addSelect('COUNT(*)', 'count')
                .where('(rc.status != :archivedStatus OR rc.status IS NULL)', { archivedStatus: ReviewCheckoutStatus.ARCHIVED })
                .groupBy('rc.status'),
                filters,
                listingIds
            ).getRawMany(),
            this.applyDashboardMitigationFilters(
                this.reviewCheckoutRepo
                .createQueryBuilder('rc')
                .select("DATE_FORMAT(rc.createdAt, '%Y-%m')", 'month')
                .addSelect('COUNT(*)', 'count')
                .where('rc.createdAt >= :sixMonthsAgo', { sixMonthsAgo })
                .andWhere('(rc.status != :archivedStatus OR rc.status IS NULL)', { archivedStatus: ReviewCheckoutStatus.ARCHIVED })
                .groupBy("DATE_FORMAT(rc.createdAt, '%Y-%m')")
                .orderBy("DATE_FORMAT(rc.createdAt, '%Y-%m')", 'ASC'),
                filters,
                listingIds
            ).getRawMany(),
            this.applyDashboardMitigationFilters(
                this.reviewCheckoutRepo
                .createQueryBuilder('rc')
                .select('ri.listingMapId', 'listingMapId')
                .addSelect('COUNT(rc.id)', 'count')
                .where('(rc.status != :archivedStatus OR rc.status IS NULL)', { archivedStatus: ReviewCheckoutStatus.ARCHIVED })
                .groupBy('ri.listingMapId'),
                filters,
                listingIds
            ).getRawMany(),
        ]);

        const [reservationChannelBreakdown, mitigationAssigneeBreakdown] = await Promise.all([
            this.applyDashboardReservationFilters(
                this.reservationInfoRepo
                    .createQueryBuilder('ri')
                    .select('ri.channelId', 'channelId')
                    .addSelect('ri.channelName', 'channelName')
                    .addSelect('COUNT(DISTINCT ri.id)', 'totalReservations')
                    .groupBy('ri.channelId')
                    .addGroupBy('ri.channelName'),
                filters,
                listingIds
            ).getRawMany(),
            this.applyDashboardMitigationFilters(
                this.reviewCheckoutRepo
                    .createQueryBuilder('rc')
                    .select('rc.assignee', 'assignee')
                    .addSelect('COUNT(*)', 'count')
                    .where('(rc.status != :archivedStatus OR rc.status IS NULL)', { archivedStatus: ReviewCheckoutStatus.ARCHIVED })
                    .groupBy('rc.assignee'),
                filters,
                listingIds
            ).getRawMany(),
        ]);

        // Property type distribution
        const mitigationListingIds = checkoutCountsByListing.map(c => Number(c.listingMapId)).filter(Boolean);
        const listings = mitigationListingIds.length > 0
            ? await this.listingRepo.find({ where: { id: In(mitigationListingIds) }, select: ['id', 'tags'] })
            : [];
        const listingTagMap = new Map(listings.map(l => [Number(l.id), l.tags]));
        const propertyTypeCounts: Record<string, number> = {};
        for (const item of checkoutCountsByListing) {
            const pt = this.extractPropertyTypeFromTags(listingTagMap.get(Number(item.listingMapId))) || 'Unknown';
            propertyTypeCounts[pt] = (propertyTypeCounts[pt] || 0) + Number(item.count);
        }

        // Compute summary stats
        const totalVisible = Number(visibilityStats.find(v => String(v.isHidden) === '0')?.count || 0);
        const totalHidden = Number(visibilityStats.find(v => String(v.isHidden) === '1')?.count || 0);
        const ratingMap = new Map<number, number>(ratingDistribution.map((row) => [Number(row.rating), Number(row.count)]));
        const ratingDist: Array<{ rating: number; count: number }> = [1, 2, 3, 4, 5].map((rating) => ({
            rating,
            count: ratingMap.get(rating) || 0,
        }));
        const totalRated = ratingDist.reduce((sum, r) => sum + r.count, 0);
        const fiveStarCount = ratingDist.find(r => r.rating === 5)?.count || 0;
        const lowRatingCount = ratingDist.filter(r => r.rating <= 3).reduce((sum, r) => sum + r.count, 0);
        const avgRating = totalRated > 0
            ? ratingDist.reduce((sum, r) => sum + r.rating * r.count, 0) / totalRated
            : 0;

        const mitigationStatusData = mitigationByStatus.map(s => ({ status: s.status, count: Number(s.count) }));
        const totalMitigation = mitigationStatusData.reduce((sum, s) => sum + s.count, 0);
        const closedMitigation = mitigationStatusData
            .filter(s => s.status === ReviewCheckoutStatus.COMPLETED)
            .reduce((sum, s) => sum + s.count, 0);
        const openMitigation = totalMitigation - closedMitigation;

        const reservationChannelMap = new Map(
            reservationChannelBreakdown.map((row) => [
                `${Number(row.channelId || 0)}::${String(row.channelName || '').trim()}`,
                Number(row.totalReservations || 0),
            ])
        );

        const channelData = channelBreakdown
            .map((channelRow) => {
                const key = `${Number(channelRow.channelId || 0)}::${String(channelRow.channelName || '').trim()}`;
                const reviewedReservations = Number(channelRow.count);
                const totalReservations = reservationChannelMap.get(key) || reviewedReservations;
                return {
                    channelId: Number(channelRow.channelId || 0) || null,
                    channelName: channelRow.channelName || 'Unknown',
                    count: reviewedReservations,
                    reviewedReservations,
                    totalReservations,
                    avgRating: parseFloat(Number(channelRow.avgRating).toFixed(2)),
                };
            })
            .filter((entry) => entry.reviewedReservations > 0);

        const assigneeSummaryMap = await this.buildDashboardUserSummaryMap(
            mitigationAssigneeBreakdown.map((row) => String(row.assignee || '').trim() || null)
        );
        const assigneeDistribution = mitigationAssigneeBreakdown.map((row) => {
            const assigneeUid = String(row.assignee || '').trim() || null;
            if (!assigneeUid) {
                return {
                    uid: null,
                    displayName: 'Unassigned',
                    fullNameTooltip: 'Unassigned',
                    firstName: '',
                    lastName: '',
                    preferredName: null,
                    photoUrl: null,
                    count: Number(row.count || 0),
                };
            }

            const summary = assigneeSummaryMap.get(assigneeUid);
            return {
                uid: assigneeUid,
                displayName: summary?.displayName || assigneeUid,
                fullNameTooltip: summary?.fullNameTooltip || assigneeUid,
                firstName: summary?.firstName || '',
                lastName: summary?.lastName || '',
                preferredName: summary?.preferredName || null,
                photoUrl: summary?.photoUrl || null,
                count: Number(row.count || 0),
            };
        }).sort((left, right) => right.count - left.count);

        return {
            reviews: {
                total: totalVisible + totalHidden,
                visible: totalVisible,
                hidden: totalHidden,
                avgRating: parseFloat(avgRating.toFixed(2)),
                fiveStarCount,
                lowRatingCount,
                ratingDistribution: ratingDist,
                channelBreakdown: channelData,
                monthlyTrend: reviewMonthlyTrend.map(m => ({
                    month: m.month,
                    count: Number(m.count),
                    avgRating: parseFloat(Number(m.avgRating).toFixed(2)),
                })),
            },
            mitigation: {
                total: totalMitigation,
                open: openMitigation,
                closed: closedMitigation,
                byStatus: mitigationStatusData,
                monthlyTrend: mitigationMonthlyTrend.map(m => ({ month: m.month, count: Number(m.count) })),
                propertyTypeDistribution: Object.entries(propertyTypeCounts).map(([type, count]) => ({ type, count })),
                assigneeDistribution,
            },
        };
    }

    async getReviewsDashboardDrilldown(filters: DashboardDrilldownFilters = {}) {
        const dimension = String(filters.dimension || '').trim() as DashboardDrilldownDimension;
        const value = String(filters.value || '').trim();

        if (!dimension || !value) {
            throw CustomErrorHandler.validationError('Dashboard drilldown requires both dimension and value.');
        }

        const allowedDimensions: DashboardDrilldownDimension[] = [
            'review_rating',
            'review_channel',
            'review_month',
            'mitigation_status',
            'mitigation_month',
            'mitigation_property_type',
            'mitigation_assignee',
        ];

        if (!allowedDimensions.includes(dimension)) {
            throw CustomErrorHandler.validationError('Unsupported dashboard drilldown dimension.');
        }

        if (dimension.startsWith('review_')) {
            const listingIds = await this.resolveDashboardListingIds(filters);
            const reviewQuery = this.applyDashboardReviewFilters(
                this.reviewRepository
                    .createQueryBuilder('r')
                    .leftJoinAndSelect('r.reviewDetail', 'reviewDetail')
                    .orderBy('r.submittedAt', 'DESC')
                    .addOrderBy('r.updatedAt', 'DESC'),
                filters,
                listingIds
            );

            let title = 'Review Records';

            switch (dimension) {
                case 'review_rating': {
                    const rating = Number(value);
                    if (Number.isNaN(rating)) {
                        throw CustomErrorHandler.validationError('Invalid rating drilldown value.');
                    }
                    reviewQuery.andWhere('r.rating = :rating', { rating });
                    title = `${rating}-Star Reviews`;
                    break;
                }
                case 'review_channel':
                    if (value === 'Unknown') {
                        reviewQuery.andWhere('(r.channelName IS NULL OR TRIM(r.channelName) = "")');
                    } else {
                        reviewQuery.andWhere('r.channelName = :channelName', { channelName: value });
                    }
                    title = `Reviews for ${value}`;
                    break;
                case 'review_month':
                    reviewQuery.andWhere("DATE_FORMAT(r.submittedAt, '%Y-%m') = :month", { month: value });
                    title = `Reviews Submitted in ${value}`;
                    break;
                default:
                    break;
            }

            const reviews = await reviewQuery.getMany();
            const listingIdsForResults = Array.from(new Set(reviews.map((review) => Number(review.listingMapId)).filter(Boolean)));
            const listingRows = listingIdsForResults.length > 0
                ? await this.listingRepo.find({ where: { id: In(listingIdsForResults) }, select: ['id', 'tags'] })
                : [];
            const listingTagMap = new Map(listingRows.map((listing) => [Number(listing.id), listing.tags]));

            return {
                title,
                kind: 'review',
                records: reviews.map((review) => ({
                    recordType: 'review',
                    id: String(review.id),
                    reviewerName: review.reviewerName,
                    listingMapId: review.listingMapId,
                    channelId: review.channelId,
                    channelName: review.channelName,
                    rating: review.rating,
                    externalReservationId: review.externalReservationId,
                    publicReview: review.publicReview,
                    privateReview: review.privateReview,
                    submittedAt: review.submittedAt,
                    arrivalDate: review.arrivalDate,
                    departureDate: review.departureDate,
                    listingName: review.listingName,
                    externalListingName: review.externalListingName,
                    guestName: review.guestName || review.reviewerName,
                    createdAt: review.createdAt,
                    updatedAt: review.updatedAt,
                    isHidden: review.isHidden,
                    visibility: review.visibility,
                    reviewDetail: review.reviewDetail || null,
                    bookingAmount: review.bookingAmount,
                    reservationId: review.reservationId ? String(review.reservationId) : undefined,
                    createdBy: review.createdBy,
                    updatedBy: review.updatedBy,
                    propertyType: this.extractPropertyTypeFromTags(listingTagMap.get(Number(review.listingMapId))) || null,
                    status: review.reviewDetail?.claimResolutionStatus || null,
                })),
            };
        }

        const mitigationFilters: DashboardFilters = { ...filters };
        let listingIds = await this.resolveDashboardListingIds(mitigationFilters);
        let title = 'Mitigation Records';

        if (dimension === 'mitigation_property_type') {
            listingIds = await this.resolveDashboardListingIds({
                ...mitigationFilters,
                propertyType: [value],
            });
            title = `${value} Mitigation Records`;
        }

        const mitigationQuery = this.applyDashboardMitigationFilters(
            this.reviewCheckoutRepo
                .createQueryBuilder('rc')
                .leftJoinAndSelect('rc.reservationInfo', 'ri')
                .where('(rc.status != :archivedStatus OR rc.status IS NULL)', { archivedStatus: ReviewCheckoutStatus.ARCHIVED })
                .orderBy('rc.updatedAt', 'DESC')
                .addOrderBy('rc.createdAt', 'DESC'),
            mitigationFilters,
            listingIds
        );

        switch (dimension) {
            case 'mitigation_status':
                mitigationQuery.andWhere('COALESCE(rc.status, :emptyStatus) = :statusValue', {
                    emptyStatus: '',
                    statusValue: value,
                });
                title = `Mitigation Status: ${value}`;
                break;
            case 'mitigation_assignee':
                if (value === '__unassigned__') {
                    mitigationQuery.andWhere('(rc.assignee IS NULL OR TRIM(rc.assignee) = "")');
                    title = 'Unassigned Mitigation Records';
                } else {
                    mitigationQuery.andWhere('rc.assignee = :assigneeValue', { assigneeValue: value });
                    const assigneeSummaryMap = await this.buildDashboardUserSummaryMap([value]);
                    title = `${assigneeSummaryMap.get(value)?.displayName || value} Mitigation Records`;
                }
                break;
            case 'mitigation_month':
                mitigationQuery.andWhere("DATE_FORMAT(rc.createdAt, '%Y-%m') = :month", { month: value });
                title = `Mitigation Created in ${value}`;
                break;
            default:
                break;
        }

        const mitigationRows = await mitigationQuery.getMany();
        const reservationIds = Array.from(
            new Set(
                mitigationRows
                    .map((row) => Number(row.reservationInfo?.id || 0))
                    .filter(Boolean)
            )
        );
        const listingIdsForResults = Array.from(
            new Set(
                mitigationRows
                    .map((row) => Number(row.reservationInfo?.listingMapId || 0))
                    .filter(Boolean)
            )
        );

        const [matchingReviews, listings] = await Promise.all([
            reservationIds.length > 0
                ? this.reviewRepository.find({
                    where: { reservationId: In(reservationIds as any) },
                    relations: ['reviewDetail', 'reviewDetail.removalAttempts'],
                })
                : Promise.resolve([]),
            listingIdsForResults.length > 0
                ? this.listingRepo.find({ where: { id: In(listingIdsForResults) }, select: ['id', 'tags'] })
                : Promise.resolve([]),
        ]);

        const reviewMap = new Map(matchingReviews.map((review) => [Number(review.reservationId), review]));
        const listingTagMap = new Map(listings.map((listing) => [Number(listing.id), listing.tags]));

        return {
            title,
            kind: 'mitigation',
            records: mitigationRows.map((row) => {
                const reservationInfo = row.reservationInfo;
                const matchedReview = reviewMap.get(Number(reservationInfo?.id || 0));
                return {
                    recordType: 'mitigation',
                    id: String(row.id),
                    reservationId: reservationInfo?.id,
                    listingId: reservationInfo?.listingMapId,
                    status: row.status || ReviewCheckoutStatus.NEW,
                    channelName: reservationInfo?.channelName || '',
                    propertyType: this.extractPropertyTypeFromTags(listingTagMap.get(Number(reservationInfo?.listingMapId || 0))) || 'Unknown',
                    listingName: reservationInfo?.listingName || matchedReview?.listingName || '',
                    guestName: reservationInfo?.guestName || matchedReview?.guestName || matchedReview?.reviewerName || '',
                    arrivalDate: reservationInfo?.arrivalDate || matchedReview?.arrivalDate || null,
                    departureDate: reservationInfo?.departureDate || matchedReview?.departureDate || null,
                    aiAnalysis: null,
                    issues: [],
                    rating: matchedReview?.rating ?? null,
                    isHidden: matchedReview?.isHidden ?? 0,
                    visibility: matchedReview?.visibility ?? row.visibility ?? 'Awaiting Review',
                    reviewId: matchedReview ? Number(matchedReview.id) : null,
                    assignee: row.assignee || null,
                    assigneeName: row.assignee || null,
                    publicReview: matchedReview?.publicReview ?? null,
                    privateReview: matchedReview?.privateReview ?? null,
                    submittedAt: matchedReview?.submittedAt ?? null,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt,
                    createdBy: row.createdBy,
                    updatedBy: row.updatedBy,
                    reviewDetail: matchedReview?.reviewDetail || null,
                    confirmationCode: reservationInfo?.confirmation_code || '',
                    phoneNumber: reservationInfo?.phone || '',
                    totalPaid: reservationInfo?.totalPrice ? Number(reservationInfo.totalPrice) : null,
                    ownerRevenue: reservationInfo?.owner_revenue ?? null,
                    refundAmount: null,
                    refundStatus: null,
                    refundExplanation: null,
                    refundPercent: null,
                    refundRequestId: null,
                    resolutionNotes: matchedReview?.reviewDetail?.notes ?? null,
                    checkInTime: reservationInfo?.checkInTime ?? null,
                    checkOutTime: reservationInfo?.checkOutTime ?? null,
                    timeZoneName: null,
                    tags: [],
                    integration: reservationInfo?.integration_nickname || '',
                };
            }),
        };
    }


}
