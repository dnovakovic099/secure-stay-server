import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIEmbeddingEntity } from "../entity/AIEmbedding";
import { AILearnedFactEntity } from "../entity/AILearnedFact";
import { EmbeddingService } from "./EmbeddingService";
import { ExemplarService, focusQuery } from "./ExemplarService";
import { ListingGroupService } from "./ListingGroupService";

export interface RetrievedFact {
    question: string;
    answer: string;
    sim: number;
    scope: string;
}

/**
 * Semantic retrieval + indexing for learned facts (the bot's accumulated,
 * approved memory). Replaces the keyword/token-overlap ranking so a paraphrased
 * question still finds the right stored answer. Exemplar (Q&A) retrieval lives
 * in ExemplarService; this focuses on facts and shares the same embedding store.
 */
export class RetrievalService {
    private repo = appDatabase.getRepository(AIEmbeddingEntity);
    private factRepo = appDatabase.getRepository(AILearnedFactEntity);
    private embed = new EmbeddingService();
    private exemplars = new ExemplarService();
    private groups = new ListingGroupService();

    private static portfolioFactCache: { at: number; rows: { text: string; payload: string; vec: number[] }[] } | null = null;

    static invalidate() {
        RetrievalService.portfolioFactCache = null;
    }

    /** Index all approved learned facts into the embedding store (idempotent). */
    async embedFacts(): Promise<number> {
        const facts = await this.factRepo.find({ where: { status: "approved" } });
        const existing = new Set(
            (await this.repo.find({ select: ["dedupKey"], where: { kind: "fact" } })).map((e) => e.dedupKey).filter(Boolean) as string[]
        );
        const records = [];
        for (const f of facts) {
            const dedupKey = `fact|${f.id}`;
            if (existing.has(dedupKey)) continue;
            const q = (f.question || f.topic || "").toString();
            const a = (f.answer || "").toString();
            if (!q || !a) continue;
            const groupId = f.scope === "portfolio" ? null : (await this.groups.resolve(f.listingId)) ?? f.listingId ?? null;
            records.push({
                kind: "fact",
                refId: f.id,
                listingId: f.listingId ?? null,
                groupId,
                scope: f.scope === "portfolio" ? "portfolio" : "property",
                text: focusQuery(q),
                payload: `Q: ${q}\nA: ${a}`,
                dedupKey,
            });
        }
        const n = await this.exemplars.embedAndStore(records);
        RetrievalService.invalidate();
        logger.info(`[Retrieval] embedded ${n} new fact vectors (of ${facts.length} approved)`);
        return n;
    }

    private async getPortfolioFacts() {
        const c = RetrievalService.portfolioFactCache;
        if (c && Date.now() - c.at < 30 * 60 * 1000) return c.rows;
        const rows = await this.repo.find({ where: { kind: "fact", scope: "portfolio" }, take: 1000 });
        const parsed = rows
            .map((r) => ({ text: r.embeddedText, payload: r.payload || "", vec: EmbeddingService.parseVector(r.vector) || [] }))
            .filter((r) => r.vec.length && r.payload);
        RetrievalService.portfolioFactCache = { at: Date.now(), rows: parsed };
        return parsed;
    }

    /** Semantically retrieve the most relevant learned facts for a query. */
    async retrieveFacts(
        groupId: number | null | undefined,
        queryText: string,
        opts: { k?: number; minSim?: number } = {}
    ): Promise<RetrievedFact[]> {
        if (!queryText?.trim()) return [];
        const k = opts.k ?? 6;
        const minSim = opts.minSim ?? 0.4;
        const qv = await this.embed.embedOne(focusQuery(queryText));
        const scored: RetrievedFact[] = [];

        if (groupId) {
            const rows = await this.repo.find({ where: { kind: "fact", groupId: Number(groupId) as any }, take: 2000 });
            for (const r of rows) {
                const v = EmbeddingService.parseVector(r.vector);
                if (!v || !r.payload) continue;
                const sim = EmbeddingService.cosine(qv, v);
                if (sim >= minSim) scored.push({ question: r.embeddedText, answer: r.payload, sim, scope: "property" });
            }
        }
        for (const r of await this.getPortfolioFacts()) {
            const sim = EmbeddingService.cosine(qv, r.vec);
            if (sim >= Math.max(minSim, 0.45)) scored.push({ question: r.text, answer: r.payload, sim, scope: "portfolio" });
        }
        scored.sort((a, b) => b.sim - a.sim);
        const seen = new Set<string>();
        const out: RetrievedFact[] = [];
        for (const s of scored) {
            const key = s.answer.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(s);
            if (out.length >= k) break;
        }
        return out;
    }

    /** Render retrieved facts to the prompt block (payload already "Q:..\nA:.."). */
    renderFacts(facts: RetrievedFact[]): string | null {
        if (!facts.length) return null;
        const prop = facts.filter((f) => f.scope === "property");
        const port = facts.filter((f) => f.scope === "portfolio");
        const lines: string[] = [];
        if (prop.length) {
            lines.push("PROPERTY-SPECIFIC learned answers (guest-shareable):");
            for (const f of prop) lines.push(this.fmt(f));
        }
        if (port.length) {
            lines.push("PORTFOLIO-WIDE learned answers (apply to all properties):");
            for (const f of port) lines.push(this.fmt(f));
        }
        return lines.join("\n");
    }

    private fmt(f: RetrievedFact): string {
        const m = /^Q:\s*([\s\S]*?)\nA:\s*([\s\S]*)$/.exec(f.answer);
        if (m) return `- Q: ${m[1].trim()}\n  A: ${m[2].trim()}`;
        return `- ${f.answer.trim()}`;
    }
}
