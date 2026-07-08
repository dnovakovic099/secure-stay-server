import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AILearningPromptEntity } from "../entity/AILearningPrompt";
import { AILearnedFactsService } from "./AILearnedFactsService";
import { InboxAIAuditService } from "./InboxAIAuditService";

const slug = (s: string) =>
    String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120) || "general";

/**
 * Manages the "flag conversation for learning" prompts: the bot raises a question
 * when it lacks a reusable property fact; staff answer it (stored as a learned
 * fact) or dismiss it; the nightly job auto-resolves prompts once the fact is
 * otherwise learned.
 */
export class AILearningPromptService {
    private repo = appDatabase.getRepository(AILearningPromptEntity);
    private learned = new AILearnedFactsService();

    /**
     * Raise (or refresh) the single active prompt for a thread. Called during
     * suggestion generation when the model emits a learning_question.
     */
    async raise(input: {
        threadId: number;
        source?: string;
        listingId?: number | null;
        listingName?: string | null;
        question: string;
        topic?: string | null;
        sampleSuggestionId?: number | null;
    }): Promise<AILearningPromptEntity | null> {
        const question = (input.question || "").trim();
        if (!question) return null;
        const source = input.source === "quo" ? "quo" : "hostify";
        try {
            const existing = await this.repo.findOne({
                where: { threadId: input.threadId as any, source, status: "pending" },
                order: { createdAt: "DESC" },
            });
            if (existing) {
                // Refresh wording/topic but keep one pending prompt per thread.
                existing.question = question.slice(0, 1000);
                existing.topic = input.topic ? slug(input.topic) : existing.topic;
                if (input.listingId != null) existing.listingId = input.listingId;
                if (input.listingName) existing.listingName = input.listingName;
                if (input.sampleSuggestionId != null) existing.sampleSuggestionId = input.sampleSuggestionId;
                return this.repo.save(existing);
            }
            const created = this.repo.create({
                threadId: input.threadId,
                source,
                listingId: input.listingId ?? null,
                listingName: input.listingName ?? null,
                question: question.slice(0, 1000),
                topic: input.topic ? slug(input.topic) : null,
                status: "pending",
                sampleSuggestionId: input.sampleSuggestionId ?? null,
            });
            return this.repo.save(created);
        } catch (e: any) {
            logger.warn(`[LearningPrompt] raise failed for thread ${input.threadId}: ${e.message}`);
            return null;
        }
    }

    async getPendingForThread(threadId: number, source: string = "hostify"): Promise<AILearningPromptEntity | null> {
        return this.repo.findOne({
            where: { threadId: threadId as any, source, status: "pending" },
            order: { createdAt: "DESC" },
        });
    }

    /** Staff answers the prompt → store as a learned fact + mark answered. */
    async answer(
        id: number,
        opts: { answer: string; scope?: "property" | "portfolio"; userId?: number | null }
    ): Promise<AILearningPromptEntity | null> {
        const prompt = await this.repo.findOne({ where: { id } });
        if (!prompt) return null;
        const answer = (opts.answer || "").trim();
        if (!answer) return null;

        try {
            await this.learned.upsert(
                {
                    scope: opts.scope === "portfolio" ? "portfolio" : "property",
                    listingId: prompt.listingId ?? null,
                    topic: prompt.topic || slug(prompt.question),
                    question: prompt.question,
                    answer,
                    sampleThreadId: prompt.threadId,
                    source: "learning_prompt",
                    createdByUserId: opts.userId ?? null,
                },
                // Staff typed this answer themselves — trusted, no frequency gate.
                { autoApprove: InboxAIAuditService.autoApproveFacts(), trustedSource: true }
            );
        } catch (e: any) {
            // If a property-specific fact couldn't be stored portfolio-wide, retry as property.
            logger.warn(`[LearningPrompt] fact upsert failed (${e.message}); retrying property scope`);
            if (prompt.listingId) {
                await this.learned
                    .upsert(
                        {
                            scope: "property",
                            listingId: prompt.listingId,
                            topic: prompt.topic || slug(prompt.question),
                            question: prompt.question,
                            answer,
                            sampleThreadId: prompt.threadId,
                            source: "learning_prompt",
                            createdByUserId: opts.userId ?? null,
                        },
                        { autoApprove: InboxAIAuditService.autoApproveFacts(), trustedSource: true }
                    )
                    .catch((e2: any) => logger.warn(`[LearningPrompt] retry failed: ${e2.message}`));
            }
        }

        prompt.status = "answered";
        prompt.answerText = answer.slice(0, 4000);
        prompt.answerScope = opts.scope === "portfolio" ? "portfolio" : "property";
        prompt.answeredByUserId = opts.userId ?? null;
        prompt.resolvedAt = new Date();
        prompt.resolvedVia = "staff";
        return this.repo.save(prompt);
    }

    async dismiss(id: number, userId?: number | null): Promise<boolean> {
        const prompt = await this.repo.findOne({ where: { id } });
        if (!prompt) return false;
        prompt.status = "dismissed";
        prompt.resolvedAt = new Date();
        prompt.resolvedVia = "dismissed";
        prompt.answeredByUserId = userId ?? prompt.answeredByUserId;
        await this.repo.save(prompt);
        return true;
    }

    /**
     * Nightly: auto-resolve pending prompts whose fact has since been learned for
     * the same listing + topic (e.g. from the team's own reply), so stale
     * questions stop showing once we already know the answer.
     */
    async autoResolveCovered(): Promise<{ resolved: number }> {
        const pending = await this.repo.find({ where: { status: "pending" } });
        if (!pending.length) return { resolved: 0 };
        let resolved = 0;
        for (const p of pending) {
            if (!p.topic) continue;
            try {
                const facts = await this.learned.list({ status: "approved", listingId: p.listingId ?? undefined });
                const covered = (facts || []).some(
                    (f: any) => f.topic && (f.topic === p.topic || f.topic.includes(p.topic) || p.topic!.includes(f.topic))
                );
                if (covered) {
                    p.status = "answered";
                    p.resolvedAt = new Date();
                    p.resolvedVia = "auto_learned";
                    await this.repo.save(p);
                    resolved++;
                }
            } catch {
                /* skip */
            }
        }
        if (resolved) logger.info(`[LearningPrompt] auto-resolved ${resolved} prompt(s) already learned`);
        return { resolved };
    }
}
