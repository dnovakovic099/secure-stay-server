import crypto from "crypto";
import OpenAI from "openai";
import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIKnowledgeConflictEntity, AIConflictScanEntity } from "../entity/AIKnowledgeConflict";
import { AILearnedFactEntity } from "../entity/AILearnedFact";
import { ListingKnowledgeEntryEntity } from "../entity/ListingKnowledgeEntry";
import { Listing } from "../entity/Listing";
import { ListingGroupService } from "./ListingGroupService";

const CONFLICT_MODEL = process.env.AI_CONFLICT_MODEL || process.env.AI_ITEM_DETECTION_MODEL || "gpt-4.1-mini";

/** One comparable knowledge item handed to the LLM. */
interface KnowledgeItem {
    /** Stable ref: 'ld:<listingId>:<slug>' | 'fact:<id>' | 'kb:<id>' */
    ref: string;
    sourceType: "listing_data" | "learned_fact" | "kb_entry";
    sourceId: number | null;
    label: string;
    text: string;
}

const slug = (s: string) =>
    String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "general";

const fmtHour = (v: any): string | null => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 23) return null;
    const ampm = n >= 12 ? "PM" : "AM";
    return `${n % 12 === 0 ? 12 : n % 12}:00 ${ampm}`;
};

/**
 * AIConflictDetectorService — finds contradictions between the AI's knowledge
 * sources so staff can fix the wrong one before a guest hears it.
 *
 * The bot answers from three places: live listing data (authoritative),
 * learned Q&A facts, and Knowledge Base entries. They drift: the listing gets
 * a new check-out time, but a fact taught last summer still says the old one —
 * and which value the guest hears depends on retrieval luck. Each sweep:
 *
 *   1. builds every listing's knowledge set (facts + KB across the
 *      channel-split group, portfolio facts, listing_info snapshot)
 *   2. skips listings whose source hash hasn't changed since the last scan
 *      (nightly runs only pay LLM calls for listings that changed)
 *   3. asks a small JSON-mode model for genuinely contradicting pairs
 *   4. upserts them dedupe-keyed; dismissed stay dismissed, fixed ones
 *      auto-resolve (the pair stops being detected, or a source is
 *      removed/edited — see autoResolveInvalid).
 */
export class AIConflictDetectorService {
    private repo = appDatabase.getRepository(AIKnowledgeConflictEntity);
    private scanRepo = appDatabase.getRepository(AIConflictScanEntity);
    private factRepo = appDatabase.getRepository(AILearnedFactEntity);
    private kbRepo = appDatabase.getRepository(ListingKnowledgeEntryEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private groups = new ListingGroupService();

    static isEnabled(): boolean {
        return String(process.env.AI_MESSAGING_ENABLED || "").toLowerCase() === "true";
    }

    // ------------------------------------------------------------------
    // Store / listing / summary
    // ------------------------------------------------------------------

    async list(opts: { status?: string; listingId?: number; limit?: number } = {}) {
        const qb = this.repo
            .createQueryBuilder("c")
            .where("c.status = :status", { status: opts.status || "open" })
            .orderBy("FIELD(c.severity, 'high', 'medium', 'low')", "ASC")
            .addOrderBy("c.lastSeenAt", "DESC")
            .take(Math.min(Math.max(opts.limit || 200, 1), 500));
        if (opts.listingId) qb.andWhere("c.listingId = :lid", { lid: opts.listingId });
        return qb.getMany();
    }

    /**
     * Sources that must NOT be fed into a guest-facing reply while a Conflicts
     * row is still open. Live listing_data always wins: the conflicting
     * learned_fact / kb_entry is suppressed. Fact-vs-KB (no listing side)
     * suppresses both until staff clears the Conflicts page — better to defer
     * than tell the guest the wrong checkout time.
     *
     * listingIds should be the full channel-split group for the conversation.
     */
    async getGuestReplySuppressions(listingIds: number[]): Promise<{
        factIds: Set<number>;
        kbIds: Set<number>;
        topics: string[];
    }> {
        const factIds = new Set<number>();
        const kbIds = new Set<number>();
        const topics: string[] = [];
        const ids = [...new Set((listingIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
        if (!ids.length) return { factIds, kbIds, topics };

        const conflicts = await this.repo
            .createQueryBuilder("c")
            .where("c.status = 'open'")
            .andWhere("c.listingId IN (:...ids)", { ids })
            .take(200)
            .getMany();

        const suppressSide = (type: string, id: number | null) => {
            if (id == null) return;
            if (type === "learned_fact") factIds.add(Number(id));
            else if (type === "kb_entry") kbIds.add(Number(id));
        };

        for (const c of conflicts) {
            const aIsListing = c.sourceAType === "listing_data";
            const bIsListing = c.sourceBType === "listing_data";
            if (aIsListing && !bIsListing) suppressSide(c.sourceBType, c.sourceBId);
            else if (bIsListing && !aIsListing) suppressSide(c.sourceAType, c.sourceAId);
            else {
                // Neither side is live listing data — hold both out of guest context.
                suppressSide(c.sourceAType, c.sourceAId);
                suppressSide(c.sourceBType, c.sourceBId);
            }
            if (c.topic) topics.push(String(c.topic));
        }
        return { factIds, kbIds, topics: [...new Set(topics)].slice(0, 12) };
    }

    async summary() {
        const rows: any[] = await appDatabase.query(
            `SELECT status, severity, COUNT(*) n FROM ai_knowledge_conflicts GROUP BY status, severity`
        );
        const out = { open: 0, high: 0, medium: 0, resolved: 0, dismissed: 0 };
        for (const r of rows) {
            const n = Number(r.n);
            if (r.status === "open") {
                out.open += n;
                if (r.severity === "high") out.high += n;
                else out.medium += n;
            } else if (r.status === "resolved") out.resolved += n;
            else if (r.status === "dismissed") out.dismissed += n;
        }
        return out;
    }

    async resolve(id: number) {
        const row = await this.repo.findOne({ where: { id } });
        if (!row) throw new Error(`Conflict ${id} not found`);
        row.status = "resolved";
        row.resolvedAt = new Date();
        return this.repo.save(row);
    }

    async dismiss(id: number, userId?: number | null) {
        const row = await this.repo.findOne({ where: { id } });
        if (!row) throw new Error(`Conflict ${id} not found`);
        row.status = "dismissed";
        row.dismissedByUserId = userId ?? null;
        return this.repo.save(row);
    }

    // ------------------------------------------------------------------
    // Source gathering
    // ------------------------------------------------------------------

    /** Authoritative listing_info snapshot as comparable items. */
    private listingDataItems(l: Listing): KnowledgeItem[] {
        const items: KnowledgeItem[] = [];
        const push = (topic: string, label: string, text: string | null) => {
            if (!text || !String(text).trim()) return;
            items.push({
                ref: `ld:${l.id}:${slug(topic)}`,
                sourceType: "listing_data",
                sourceId: null,
                label,
                text: String(text).trim(),
            });
        };
        const ci = fmtHour((l as any).checkInTimeStart);
        const co = fmtHour((l as any).checkOutTime);
        if (ci) push("check-in time", "Listing: check-in time", `Check-in starts at ${ci}.`);
        if (co) push("check-out time", "Listing: check-out time", `Check-out is by ${co}.`);
        const loc = [l.address, l.city, l.state].filter((v: any) => v && String(v).trim() && String(v) !== "(NOT SPECIFIED)");
        if (loc.length) push("address", "Listing: address", `The property address is ${loc.join(", ")}.`);
        if (l.bedroomsNumber != null) push("bedrooms", "Listing: bedrooms", `The property has ${l.bedroomsNumber} bedroom(s).`);
        if (l.bathroomsNumber != null) push("bathrooms", "Listing: bathrooms", `The property has ${l.bathroomsNumber} bathroom(s).`);
        if (l.personCapacity != null) push("max guests", "Listing: max guests", `Maximum occupancy is ${l.personCapacity} guest(s).`);
        if (l.cleaningFee != null && Number(l.cleaningFee) > 0)
            push("cleaning fee", "Listing: cleaning fee", `The cleaning fee is $${l.cleaningFee}.`);
        if ((l as any).airbnbPetFeeAmount != null && Number((l as any).airbnbPetFeeAmount) > 0)
            push("pet fee", "Listing: pet fee", `The pet fee is $${(l as any).airbnbPetFeeAmount}.`);
        const wifiName = String((l as any).wifiUsername || "").trim();
        if (wifiName) {
            const wifiPass = String((l as any).wifiPassword || "").trim();
            push("wifi", "Listing: WiFi", `WiFi network "${wifiName}"${wifiPass ? ` with password "${wifiPass}"` : ""}.`);
        }
        return items;
    }

    /**
     * All comparable knowledge for one listing (across its channel-split
     * group): listing_info snapshot + approved QA facts (property + portfolio)
     * + active KB entries.
     */
    private async gatherSources(listingId: number): Promise<{ items: KnowledgeItem[]; hash: string; listingName: string | null }> {
        const groupIds = (await this.groups.groupIds(listingId).catch(() => [listingId])) || [listingId];
        const ids = groupIds.length ? groupIds : [listingId];

        const [listing, facts, portfolioFacts, kbEntries] = await Promise.all([
            this.listingRepo.findOne({ where: { id: listingId as any } }),
            this.factRepo.find({
                where: { status: "approved", factType: "qa", scope: "property", listingId: In(ids) as any },
                order: { frequency: "DESC" },
                take: 80,
            }),
            this.factRepo.find({
                where: { status: "approved", factType: "qa", scope: "portfolio" },
                order: { frequency: "DESC" },
                take: 50,
            }),
            this.kbRepo.find({
                where: { listingId: In(ids) as any, isArchived: 0 },
                order: { updatedAt: "DESC" },
                take: 80,
            }),
        ]);

        const items: KnowledgeItem[] = [];
        if (listing) items.push(...this.listingDataItems(listing));
        for (const f of [...facts, ...portfolioFacts]) {
            const text = [f.question ? `Q: ${f.question}` : null, f.answer ? `A: ${f.answer}` : null]
                .filter(Boolean)
                .join("\n");
            if (!text) continue;
            items.push({
                ref: `fact:${f.id}`,
                sourceType: "learned_fact",
                sourceId: Number(f.id),
                label: `Learned fact (${f.scope === "portfolio" ? "all homes" : "this home"}): ${f.topic}`,
                text: text.slice(0, 700),
            });
        }
        for (const k of kbEntries) {
            const text = String(k.content || "").trim();
            if (!text) continue;
            items.push({
                ref: `kb:${k.id}`,
                sourceType: "kb_entry",
                sourceId: Number(k.id),
                label: `KB entry: ${k.title || k.category || "untitled"}`,
                text: text.slice(0, 900),
            });
        }

        const hash = crypto
            .createHash("sha256")
            .update(items.map((i) => `${i.ref}|${i.text}`).join("\n"))
            .digest("hex");
        const listingName = listing ? (listing as any).internalListingName || listing.name || null : null;
        return { items, hash, listingName };
    }

    // ------------------------------------------------------------------
    // Detection
    // ------------------------------------------------------------------

    private async detectWithLLM(items: KnowledgeItem[], listingName: string | null) {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const numbered = items
            .map((i) => `[${i.ref}] (${i.sourceType}) ${i.label}\n${i.text}`)
            .join("\n\n");
        const completion = await client.chat.completions.create({
            model: CONFLICT_MODEL,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `You audit a short-term-rental property's AI knowledge for FACTUAL CONTRADICTIONS — cases where two sources give a guest DIFFERENT answers to the same question (different times, amounts, codes, counts, yes-vs-no policies).

Return JSON: {"conflicts":[{"a":"<ref>","b":"<ref>","topic":"<2-4 word label like 'check-out time'>","severity":"high"|"medium","explanation":"<one sentence quoting both conflicting values>","suggestedFix":"<which source to change and to what>"}]}

Rules:
- ONLY true contradictions: the same fact with different values. NOT tone differences, NOT one source having extra detail the other lacks, NOT vague-vs-specific.
- 'listing_data' items come from the live listing feed and are the source of truth — when a learned_fact or kb_entry disagrees with listing_data, the fix is to correct the fact/KB entry (or the listing itself if staff know it changed).
- severity "high": wrong times, money amounts, access/wifi credentials, occupancy, or yes/no policies (pets, parties, smoking). severity "medium": everything else.
- A pair must be two DIFFERENT refs. Report each conflicting pair once.
- No contradictions found => {"conflicts":[]}.`,
                },
                {
                    role: "user",
                    content: `Property: ${listingName || "unknown"}\n\nKnowledge items:\n\n${numbered}`,
                },
            ],
        });
        try {
            const parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
            return Array.isArray(parsed.conflicts) ? parsed.conflicts : [];
        } catch {
            return [];
        }
    }

    /** Scan one listing. Returns conflicts found (or null when skipped by hash). */
    async scanListing(listingId: number, opts: { force?: boolean } = {}): Promise<number | null> {
        const { items, hash, listingName } = await this.gatherSources(listingId);
        // Fewer than 2 items can't conflict; also clears the cache row so a
        // future re-add triggers a fresh scan.
        const scan = await this.scanRepo.findOne({ where: { listingId: listingId as any } });
        if (!opts.force && scan && scan.sourceHash === hash) return null;

        let found = 0;
        const activeKeys: string[] = [];
        if (items.length >= 2) {
            const raw = await this.detectWithLLM(items, listingName);
            const byRef = new Map(items.map((i) => [i.ref, i]));
            for (const c of raw) {
                const a = byRef.get(String(c.a));
                const b = byRef.get(String(c.b));
                if (!a || !b || a.ref === b.ref) continue;
                const [first, second] = [a, b].sort((x, y) => x.ref.localeCompare(y.ref));
                const dedupeKey = `conflict:${first.ref}:${second.ref}`.slice(0, 160);
                activeKeys.push(dedupeKey);

                const existing = await this.repo.findOne({ where: { dedupeKey } });
                if (existing) {
                    existing.lastSeenAt = new Date();
                    existing.explanation = String(c.explanation || existing.explanation || "").slice(0, 1000);
                    existing.suggestedFix = String(c.suggestedFix || existing.suggestedFix || "").slice(0, 1000);
                    existing.sourceAText = first.text;
                    existing.sourceBText = second.text;
                    if (existing.status === "resolved") {
                        existing.status = "open";
                        existing.resolvedAt = null;
                    }
                    await this.repo.save(existing); // dismissed stays dismissed
                } else {
                    await this.repo.save(
                        this.repo.create({
                            listingId,
                            listingName,
                            topic: String(c.topic || "").slice(0, 120) || null,
                            severity: c.severity === "high" ? "high" : "medium",
                            status: "open",
                            dedupeKey,
                            sourceAType: first.sourceType,
                            sourceAId: first.sourceId,
                            sourceALabel: first.label.slice(0, 255),
                            sourceAText: first.text,
                            sourceBType: second.sourceType,
                            sourceBId: second.sourceId,
                            sourceBLabel: second.label.slice(0, 255),
                            sourceBText: second.text,
                            explanation: String(c.explanation || "").slice(0, 1000) || null,
                            suggestedFix: String(c.suggestedFix || "").slice(0, 1000) || null,
                            lastSeenAt: new Date(),
                        })
                    );
                }
                found++;
            }
        }

        // Conflicts for this listing no longer detected => the fix landed.
        const qb = this.repo
            .createQueryBuilder()
            .update()
            .set({ status: "resolved", resolvedAt: new Date() })
            .where("listingId = :lid", { lid: listingId })
            .andWhere("status IN ('open','dismissed')");
        if (activeKeys.length) qb.andWhere("dedupeKey NOT IN (:...keys)", { keys: activeKeys });
        await qb.execute();

        if (scan) {
            scan.sourceHash = hash;
            scan.conflictsFound = found;
            scan.scannedAt = new Date();
            await this.scanRepo.save(scan);
        } else {
            await this.scanRepo.save(
                this.scanRepo.create({ listingId, sourceHash: hash, conflictsFound: found, scannedAt: new Date() })
            );
        }
        return found;
    }

    /**
     * Resolve conflicts whose underlying source is gone: a fact that is no
     * longer approved (rejected/edited away) or a KB entry that was archived.
     * Runs before every sweep so "remove the wrong fact" clears the conflict
     * immediately, without waiting for that listing's next LLM re-scan.
     */
    async autoResolveInvalid(): Promise<number> {
        const result: any = await appDatabase.query(
            `UPDATE ai_knowledge_conflicts c
             SET c.status = 'resolved', c.resolvedAt = NOW()
             WHERE c.status IN ('open','dismissed')
               AND (
                 (c.sourceAType = 'learned_fact' AND NOT EXISTS
                   (SELECT 1 FROM ai_learned_facts f WHERE f.id = c.sourceAId AND f.status = 'approved'))
                 OR (c.sourceBType = 'learned_fact' AND NOT EXISTS
                   (SELECT 1 FROM ai_learned_facts f WHERE f.id = c.sourceBId AND f.status = 'approved'))
                 OR (c.sourceAType = 'kb_entry' AND NOT EXISTS
                   (SELECT 1 FROM listing_knowledge_entries k WHERE k.id = c.sourceAId AND k.isArchived = 0))
                 OR (c.sourceBType = 'kb_entry' AND NOT EXISTS
                   (SELECT 1 FROM listing_knowledge_entries k WHERE k.id = c.sourceBId AND k.isArchived = 0))
               )`
        );
        return Number(result?.affectedRows || 0);
    }

    /**
     * Full sweep: every listing that has any facts or KB content. Hash cache
     * makes the steady-state nightly run nearly free — only listings whose
     * knowledge changed since the last scan hit the LLM.
     */
    async sweep(opts: { force?: boolean; maxLLMScans?: number } = {}): Promise<{
        listings: number;
        scanned: number;
        skipped: number;
        conflictsFound: number;
        autoResolved: number;
    }> {
        const autoResolved = await this.autoResolveInvalid();

        const rows: any[] = await appDatabase.query(
            `SELECT DISTINCT listingId FROM (
               SELECT listingId FROM ai_learned_facts
                WHERE status = 'approved' AND factType = 'qa' AND scope = 'property' AND listingId IS NOT NULL
               UNION
               SELECT listingId FROM listing_knowledge_entries WHERE isArchived = 0
             ) t`
        );
        // Channel-split groups share content — scan each group once, via its
        // canonical (lowest) member id.
        const canonical = new Set<number>();
        for (const r of rows) {
            const id = Number(r.listingId);
            if (!id) continue;
            const group = (await this.groups.groupIds(id).catch(() => [id])) || [id];
            canonical.add(Math.min(...group.map(Number)));
        }

        const maxScans = Math.max(1, opts.maxLLMScans ?? 150);
        let scanned = 0;
        let skipped = 0;
        let conflictsFound = 0;
        for (const listingId of canonical) {
            if (scanned >= maxScans) break;
            try {
                const found = await this.scanListing(listingId, { force: opts.force });
                if (found === null) skipped++;
                else {
                    scanned++;
                    conflictsFound += found;
                }
            } catch (err: any) {
                logger.warn(`[ConflictDetector] scan failed for listing ${listingId}: ${err.message}`);
            }
        }

        const out = { listings: canonical.size, scanned, skipped, conflictsFound, autoResolved };
        logger.info(`[ConflictDetector] sweep: ${JSON.stringify(out)}`);
        return out;
    }
}
