import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIEmbeddingEntity } from "../entity/AIEmbedding";
import { EmbeddingService, EMBEDDING_MODEL } from "./EmbeddingService";
import { ListingGroupService } from "./ListingGroupService";

export interface Exemplar {
    question: string;
    answer: string;
    sim: number;
}

const norm = (s: string) =>
    String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

/**
 * Retrieval over our real (guest question -> team answer) message history.
 * This is the core of "use our data": at answer time we fetch the most
 * semantically-similar past questions for the SAME property group and show the
 * model how our team actually answered them.
 */
export class ExemplarService {
    private repo = appDatabase.getRepository(AIEmbeddingEntity);
    private embed = new EmbeddingService();
    private groups = new ListingGroupService();

    static isEnabled(): boolean {
        return process.env.AI_RAG_ENABLED === "true";
    }

    /**
     * Top-k proven Q&A exemplars for a property group, ranked by cosine
     * similarity to the guest's query vector. Group-scoped so we only load a
     * small candidate set into memory.
     */
    async retrieveSimilar(
        groupId: number | null | undefined,
        queryVector: number[],
        opts: { k?: number; minSim?: number } = {}
    ): Promise<Exemplar[]> {
        if (!groupId || !queryVector?.length) return [];
        const k = opts.k ?? 4;
        const minSim = opts.minSim ?? 0.55;
        const rows = await this.repo.find({
            where: { kind: "qa", groupId: Number(groupId) as any },
            take: 2000,
        });
        const scored: Exemplar[] = [];
        for (const r of rows) {
            const v = EmbeddingService.parseVector(r.vector);
            if (!v) continue;
            const sim = EmbeddingService.cosine(queryVector, v);
            if (sim >= minSim && r.payload) scored.push({ question: r.embeddedText, answer: r.payload, sim });
        }
        scored.sort((a, b) => b.sim - a.sim);
        // Deduplicate near-identical answers so we don't show the same reply twice.
        const seen = new Set<string>();
        const out: Exemplar[] = [];
        for (const s of scored) {
            const key = norm(s.answer).slice(0, 80);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(s);
            if (out.length >= k) break;
        }
        return out;
    }

    /** Convenience for callers that only have text. */
    async retrieveForQuery(
        groupId: number | null | undefined,
        queryText: string,
        opts: { k?: number; minSim?: number } = {}
    ): Promise<Exemplar[]> {
        if (!groupId || !queryText?.trim()) return [];
        const qv = await this.embed.embedOne(queryText);
        return this.retrieveSimilar(groupId, qv, opts);
    }

    /** Add a single live pair (called when the team replies to a suggestion). */
    async addPair(listingId: number | null, question: string, answer: string, refId?: number | null): Promise<boolean> {
        try {
            if (!question || question.trim().length < 12 || !answer || answer.trim().length < 15) return false;
            const groupId = (await this.groups.resolve(listingId)) ?? listingId ?? null;
            const dedupKey = `qa|${groupId ?? 0}|${norm(question).slice(0, 80)}`;
            const existing = await this.repo.findOne({ where: { dedupKey } });
            const vector = JSON.stringify(await this.embed.embedOne(question));
            if (existing) {
                existing.payload = answer.slice(0, 4000);
                existing.vector = vector;
                existing.listingId = listingId ?? null;
                existing.groupId = groupId as any;
                await this.repo.save(existing);
                return true;
            }
            await this.repo.save(
                this.repo.create({
                    kind: "qa",
                    refId: refId ?? null,
                    listingId: listingId ?? null,
                    groupId: groupId as any,
                    scope: "property",
                    embeddedText: question.slice(0, 4000),
                    payload: answer.slice(0, 4000),
                    vector,
                    model: EMBEDDING_MODEL,
                    dedupKey,
                })
            );
            return true;
        } catch (err: any) {
            logger.warn(`[Exemplar] addPair failed: ${err.message}`);
            return false;
        }
    }

    /**
     * One-shot / nightly backfill: mine (guest question -> next team reply) pairs
     * from the whole message history, dedup per group, embed, and store.
     * Processes newest first so the freshest answer wins on duplicates.
     */
    async backfillFromHistory(opts: { sinceDays?: number; maxPairs?: number } = {}): Promise<{ pairs: number; embedded: number }> {
        const sinceClause = opts.sinceDays ? `AND m.sentAt >= DATE_SUB(NOW(), INTERVAL ${Number(opts.sinceDays)} DAY)` : "";
        // Pair each outgoing human (non-auto, non-AI) reply with the most recent
        // preceding guest message in the same thread.
        const rows: any[] = await appDatabase.query(
            `SELECT r.threadId,
                    COALESCE(r.listingId, c.listingId) AS listingId,
                    r.externalId AS refId,
                    r.body AS answer,
                    (SELECT g.body FROM inbox_messages g
                       WHERE g.threadId = r.threadId AND g.direction = 'incoming'
                         AND g.sentAt <= r.sentAt AND CHAR_LENGTH(g.body) >= 12
                       ORDER BY g.sentAt DESC LIMIT 1) AS question
             FROM inbox_messages r
             JOIN inbox_conversations c ON c.threadId = r.threadId
             WHERE r.direction = 'outgoing' AND r.isAutomatic = 0
               AND (r.senderName IS NULL OR LOWER(r.senderName) <> 'ai assistant')
               AND CHAR_LENGTH(r.body) >= 15
               ${sinceClause}
             ORDER BY r.sentAt DESC
             LIMIT ${Number(opts.maxPairs) || 30000}`
        );

        // Resolve group ids and dedup.
        const seen = new Set<string>();
        const toEmbed: { question: string; answer: string; listingId: number | null; groupId: number | null; refId: number | null; dedupKey: string }[] = [];
        for (const r of rows) {
            const q = (r.question || "").trim();
            const a = (r.answer || "").trim();
            if (q.length < 12 || a.length < 15) continue;
            if (norm(q) === norm(a)) continue;
            const listingId = r.listingId != null ? Number(r.listingId) : null;
            const groupId = (await this.groups.resolve(listingId)) ?? listingId ?? null;
            const dedupKey = `qa|${groupId ?? 0}|${norm(q).slice(0, 80)}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);
            toEmbed.push({ question: q, answer: a, listingId, groupId, refId: r.refId != null ? Number(r.refId) : null, dedupKey });
        }

        // Skip pairs already embedded (idempotent re-runs).
        const existingKeys = new Set(
            (await this.repo.find({ select: ["dedupKey"], where: { kind: "qa" } })).map((e) => e.dedupKey).filter(Boolean) as string[]
        );
        const fresh = toEmbed.filter((p) => !existingKeys.has(p.dedupKey));
        logger.info(`[Exemplar] backfill: ${rows.length} replies -> ${toEmbed.length} unique pairs, ${fresh.length} new to embed`);

        let embedded = 0;
        const BATCH = 96;
        for (let i = 0; i < fresh.length; i += BATCH) {
            const slice = fresh.slice(i, i + BATCH);
            let vectors: number[][];
            try {
                vectors = await this.embed.embedMany(slice.map((p) => p.question), BATCH);
            } catch (err: any) {
                logger.warn(`[Exemplar] embed batch failed at ${i}: ${err.message}`);
                continue;
            }
            const entities = slice.map((p, idx) =>
                this.repo.create({
                    kind: "qa",
                    refId: p.refId,
                    listingId: p.listingId,
                    groupId: p.groupId as any,
                    scope: "property",
                    embeddedText: p.question.slice(0, 4000),
                    payload: p.answer.slice(0, 4000),
                    vector: JSON.stringify(vectors[idx]),
                    model: EMBEDDING_MODEL,
                    dedupKey: p.dedupKey,
                })
            );
            await this.repo.save(entities, { chunk: 50 });
            embedded += entities.length;
            if (i % (BATCH * 10) === 0) logger.info(`[Exemplar] embedded ${embedded}/${fresh.length}`);
        }
        logger.info(`[Exemplar] backfill complete: embedded ${embedded} new exemplars`);
        return { pairs: toEmbed.length, embedded };
    }
}
