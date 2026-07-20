import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import OpenAI from "openai";
import { AILearningPromptEntity } from "../entity/AILearningPrompt";
import { AILearnedFactsService } from "./AILearnedFactsService";
import { InboxAIAuditService } from "./InboxAIAuditService";

const slug = (s: string) =>
    String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120) || "general";

const ANSWER_PHASE_VOCAB = new Set(["inquiry", "accepted", "cancelled", "in_house", "post_stay"]);

function normalizeAnswerPhases(input?: string[] | null): string[] | null {
    if (!input || !input.length) return null;
    const clean = input
        .map((p) => String(p || "").trim().toLowerCase())
        .filter((p) => ANSWER_PHASE_VOCAB.has(p));
    if (!clean.length) return null;
    if (clean.length === ANSWER_PHASE_VOCAB.size) return null; // "all" == no filter
    return [...new Set(clean)];
}

async function setLearnedFactPhases(factId: number, phases: string[]): Promise<void> {
    try {
        await appDatabase
            .query(`ALTER TABLE ai_learned_facts ADD COLUMN applicablePhases JSON NULL`)
            .catch(() => {
                /* column already exists */
            });
        await appDatabase.query(`UPDATE ai_learned_facts SET applicablePhases = ? WHERE id = ?`, [
            JSON.stringify(phases),
            factId,
        ]);
    } catch {
        /* Non-fatal: phase targeting degrades to "applies to all phases". */
    }
}

/**
 * Manages the "flag conversation for learning" prompts: the bot raises a question
 * when it lacks a reusable property fact; staff answer it (stored as a learned
 * fact) or dismiss it; the nightly job auto-resolves prompts once the fact is
 * otherwise learned.
 */
export class AILearningPromptService {
    private repo = appDatabase.getRepository(AILearningPromptEntity);
    private learned = new AILearnedFactsService();

    private safeJson(raw: string): any {
        try {
            return JSON.parse(raw);
        } catch {
            const match = raw.match(/\{[\s\S]*\}/);
            if (!match) return null;
            try {
                return JSON.parse(match[0]);
            } catch {
                return null;
            }
        }
    }

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

    /**
     * The full pending queue (both inboxes) for the Analytics page — the July
     * audit found 400+ prompts silently piling up because they were only
     * visible one-at-a-time inside their own conversations.
     */
    async listPending(opts: { source?: string; limit?: number } = {}): Promise<AILearningPromptEntity[]> {
        const qb = this.repo
            .createQueryBuilder("p")
            .where("p.status = 'pending'")
            .orderBy("p.createdAt", "DESC")
            .take(Math.min(Math.max(Number(opts.limit) || 200, 1), 500));
        if (opts.source === "quo" || opts.source === "hostify") {
            qb.andWhere("p.source = :source", { source: opts.source });
        }
        return qb.getMany();
    }

    async getPendingForThread(threadId: number, source: string = "hostify"): Promise<AILearningPromptEntity | null> {
        return this.repo.findOne({
            where: { threadId: threadId as any, source, status: "pending" },
            order: { createdAt: "DESC" },
        });
    }

    async recommendAnswer(id: number): Promise<{ answer: string | null; reason: string | null; source: string }> {
        const prompt = await this.repo.findOne({ where: { id } });
        if (!prompt) return { answer: null, reason: "Prompt not found", source: "none" };

        const suggestionRows: any[] = prompt.sampleSuggestionId
            ? await appDatabase.query(
                  `SELECT suggestedReply, actualReplyText, internalSummary, warnings, sourcesUsed
                   FROM ai_message_suggestions
                   WHERE id = ?
                   LIMIT 1`,
                  [prompt.sampleSuggestionId]
              )
            : [];
        const suggestion = suggestionRows[0] || null;

        const messageRows: any[] = await appDatabase.query(
            `SELECT direction, senderName, sentByName, body, note, sentAt
             FROM inbox_messages
             WHERE threadId = ?
             ORDER BY sentAt DESC, id DESC
             LIMIT 12`,
            [prompt.threadId]
        );
        const transcript = messageRows
            .reverse()
            .map((m) => {
                const who =
                    m.direction === "incoming"
                        ? "Guest"
                        : m.direction === "outgoing"
                          ? m.sentByName || m.senderName || "Host"
                          : "System";
                const text = String(m.body || m.note || "").replace(/\s+/g, " ").trim();
                if (!text) return null;
                return `${who}: ${text}`;
            })
            .filter(Boolean)
            .join("\n");

        const directTeamAnswer = String(suggestion?.actualReplyText || "").trim();
        if (!process.env.OPENAI_API_KEY) {
            return directTeamAnswer
                ? { answer: directTeamAnswer.slice(0, 4000), reason: "Based on the linked team reply.", source: "team_reply" }
                : {
                      answer: null,
                      reason: "OpenAI is not configured, and there is no linked team reply to use.",
                      source: "none",
                  };
        }

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const model = process.env.OPENAI_MODEL || process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
        const completion = await openai.chat.completions.create({
            model,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content:
                        "You draft staff-only answers to AI learning prompts. The answer may become an internal learned fact. Do not write a guest-facing reply. Use only the provided context. If the context does not contain enough information, return an empty answer and explain why.",
                },
                {
                    role: "user",
                    content: [
                        `Learning question: ${prompt.question}`,
                        prompt.topic ? `Topic: ${prompt.topic}` : null,
                        prompt.listingName ? `Listing: ${prompt.listingName}` : null,
                        suggestion?.actualReplyText ? `Team reply already sent:\n${suggestion.actualReplyText}` : null,
                        suggestion?.suggestedReply ? `AI drafted reply:\n${suggestion.suggestedReply}` : null,
                        transcript ? `Recent conversation:\n${transcript}` : null,
                        "Return JSON only: {\"answer\":\"concise reusable answer or empty string\",\"reason\":\"short explanation\"}.",
                    ]
                        .filter(Boolean)
                        .join("\n\n"),
                },
            ],
        });
        const parsed = this.safeJson(completion.choices[0]?.message?.content?.trim() || "{}") || {};
        const answer = String(parsed.answer || "").trim();
        const reason = String(parsed.reason || "").trim() || null;
        return {
            answer: answer ? answer.slice(0, 4000) : null,
            reason: reason || (answer ? "Recommended from conversation context." : "Not enough context to recommend an answer."),
            source: "ai_recommendation",
        };
    }

    /**
     * Staff answers the prompt → store as one-or-more learned facts + mark answered.
     * `scope` selects targeting:
     *   - "portfolio" → account-wide (listingId=null)
     *   - "selected"  → each id in opts.listingIds gets its own property-scoped fact
     *   - "property"  → the prompt's own listing (default)
     * `phases` optionally restricts the fact to certain reservation phases; falls
     * back silently to "all phases" when the deployment hasn't provisioned the
     * ai_learned_facts.applicablePhases column yet.
     */
    async answer(
        id: number,
        opts: {
            answer: string;
            scope?: "property" | "portfolio" | "selected";
            userId?: number | null;
            listingIds?: number[] | null;
            phases?: string[] | null;
        }
    ): Promise<AILearningPromptEntity | null> {
        const prompt = await this.repo.findOne({ where: { id } });
        if (!prompt) return null;
        const answer = (opts.answer || "").trim();
        if (!answer) return null;

        const desired: (number | null)[] = (() => {
            if (opts.scope === "portfolio") return [null];
            if (opts.scope === "selected") {
                const ids = (opts.listingIds || [])
                    .map((n) => Number(n))
                    .filter((n) => Number.isFinite(n) && n > 0);
                if (ids.length) return [...new Set(ids)];
                return prompt.listingId != null ? [Number(prompt.listingId)] : [null];
            }
            return [prompt.listingId ?? null];
        })();
        const phases = normalizeAnswerPhases(opts.phases);

        for (const lid of desired) {
            const rowScope = lid == null ? "portfolio" : "property";
            try {
                const saved = await this.learned.upsert(
                    {
                        scope: rowScope,
                        listingId: lid,
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
                if (phases && saved?.id) {
                    await setLearnedFactPhases(saved.id, phases);
                }
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
        }

        prompt.status = "answered";
        prompt.answerText = answer.slice(0, 4000);
        prompt.answerScope =
            opts.scope === "portfolio" ? "portfolio" : opts.scope === "selected" ? "selected" : "property";
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
