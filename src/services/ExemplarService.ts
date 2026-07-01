import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIEmbeddingEntity } from "../entity/AIEmbedding";
import { EmbeddingService, EMBEDDING_MODEL } from "./EmbeddingService";
import { ListingGroupService } from "./ListingGroupService";

export interface Exemplar {
    question: string;
    answer: string;
    sim: number;
    scope?: string;
}

const norm = (s: string) =>
    String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

/** Details that belong to a single property and must not go portfolio-wide. */
const PROPERTY_SPECIFIC =
    /\bgarage|driveway|carport|parking|door\s*code|lock\s*code|gate\s*code|access\s*code|wifi\s*password|password|\baddress\b|\bfloor\b|square\s*feet|sq\s*ft|bedroom|bathroom|\bsleeps\b|\bcode\b|\bkey\b|lockbox|pool\s*heat/i;

/**
 * Strip greetings, guest names, and sign-offs so the embedding focuses on the
 * actual question. "Hi Amber! Just wondering, what's the wifi? Thanks!" ->
 * "what's the wifi". Improves recall for short/most queries.
 */
export function focusQuery(text: string): string {
    let t = String(text || "").replace(/\s+/g, " ").trim();
    // Drop a leading greeting + optional name ("Hi", "Hello Amber,", "Good morning!")
    t = t.replace(/^(hi+|hey+|hello+|good (morning|afternoon|evening)|dear|hola|buenos días|buenas)\b[\s,!.-]*[A-Z][a-z]+?[\s,!.]*/i, "");
    t = t.replace(/^(hi+|hey+|hello+|good (morning|afternoon|evening)|dear|hola|buenos días|buenas)\b[\s,!.-]*/i, "");
    // Drop trailing thanks / sign-offs.
    t = t.replace(/\b(thanks?|thank you|thx|cheers|regards|best|appreciate it)\b[\s,!.]*$/i, "").trim();
    return t.length >= 8 ? t : String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * Retrieval + indexing over our real (guest question -> team answer) message
 * history. This is the core of "use our data": at answer time we fetch the most
 * semantically-similar past questions for the SAME property group (with a safe
 * portfolio fallback) and show the model how our team actually answered them.
 */
export class ExemplarService {
    private repo = appDatabase.getRepository(AIEmbeddingEntity);
    private embed = new EmbeddingService();
    private groups = new ListingGroupService();

    private static portfolioCache: { at: number; rows: { text: string; payload: string; vec: number[] }[] } | null = null;

    static isEnabled(): boolean {
        return process.env.AI_RAG_ENABLED === "true";
    }

    // ---------------------------------------------------------------- retrieval
    async retrieveSimilar(
        groupId: number | null | undefined,
        queryVector: number[],
        opts: { k?: number; minSim?: number; withPortfolio?: boolean } = {}
    ): Promise<Exemplar[]> {
        if (!queryVector?.length) return [];
        const k = opts.k ?? 4;
        const minSim = opts.minSim ?? 0.52;
        const out: Exemplar[] = [];
        const seenAns = new Set<string>();

        if (groupId) {
            const rows = await this.repo.find({ where: { kind: "qa", groupId: Number(groupId) as any }, take: 3000 });
            const scored: Exemplar[] = [];
            for (const r of rows) {
                const v = EmbeddingService.parseVector(r.vector);
                if (!v || !r.payload) continue;
                const sim = EmbeddingService.cosine(queryVector, v);
                if (sim >= minSim) scored.push({ question: r.embeddedText, answer: r.payload, sim, scope: "property" });
            }
            scored.sort((a, b) => b.sim - a.sim);
            for (const s of scored) {
                const key = norm(s.answer).slice(0, 60);
                if (seenAns.has(key)) continue;
                seenAns.add(key);
                out.push(s);
                if (out.length >= k) break;
            }
        }

        // Portfolio fallback for generic operational questions when the property
        // itself has little/no matching history (higher similarity bar).
        if (opts.withPortfolio !== false && out.length < k) {
            const port = await this.getPortfolioFaq();
            const scored: Exemplar[] = [];
            for (const r of port) {
                const sim = EmbeddingService.cosine(queryVector, r.vec);
                if (sim >= Math.max(minSim, 0.6)) scored.push({ question: r.text, answer: r.payload, sim, scope: "portfolio" });
            }
            scored.sort((a, b) => b.sim - a.sim);
            for (const s of scored) {
                const key = norm(s.answer).slice(0, 60);
                if (seenAns.has(key)) continue;
                seenAns.add(key);
                out.push(s);
                if (out.length >= k) break;
            }
        }
        return out;
    }

    async retrieveForQuery(
        groupId: number | null | undefined,
        queryText: string,
        opts: { k?: number; minSim?: number; withPortfolio?: boolean } = {}
    ): Promise<Exemplar[]> {
        if (!queryText?.trim()) return [];
        const qv = await this.embed.embedOne(focusQuery(queryText));
        return this.retrieveSimilar(groupId, qv, opts);
    }

    private async getPortfolioFaq(): Promise<{ text: string; payload: string; vec: number[] }[]> {
        const cached = ExemplarService.portfolioCache;
        if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.rows;
        const rows = await this.repo.find({ where: { kind: "qa", scope: "portfolio" }, take: 1000 });
        const parsed = rows
            .map((r) => ({ text: r.embeddedText, payload: r.payload || "", vec: EmbeddingService.parseVector(r.vector) || [] }))
            .filter((r) => r.vec.length && r.payload);
        ExemplarService.portfolioCache = { at: Date.now(), rows: parsed };
        return parsed;
    }

    static invalidatePortfolioCache() {
        ExemplarService.portfolioCache = null;
    }

    // ------------------------------------------------------------------- growth
    async addPair(listingId: number | null, question: string, answer: string, refId?: number | null): Promise<boolean> {
        try {
            const fq = focusQuery(question);
            if (fq.length < 10 || !answer || answer.trim().length < 15) return false;
            const groupId = (await this.groups.resolve(listingId)) ?? listingId ?? null;
            const dedupKey = `qa|${groupId ?? 0}|${norm(fq).slice(0, 70)}|${norm(answer).slice(0, 50)}`;
            const existing = await this.repo.findOne({ where: { dedupKey } });
            if (existing) return true;
            const vector = JSON.stringify(await this.embed.embedOne(fq));
            await this.repo.save(
                this.repo.create({
                    kind: "qa",
                    refId: refId ?? null,
                    listingId: listingId ?? null,
                    groupId: groupId as any,
                    scope: "property",
                    embeddedText: fq.slice(0, 4000),
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
     * Turn-level pairing over the WHOLE history: walk each thread chronologically,
     * accumulate the guest's turn (consecutive guest messages), and pair it with
     * the FIRST substantive human reply (skipping automatic/AI messages), bounded
     * to a 72h response window. Dedup keeps DISTINCT answers (not just one per
     * question), so we use far more of the data than the old approach.
     */
    async backfillFromHistory(opts: { sinceDays?: number; maxPairs?: number } = {}): Promise<{ pairs: number; embedded: number }> {
        const sinceClause = opts.sinceDays ? `AND m.sentAt >= DATE_SUB(NOW(), INTERVAL ${Number(opts.sinceDays)} DAY)` : "";
        const msgs: any[] = await appDatabase.query(
            `SELECT m.threadId, COALESCE(m.listingId, c.listingId) AS listingId, m.externalId AS extId,
                    m.direction, m.isAutomatic, m.senderName, m.body, m.sentAt
             FROM inbox_messages m
             JOIN inbox_conversations c ON c.threadId = m.threadId
             WHERE (m.direction = 'incoming' OR (m.direction = 'outgoing' AND m.isAutomatic = 0))
               AND m.body IS NOT NULL ${sinceClause}
             ORDER BY m.threadId ASC, m.sentAt ASC, m.id ASC`
        );

        const WINDOW_MS = 72 * 3600 * 1000;
        type Pair = { question: string; answer: string; listingId: number | null; refId: number | null };
        const pairs: Pair[] = [];
        let curThread: any = null;
        let qParts: string[] = [];
        let lastGuestAt: number | null = null;
        let lastGuestListing: number | null = null;

        const flushThreadReset = () => {
            qParts = [];
            lastGuestAt = null;
            lastGuestListing = null;
        };

        for (const m of msgs) {
            if (m.threadId !== curThread) {
                curThread = m.threadId;
                flushThreadReset();
            }
            const body = (m.body || "").trim();
            if (m.direction === "incoming") {
                if (body.length >= 3) {
                    qParts.push(body);
                    lastGuestAt = new Date(m.sentAt).getTime();
                    lastGuestListing = m.listingId != null ? Number(m.listingId) : lastGuestListing;
                }
            } else {
                // outgoing human reply
                const isAI = (m.senderName || "").toLowerCase() === "ai assistant";
                if (isAI || body.length < 15) continue;
                if (qParts.length && lastGuestAt != null && new Date(m.sentAt).getTime() - lastGuestAt <= WINDOW_MS) {
                    const question = focusQuery(qParts.join(" ").slice(0, 1200));
                    if (question.length >= 10 && norm(question) !== norm(body)) {
                        pairs.push({
                            question,
                            answer: body,
                            listingId: m.listingId != null ? Number(m.listingId) : lastGuestListing,
                            refId: m.extId != null ? Number(m.extId) : null,
                        });
                    }
                    // Clear the turn so a burst of replies doesn't re-pair.
                    flushThreadReset();
                }
            }
        }

        // Resolve groups, dedup by (group, focusedQ, answer), cap distinct answers
        // per (group, question) to 3 to avoid near-duplicate bloat.
        const seenExact = new Set<string>();
        const perQuestion = new Map<string, number>();
        const toEmbed: { question: string; answer: string; listingId: number | null; groupId: number | null; refId: number | null; dedupKey: string }[] = [];
        for (const p of pairs) {
            const groupId = (await this.groups.resolve(p.listingId)) ?? p.listingId ?? null;
            const qKey = `${groupId ?? 0}|${norm(p.question).slice(0, 70)}`;
            const dedupKey = `qa|${qKey}|${norm(p.answer).slice(0, 50)}`;
            if (seenExact.has(dedupKey)) continue;
            const cnt = perQuestion.get(qKey) || 0;
            if (cnt >= 3) continue;
            seenExact.add(dedupKey);
            perQuestion.set(qKey, cnt + 1);
            toEmbed.push({ question: p.question, answer: p.answer, listingId: p.listingId, groupId, refId: p.refId, dedupKey });
        }

        // Build portfolio FAQ candidates: questions asked across >=3 distinct groups,
        // that are NOT property-specific — safe generic operational answers.
        const byQ = new Map<string, { groups: Set<number>; answer: string; question: string }>();
        for (const p of toEmbed) {
            const qk = norm(p.question).slice(0, 60);
            if (!qk || PROPERTY_SPECIFIC.test(`${p.question} ${p.answer}`)) continue;
            if (!byQ.has(qk)) byQ.set(qk, { groups: new Set(), answer: p.answer, question: p.question });
            byQ.get(qk)!.groups.add(Number(p.groupId ?? 0));
        }
        const portfolio: { question: string; answer: string; dedupKey: string }[] = [];
        for (const [qk, v] of byQ) {
            if (v.groups.size >= 3) portfolio.push({ question: v.question, answer: v.answer, dedupKey: `qa|portfolio|${qk}` });
        }

        // Skip anything already embedded.
        const existingKeys = new Set(
            (await this.repo.find({ select: ["dedupKey"], where: { kind: "qa" } })).map((e) => e.dedupKey).filter(Boolean) as string[]
        );
        const freshQa = toEmbed.filter((p) => !existingKeys.has(p.dedupKey));
        const freshPort = portfolio.filter((p) => !existingKeys.has(p.dedupKey)).slice(0, 600);
        logger.info(
            `[Exemplar] pairing produced ${pairs.length} raw pairs -> ${toEmbed.length} unique, ${freshQa.length} new; portfolio FAQ ${portfolio.length} (${freshPort.length} new)`
        );

        let embedded = 0;
        embedded += await this.embedAndStore(
            freshQa.map((p) => ({
                kind: "qa",
                refId: p.refId,
                listingId: p.listingId,
                groupId: p.groupId,
                scope: "property",
                text: p.question,
                payload: p.answer,
                dedupKey: p.dedupKey,
            }))
        );
        embedded += await this.embedAndStore(
            freshPort.map((p) => ({
                kind: "qa",
                refId: null,
                listingId: null,
                groupId: null,
                scope: "portfolio",
                text: p.question,
                payload: p.answer,
                dedupKey: p.dedupKey,
            }))
        );
        ExemplarService.invalidatePortfolioCache();
        logger.info(`[Exemplar] backfill complete: embedded ${embedded} new (${freshQa.length} property + ${freshPort.length} portfolio)`);
        return { pairs: toEmbed.length, embedded };
    }

    /** Embed a set of records (question/text) in batches and persist. */
    async embedAndStore(
        records: { kind: string; refId: number | null; listingId: number | null; groupId: number | null; scope: string; text: string; payload: string | null; dedupKey: string; visibility?: string | null }[]
    ): Promise<number> {
        let embedded = 0;
        const BATCH = 96;
        for (let i = 0; i < records.length; i += BATCH) {
            const slice = records.slice(i, i + BATCH);
            let vectors: number[][];
            try {
                vectors = await this.embed.embedMany(slice.map((p) => p.text), BATCH);
            } catch (err: any) {
                logger.warn(`[Exemplar] embed batch failed at ${i}: ${err.message}`);
                continue;
            }
            const entities = slice.map((p, idx) =>
                this.repo.create({
                    kind: p.kind,
                    refId: p.refId,
                    listingId: p.listingId,
                    groupId: p.groupId as any,
                    scope: p.scope,
                    embeddedText: p.text.slice(0, 4000),
                    payload: p.payload ? p.payload.slice(0, 4000) : null,
                    vector: JSON.stringify(vectors[idx]),
                    model: EMBEDDING_MODEL,
                    dedupKey: p.dedupKey,
                    visibility: p.visibility ?? null,
                })
            );
            await this.repo.save(entities, { chunk: 50 });
            embedded += entities.length;
            if (i % (BATCH * 10) === 0 && records.length > BATCH) logger.info(`[Exemplar] embedded ${embedded}/${records.length}`);
        }
        return embedded;
    }
}
