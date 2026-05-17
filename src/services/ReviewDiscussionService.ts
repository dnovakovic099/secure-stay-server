import { appDatabase } from "../utils/database.util";
import { ReviewDiscussionAttachment, ReviewDiscussionMessageEntity, ReviewDiscussionSourceType } from "../entity/ReviewDiscussionMessage";
import { ReviewDiscussionReactionEntity, ReviewDiscussionReactionType } from "../entity/ReviewDiscussionReaction";
import { ReviewEntity } from "../entity/Review";
import { UsersEntity } from "../entity/Users";
import { Issue } from "../entity/Issue";
import { GuestAnalysisEntity } from "../entity/GuestAnalysis";
import { ReviewDetailEntity } from "../entity/ReviewDetail";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ReviewCheckout } from "../entity/ReviewCheckout";
import { Employee } from "../entity/Employee";
import { FileInfo } from "../entity/FileInfo";
import { ResolutionsTeamSlackService } from "./ResolutionsTeamSlackService";
import logger from "../utils/logger.utils";
import { getSlackUsers } from "../utils/getSlackUsers";
import { generateSlackMessageLink } from "../helpers/helpers";

type DiscussionFilter = "all" | "notes" | "system" | "ai" | "mentions";
type DiscussionSort = "oldest" | "newest";

interface ReactionSummary {
    reaction: ReviewDiscussionReactionType;
    count: number;
    reactedByCurrentUser: boolean;
}

interface DiscussionItemDTO {
    id: string;
    persistentId: number | null;
    authorId?: string | null;
    parentMessageId: string | null;
    sourceType: ReviewDiscussionSourceType;
    authorName: string;
    authorAvatar?: string;
    content: string;
    mentions: string[];
    createdAt: string;
    metadata?: Record<string, any> | null;
    reactions: ReactionSummary[];
    replies: DiscussionItemDTO[];
    canReply: boolean;
    canReact: boolean;
    canEdit: boolean;
    canDelete: boolean;
}

interface DiscussionThreadDTO {
    exists: boolean;
    slackThreadTs: string | null;
    slackChannelId: string | null;
    slackPermalink: string | null;
}

const ALLOWED_REACTIONS: ReviewDiscussionReactionType[] = ["eyes", "heart", "check", "warning"];

export class ReviewDiscussionService {
    private messageRepo = appDatabase.getRepository(ReviewDiscussionMessageEntity);
    private reactionRepo = appDatabase.getRepository(ReviewDiscussionReactionEntity);
    private reviewRepo = appDatabase.getRepository(ReviewEntity);
    private userRepo = appDatabase.getRepository(UsersEntity);
    private issueRepo = appDatabase.getRepository(Issue);
    private analysisRepo = appDatabase.getRepository(GuestAnalysisEntity);
    private reviewDetailRepo = appDatabase.getRepository(ReviewDetailEntity);
    private reviewCheckoutRepo = appDatabase.getRepository(ReviewCheckout);
    private employeeRepo = appDatabase.getRepository(Employee);
    private fileInfoRepo = appDatabase.getRepository(FileInfo);

    private normalizeFilter(filter?: string): DiscussionFilter {
        const value = String(filter || "all").toLowerCase();
        if (value === "notes") return "notes";
        if (value === "system") return "system";
        if (value === "ai") return "ai";
        if (value === "mentions") return "mentions";
        return "all";
    }

    private normalizeSort(sort?: string): DiscussionSort {
        return String(sort || "oldest").toLowerCase() === "newest" ? "newest" : "oldest";
    }

    private getBaseUrl() {
        const configuredBaseUrl = String(process.env.BASE_URL || "").trim();
        return (
            configuredBaseUrl && !/localhost|127\.0\.0\.1/i.test(configuredBaseUrl)
                ? configuredBaseUrl
                : "https://securestay.ai"
        ).replace(/\/$/, "");
    }

    private buildDiscussionAttachmentUrl(fileName: string) {
        return `${this.getBaseUrl()}/review/discussion/attachment/${encodeURIComponent(fileName)}`;
    }

    private buildAttachments(files?: Express.Multer.File[] | null): ReviewDiscussionAttachment[] {
        return (files || []).map((file) => ({
            fileName: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            url: this.buildDiscussionAttachmentUrl(file.filename),
        }));
    }

    private extractMentions(content: string) {
        const slackMatches = Array.from(content.matchAll(/<@([A-Za-z0-9]+)(?:\|[^>]+)?>/g))
            .map((match) => `<@${match[1]}>`);
        const handleMatches = Array.from(content.matchAll(/(^|[^<])@([a-zA-Z0-9._-]+)/g))
            .map((match) => `@${match[2]}`);
        return Array.from(new Set([
            ...slackMatches.map((match) => match.toLowerCase()),
            ...handleMatches.map((match) => match.toLowerCase()),
        ]));
    }

    private buildEmployeePhotoUrl(fileInfo?: FileInfo | null) {
        if (!fileInfo) return null;

        if (fileInfo.status === "uploaded" && fileInfo.driveFileId) {
            return `${process.env.BASE_URL}/getdriveimage/${fileInfo.driveFileId}`;
        }

        if (fileInfo.localPath && fileInfo.fileName) {
            return `${process.env.BASE_URL}/getimage/employees/${fileInfo.fileName}`;
        }

        return null;
    }

    private async getUserDisplay(userId: string) {
        const user = await this.userRepo.findOne({ where: { uid: userId } });
        if (!user) {
            return {
                userName: userId || "SecureStay User",
                mentionKeys: userId ? [`@${String(userId).toLowerCase()}`] : [],
                avatarUrl: null as string | null,
            };
        }

        const employee = await this.employeeRepo.findOne({
            where: { userId: user.id, deletedAt: null as any },
            select: ["userId", "preferredName", "profilePhoto", "slackUserId"],
        });
        const firstName = String(user.firstName || "").trim();
        const lastName = String(user.lastName || "").trim();
        const preferredName = String(employee?.preferredName || "").trim();
        const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
        const userName = preferredName || firstName || user.email || user.uid || "SecureStay User";
        const mentionKeys = new Set<string>();
        if (firstName) mentionKeys.add(`@${firstName.toLowerCase()}`);
        if (lastName) mentionKeys.add(`@${lastName.toLowerCase()}`);
        if (preferredName) mentionKeys.add(`@${preferredName.toLowerCase()}`);
        if (fullName) mentionKeys.add(`@${fullName.toLowerCase().replace(/\s+/g, ".")}`);
        if (user.email) mentionKeys.add(`@${user.email.toLowerCase().split("@")[0]}`);
        if (user.uid) mentionKeys.add(`@${user.uid.toLowerCase()}`);
        if (employee?.slackUserId) mentionKeys.add(`<@${String(employee.slackUserId).toLowerCase()}>`);

        const profilePhotoId = Number(employee?.profilePhoto);
        const photoInfo = !Number.isNaN(profilePhotoId) && profilePhotoId > 0
            ? await this.fileInfoRepo.findOne({ where: { id: profilePhotoId } })
            : null;
        const slackUsers = await getSlackUsers();
        const slackAvatarUrl = employee?.slackUserId
            ? slackUsers.find((member: any) => member.id === employee.slackUserId)?.image || null
            : null;

        return {
            userName,
            mentionKeys: Array.from(mentionKeys),
            avatarUrl: this.buildEmployeePhotoUrl(photoInfo) || slackAvatarUrl,
        };
    }

    private buildReactionSummary(
        messageId: number,
        reactions: ReviewDiscussionReactionEntity[],
        currentUserId: string
    ): ReactionSummary[] {
        return ALLOWED_REACTIONS.map((reaction) => {
            const matched = reactions.filter((item) => item.messageId === messageId && item.reaction === reaction);
            return {
                reaction,
                count: matched.length,
                reactedByCurrentUser: matched.some((item) => item.userId === currentUserId),
            };
        });
    }

    private canEditMessage(message: ReviewDiscussionMessageEntity, currentUserId: string) {
        return (
            message.sourceType === "note" &&
            !!message.authorId &&
            message.authorId === currentUserId &&
            message.metadata?.source !== "slack"
        );
    }

    private canDeleteMessage(message: ReviewDiscussionMessageEntity, currentUserId: string) {
        return this.canEditMessage(message, currentUserId);
    }

    private async findMessageDtoById(
        fetchFeed: Promise<{ items: DiscussionItemDTO[] }>,
        messageId: number
    ) {
        const feed = await fetchFeed;
        return feed.items.find((item) => item.id === String(messageId))
            || feed.items.flatMap((item) => item.replies).find((item) => item.id === String(messageId))
            || null;
    }

    private sortItems<T extends { createdAt: string }>(items: T[], sort: DiscussionSort) {
        return [...items].sort((left, right) => {
            const diff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
            return sort === "newest" ? -diff : diff;
        });
    }

    private async buildSystemAndAiMessages(review: ReviewEntity): Promise<DiscussionItemDTO[]> {
        const items: DiscussionItemDTO[] = [];
        const reviewDetail = await this.reviewDetailRepo.findOne({
            where: { reviewId: review.id },
        });

        items.push({
            id: `system-review-${review.id}`,
            persistentId: null,
            parentMessageId: null,
            sourceType: "system",
            authorName: "SecureStay",
            content: `Review submitted with visibility currently set to ${review.isHidden ? "Hidden" : "Visible"}.`,
            mentions: [],
            createdAt: review.submittedAt ? new Date(review.submittedAt).toISOString() : review.createdAt?.toISOString?.() || new Date().toISOString(),
            metadata: { eventType: "review_submitted" },
            reactions: [],
            replies: [],
            canReply: false,
            canReact: false,
            canEdit: false,
            canDelete: false,
        });

        if (reviewDetail?.createdAt) {
            items.push({
                id: `system-detail-${review.id}`,
                persistentId: null,
                parentMessageId: null,
                sourceType: "system",
                authorName: "SecureStay",
                content: `Review detail ${reviewDetail?.updatedAt && reviewDetail.updatedAt !== reviewDetail.createdAt ? "updated" : "created"}${reviewDetail?.claimResolutionStatus ? ` with status ${reviewDetail.claimResolutionStatus}` : ""}.`,
                mentions: [],
                createdAt: new Date(reviewDetail.updatedAt || reviewDetail.createdAt).toISOString(),
                metadata: { eventType: "review_detail" },
                reactions: [],
                replies: [],
                canReply: false,
                canReact: false,
                canEdit: false,
                canDelete: false,
            });
        }

        if (review.reservationId) {
            const issues = await this.issueRepo.find({
                where: { reservation_id: String(review.reservationId) },
                order: { created_at: "ASC" },
            });

            issues.forEach((issue) => {
                items.push({
                    id: `system-issue-${issue.id}`,
                    persistentId: null,
                    parentMessageId: null,
                    sourceType: "system",
                    authorName: "SecureStay",
                    content: `Issue ${issue.status ? `(${issue.status})` : ""}: ${issue.issue_description || "Issue linked to this reservation"}`,
                    mentions: [],
                    createdAt: issue.updated_at?.toISOString?.() || issue.created_at?.toISOString?.() || new Date().toISOString(),
                    metadata: { eventType: "issue", category: issue.category || null },
                    reactions: [],
                    replies: [],
                    canReply: false,
                    canReact: false,
                    canEdit: false,
                    canDelete: false,
                });
            });
        }

        if (review.reservationId) {
            const analyses = await this.analysisRepo.find({
                where: { reservationId: Number(review.reservationId) },
                order: { analyzedAt: "DESC" },
            });

            analyses.forEach((analysis) => {
                items.push({
                    id: `ai-${analysis.id}`,
                    persistentId: null,
                    parentMessageId: null,
                    sourceType: "ai",
                    authorName: analysis.analyzedBy === "auto" ? "AI Manager" : "AI Analysis",
                    content: analysis.summary || "AI analysis generated",
                    mentions: [],
                    createdAt: analysis.analyzedAt?.toISOString?.() || new Date().toISOString(),
                    metadata: {
                        sentiment: analysis.sentiment,
                        flagCount: Array.isArray(analysis.flags) ? analysis.flags.length : 0,
                    },
                    reactions: [],
                    replies: [],
                    canReply: false,
                    canReact: false,
                    canEdit: false,
                    canDelete: false,
                });
            });
        }

        return items;
    }

    private matchesMentionFilter(item: DiscussionItemDTO, currentUserMentions: string[]) {
        const searchable = `${item.content} ${item.authorName}`.toLowerCase();
        return item.mentions.some((mention) => currentUserMentions.includes(mention)) ||
            currentUserMentions.some((mention) => searchable.includes(mention));
    }

    private buildSlackPermalink(channelId?: string | null, messageTs?: string | null) {
        const workspaceUrl = String(process.env.SLACK_WORKSPACE_URL || "").trim();
        if (!workspaceUrl || !channelId || !messageTs) return null;
        return generateSlackMessageLink(workspaceUrl.replace(/\/$/, ""), channelId, messageTs);
    }

    async getReservationThreadInfo(reservationId: string): Promise<DiscussionThreadDTO> {
        const reviewCheckout = await this.reviewCheckoutRepo.findOne({
            where: { reservationInfo: { id: Number(reservationId) } },
            select: ["id", "slackChannelId", "slackThreadTs"],
        });

        return {
            exists: Boolean(reviewCheckout?.slackThreadTs && reviewCheckout?.slackChannelId),
            slackThreadTs: reviewCheckout?.slackThreadTs || null,
            slackChannelId: reviewCheckout?.slackChannelId || null,
            slackPermalink: this.buildSlackPermalink(reviewCheckout?.slackChannelId || null, reviewCheckout?.slackThreadTs || null),
        };
    }

    async ensureReservationThread(reservationId: string, userId: string): Promise<DiscussionThreadDTO> {
        const slackService = new ResolutionsTeamSlackService();
        const result = await slackService.ensureThreadForReservation(Number(reservationId), userId);
        return {
            exists: Boolean(result?.slackThreadTs && result?.slackChannelId),
            slackThreadTs: result?.slackThreadTs || null,
            slackChannelId: result?.slackChannelId || null,
            slackPermalink: this.buildSlackPermalink(result?.slackChannelId || null, result?.slackThreadTs || null),
        };
    }

    private async buildStoredMessageDto(
        message: ReviewDiscussionMessageEntity,
        reactions: ReviewDiscussionReactionEntity[],
        currentUserId: string,
        slackChannelId?: string | null
    ): Promise<DiscussionItemDTO> {
        const isSlackSource = message.metadata?.source === "slack";
        const authorDisplay = message.authorId && !isSlackSource
            ? await this.getUserDisplay(message.authorId)
            : null;
        const slackMessageTs = String(message.metadata?.slackMessageTs || "").trim() || null;
        const slackPermalink = this.buildSlackPermalink(slackChannelId, slackMessageTs);

        return {
            id: String(message.id),
            persistentId: message.id,
            authorId: message.authorId,
            parentMessageId: message.parentMessageId ? String(message.parentMessageId) : null,
            sourceType: message.sourceType,
            authorName: authorDisplay?.userName || message.authorName,
            authorAvatar: authorDisplay?.avatarUrl || message.authorAvatar || undefined,
            content: message.content,
            mentions: message.mentions || [],
            createdAt: message.createdAt.toISOString(),
            metadata: {
                ...(message.metadata || {}),
                ...(slackPermalink ? { slackPermalink } : {}),
            },
            reactions: this.buildReactionSummary(message.id, reactions, currentUserId),
            replies: [],
            canReply: message.sourceType === "note" && !message.parentMessageId,
            canReact: true,
            canEdit: this.canEditMessage(message, currentUserId),
            canDelete: this.canDeleteMessage(message, currentUserId),
        };
    }

    async getDiscussionFeed(reviewId: string, filter: string | undefined, sort: string | undefined, currentUserId: string) {
        const normalizedFilter = this.normalizeFilter(filter);
        const normalizedSort = this.normalizeSort(sort);

        const review = await this.reviewRepo.findOne({ where: { id: reviewId } });
        if (!review) {
            throw CustomErrorHandler.notFound(`Review ${reviewId} not found`);
        }

        const { mentionKeys } = await this.getUserDisplay(currentUserId);
        const storedMessages = await this.messageRepo.find({
            where: { reviewId },
            order: { createdAt: "ASC" },
        });
        const reviewCheckout = review.reservationId
            ? await this.reviewCheckoutRepo.findOne({
                where: { reservationInfo: { id: Number(review.reservationId) } },
                select: ["id", "slackChannelId"],
            })
            : null;
        const reactions = storedMessages.length
            ? await this.reactionRepo.find({
                where: storedMessages.map((item) => ({ messageId: item.id })),
                order: { createdAt: "ASC" },
            })
            : [];

        const topLevel: DiscussionItemDTO[] = [];
        const replyMap = new Map<number, DiscussionItemDTO[]>();

        const mappedMessages = await Promise.all(
            storedMessages.map((message) => this.buildStoredMessageDto(message, reactions, currentUserId, reviewCheckout?.slackChannelId || null))
        );

        mappedMessages.forEach((dto) => {
            if (dto.parentMessageId) {
                const bucket = replyMap.get(Number(dto.parentMessageId)) || [];
                bucket.push(dto);
                replyMap.set(Number(dto.parentMessageId), bucket);
            } else {
                topLevel.push(dto);
            }
        });

        topLevel.forEach((item) => {
            item.replies = this.sortItems(replyMap.get(Number(item.id)) || [], "oldest");
        });

        const syntheticItems = await this.buildSystemAndAiMessages(review);
        let items = [...topLevel, ...syntheticItems];

        if (normalizedFilter === "notes") {
            items = items.filter((item) => item.sourceType === "note");
        } else if (normalizedFilter === "system") {
            items = items.filter((item) => item.sourceType === "system");
        } else if (normalizedFilter === "ai") {
            items = items.filter((item) => item.sourceType === "ai");
        } else if (normalizedFilter === "mentions") {
            items = items.filter((item) => this.matchesMentionFilter(item, mentionKeys) || item.replies.some((reply) => this.matchesMentionFilter(reply, mentionKeys)));
        }

        items = this.sortItems(items, normalizedSort);

        return {
            reviewId,
            filter: normalizedFilter,
            sort: normalizedSort,
            items,
            allowedReactions: ALLOWED_REACTIONS,
        };
    }

    async createMessage(reviewId: string, content: string, parentMessageId: number | null, userId: string, files?: Express.Multer.File[] | null) {
        const review = await this.reviewRepo.findOne({ where: { id: reviewId } });
        if (!review) {
            throw CustomErrorHandler.notFound(`Review ${reviewId} not found`);
        }

        const trimmedContent = String(content || "").trim();
        if (!trimmedContent) {
            throw CustomErrorHandler.validationError("Content is required");
        }

        if (parentMessageId) {
            const parent = await this.messageRepo.findOne({ where: { id: parentMessageId, reviewId } });
            if (!parent) {
                throw CustomErrorHandler.notFound(`Parent message ${parentMessageId} not found`);
            }
        }

        const { userName, avatarUrl } = await this.getUserDisplay(userId);
        const message = this.messageRepo.create({
            reviewId,
            parentMessageId,
            sourceType: "note",
            authorId: userId,
            authorName: userName,
            authorAvatar: avatarUrl,
            content: trimmedContent,
            mentions: this.extractMentions(trimmedContent),
            metadata: {
                source: "app",
                attachments: this.buildAttachments(files),
            },
        });

        const saved = await this.messageRepo.save(message);
        return this.findMessageDtoById(this.getDiscussionFeed(reviewId, "all", "oldest", userId), saved.id);
    }

    async updateMessage(reviewId: string, messageId: number, content: string, userId: string) {
        const review = await this.reviewRepo.findOne({ where: { id: reviewId } });
        if (!review) {
            throw CustomErrorHandler.notFound(`Review ${reviewId} not found`);
        }

        const message = await this.messageRepo.findOne({ where: { id: messageId, reviewId } });
        if (!message) {
            throw CustomErrorHandler.notFound(`Message ${messageId} not found`);
        }

        if (!this.canEditMessage(message, userId)) {
            throw CustomErrorHandler.forbidden("This discussion entry cannot be edited");
        }

        const trimmedContent = String(content || "").trim();
        if (!trimmedContent) {
            throw CustomErrorHandler.validationError("Content is required");
        }

        message.content = trimmedContent;
        message.mentions = this.extractMentions(trimmedContent);
        message.metadata = {
            ...(message.metadata || {}),
            source: message.metadata?.source || "app",
            editedAt: new Date().toISOString(),
        };

        const saved = await this.messageRepo.save(message);
        return this.findMessageDtoById(this.getDiscussionFeed(reviewId, "all", "oldest", userId), saved.id);
    }

    async toggleReaction(reviewId: string, messageId: number, reaction: string, userId: string) {
        if (!ALLOWED_REACTIONS.includes(reaction as ReviewDiscussionReactionType)) {
            throw CustomErrorHandler.validationError("Unsupported reaction");
        }

        const message = await this.messageRepo.findOne({ where: { id: messageId, reviewId } });
        if (!message) {
            throw CustomErrorHandler.notFound(`Message ${messageId} not found`);
        }

        const { userName } = await this.getUserDisplay(userId);
        const existing = await this.reactionRepo.findOne({
            where: {
                messageId,
                userId,
                reaction: reaction as ReviewDiscussionReactionType,
            },
        });

        if (existing) {
            await this.reactionRepo.remove(existing);
        } else {
            const created = this.reactionRepo.create({
                messageId,
                userId,
                userName,
                reaction: reaction as ReviewDiscussionReactionType,
            });
            await this.reactionRepo.save(created);
        }

        const feed = await this.getDiscussionFeed(reviewId, "all", "oldest", userId);
        return feed.items.find((item) => item.id === String(messageId))
            || feed.items.flatMap((item) => item.replies).find((item) => item.id === String(messageId))
            || null;
    }

    private async buildSystemAndAiMessagesByReservation(reservationId: number): Promise<DiscussionItemDTO[]> {
        const items: DiscussionItemDTO[] = [];

        const issues = await this.issueRepo.find({
            where: { reservation_id: String(reservationId) },
            order: { created_at: "ASC" },
        });
        issues.forEach((issue) => {
            items.push({
                id: `system-issue-${issue.id}`,
                persistentId: null,
                parentMessageId: null,
                sourceType: "system",
                authorName: "SecureStay",
                content: `Issue ${issue.status ? `(${issue.status})` : ""}: ${issue.issue_description || "Issue linked to this reservation"}`,
                mentions: [],
                createdAt: issue.updated_at?.toISOString?.() || issue.created_at?.toISOString?.() || new Date().toISOString(),
                metadata: { eventType: "issue", category: issue.category || null },
                reactions: [],
                replies: [],
                canReply: false,
                canReact: false,
                canEdit: false,
                canDelete: false,
            });
        });

        const analyses = await this.analysisRepo.find({
            where: { reservationId },
            order: { analyzedAt: "DESC" },
        });
        analyses.forEach((analysis) => {
            items.push({
                id: `ai-${analysis.id}`,
                persistentId: null,
                parentMessageId: null,
                sourceType: "ai",
                authorName: analysis.analyzedBy === "auto" ? "AI Manager" : "AI Analysis",
                content: analysis.summary || "AI analysis generated",
                mentions: [],
                createdAt: analysis.analyzedAt?.toISOString?.() || new Date().toISOString(),
                metadata: {
                    sentiment: analysis.sentiment,
                    flagCount: Array.isArray(analysis.flags) ? analysis.flags.length : 0,
                },
                reactions: [],
                replies: [],
                canReply: false,
                canReact: false,
                canEdit: false,
                canDelete: false,
            });
        });

        return items;
    }

    async getDiscussionFeedByReservation(reservationId: string, filter: string | undefined, sort: string | undefined, currentUserId: string) {
        const normalizedFilter = this.normalizeFilter(filter);
        const normalizedSort = this.normalizeSort(sort);
        const { mentionKeys } = await this.getUserDisplay(currentUserId);

        const storedMessages = await this.messageRepo.find({
            where: { reservationId: Number(reservationId) },
            order: { createdAt: "ASC" },
        });
        const reviewCheckout = await this.reviewCheckoutRepo.findOne({
            where: { reservationInfo: { id: Number(reservationId) } },
            select: ["id", "slackChannelId"],
        });
        const reactions = storedMessages.length
            ? await this.reactionRepo.find({
                where: storedMessages.map((item) => ({ messageId: item.id })),
                order: { createdAt: "ASC" },
            })
            : [];

        const topLevel: DiscussionItemDTO[] = [];
        const replyMap = new Map<number, DiscussionItemDTO[]>();

        const mappedMessages = await Promise.all(
            storedMessages.map((message) => this.buildStoredMessageDto(message, reactions, currentUserId, reviewCheckout?.slackChannelId || null))
        );

        mappedMessages.forEach((dto) => {
            if (dto.parentMessageId) {
                const bucket = replyMap.get(Number(dto.parentMessageId)) || [];
                bucket.push(dto);
                replyMap.set(Number(dto.parentMessageId), bucket);
            } else {
                topLevel.push(dto);
            }
        });

        topLevel.forEach((item) => {
            item.replies = this.sortItems(replyMap.get(Number(item.id)) || [], "oldest");
        });

        const syntheticItems = await this.buildSystemAndAiMessagesByReservation(Number(reservationId));
        let items = [...topLevel, ...syntheticItems];

        if (normalizedFilter === "notes") {
            items = items.filter((item) => item.sourceType === "note");
        } else if (normalizedFilter === "system") {
            items = items.filter((item) => item.sourceType === "system");
        } else if (normalizedFilter === "ai") {
            items = items.filter((item) => item.sourceType === "ai");
        } else if (normalizedFilter === "mentions") {
            items = items.filter((item) => this.matchesMentionFilter(item, mentionKeys) || item.replies.some((reply) => this.matchesMentionFilter(reply, mentionKeys)));
        }

        items = this.sortItems(items, normalizedSort);

        return {
            reservationId,
            filter: normalizedFilter,
            sort: normalizedSort,
            items,
            allowedReactions: ALLOWED_REACTIONS,
        };
    }

    async createMessageByReservation(reservationId: string, content: string, parentMessageId: number | null, userId: string, files?: Express.Multer.File[] | null) {
        const trimmedContent = String(content || "").trim();
        const attachments = this.buildAttachments(files);
        if (!trimmedContent && attachments.length === 0) {
            throw CustomErrorHandler.validationError("Content or attachments are required");
        }

        if (parentMessageId) {
            const parent = await this.messageRepo.findOne({ where: { id: parentMessageId, reservationId: Number(reservationId) } });
            if (!parent) {
                throw CustomErrorHandler.notFound(`Parent message ${parentMessageId} not found`);
            }
        }

        const { userName, avatarUrl } = await this.getUserDisplay(userId);
        const message = this.messageRepo.create({
            reviewId: null,
            reservationId: Number(reservationId),
            parentMessageId,
            sourceType: "note",
            authorId: userId,
            authorName: userName,
            authorAvatar: avatarUrl,
            content: trimmedContent,
            mentions: this.extractMentions(trimmedContent),
            metadata: {
                source: "app",
                attachments,
            },
        });

        let saved = await this.messageRepo.save(message);

        try {
            const rc = await this.reviewCheckoutRepo.findOne({
                where: { reservationInfo: { id: Number(reservationId) } },
                select: ["id", "slackThreadTs"],
            });
            if (rc?.slackThreadTs) {
                const resolutionsService = new ResolutionsTeamSlackService();
                const slackMessageTs = await resolutionsService.postActivityToThread(rc.id, {
                    type: "comment",
                    actor: userId,
                    details: [trimmedContent, ...attachments.map((attachment) => attachment.url)].filter(Boolean).join("\n"),
                });
                if (slackMessageTs && slackMessageTs !== rc.slackThreadTs) {
                    saved.metadata = {
                        ...(saved.metadata || {}),
                        source: "app",
                        slackMessageTs,
                    };
                    saved = await this.messageRepo.save(saved);
                }
            }
        } catch (err) {
            logger.error("[ReviewDiscussion] Failed to post note to Slack thread:", err);
        }

        return this.findMessageDtoById(this.getDiscussionFeedByReservation(reservationId, "all", "oldest", userId), saved.id);
    }

    async updateMessageByReservation(reservationId: string, messageId: number, content: string, userId: string) {
        const message = await this.messageRepo.findOne({
            where: { id: messageId, reservationId: Number(reservationId) },
        });
        if (!message) {
            throw CustomErrorHandler.notFound(`Message ${messageId} not found`);
        }

        if (!this.canEditMessage(message, userId)) {
            throw CustomErrorHandler.forbidden("This discussion entry cannot be edited");
        }

        const trimmedContent = String(content || "").trim();
        if (!trimmedContent) {
            throw CustomErrorHandler.validationError("Content is required");
        }

        const previousContent = message.content;

        message.content = trimmedContent;
        message.mentions = this.extractMentions(trimmedContent);
        message.metadata = {
            ...(message.metadata || {}),
            source: message.metadata?.source || "app",
            editedAt: new Date().toISOString(),
        };

        const saved = await this.messageRepo.save(message);

        try {
            const rc = await this.reviewCheckoutRepo.findOne({
                where: { reservationInfo: { id: Number(reservationId) } },
                select: ["id", "slackThreadTs"],
            });
            if (rc?.slackThreadTs) {
                const resolutionsService = new ResolutionsTeamSlackService();
                const slackMessageTs = String(message.metadata?.slackMessageTs || "").trim();
                if (slackMessageTs && slackMessageTs !== rc.slackThreadTs) {
                    await resolutionsService.updateActivityMessageInThread(rc.id, slackMessageTs, {
                        type: "comment",
                        actor: userId,
                        details: trimmedContent,
                        oldValue: previousContent,
                        newValue: trimmedContent,
                    });
                }
            }
        } catch (err) {
            logger.error("[ReviewDiscussion] Failed to sync edited note to Slack thread:", err);
        }

        return this.findMessageDtoById(
            this.getDiscussionFeedByReservation(reservationId, "all", "oldest", userId),
            saved.id
        );
    }

    private async deleteMessageCascade(message: ReviewDiscussionMessageEntity) {
        const stack = [message];
        const messagesToDelete: ReviewDiscussionMessageEntity[] = [];

        while (stack.length) {
            const current = stack.pop();
            if (!current) continue;
            messagesToDelete.push(current);
            const replies = await this.messageRepo.find({ where: { parentMessageId: current.id } });
            stack.push(...replies);
        }

        for (const item of messagesToDelete.reverse()) {
            await this.reactionRepo.delete({ messageId: item.id });
            await this.messageRepo.delete({ id: item.id });
        }
    }

    async deleteMessageByReservation(reservationId: string, messageId: number, userId: string) {
        const message = await this.messageRepo.findOne({
            where: { id: messageId, reservationId: Number(reservationId) },
        });
        if (!message) {
            throw CustomErrorHandler.notFound(`Message ${messageId} not found`);
        }

        if (!this.canDeleteMessage(message, userId)) {
            throw CustomErrorHandler.forbidden("This discussion entry cannot be deleted");
        }

        const slackMessageTs = String(message.metadata?.slackMessageTs || "").trim();
        if (slackMessageTs) {
            try {
                const rc = await this.reviewCheckoutRepo.findOne({
                    where: { reservationInfo: { id: Number(reservationId) } },
                    select: ["id", "slackThreadTs"],
                });
                if (rc?.slackThreadTs && slackMessageTs !== rc.slackThreadTs) {
                    await new ResolutionsTeamSlackService().deleteActivityMessageInThread(rc.id, slackMessageTs);
                }
            } catch (err) {
                logger.error("[ReviewDiscussion] Failed to delete note from Slack thread:", err);
            }
        }

        await this.deleteMessageCascade(message);
        return { deleted: true, id: messageId };
    }

    async toggleReactionByReservation(reservationId: string, messageId: number, reaction: string, userId: string) {
        if (!ALLOWED_REACTIONS.includes(reaction as ReviewDiscussionReactionType)) {
            throw CustomErrorHandler.validationError("Unsupported reaction");
        }

        const message = await this.messageRepo.findOne({ where: { id: messageId, reservationId: Number(reservationId) } });
        if (!message) {
            throw CustomErrorHandler.notFound(`Message ${messageId} not found`);
        }

        const { userName } = await this.getUserDisplay(userId);
        const existing = await this.reactionRepo.findOne({
            where: { messageId, userId, reaction: reaction as ReviewDiscussionReactionType },
        });

        if (existing) {
            await this.reactionRepo.remove(existing);
        } else {
            const created = this.reactionRepo.create({
                messageId,
                userId,
                userName,
                reaction: reaction as ReviewDiscussionReactionType,
            });
            await this.reactionRepo.save(created);
        }

        const feed = await this.getDiscussionFeedByReservation(reservationId, "all", "oldest", userId);
        return feed.items.find((item) => item.id === String(messageId))
            || feed.items.flatMap((item) => item.replies).find((item) => item.id === String(messageId))
            || null;
    }

    async createSystemMessage(reviewId: string, content: string, metadata: Record<string, any> | null = null) {
        const review = await this.reviewRepo.findOne({ where: { id: reviewId } });
        if (!review) return null;

        const message = this.messageRepo.create({
            reviewId,
            parentMessageId: null,
            sourceType: "system",
            authorId: null,
            authorName: "SecureStay",
            authorAvatar: null,
            content: content.trim(),
            mentions: [],
            metadata,
        });

        return this.messageRepo.save(message);
    }

    async createSystemMessageByReservation(
        reservationId: number | string,
        content: string,
        metadata: Record<string, any> | null = null
    ) {
        const normalizedReservationId = Number(reservationId);
        const normalizedContent = String(content || "").trim();
        if (!normalizedReservationId || Number.isNaN(normalizedReservationId) || !normalizedContent) return null;

        const message = this.messageRepo.create({
            reviewId: null,
            reservationId: normalizedReservationId,
            parentMessageId: null,
            sourceType: "system",
            authorId: null,
            authorName: "SecureStay",
            authorAvatar: null,
            content: normalizedContent,
            mentions: [],
            metadata,
        });

        return this.messageRepo.save(message);
    }
}
