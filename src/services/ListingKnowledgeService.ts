import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ListingKnowledgeEntryEntity } from "../entity/ListingKnowledgeEntry";
import { ListingGroupService } from "./ListingGroupService";

export interface KnowledgeInput {
    listingId: number;
    category?: string | null;
    visibility?: string | null;
    title?: string | null;
    content?: string | null;
    photos?: any[] | null;
    source?: string | null;
    userId?: number | null;
    userName?: string | null;
}

const normalizeVisibility = (v?: string | null): "internal" | "external" =>
    String(v || "").toLowerCase() === "internal" ? "internal" : "external";

/**
 * CRUD for the per-listing Knowledge Base plus a bot-facing reader that
 * InboxAIService uses to ground suggestions in real property facts.
 */
export class ListingKnowledgeService {
    private repo = appDatabase.getRepository(ListingKnowledgeEntryEntity);

    async list(
        listingId: number,
        opts: { includeArchived?: boolean; visibility?: string; includeGroup?: boolean } = {}
    ) {
        let listingIds = [Number(listingId)];
        if (opts.includeGroup) {
            try {
                listingIds = await new ListingGroupService().groupIds(listingId);
            } catch (err: any) {
                logger.warn(`[ListingKnowledge] group expand failed for ${listingId}: ${err.message}`);
            }
        }
        const where: any = {
            listingId: listingIds.length === 1 ? (listingIds[0] as any) : In(listingIds),
        };
        if (!opts.includeArchived) where.isArchived = 0;
        if (opts.visibility) where.visibility = normalizeVisibility(opts.visibility);
        const rows = await this.repo.find({ where, order: { updatedAt: "DESC", id: "DESC" } });
        // Dedup identical content mirrored across channel-split siblings.
        const seen = new Set<string>();
        return rows.filter((e) => {
            const key = `${e.visibility}|${(e.title || "").toLowerCase()}|${(e.content || "").slice(0, 120).toLowerCase()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    async create(input: KnowledgeInput) {
        const entry = this.repo.create({
            listingId: input.listingId,
            category: (input.category || "General").slice(0, 120),
            visibility: normalizeVisibility(input.visibility),
            title: input.title ? String(input.title).slice(0, 255) : null,
            content: input.content ?? null,
            photos: input.photos && input.photos.length ? JSON.stringify(input.photos) : null,
            source: input.source === "ai_suggested" ? "ai_suggested" : "manual",
            createdByUserId: input.userId ?? null,
            createdByName: input.userName ?? null,
            updatedByUserId: input.userId ?? null,
            updatedByName: input.userName ?? null,
            isArchived: 0,
        });
        const saved = await this.repo.save(entry);
        logger.info(`[ListingKnowledge] entry ${saved.id} created for listing ${input.listingId} (${saved.visibility})`);
        return saved;
    }

    async update(id: number, input: Partial<KnowledgeInput>) {
        const entry = await this.repo.findOne({ where: { id } });
        if (!entry) throw new Error(`Knowledge entry ${id} not found`);
        if (input.category != null) entry.category = String(input.category).slice(0, 120);
        if (input.visibility != null) entry.visibility = normalizeVisibility(input.visibility);
        if (input.title !== undefined) entry.title = input.title ? String(input.title).slice(0, 255) : null;
        if (input.content !== undefined) entry.content = input.content ?? null;
        if (input.photos !== undefined) entry.photos = input.photos && input.photos.length ? JSON.stringify(input.photos) : null;
        if (input.userId != null) entry.updatedByUserId = input.userId;
        if (input.userName != null) entry.updatedByName = input.userName;
        return this.repo.save(entry);
    }

    /** Soft-delete (archive) so nothing is ever hard-lost. */
    async remove(id: number, opts: { userId?: number | null; userName?: string | null } = {}) {
        const entry = await this.repo.findOne({ where: { id } });
        if (!entry) throw new Error(`Knowledge entry ${id} not found`);
        entry.isArchived = 1;
        if (opts.userId != null) entry.updatedByUserId = opts.userId;
        if (opts.userName != null) entry.updatedByName = opts.userName;
        return this.repo.save(entry);
    }

    /**
     * Compact, model-friendly rendering of a listing's knowledge for the bot.
     *
     * Query-aware + priority-ranked so the facts most relevant to the guest's
     * actual question always survive the size budget. Previously this dumped every
     * entry ordered by category and hard-truncated at a char cap — which meant a
     * long listing description could push out high-value structured facts like the
     * cleaning fee or amenities. Now:
     *  - each entry is capped individually (long free-text like the description is
     *    trimmed rather than allowed to eat the whole budget),
     *  - entries are scored by (a) overlap with the guest's question and (b) a
     *    priority for high-value structured topics (fees, check-in, amenities,
     *    wifi, parking, house rules), and assembled highest-value-first.
     *
     * Returns null when there is nothing useful, so callers can skip the block.
     */
    async renderForBot(
        listingId: number | null | undefined,
        opts:
            | {
                  query?: string;
                  maxChars?: number;
                  listingIds?: number[];
                  /** Open Conflicts-page KB entry ids — never inject into guest replies. */
                  excludeKbIds?: Set<number> | number[];
              }
            | number = {}
    ): Promise<string | null> {
        if (!listingId) return null;
        // Back-compat: allow renderForBot(id, maxChars).
        const o = typeof opts === "number" ? { maxChars: opts } : opts;
        const maxChars = o.maxChars ?? 5000;
        const qTokens = tokenize(o.query);
        const excluded =
            o.excludeKbIds instanceof Set ? o.excludeKbIds : new Set((o.excludeKbIds || []).map(Number));
        // Search across the whole property group (channel-split siblings) when
        // provided, so a conversation on a child listing still finds the KB.
        const ids = (o.listingIds && o.listingIds.length ? o.listingIds : [Number(listingId)]).map(Number);

        let entries: ListingKnowledgeEntryEntity[];
        try {
            entries = await this.repo.find({
                where: { listingId: ids.length === 1 ? (ids[0] as any) : In(ids), isArchived: 0 },
            });
        } catch (err: any) {
            logger.error(`[ListingKnowledge] renderForBot failed for listing ${listingId}: ${err.message}`);
            return null;
        }
        if (excluded.size) entries = entries.filter((e) => !excluded.has(Number(e.id)));
        if (!entries.length) return null;

        // Dedup identical entries shared across sibling listings in the group.
        const seenKey = new Set<string>();
        entries = entries.filter((e) => {
            const key = `${e.visibility}|${(e.title || "").toLowerCase()}|${(e.content || "").slice(0, 80).toLowerCase()}`;
            if (seenKey.has(key)) return false;
            seenKey.add(key);
            return true;
        });

        const CORE = /check-?in|check-?out|\bfee\b|fees|wifi|wi-fi|parking|house rule|amenit|address|stay length|\bpet\b|location|overview/i;
        const isDesc = (e: ListingKnowledgeEntryEntity) => /description/i.test(`${e.title || ""} ${e.category || ""}`);
        const score = (e: ListingKnowledgeEntryEntity) => {
            const hay = `${e.title || ""} ${e.category || ""} ${e.content || ""}`.toLowerCase();
            let rel = 0;
            for (const t of qTokens) if (hay.includes(t)) rel += 1;
            const key = `${e.category || ""} ${e.title || ""}`;
            // Description is neutral priority (0): it must not crowd out structured
            // facts when irrelevant, but a relevant snippet from it can still surface.
            const pri = isDesc(e) ? 0 : CORE.test(key) ? 2 : 1;
            return rel * 10 + pri;
        };
        const rank = (list: ListingKnowledgeEntryEntity[]) =>
            list
                .map((e) => ({ e, s: score(e) }))
                .sort((a, b) => b.s - a.s)
                .map((x) => x.e);
        const fmt = (e: ListingKnowledgeEntryEntity) => {
            const head = e.title ? `${e.category} — ${e.title}` : e.category;
            const raw = (e.content || "").trim();
            const limit = isDesc(e) ? 700 : 700;
            let body: string;
            if (raw.replace(/\s+/g, " ").length <= limit) {
                body = raw.replace(/\s+/g, " ").trim();
            } else {
                // Long free-text (e.g. the listing description): pull the sentences
                // most relevant to the guest's question rather than a blind head
                // slice, so answers buried deep in the text (parking, early check-in,
                // A/C, laundry) still surface.
                body = extractRelevantSnippet(raw, qTokens, limit);
            }
            // Platform amenity checklists are marketing lists, not confirmed inventory.
            if (/^amenities$/i.test(String(e.title || "").trim()) || /^amenities$/i.test(String(e.category || "").trim())) {
                body =
                    `[Platform amenity checklist — listed on the booking site, NOT confirmed on-site inventory; ` +
                    `do NOT invent where items are stored] ${body}`;
            }
            return `- [${head}] ${body}`;
        };

        // Guest-reply context: EXTERNAL only. Internal entries stay available
        // in the All Listings KB UI for staff but must never reach the model
        // that drafts guest messages (even "to inform" is a leak hazard).
        const external = rank(entries.filter((e) => e.visibility === "external"));

        const lines: string[] = [];
        const addSection = (header: string, list: ListingKnowledgeEntryEntity[], budget: number) => {
            if (!list.length) return;
            const start = lines.length;
            let sectionUsed = 0;
            for (const e of list) {
                const line = fmt(e);
                if (sectionUsed + line.length > budget) continue; // skip oversized, keep scanning for smaller high-value ones
                lines.push(line);
                sectionUsed += line.length + 1;
            }
            if (lines.length > start) lines.splice(start, 0, header);
        };

        addSection("EXTERNAL (guest-shareable facts — you may state these directly):", external, maxChars);

        const out = lines.join("\n").trim();
        return out || null;
    }
}

/**
 * From a long block of free text, return the fragments most relevant to the
 * query tokens (falling back to the head of the text when there's no query or no
 * overlap), joined and capped to `limit` chars.
 */
export function extractRelevantSnippet(text: string, qTokens: string[], limit: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    // Split on sentence / bullet boundaries used in listing descriptions.
    const parts = text
        .split(/[\n\r]+|(?<=[.!?])\s+|[▪✔⭐✨•]+/u)
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter((s) => s.length > 3);
    if (!qTokens.length || parts.length === 0) {
        return flat.slice(0, limit) + (flat.length > limit ? "…" : "");
    }
    const scored = parts
        .map((s) => {
            const low = s.toLowerCase();
            let hit = 0;
            for (const t of qTokens) if (low.includes(t)) hit += 1;
            return { s, hit };
        })
        .filter((x) => x.hit > 0)
        .sort((a, b) => b.hit - a.hit);

    if (!scored.length) {
        // No overlap: give the model the head of the text as general grounding.
        return flat.slice(0, limit) + (flat.length > limit ? "…" : "");
    }
    const out: string[] = [];
    let used = 0;
    for (const { s } of scored) {
        if (used + s.length + 2 > limit) continue;
        out.push(s);
        used += s.length + 2;
    }
    return out.join(" · ") || flat.slice(0, limit) + "…";
}

/**
 * Lowercase word tokens with common stopwords removed.
 * Keep short amenity tokens (tv, ac, bbq) — len>=3 alone dropped "tv" and
 * missed bedroom-TV facts in listing descriptions.
 */
export function tokenize(text?: string | null): string[] {
    const stop = new Set([
        "the", "and", "for", "are", "you", "your", "can", "with", "have", "has", "how", "what", "where", "when",
        "does", "did", "is", "it", "a", "an", "to", "of", "in", "on", "at", "we", "our", "my", "i", "do", "there",
        "any", "get", "this", "that", "whats", "im", "me", "please", "would", "could", "about",
    ]);
    const shortKeep = new Set(["tv", "tvs", "ac", "bbq", "wifi", "hot", "tub"]);
    return Array.from(
        new Set(
            String(text || "")
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ")
                .split(/\s+/)
                .filter((w) => (w.length >= 3 || shortKeep.has(w)) && !stop.has(w))
        )
    );
}
