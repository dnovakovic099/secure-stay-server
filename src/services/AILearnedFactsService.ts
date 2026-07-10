import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AILearnedFactEntity } from "../entity/AILearnedFact";
import { IsNull, In } from "typeorm";

export interface LearnedFactInput {
    scope?: "property" | "portfolio";
    listingId?: number | null;
    topic: string;
    question?: string | null;
    answer?: string | null;
    sampleThreadId?: number | null;
    source?: string;
    /** users.id of the staff member who taught this fact (manual paths only). */
    createdByUserId?: number | null;
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
    // Facts that are physically tied to a single property must never be stored
    // portfolio-wide (that caused e.g. a "one car fits in the garage" answer to
    // leak onto a driveway-only property). Force these back to property scope.
    private static PROPERTY_SPECIFIC =
        /\bgarage|driveway|carport|parking|door\s*code|lock\s*code|gate\s*code|access\s*code|wifi\s*password|address|\bfloor\b|square\s*feet|sq\s*ft|bedroom|bathroom|sleeps|capacity|pool\s*heat/i;

    /**
     * Property-scoped facts only auto-approve once the same topic has been seen
     * this many times (team feedback: one-off Q&As were auto-approving bad info).
     */
    private static AUTO_APPROVE_MIN_FREQUENCY = 3;

    /**
     * Auto-approval gate (team feedback: blanket auto-approve produced bad facts).
     *  - property scope: the same (listing, topic) must have been seen at least
     *    AUTO_APPROVE_MIN_FREQUENCY times before it can auto-approve.
     *  - portfolio scope: only auto-approve when the topic has already been asked
     *    on (essentially) every active property — otherwise it stays pending for
     *    a human to confirm it's truly universal.
     * Explicit staff sources (simulator teach, learning-prompt answers) bypass
     * this via opts.trustedSource.
     */
    private async passesAutoApproveGate(
        scope: string,
        listingId: number | null,
        topic: string,
        frequency: number
    ): Promise<boolean> {
        if (scope === "property") {
            return frequency >= AILearnedFactsService.AUTO_APPROVE_MIN_FREQUENCY;
        }
        // Portfolio: how many distinct properties has this topic been asked on,
        // vs. how many properties actively receive guest messages?
        try {
            const askedRow = await this.repo
                .createQueryBuilder("f")
                .select("COUNT(DISTINCT f.listingId)", "cnt")
                .where("f.scope = 'property'")
                .andWhere("f.topic = :topic", { topic })
                .andWhere("f.listingId IS NOT NULL")
                .getRawOne();
            const askedOn = Number(askedRow?.cnt) || 0;
            const activeRow = await appDatabase
                .createQueryBuilder()
                .select("COUNT(DISTINCT c.listingId)", "cnt")
                .from("inbox_conversations", "c")
                .where("c.listingId IS NOT NULL")
                .getRawOne();
            const active = Number(activeRow?.cnt) || 0;
            return active > 0 && askedOn >= active;
        } catch (err: any) {
            logger.warn(`[LearnedFacts] portfolio auto-approve coverage check failed: ${err.message}`);
            return false;
        }
    }

    async upsert(
        input: LearnedFactInput,
        opts: { autoApprove?: boolean; trustedSource?: boolean } = {}
    ): Promise<AILearnedFactEntity> {
        let scope = input.scope === "portfolio" ? "portfolio" : "property";
        if (
            scope === "portfolio" &&
            AILearnedFactsService.PROPERTY_SPECIFIC.test(`${input.question ?? ""} ${input.answer ?? ""}`)
        ) {
            // Only demotable if we actually know which listing it came from;
            // otherwise drop it rather than let it generalize incorrectly.
            if (input.listingId) {
                scope = "property";
                logger.info(`[LearnedFacts] demoted property-specific fact to listing ${input.listingId}: "${input.topic}"`);
            } else {
                logger.warn(`[LearnedFacts] dropped ungrounded property-specific portfolio fact: "${input.topic}"`);
                throw new Error("property-specific fact cannot be portfolio-wide without a listingId");
            }
        }
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
            if (input.createdByUserId != null) existing.createdByUserId = input.createdByUserId;
            // Auto-approve keeps still-pending facts flowing to the bot; a rejected
            // fact stays rejected until a human re-approves it. Extracted facts
            // must additionally pass the frequency/coverage gate.
            if (opts.autoApprove && existing.status === "pending") {
                const approve =
                    opts.trustedSource ||
                    (await this.passesAutoApproveGate(scope, listingId, topic, existing.frequency));
                if (approve) existing.status = "approved";
            }
            return this.repo.save(existing);
        }

        const autoApproveNew =
            !!opts.autoApprove &&
            (opts.trustedSource || (await this.passesAutoApproveGate(scope, listingId, topic, 1)));
        const created = this.repo.create({
            scope,
            listingId,
            topic,
            question: input.question ?? null,
            answer: input.answer ?? null,
            frequency: 1,
            status: autoApproveNew ? "approved" : "pending",
            source: input.source || "nightly_audit",
            sampleThreadId: input.sampleThreadId ?? null,
            createdByUserId: input.createdByUserId ?? null,
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
        const rows = await this.repo.find({ where, order: { frequency: "DESC", updatedAt: "DESC" }, take: 500 });
        const listingIds = [...new Set(rows.map((f) => f.listingId).filter((id) => id != null).map(Number))];
        const listingNames = new Map<number, string>();
        if (listingIds.length) {
            const listingRows: any[] = await appDatabase.query(
                `SELECT id, internalListingName, name, externalListingName
                 FROM listing_info
                 WHERE id IN (${listingIds.map(() => "?").join(",")})`,
                listingIds
            );
            for (const listing of listingRows) {
                const name = listing.internalListingName || listing.name || listing.externalListingName || null;
                if (name) listingNames.set(Number(listing.id), name);
            }
        }

        // Attribution: resolve who taught / reviewed each fact to display names,
        // so the Learned tab can show "Taught by X" instead of a bare user id.
        const ids = new Set<number>();
        for (const f of rows) {
            if (f.createdByUserId != null) ids.add(Number(f.createdByUserId));
            if (f.reviewedByUserId != null) ids.add(Number(f.reviewedByUserId));
        }
        const nameById = await AILearnedFactsService.userNames([...ids]);
        return rows.map((f) => ({
            ...f,
            listingName: f.listingId != null ? listingNames.get(Number(f.listingId)) ?? null : null,
            taughtByName: f.createdByUserId != null ? nameById.get(Number(f.createdByUserId)) ?? null : null,
            reviewedByName: f.reviewedByUserId != null ? nameById.get(Number(f.reviewedByUserId)) ?? null : null,
            approvalReason:
                f.status !== "approved"
                    ? null
                    : f.reviewedByUserId != null
                    ? `This learned fact was approved or last reviewed by ${nameById.get(Number(f.reviewedByUserId)) ?? "a SecureStay user"}.`
                    : f.createdByUserId != null
                    ? `This learned fact was manually taught by ${nameById.get(Number(f.createdByUserId)) ?? "a SecureStay user"} and trusted for future replies.`
                    : f.source === "nightly_audit" && f.frequency >= AILearnedFactsService.AUTO_APPROVE_MIN_FREQUENCY
                    ? `This self-learned fact was approved because the same topic was found ${f.frequency} times, meeting the self-learning review threshold.`
                    : "This self-learned fact is approved in the learned-facts review list. No reviewer name is attached to the record.",
        }));
    }

    /** users.id -> display name (firstName lastName, falling back to email). */
    static async userNames(ids: number[]): Promise<Map<number, string>> {
        const map = new Map<number, string>();
        if (!ids.length) return map;
        try {
            const rows: any[] = await appDatabase.query(
                `SELECT id, firstName, lastName, email FROM users WHERE id IN (${ids.map(() => "?").join(",")})`,
                ids
            );
            for (const u of rows) {
                const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
                map.set(Number(u.id), name || u.email || `user ${u.id}`);
            }
        } catch {
            /* attribution is best-effort */
        }
        return map;
    }

    async setStatus(id: number, status: "approved" | "rejected" | "pending", userId?: number | null) {
        const fact = await this.repo.findOne({ where: { id } });
        if (!fact) throw new Error(`Learned fact ${id} not found`);
        fact.status = status;
        fact.reviewedByUserId = userId ?? fact.reviewedByUserId ?? null;
        return this.repo.save(fact);
    }

    /**
     * Staff-edit a learned fact: customize the answer/question, recategorize the
     * topic, or move it between property and portfolio scope. Used by the
     * "Learned" tab so curators can correct what the bot remembers.
     */
    async update(
        id: number,
        patch: {
            answer?: string | null;
            question?: string | null;
            topic?: string;
            scope?: "property" | "portfolio";
            listingId?: number | null;
        },
        userId?: number | null
    ) {
        const fact = await this.repo.findOne({ where: { id } });
        if (!fact) throw new Error(`Learned fact ${id} not found`);
        if (patch.answer !== undefined) fact.answer = patch.answer;
        if (patch.question !== undefined) fact.question = patch.question;
        if (patch.topic !== undefined && patch.topic.trim()) fact.topic = slug(patch.topic);
        if (patch.scope !== undefined) {
            fact.scope = patch.scope === "portfolio" ? "portfolio" : "property";
            if (fact.scope === "portfolio") fact.listingId = null;
        }
        if (patch.listingId !== undefined && fact.scope !== "portfolio") {
            fact.listingId = patch.listingId;
        }
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
        opts: { query?: string; maxChars?: number; listingIds?: number[] } | number = {}
    ): Promise<string | null> {
        const o = typeof opts === "number" ? { maxChars: opts } : opts;
        const maxChars = o.maxChars ?? 3500;
        const qTokens = tokenizeFacts(o.query);
        // Gather property facts across the whole channel-split group when provided.
        const ids = (o.listingIds && o.listingIds.length ? o.listingIds : listingId ? [Number(listingId)] : []).map(Number);
        try {
            const [property, portfolio] = await Promise.all([
                ids.length
                    ? this.repo.find({
                          where: { status: "approved", scope: "property", listingId: ids.length === 1 ? (ids[0] as any) : In(ids) },
                          order: { frequency: "DESC" },
                          take: 300,
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
