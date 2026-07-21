import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AILearnedFactEntity } from "../entity/AILearnedFact";
import { ListingKnowledgeEntryEntity } from "../entity/ListingKnowledgeEntry";
import { IsNull, In } from "typeorm";
import { allowPortfolioMemory, isPropertyScopedMemory } from "../utils/aiPortfolioGuards";

export type LearnedFactType = "qa" | "style_rule" | "topic_to_avoid";
export type LearnedFactVisibility = "internal" | "external";

export interface LearnedFactInput {
    scope?: "property" | "portfolio";
    listingId?: number | null;
    topic: string;
    question?: string | null;
    answer?: string | null;
    factType?: LearnedFactType;
    visibility?: LearnedFactVisibility;
    sampleThreadId?: number | null;
    source?: string;
    /** users.id of the staff member who taught this fact (manual paths only). */
    createdByUserId?: number | null;
}

/**
 * Instruction phrases the AI can't actually execute in a reply. We reject
 * these on `sandboxTeach` so a well-meaning curator doesn't create a learned
 * fact that promises something the bot can't deliver ("recommend nearby
 * available properties", "book them for next weekend"). Kept short and
 * conservative so obvious cases fire without blocking normal answers.
 */
const UNSUPPORTED_INSTRUCTION_PATTERNS: { pattern: RegExp; reason: string }[] = [
    { pattern: /\b(recommend|find|check|look up|show)\b[^.]{0,60}\b(nearby|other|another|alternate)\b[^.]{0,60}\b(propert|listing|home|unit|place)/i,
        reason: "The AI cannot search live availability across other properties. Route the guest to the sales channel instead." },
    { pattern: /\b(book|reserve|hold|charge|refund|cancel)\b[^.]{0,80}\b(for|on|to|the|their|this)\b/i,
        reason: "The AI cannot execute reservations, payments, or refunds directly. Ask a human to handle transactional actions." },
    { pattern: /\b(check|verify|look up|pull)\b[^.]{0,60}\b(availability|open dates|calendar)\b/i,
        reason: "The AI cannot query live calendar availability for arbitrary date ranges. Add rules to defer to the availability endpoint instead." },
    { pattern: /\b(send|schedule|dispatch)\b[^.]{0,60}\b(cleaner|maintenance|tech|technician|contractor)\b/i,
        reason: "The AI cannot dispatch staff or vendors. Create an action item or escalate to a human." },
];

export interface CapabilityCheckResult {
    supported: boolean;
    reason?: string;
    matchedPattern?: string;
}

/**
 * Pre-teach check: does this instruction fit what the AI can actually do?
 * Returns { supported:false, reason } so the sandbox teach endpoint can refuse
 * and show the reviewer why. Applied to both the question and the answer text.
 */
export function checkInstructionSupport(text: string): CapabilityCheckResult {
    const hay = String(text || "").trim();
    if (!hay) return { supported: true };
    for (const rule of UNSUPPORTED_INSTRUCTION_PATTERNS) {
        if (rule.pattern.test(hay)) {
            return { supported: false, reason: rule.reason, matchedPattern: rule.pattern.source };
        }
    }
    return { supported: true };
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
    private kbRepo = appDatabase.getRepository(ListingKnowledgeEntryEntity);

    private static cleanDisplayName(value: unknown): string | null {
        const text = String(value ?? "").replace(/\s+/g, " ").trim();
        return text || null;
    }

    private async resolveListingNicknames(listingIds: number[]): Promise<Map<number, string>> {
        const uniqueIds = [...new Set(listingIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
        const listingNames = new Map<number, string>();
        if (!uniqueIds.length) return listingNames;

        const applyRows = (rows: any[] = [], idKey = "listingId", nameKey = "listingName") => {
            for (const row of rows) {
                const id = Number(row?.[idKey]);
                if (!Number.isFinite(id) || listingNames.has(id)) continue;
                const name = AILearnedFactsService.cleanDisplayName(row?.[nameKey]);
                if (name) listingNames.set(id, name);
            }
        };

        const placeholders = uniqueIds.map(() => "?").join(",");
        const listingRows: any[] = await appDatabase.query(
            `SELECT id, internalListingName
             FROM listing_info
             WHERE id IN (${placeholders})`,
            uniqueIds
        );
        applyRows(listingRows, "id", "internalListingName");

        const unresolvedIds = () => uniqueIds.filter((id) => !listingNames.has(id));
        const applyFallback = async (table: string) => {
            const ids = unresolvedIds();
            if (!ids.length) return;
            const fallbackRows: any[] = await appDatabase.query(
                `SELECT listingId, MAX(NULLIF(TRIM(listingName), '')) AS listingName
                 FROM ${table}
                 WHERE listingId IN (${ids.map(() => "?").join(",")})
                   AND listingName IS NOT NULL
                   AND TRIM(listingName) <> ''
                 GROUP BY listingId`,
                ids
            );
            applyRows(fallbackRows);
        };

        // Some inbox listing ids are Hostify ids that do not have a matching
        // listing_info row. Fall back to the nickname/name captured on the
        // source conversation or learning prompt instead of returning null.
        await applyFallback("inbox_conversations");
        await applyFallback("quo_conversations");
        await applyFallback("ai_learning_prompts");

        return listingNames;
    }

    /**
     * Upsert by (scope, listingId, topic): if a matching fact exists we bump its
     * frequency and refresh lastSeenAt (and fill answer/question if empty); else
     * we insert a new pending fact.
     */
    // Facts that are physically tied to a single property must never be stored
    // portfolio-wide (that caused e.g. a "one car fits in the garage" answer to
    // leak onto a driveway-only property). Force these back to property scope.

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

    /**
     * Mirror an approved, property-scoped, guest-shareable QA fact into the
     * property's Knowledge Base so it lives alongside curated listing info.
     * Internal facts and style_rule / topic_to_avoid facts stay in the learned
     * store only — the KB is guest-facing and must not leak internal guidance.
     * Idempotent by (listingId, knowledgeEntryId).
     */
    private async syncFactToKnowledge(fact: AILearnedFactEntity): Promise<AILearnedFactEntity> {
        const shouldMirror =
            fact.status === "approved" &&
            fact.scope === "property" &&
            fact.listingId != null &&
            fact.factType === "qa" &&
            fact.visibility === "external";

        // If the fact no longer qualifies (rejected, promoted to portfolio,
        // switched to internal / style rule), archive the linked KB entry.
        if (!shouldMirror) {
            if (fact.knowledgeEntryId) {
                try {
                    await this.kbRepo.update(
                        { id: fact.knowledgeEntryId as any },
                        { isArchived: 1 }
                    );
                } catch (err: any) {
                    logger.warn(`[LearnedFacts] KB archive failed for fact ${fact.id}: ${err.message}`);
                }
                fact.knowledgeEntryId = null;
                await this.repo.save(fact);
            }
            return fact;
        }

        const title = (fact.question || fact.topic || "").replace(/\s+/g, " ").trim().slice(0, 255) || "Learned";
        const category = fact.topic || "Learned";
        const content = fact.answer || "";

        try {
            let entry = fact.knowledgeEntryId
                ? await this.kbRepo.findOne({ where: { id: fact.knowledgeEntryId as any } })
                : null;
            if (entry) {
                entry.title = title;
                entry.category = category.slice(0, 120);
                entry.content = content;
                entry.visibility = "external";
                entry.isArchived = 0;
                entry.source = "ai_suggested";
                await this.kbRepo.save(entry);
            } else {
                entry = this.kbRepo.create({
                    listingId: Number(fact.listingId),
                    category: category.slice(0, 120),
                    visibility: "external",
                    title,
                    content,
                    source: "ai_suggested",
                    isArchived: 0,
                });
                entry = await this.kbRepo.save(entry);
                fact.knowledgeEntryId = entry.id;
                await this.repo.save(fact);
            }
        } catch (err: any) {
            logger.warn(`[LearnedFacts] KB sync failed for fact ${fact.id}: ${err.message}`);
        }
        return fact;
    }

    /**
     * Reverse sync: called from ListingKnowledgeController when a KB entry is
     * edited or removed. Keeps the paired learned fact in step so curators
     * can't get the two views out of sync.
     */
    async syncFromKnowledgeEntry(entry: ListingKnowledgeEntryEntity): Promise<void> {
        const fact = await this.repo.findOne({ where: { knowledgeEntryId: entry.id as any } });
        if (!fact) return;
        if (entry.isArchived) {
            fact.status = "rejected";
            fact.knowledgeEntryId = null;
        } else {
            fact.answer = entry.content;
            fact.question = entry.title;
            fact.topic = slug(entry.category || fact.topic);
            fact.visibility = entry.visibility === "internal" ? "internal" : "external";
            // If the KB curator flipped it to internal, drop the KB link since
            // learned facts marked internal never mirror to KB.
            if (fact.visibility === "internal") fact.knowledgeEntryId = null;
        }
        await this.repo.save(fact);
    }

    async upsert(
        input: LearnedFactInput,
        opts: { autoApprove?: boolean; trustedSource?: boolean } = {}
    ): Promise<AILearnedFactEntity> {
        let scope = input.scope === "portfolio" ? "portfolio" : "property";
        if (
            scope === "portfolio" &&
            isPropertyScopedMemory(`${input.question ?? ""} ${input.answer ?? ""}`)
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
        const factType: LearnedFactType =
            input.factType === "style_rule" || input.factType === "topic_to_avoid" ? input.factType : "qa";
        const visibility: LearnedFactVisibility = input.visibility === "internal" ? "internal" : "external";

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
            if (input.factType !== undefined) existing.factType = factType;
            if (input.visibility !== undefined) existing.visibility = visibility;
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
            const saved = await this.repo.save(existing);
            return this.syncFactToKnowledge(saved);
        }

        const autoApproveNew =
            !!opts.autoApprove &&
            (opts.trustedSource || (await this.passesAutoApproveGate(scope, listingId, topic, 1)));
        const created = this.repo.create({
            scope,
            listingId,
            topic,
            factType,
            visibility,
            question: input.question ?? null,
            answer: input.answer ?? null,
            frequency: 1,
            status: autoApproveNew ? "approved" : "pending",
            source: input.source || "nightly_audit",
            sampleThreadId: input.sampleThreadId ?? null,
            createdByUserId: input.createdByUserId ?? null,
            lastSeenAt: new Date(),
        });
        const saved = await this.repo.save(created);
        return this.syncFactToKnowledge(saved);
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

    async list(opts: { status?: string; scope?: string; listingId?: number; factType?: string } = {}) {
        const where: any = {};
        if (opts.status) where.status = opts.status;
        if (opts.scope) where.scope = opts.scope;
        if (opts.listingId != null) where.listingId = opts.listingId;
        if (opts.factType) where.factType = opts.factType;
        const rows = await this.repo.find({ where, order: { frequency: "DESC", updatedAt: "DESC" }, take: 500 });
        const listingIds = [...new Set(rows.map((f) => f.listingId).filter((id) => id != null).map(Number))];
        const listingNames = await this.resolveListingNicknames(listingIds);

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
        const saved = await this.repo.save(fact);
        return this.syncFactToKnowledge(saved);
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
            factType?: LearnedFactType;
            visibility?: LearnedFactVisibility;
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
        if (patch.factType !== undefined) fact.factType = patch.factType;
        if (patch.visibility !== undefined) fact.visibility = patch.visibility;
        fact.reviewedByUserId = userId ?? fact.reviewedByUserId ?? null;
        const saved = await this.repo.save(fact);
        return this.syncFactToKnowledge(saved);
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
        opts:
            | {
                  query?: string;
                  maxChars?: number;
                  listingIds?: number[];
                  channel?: string | null;
                  /** Open Conflicts-page fact ids — never inject these into guest replies. */
                  excludeFactIds?: Set<number> | number[];
              }
            | number = {}
    ): Promise<string | null> {
        const o = typeof opts === "number" ? { maxChars: opts } : opts;
        const maxChars = o.maxChars ?? 3500;
        const qTokens = tokenizeFacts(o.query);
        const channel = o.channel ?? null;
        const excluded =
            o.excludeFactIds instanceof Set
                ? o.excludeFactIds
                : new Set((o.excludeFactIds || []).map(Number));
        // Gather property facts across the whole channel-split group when provided.
        const ids = (o.listingIds && o.listingIds.length ? o.listingIds : listingId ? [Number(listingId)] : []).map(Number);
        try {
            const [propertyRaw, portfolioRaw] = await Promise.all([
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
            const property = excluded.size ? propertyRaw.filter((f) => !excluded.has(Number(f.id))) : propertyRaw;
            const portfolio = excluded.size ? portfolioRaw.filter((f) => !excluded.has(Number(f.id))) : portfolioRaw;

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

            // Split by fact type so internal-only guidance can't get quoted
            // verbatim to a guest. style_rule / topic_to_avoid facts are
            // surfaced separately from Q&A facts so the prompt can apply them
            // as rules rather than answers.
            const isQa = (f: AILearnedFactEntity) => !f.factType || f.factType === "qa";
            // Guest-reply context: EXTERNAL QA only. Internal facts remain in
            // the Learned tab for staff, but never enter guest-facing prompts.
            const qaExternal = (f: AILearnedFactEntity) => isQa(f) && f.visibility !== "internal";
            const isStyle = (f: AILearnedFactEntity) => f.factType === "style_rule";
            const isAvoid = (f: AILearnedFactEntity) => f.factType === "topic_to_avoid";

            const rankedPropertyExternal = rank(property.filter(qaExternal));
            const rankedPortfolioExternal = rank(
                portfolio.filter(
                    (f) =>
                        qaExternal(f) &&
                        allowPortfolioMemory(`${f.question || ""} ${f.answer || ""} ${f.topic || ""}`, channel)
                )
            );
            const styleRules = rank([...property, ...portfolio].filter(isStyle));
            const avoidTopics = rank([...property, ...portfolio].filter(isAvoid));

            const lines: string[] = [];
            let used = 0;
            const fmt = (f: AILearnedFactEntity) => {
                const q = (f.question || f.topic || "").replace(/\s+/g, " ").trim();
                const a = (f.answer || "").replace(/\s+/g, " ").trim();
                return `- Q: ${q}\n  A: ${a}`;
            };
            const fmtRule = (f: AILearnedFactEntity) => {
                const rule = (f.answer || f.question || f.topic || "").replace(/\s+/g, " ").trim();
                return `- ${rule}`;
            };
            const addSection = (header: string, list: AILearnedFactEntity[], budget: number, formatter = fmt) => {
                if (!list.length) return;
                const start = lines.length;
                let sectionUsed = 0;
                for (const f of list) {
                    const block = formatter(f);
                    if (sectionUsed + block.length > budget) break;
                    lines.push(block);
                    sectionUsed += block.length + 1;
                    used += block.length + 1;
                }
                if (lines.length > start) lines.splice(start, 0, header);
            };

            addSection("PROPERTY-SPECIFIC learned answers (guest-shareable):", rankedPropertyExternal, Math.floor(maxChars * 0.55));
            if (lines.length) lines.push("");
            addSection(
                "PORTFOLIO-WIDE learned answers (generic ops ONLY — never use for checkout times, capacity, deposits, amenities, or channel-specific money facts):",
                rankedPortfolioExternal,
                Math.floor(maxChars * 0.3)
            );
            if (styleRules.length) {
                lines.push("");
                addSection(
                    "LEARNED COMMUNICATION STYLE / RULES (apply to every reply):",
                    styleRules,
                    Math.floor(maxChars * 0.075),
                    fmtRule
                );
            }
            if (avoidTopics.length) {
                lines.push("");
                addSection(
                    "LEARNED TOPICS TO AVOID / ALWAYS ESCALATE:",
                    avoidTopics,
                    Math.floor(maxChars * 0.075),
                    fmtRule
                );
            }

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
