import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ListingKnowledgeEntryEntity } from "../entity/ListingKnowledgeEntry";

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

    async list(listingId: number, opts: { includeArchived?: boolean; visibility?: string } = {}) {
        const where: any = { listingId };
        if (!opts.includeArchived) where.isArchived = 0;
        if (opts.visibility) where.visibility = normalizeVisibility(opts.visibility);
        return this.repo.find({ where, order: { updatedAt: "DESC", id: "DESC" } });
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
        opts: { query?: string; maxChars?: number } | number = {}
    ): Promise<string | null> {
        if (!listingId) return null;
        // Back-compat: allow renderForBot(id, maxChars).
        const o = typeof opts === "number" ? { maxChars: opts } : opts;
        const maxChars = o.maxChars ?? 5000;
        const qTokens = tokenize(o.query);

        let entries: ListingKnowledgeEntryEntity[];
        try {
            entries = await this.repo.find({
                where: { listingId: Number(listingId), isArchived: 0 },
            });
        } catch (err: any) {
            logger.error(`[ListingKnowledge] renderForBot failed for listing ${listingId}: ${err.message}`);
            return null;
        }
        if (!entries.length) return null;

        const CORE = /check-?in|check-?out|\bfee\b|fees|wifi|wi-fi|parking|house rule|amenit|address|stay length|\bpet\b|location|overview/i;
        const isDesc = (e: ListingKnowledgeEntryEntity) => /description/i.test(`${e.title || ""} ${e.category || ""}`);
        const score = (e: ListingKnowledgeEntryEntity) => {
            const hay = `${e.title || ""} ${e.category || ""} ${e.content || ""}`.toLowerCase();
            let rel = 0;
            for (const t of qTokens) if (hay.includes(t)) rel += 1;
            const key = `${e.category || ""} ${e.title || ""}`;
            const pri = isDesc(e) ? -2 : CORE.test(key) ? 2 : 1;
            return rel * 10 + pri;
        };
        const rank = (list: ListingKnowledgeEntryEntity[]) =>
            list
                .map((e) => ({ e, s: score(e) }))
                .sort((a, b) => b.s - a.s)
                .map((x) => x.e);
        const fmt = (e: ListingKnowledgeEntryEntity) => {
            const head = e.title ? `${e.category} — ${e.title}` : e.category;
            let body = (e.content || "").replace(/\s+/g, " ").trim();
            const limit = isDesc(e) ? 600 : 700;
            if (body.length > limit) body = body.slice(0, limit) + "…";
            return `- [${head}] ${body}`;
        };

        const external = rank(entries.filter((e) => e.visibility === "external"));
        const internal = rank(entries.filter((e) => e.visibility === "internal"));

        const lines: string[] = [];
        let used = 0;
        const addSection = (header: string, list: ListingKnowledgeEntryEntity[], budget: number) => {
            if (!list.length) return;
            const start = lines.length;
            let sectionUsed = 0;
            for (const e of list) {
                const line = fmt(e);
                if (sectionUsed + line.length > budget) continue; // skip oversized, keep scanning for smaller high-value ones
                lines.push(line);
                sectionUsed += line.length + 1;
                used += line.length + 1;
            }
            if (lines.length > start) lines.splice(start, 0, header);
        };

        addSection("EXTERNAL (guest-shareable facts — you may state these directly):", external, Math.floor(maxChars * 0.72));
        if (lines.length) lines.push("");
        addSection(
            "INTERNAL (staff-only — use to inform your reply but DO NOT quote to the guest):",
            internal,
            Math.max(0, maxChars - used)
        );

        const out = lines.join("\n").trim();
        return out || null;
    }
}

/** Lowercase word tokens (len >= 3) with common stopwords removed. */
function tokenize(text?: string | null): string[] {
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
