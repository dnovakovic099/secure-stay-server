import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIEmbeddingEntity } from "../entity/AIEmbedding";
import { AILearnedFactEntity } from "../entity/AILearnedFact";
import { ListingKnowledgeEntryEntity } from "../entity/ListingKnowledgeEntry";
import { EmbeddingService } from "./EmbeddingService";
import { ExemplarService, focusQuery } from "./ExemplarService";
import { ListingGroupService } from "./ListingGroupService";
import { allowPortfolioMemory } from "../utils/aiPortfolioGuards";

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
    private kbRepo = appDatabase.getRepository(ListingKnowledgeEntryEntity);
    private embed = new EmbeddingService();
    private exemplars = new ExemplarService();
    private groups = new ListingGroupService();

    private static portfolioFactCache: {
        at: number;
        rows: { text: string; payload: string; vec: number[]; refId: number | null; visibility: string | null }[];
    } | null = null;

    static invalidate() {
        RetrievalService.portfolioFactCache = null;
    }

    /** Index all approved EXTERNAL learned facts into the embedding store (idempotent). */
    async embedFacts(): Promise<number> {
        // Internal facts are staff-only and must never be retrieved into guest
        // reply context — skip embedding them entirely.
        const facts = await this.factRepo.find({ where: { status: "approved" } });
        const externalFacts = facts.filter((f) => f.visibility !== "internal" && (!f.factType || f.factType === "qa"));
        const existing = new Set(
            (await this.repo.find({ select: ["dedupKey"], where: { kind: "fact" } })).map((e) => e.dedupKey).filter(Boolean) as string[]
        );
        const records = [];
        for (const f of externalFacts) {
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
                visibility: "external",
            });
        }
        const n = await this.exemplars.embedAndStore(records);
        RetrievalService.invalidate();
        logger.info(`[Retrieval] embedded ${n} new fact vectors (of ${externalFacts.length} approved external QA; ${facts.length} total approved)`);
        return n;
    }

    /** Fact IDs marked internal — used to scrub already-embedded internal facts from retrieval. */
    private async internalFactIds(): Promise<Set<number>> {
        const rows = await this.factRepo.find({
            where: { status: "approved", visibility: "internal" as any },
            select: ["id"],
        });
        return new Set(rows.map((f) => Number(f.id)));
    }

    /**
     * Index the per-listing Knowledge Base into the embedding store (kind="kb"),
     * group-scoped and visibility-aware, so property facts (amenities, bed
     * configs, house rules, policies) are retrievable semantically instead of by
     * keyword. Idempotent: skips entries already embedded (keyed on content hash
     * so edits re-embed). Returns the number of new vectors written.
     */
    async embedKnowledge(): Promise<number> {
        const entries = await this.kbRepo.find({ where: { isArchived: 0 as any } });
        const existing = new Set(
            (await this.repo.find({ select: ["dedupKey"], where: { kind: "kb" } })).map((e) => e.dedupKey).filter(Boolean) as string[]
        );
        const records: any[] = [];
        for (const e of entries) {
            const content = (e.content || "").toString().trim();
            if (content.length < 3) continue;
            const title = (e.title || e.category || "").toString().trim();
            const groupId = (await this.groups.resolve(e.listingId)) ?? e.listingId ?? null;
            const visibility = e.visibility === "internal" ? "internal" : "external";
            const chunks = this.chunk(content, 1200, 150);
            chunks.forEach((c, idx) => {
                // Short content hash keeps dedup stable but re-embeds on edit.
                const hash = String(c.length) + "_" + c.slice(0, 24).replace(/\s+/g, "");
                const dedupKey = `kb|${e.id}|${idx}|${hash}`.slice(0, 200);
                if (existing.has(dedupKey)) return;
                records.push({
                    kind: "kb",
                    refId: e.id,
                    listingId: e.listingId ?? null,
                    groupId,
                    scope: "property",
                    text: (title ? `${title}: ${c}` : c).slice(0, 4000),
                    payload: c.slice(0, 4000),
                    dedupKey,
                    visibility,
                });
            });
        }
        const n = await this.exemplars.embedAndStore(records);
        RetrievalService.invalidate();
        logger.info(`[Retrieval] embedded ${n} new KB vectors (of ${entries.length} active entries)`);
        return n;
    }

    private chunk(text: string, size: number, overlap: number): string[] {
        const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
        if (clean.length <= size) return [clean];
        const out: string[] = [];
        let i = 0;
        while (i < clean.length) {
            out.push(clean.slice(i, i + size));
            i += size - overlap;
        }
        return out.slice(0, 30);
    }

    /**
     * Semantic KB retrieval for a query, split by visibility (external =
     * guest-shareable, internal = staff-only informing the reply).
     */
    async retrieveKb(
        groupId: number | null | undefined,
        queryText: string,
        opts: { k?: number; minSim?: number } = {}
    ): Promise<{ external: { text: string; sim: number }[]; internal: { text: string; sim: number }[] }> {
        const empty = { external: [], internal: [] };
        if (!groupId || !queryText?.trim()) return empty;
        const k = opts.k ?? 4;
        const minSim = opts.minSim ?? 0.3;
        const qv = await this.embed.embedOne(focusQuery(queryText));
        const rows = await this.repo.find({ where: { kind: "kb", groupId: Number(groupId) as any }, take: 4000 });
        const scored = rows
            .map((r) => ({ text: r.payload || "", vis: r.visibility || "external", sim: EmbeddingService.cosine(qv, EmbeddingService.parseVector(r.vector) || []) }))
            .filter((s) => s.text && s.sim >= minSim)
            .sort((a, b) => b.sim - a.sim);
        const external: { text: string; sim: number }[] = [];
        const internal: { text: string; sim: number }[] = [];
        const seen = new Set<string>();
        for (const s of scored) {
            const key = s.text.slice(0, 80);
            if (seen.has(key)) continue;
            seen.add(key);
            const bucket = s.vis === "internal" ? internal : external;
            if (bucket.length < k) bucket.push({ text: s.text, sim: s.sim });
            if (external.length >= k && internal.length >= k) break;
        }
        return { external, internal };
    }

    private async getPortfolioFacts(blockedIds: Set<number>) {
        const c = RetrievalService.portfolioFactCache;
        if (c && Date.now() - c.at < 30 * 60 * 1000) {
            return c.rows.filter((r) => r.refId == null || !blockedIds.has(r.refId));
        }
        const rows = await this.repo.find({ where: { kind: "fact", scope: "portfolio" }, take: 1000 });
        const parsed = rows
            .map((r) => ({
                text: r.embeddedText,
                payload: r.payload || "",
                vec: EmbeddingService.parseVector(r.vector) || [],
                refId: r.refId != null ? Number(r.refId) : null,
                visibility: r.visibility || null,
            }))
            .filter((r) => r.vec.length && r.payload && r.visibility !== "internal");
        RetrievalService.portfolioFactCache = { at: Date.now(), rows: parsed };
        return parsed.filter((r) => r.refId == null || !blockedIds.has(r.refId));
    }

    /** Semantically retrieve the most relevant EXTERNAL learned facts for a query. */
    async retrieveFacts(
        groupId: number | null | undefined,
        queryText: string,
        opts: { k?: number; minSim?: number; channel?: string | null } = {}
    ): Promise<RetrievedFact[]> {
        if (!queryText?.trim()) return [];
        const k = opts.k ?? 6;
        const minSim = opts.minSim ?? 0.4;
        const qv = await this.embed.embedOne(focusQuery(queryText));
        const blockedIds = await this.internalFactIds();
        const scored: RetrievedFact[] = [];

        if (groupId) {
            const rows = await this.repo.find({ where: { kind: "fact", groupId: Number(groupId) as any }, take: 2000 });
            for (const r of rows) {
                if (r.visibility === "internal") continue;
                if (r.refId != null && blockedIds.has(Number(r.refId))) continue;
                const v = EmbeddingService.parseVector(r.vector);
                if (!v || !r.payload) continue;
                const sim = EmbeddingService.cosine(qv, v);
                if (sim >= minSim) scored.push({ question: r.embeddedText, answer: r.payload, sim, scope: "property" });
            }
        }
        for (const r of await this.getPortfolioFacts(blockedIds)) {
            // Never inject property-scoped / channel-mismatched portfolio facts
            // (checkout times, deposits, capacity) into unrelated bookings.
            if (!allowPortfolioMemory(`${r.text} ${r.payload}`, opts.channel)) continue;
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

    /**
     * Retrieve relevant uploaded-document chunks for a query, split by
     * visibility so guest-shareable and staff-only content can be labelled
     * differently in the prompt.
     */
    async retrieveDocs(
        groupId: number | null | undefined,
        queryText: string,
        opts: { k?: number; minSim?: number } = {}
    ): Promise<{ external: { text: string; sim: number }[]; internal: { text: string; sim: number }[] }> {
        const empty = { external: [], internal: [] };
        if (!groupId || !queryText?.trim()) return empty;
        const k = opts.k ?? 4;
        // Uploaded docs are authoritative/curated, so favour recall.
        const minSim = opts.minSim ?? 0.3;
        const qv = await this.embed.embedOne(focusQuery(queryText));
        const rows = await this.repo.find({ where: { kind: "doc", groupId: Number(groupId) as any }, take: 3000 });
        const scored = rows
            .map((r) => ({ text: r.payload || "", vis: r.visibility || "internal", sim: EmbeddingService.cosine(qv, EmbeddingService.parseVector(r.vector) || []) }))
            .filter((s) => s.text && s.sim >= minSim)
            .sort((a, b) => b.sim - a.sim);
        const external: { text: string; sim: number }[] = [];
        const internal: { text: string; sim: number }[] = [];
        const seen = new Set<string>();
        for (const s of scored) {
            const key = s.text.slice(0, 80);
            if (seen.has(key)) continue;
            seen.add(key);
            const bucket = s.vis === "external" ? external : internal;
            if (bucket.length < k) bucket.push({ text: s.text, sim: s.sim });
            if (external.length >= k && internal.length >= k) break;
        }
        return { external, internal };
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
            lines.push(
                "PORTFOLIO-WIDE learned answers (generic ops ONLY — never use for checkout/check-in times, " +
                    "guest capacity, deposits/money, amenities, or channel-specific policies; prefer reservation billing + listing details):"
            );
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
