import { appDatabase } from "../utils/database.util";
import { ReviewDiscussionMessageEntity, ReviewDiscussionSourceType } from "../entity/ReviewDiscussionMessage";
import { ReviewDiscussionReactionEntity, ReviewDiscussionReactionType } from "../entity/ReviewDiscussionReaction";
import { ReviewEntity } from "../entity/Review";
import { UsersEntity } from "../entity/Users";
import { Issue } from "../entity/Issue";
import { GuestAnalysisEntity } from "../entity/GuestAnalysis";
import { ReviewDetailEntity } from "../entity/ReviewDetail";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ReviewCheckout } from "../entity/ReviewCheckout";
import { ResolutionsTeamSlackService } from "./ResolutionsTeamSlackService";
import logger from "../utils/logger.utils";

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

    private extractMentions(content: string) {
        const matches = content.match(/@([a-zA-Z0-9._-]+)/g) || [];
        return Array.from(new Set(matches.map((match) => match.toLowerCase())));
    }

    private async getUserDisplay(userId: string) {
        const user = await this.userRepo.findOne({ where: { uid: userId } });
        if (!user) {
            return {
                userName: userId || "SecureStay User",
                mentionKeys: userId ? [`@${String(userId).toLowerCase()}`] : [],
            };
        }

        const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
        const userName = fullName || user.email || user.uid || "SecureStay User";
        const mentionKeys = new Set<string>();
        if (user.firstName) mentionKeys.add(`@${String(user.firstName).toLowerCase()}`);
        if (user.lastName) mentionKeys.add(`@${String(user.lastName).toLowerCase()}`);
        if (fullName) mentionKeys.add(`@${fullName.toLowerCase().replace(/\s+/g, ".")}`);
        if (user.email) mentionKeys.add(`@${user.email.toLowerCase().split("@")[0]}`);
        if (user.uid) mentionKeys.add(`@${user.uid.toLowerCase()}`);

        return { userName, mentionKeys: Array.from(mentionKeys) };
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
        const reactions = storedMessages.length
            ? await this.reactionRepo.find({
                where: storedMessages.map((item) => ({ messageId: item.id })),
                order: { createdAt: "ASC" },
            })
            : [];

        const topLevel: DiscussionItemDTO[] = [];
        const replyMap = new Map<number, DiscussionItemDTO[]>();

        storedMessages.forEach((message) => {
            const dto: DiscussionItemDTO = {
                id: String(message.id),
                persistentId: message.id,
                parentMessageId: message.parentMessageId ? String(message.parentMessageId) : null,
                sourceType: message.sourceType,
                authorName: message.authorName,
                authorAvatar: message.authorAvatar || undefined,
                content: message.content,
                mentions: message.mentions || [],
                createdAt: message.createdAt.toISOString(),
                metadata: message.metadata || null,
                reactions: this.buildReactionSummary(message.id, reactions, currentUserId),
                replies: [],
                canReply: message.sourceType === "note" && !message.parentMessageId,
                canReact: true,
            };

            if (message.parentMessageId) {
                const bucket = replyMap.get(message.parentMessageId) || [];
                bucket.push(dto);
                replyMap.set(message.parentMessageId, bucket);
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

    async createMessage(reviewId: string, content: string, parentMessageId: number | null, userId: string) {
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

        const { userName } = await this.getUserDisplay(userId);
        const message = this.messageRepo.create({
            reviewId,
            parentMessageId,
            sourceType: "note",
            authorId: userId,
            authorName: userName,
            authorAvatar: null,
            content: trimmedContent,
            mentions: this.extractMentions(trimmedContent),
            metadata: null,
        });

        const saved = await this.messageRepo.save(message);
        return this.getDiscussionFeed(reviewId, "all", "oldest", userId).then((feed) => {
            const match = feed.items.find((item) => item.id === String(saved.id))
                || feed.items.flatMap((item) => item.replies).find((item) => item.id === String(saved.id));
            return match;
        });
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
        const reactions = storedMessages.length
            ? await this.reactionRepo.find({
                where: storedMessages.map((item) => ({ messageId: item.id })),
                order: { createdAt: "ASC" },
            })
            : [];

        const topLevel: DiscussionItemDTO[] = [];
        const replyMap = new Map<number, DiscussionItemDTO[]>();

        storedMessages.forEach((message) => {
            const dto: DiscussionItemDTO = {
                id: String(message.id),
                persistentId: message.id,
                parentMessageId: message.parentMessageId ? String(message.parentMessageId) : null,
                sourceType: message.sourceType,
                authorName: message.authorName,
                authorAvatar: message.authorAvatar || undefined,
                content: message.content,
                mentions: message.mentions || [],
                createdAt: message.createdAt.toISOString(),
                metadata: message.metadata || null,
                reactions: this.buildReactionSummary(message.id, reactions, currentUserId),
                replies: [],
                canReply: message.sourceType === "note" && !message.parentMessageId,
                canReact: true,
            };

            if (message.parentMessageId) {
                const bucket = replyMap.get(message.parentMessageId) || [];
                bucket.push(dto);
                replyMap.set(message.parentMessageId, bucket);
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

    async createMessageByReservation(reservationId: string, content: string, parentMessageId: number | null, userId: string) {
        const trimmedContent = String(content || "").trim();
        if (!trimmedContent) {
            throw CustomErrorHandler.validationError("Content is required");
        }

        if (parentMessageId) {
            const parent = await this.messageRepo.findOne({ where: { id: parentMessageId, reservationId: Number(reservationId) } });
            if (!parent) {
                throw CustomErrorHandler.notFound(`Parent message ${parentMessageId} not found`);
            }
        }

        const { userName } = await this.getUserDisplay(userId);
        const message = this.messageRepo.create({
            reviewId: null,
            reservationId: Number(reservationId),
            parentMessageId,
            sourceType: "note",
            authorId: userId,
            authorName: userName,
            authorAvatar: null,
            content: trimmedContent,
            mentions: this.extractMentions(trimmedContent),
            metadata: null,
        });

        const saved = await this.messageRepo.save(message);

        // Fire-and-forget: post the new note to the Slack thread for this reservation (if one exists)
        (async () => {
            try {
                const rc = await this.reviewCheckoutRepo.findOne({
                    where: { reservationInfo: { id: Number(reservationId) } },
                    select: ["id", "slackThreadTs"],
                });
                if (rc?.slackThreadTs) {
                    const resolutionsService = new ResolutionsTeamSlackService();
                    await resolutionsService.postActivityToThread(rc.id, {
                        type: "comment",
                        actor: userName,
                        details: trimmedContent,
                    });
                }
            } catch (err) {
                logger.error("[ReviewDiscussion] Failed to post note to Slack thread:", err);
            }
        })();

        return this.getDiscussionFeedByReservation(reservationId, "all", "oldest", userId).then((feed) => {
            const match = feed.items.find((item) => item.id === String(saved.id))
                || feed.items.flatMap((item) => item.replies).find((item) => item.id === String(saved.id));
            return match;
        });
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
}
