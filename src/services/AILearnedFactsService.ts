import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AILearnedFactEntity } from "../entity/AILearnedFact";
import { IsNull } from "typeorm";

export interface LearnedFactInput {
    scope?: "property" | "portfolio";
    listingId?: number | null;
    topic: string;
    question?: string | null;
    answer?: string | null;
    sampleThreadId?: number | null;
    source?: string;
}

const slug = (s: string) =>
    String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120) || "general";

/**
 * Per-property and portfolio-wide "frequently asked" fact store.
 *
 * The nightly audit upserts candidate facts here (as 'pending'); staff approve or
 * reject them in the AI Copilot tab; only 'approved' facts are surfaced to the
 * bot via renderForBot(). Portfolio facts (listingId = null) apply to every
 * property so account-wide answers only have to be curated once.
 */
export class AILearnedFactsService {
    private repo = appDatabase.getRepository(AILearnedFactEntity);

    /**
     * Upsert by (scope, listingId, topic): if a matching fact exists we bump its
     * frequency and refresh lastSeenAt (and fill answer/question if empty); else
     * we insert a new pending fact.
     */
    async upsert(input: LearnedFactInput): Promise<AILearnedFactEntity> {
        const scope = input.scope === "portfolio" ? "portfolio" : "property";
        const listingId = scope === "portfolio" ? null : input.listingId ?? null;
        const topic = slug(input.topic);

        const existing = await this.repo.findOne({
            where: {
                scope,
                listingId: listingId == null ? IsNull() : (listingId as any),
                topic,
            },
        });

        if (existing) {
            existing.frequency = (existing.frequency || 1) + 1;
            existing.lastSeenAt = new Date();
            if (!existing.answer && input.answer) existing.answer = input.answer;
            if (!existing.question && input.question) existing.question = input.question;
            // A rejected fact stays rejected until a human re-approves it.
            return this.repo.save(existing);
        }

        const created = this.repo.create({
            scope,
            listingId,
            topic,
            question: input.question ?? null,
            answer: input.answer ?? null,
            frequency: 1,
            status: "pending",
            source: input.source || "nightly_audit",
            sampleThreadId: input.sampleThreadId ?? null,
            lastSeenAt: new Date(),
        });
        return this.repo.save(created);
    }

    async list(opts: { status?: string; scope?: string; listingId?: number } = {}) {
        const where: any = {};
        if (opts.status) where.status = opts.status;
        if (opts.scope) where.scope = opts.scope;
        if (opts.listingId != null) where.listingId = opts.listingId;
        return this.repo.find({ where, order: { frequency: "DESC", updatedAt: "DESC" }, take: 500 });
    }

    async setStatus(id: number, status: "approved" | "rejected" | "pending", userId?: number | null) {
        const fact = await this.repo.findOne({ where: { id } });
        if (!fact) throw new Error(`Learned fact ${id} not found`);
        fact.status = status;
        fact.reviewedByUserId = userId ?? fact.reviewedByUserId ?? null;
        return this.repo.save(fact);
    }

    /**
     * Approved facts for a listing PLUS all approved portfolio-wide facts,
     * rendered compactly for the bot. Returns null when there's nothing.
     */
    async renderForBot(listingId: number | null | undefined, maxChars = 3000): Promise<string | null> {
        try {
            const [property, portfolio] = await Promise.all([
                listingId
                    ? this.repo.find({
                          where: { status: "approved", scope: "property", listingId: Number(listingId) as any },
                          order: { frequency: "DESC" },
                          take: 40,
                      })
                    : Promise.resolve([] as AILearnedFactEntity[]),
                this.repo.find({
                    where: { status: "approved", scope: "portfolio" },
                    order: { frequency: "DESC" },
                    take: 40,
                }),
            ]);

            if (!property.length && !portfolio.length) return null;
            const lines: string[] = [];
            const fmt = (f: AILearnedFactEntity) => {
                const q = (f.question || f.topic || "").replace(/\s+/g, " ").trim();
                const a = (f.answer || "").replace(/\s+/g, " ").trim();
                return `- Q: ${q}\n  A: ${a}`;
            };
            if (property.length) {
                lines.push("PROPERTY-SPECIFIC learned answers (guest-shareable):");
                for (const f of property) lines.push(fmt(f));
            }
            if (portfolio.length) {
                if (lines.length) lines.push("");
                lines.push("PORTFOLIO-WIDE learned answers (apply to all properties, guest-shareable):");
                for (const f of portfolio) lines.push(fmt(f));
            }
            let out = lines.join("\n");
            if (out.length > maxChars) out = out.slice(0, maxChars) + " …[truncated]";
            return out;
        } catch (err: any) {
            logger.error(`[AILearnedFacts] renderForBot failed: ${err.message}`);
            return null;
        }
    }
}
