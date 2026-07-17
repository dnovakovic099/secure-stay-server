import { appDatabase } from "../utils/database.util";
import { AIMessageSuggestionEntity } from "../entity/AIMessageSuggestion";
import { AIMessageFeedbackEntity } from "../entity/AIMessageFeedback";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";

/**
 * Read models for the GR "AI" page:
 *  - AI Copilot: browse/review generated suggestions across all threads.
 *  - AI Manager: aggregate stats on how suggestions and human responses perform.
 */
export class AICopilotService {
    private suggestionRepo = appDatabase.getRepository(AIMessageSuggestionEntity);
    private feedbackRepo = appDatabase.getRepository(AIMessageFeedbackEntity);
    private conversationRepo = appDatabase.getRepository(InboxConversationEntity);
    private messageRepo = appDatabase.getRepository(InboxMessageEntity);

    /** Recent suggestions enriched with conversation context for the review view. */
    async listSuggestions(opts: {
        status?: string;
        escalationOnly?: boolean;
        /** Only suggestions where the model flagged limitations/missing info. */
        warningsOnly?: boolean;
        limit?: number;
        offset?: number;
    } = {}) {
        const limit = Math.min(Math.max(opts.limit || 30, 1), 100);
        const offset = Math.max(opts.offset || 0, 0);

        const qb = this.suggestionRepo
            .createQueryBuilder("s")
            .orderBy("s.generatedAt", "DESC")
            .addOrderBy("s.id", "DESC")
            .take(limit)
            .skip(offset);
        if (opts.status) qb.andWhere("s.status = :status", { status: opts.status });
        if (opts.escalationOnly) qb.andWhere("s.escalationRequired = 1");
        if (opts.warningsOnly) {
            qb.andWhere("s.warnings IS NOT NULL")
                .andWhere("s.warnings <> ''")
                .andWhere("s.warnings <> '[]'");
        }

        const suggestions = await qb.getMany();
        const threadIds = Array.from(new Set(suggestions.map((s) => Number(s.threadId)).filter(Boolean)));
        const conversations = threadIds.length
            ? await this.conversationRepo.find({ where: threadIds.map((threadId) => ({ threadId })) as any })
            : [];
        const convByThread = new Map(conversations.map((c) => [Number(c.threadId), c]));

        return suggestions.map((s) => {
            const c = convByThread.get(Number(s.threadId));
            return {
                ...s,
                conversation: c
                    ? {
                          guestName: c.guestName,
                          channel: c.channel,
                          listingName: c.listingName,
                          listingId: c.listingId,
                          lastMessageText: c.lastMessageText,
                      }
                    : null,
            };
        });
    }

    /** Aggregate performance metrics for the AI Manager tab. */
    async metrics(opts: { sinceDays?: number } = {}) {
        const sinceDays = Math.min(Math.max(opts.sinceDays || 30, 1), 365);
        const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

        const suggestions = await this.suggestionRepo
            .createQueryBuilder("s")
            .where("s.generatedAt >= :since", { since })
            .getMany();

        const byStatus: Record<string, number> = {};
        let confSum = 0;
        let confCount = 0;
        let escalated = 0;
        for (const s of suggestions) {
            byStatus[s.status] = (byStatus[s.status] || 0) + 1;
            if (s.confidence != null) {
                confSum += Number(s.confidence);
                confCount++;
            }
            if (s.escalationRequired) escalated++;
        }
        const total = suggestions.length;
        const accepted = (byStatus["accepted"] || 0) + (byStatus["edited"] || 0) + (byStatus["auto_sent"] || 0);

        const feedback = await this.feedbackRepo
            .createQueryBuilder("f")
            .where("f.createdAt >= :since", { since })
            .getMany();
        const thumbsUp = feedback.filter((f) => f.rating === "up").length;
        const thumbsDown = feedback.filter((f) => f.rating === "down").length;

        // Inquiry sales performance: drafts generated in sales mode, and how many
        // of those inquiry threads have since converted to a booking (their
        // conversation status is now accepted/confirmed). Rough but honest —
        // status comes from the live Hostify sync.
        const salesSuggestions = suggestions.filter((s) => Number(s.salesMode) === 1);
        const salesThreadIds = Array.from(new Set(salesSuggestions.map((s) => Number(s.threadId)).filter(Boolean)));
        let salesConverted = 0;
        if (salesThreadIds.length) {
            const salesConvs = await this.conversationRepo.find({
                where: salesThreadIds.map((threadId) => ({ threadId })) as any,
            });
            salesConverted = salesConvs.filter((c) =>
                /^(accepted|confirmed|booked|paid)/i.test(String(c.reservationStatus || ""))
            ).length;
        }

        // Human response volume by internal user (who is replying to guests).
        const responders = await this.messageRepo
            .createQueryBuilder("m")
            .select("m.sentByName", "name")
            .addSelect("COUNT(*)", "count")
            .where("m.direction = :dir", { dir: "outgoing" })
            .andWhere("m.sentByUserId IS NOT NULL")
            .andWhere("m.sentAt >= :since", { since })
            .groupBy("m.sentByName")
            .orderBy("count", "DESC")
            .getRawMany();

        return {
            sinceDays,
            suggestions: {
                total,
                byStatus,
                acceptanceRate: total ? Math.round((accepted / total) * 100) : 0,
                avgConfidence: confCount ? Math.round(confSum / confCount) : 0,
                escalationRate: total ? Math.round((escalated / total) * 100) : 0,
            },
            feedback: { thumbsUp, thumbsDown },
            inquirySales: {
                suggestions: salesSuggestions.length,
                threads: salesThreadIds.length,
                converted: salesConverted,
                conversionRate: salesThreadIds.length
                    ? Math.round((salesConverted / salesThreadIds.length) * 100)
                    : 0,
            },
            responders: responders.map((r: any) => ({ name: r.name || "Unknown", count: Number(r.count) })),
        };
    }
}
