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
     * Returns null when there is nothing useful, so callers can skip the block.
     */
    async renderForBot(listingId: number | null | undefined, maxChars = 4000): Promise<string | null> {
        if (!listingId) return null;
        let entries: ListingKnowledgeEntryEntity[];
        try {
            entries = await this.repo.find({
                where: { listingId: Number(listingId), isArchived: 0 },
                order: { visibility: "ASC", category: "ASC", id: "ASC" },
            });
        } catch (err: any) {
            logger.error(`[ListingKnowledge] renderForBot failed for listing ${listingId}: ${err.message}`);
            return null;
        }
        if (!entries.length) return null;

        const external = entries.filter((e) => e.visibility === "external");
        const internal = entries.filter((e) => e.visibility === "internal");
        const lines: string[] = [];

        const fmt = (e: ListingKnowledgeEntryEntity) => {
            const head = e.title ? `${e.category} — ${e.title}` : e.category;
            const body = (e.content || "").replace(/\s+/g, " ").trim();
            return `- [${head}] ${body}`;
        };

        if (external.length) {
            lines.push("EXTERNAL (guest-shareable facts — you may state these directly):");
            for (const e of external) lines.push(fmt(e));
        }
        if (internal.length) {
            lines.push("");
            lines.push("INTERNAL (staff-only — use to inform your reply but DO NOT quote to the guest):");
            for (const e of internal) lines.push(fmt(e));
        }

        let out = lines.join("\n");
        if (out.length > maxChars) out = out.slice(0, maxChars) + " …[truncated]";
        return out;
    }
}
