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
    async upsert(input: LearnedFactInput, opts: { autoApprove?: boolean } = {}): Promise<AILearnedFactEntity> {
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
            if (input.answer) existing.answer = input.answer;
            if (input.question) existing.question = input.question;
            // Auto-approve keeps still-pending facts flowing to the bot; a rejected
            // fact stays rejected until a human re-approves it.
            if (opts.autoApprove && existing.status === "pending") existing.status = "approved";
            return this.repo.save(existing);
        }

        const created = this.repo.create({
            scope,
            listingId,
            topic,
            question: input.question ?? null,
            answer: input.answer ?? null,
            frequency: 1,
            status: opts.autoApprove ? "approved" : "pending",
            source: input.source || "nightly_audit",
            sampleThreadId: input.sampleThreadId ?? null,
            lastSeenAt: new Date(),
        });
        return this.repo.save(created);
    }

    /** Bulk-approve every currently-pending fact (optionally filtered). */
    async approveAllPending(filter: { scope?: string; listingId?: number } = {}, userId?: number | null) {
        const where: any = { status: "pending" };
        if (filter.scope) where.scope = filter.scope;
        if (filter.listingId != null) where.listingId = filter.listingId;
        const pending = await this.repo.find({ where });
        for (const f of pending) {
            f.status = "approved";
            f.reviewedByUserId = userId ?? f.reviewedByUserId ?? null;
        }
        if (pending.length) await this.repo.save(pending);
        return { approved: pending.length };
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
     * rendered compactly for the bot.
     *
     * Query-aware + deduped: facts are scored by overlap with the guest's
     * question (falling back to frequency) so the most relevant answers survive
     * the size budget, and near-duplicate facts (the auto-extractor produces some,
     * e.g. "parking" + "parking-multiple") are collapsed. Returns null when empty.
     */
    async renderForBot(
        listingId: number | null | undefined,
        opts: { query?: string; maxChars?: number } | number = {}
    ): Promise<string | null> {
        const o = typeof opts === "number" ? { maxChars: opts } : opts;
        const maxChars = o.maxChars ?? 3500;
        const qTokens = tokenizeFacts(o.query);
        try {
            const [property, portfolio] = await Promise.all([
                listingId
                    ? this.repo.find({
                          where: { status: "approved", scope: "property", listingId: Number(listingId) as any },
                          order: { frequency: "DESC" },
                          take: 200,
                      })
                    : Promise.resolve([] as AILearnedFactEntity[]),
                this.repo.find({
                    where: { status: "approved", scope: "portfolio" },
                    order: { frequency: "DESC" },
                    take: 100,
                }),
            ]);

            if (!property.length && !portfolio.length) return null;

            const score = (f: AILearnedFactEntity) => {
                const hay = `${f.question || ""} ${f.topic || ""} ${f.answer || ""}`.toLowerCase();
                let rel = 0;
                for (const t of qTokens) if (hay.includes(t)) rel += 1;
                const freqBonus = Math.min(3, Number(f.frequency) || 1);
                return rel * 10 + freqBonus;
            };
            // Dedup near-identical facts by normalized answer prefix.
            const dedup = (list: AILearnedFactEntity[]) => {
                const seen = new Set<string>();
                const out: AILearnedFactEntity[] = [];
                for (const f of list) {
                    const key = (f.answer || f.topic || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    out.push(f);
                }
                return out;
            };
            const rank = (list: AILearnedFactEntity[]) =>
                dedup(list.map((f) => ({ f, s: score(f) })).sort((a, b) => b.s - a.s).map((x) => x.f));

            const rankedProperty = rank(property);
            const rankedPortfolio = rank(portfolio);

            const lines: string[] = [];
            let used = 0;
            const fmt = (f: AILearnedFactEntity) => {
                const q = (f.question || f.topic || "").replace(/\s+/g, " ").trim();
                const a = (f.answer || "").replace(/\s+/g, " ").trim();
                return `- Q: ${q}\n  A: ${a}`;
            };
            const addSection = (header: string, list: AILearnedFactEntity[], budget: number) => {
                if (!list.length) return;
                const start = lines.length;
                let sectionUsed = 0;
                for (const f of list) {
                    const block = fmt(f);
                    if (sectionUsed + block.length > budget) break;
                    lines.push(block);
                    sectionUsed += block.length + 1;
                    used += block.length + 1;
                }
                if (lines.length > start) lines.splice(start, 0, header);
            };

            addSection("PROPERTY-SPECIFIC learned answers (guest-shareable):", rankedProperty, Math.floor(maxChars * 0.7));
            if (lines.length) lines.push("");
            addSection(
                "PORTFOLIO-WIDE learned answers (apply to all properties, guest-shareable):",
                rankedPortfolio,
                Math.max(0, maxChars - used)
            );

            const out = lines.join("\n").trim();
            return out || null;
        } catch (err: any) {
            logger.error(`[AILearnedFacts] renderForBot failed: ${err.message}`);
            return null;
        }
    }
}

function tokenizeFacts(text?: string | null): string[] {
    const stop = new Set([
        "the", "and", "for", "are", "you", "your", "can", "with", "have", "has", "how", "what", "where", "when",
        "does", "did", "is", "it", "a", "an", "to", "of", "in", "on", "at", "we", "our", "my", "i", "do", "there",
        "any", "get", "this", "that", "whats", "im", "me", "please", "would", "could", "about",
    ]);
    return Array.from(
        new Set(
            String(text || "")
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ")
                .split(/\s+/)
                .filter((w) => w.length >= 3 && !stop.has(w))
        )
    );
}
