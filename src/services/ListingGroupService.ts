import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ListingGroupMapEntity } from "../entity/ListingGroupMap";
import { Listing } from "../entity/Listing";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { Hostify } from "../client/Hostify";

/**
 * Resolves Hostify's channel-split listing IDs to a single canonical property
 * "group" so knowledge can be shared across every sibling listing of the same
 * real property. See ListingGroupMapEntity for the why.
 *
 * In-process cache keeps the hot path (bot retrieval) free of extra DB round
 * trips; rebuildFromHostify() (re)populates the persistent map.
 */
export class ListingGroupService {
    private repo = appDatabase.getRepository(ListingGroupMapEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private convRepo = appDatabase.getRepository(InboxConversationEntity);
    private hostify = new Hostify();

    // groupId -> member listingIds, and listingId -> groupId. Lazy-loaded.
    private static groupCache: Map<number, number[]> | null = null;
    private static memberCache: Map<number, number> | null = null;

    private get apiKey(): string {
        return process.env.HOSTIFY_API_KEY as string;
    }

    private async ensureCache() {
        if (ListingGroupService.groupCache && ListingGroupService.memberCache) return;
        const rows = await this.repo.find();
        const byGroup = new Map<number, number[]>();
        const byMember = new Map<number, number>();
        for (const r of rows) {
            const gid = Number(r.groupId);
            const lid = Number(r.listingId);
            byMember.set(lid, gid);
            if (!byGroup.has(gid)) byGroup.set(gid, []);
            byGroup.get(gid)!.push(lid);
        }
        ListingGroupService.groupCache = byGroup;
        ListingGroupService.memberCache = byMember;
    }

    static invalidateCache() {
        ListingGroupService.groupCache = null;
        ListingGroupService.memberCache = null;
    }

    /** Canonical group ID for a listing (its parent, or itself). */
    async resolve(listingId: number | null | undefined): Promise<number | null> {
        if (!listingId) return null;
        await this.ensureCache();
        return ListingGroupService.memberCache!.get(Number(listingId)) ?? Number(listingId);
    }

    /**
     * All listing IDs belonging to the same property group as `listingId`
     * (siblings + parent), always including the input ID itself. Falls back to
     * just [listingId] when we have no mapping yet.
     */
    async groupIds(listingId: number | null | undefined): Promise<number[]> {
        if (!listingId) return [];
        await this.ensureCache();
        const id = Number(listingId);
        const gid = ListingGroupService.memberCache!.get(id) ?? id;
        const members = ListingGroupService.groupCache!.get(gid) ?? [];
        const set = new Set<number>([id, gid, ...members]);
        return Array.from(set);
    }

    private async upsert(listingId: number, groupId: number, name: string | null) {
        const existing = await this.repo.findOne({ where: { listingId: listingId as any } });
        if (existing) {
            if (existing.groupId === (groupId as any) && (name == null || existing.name === name)) return;
            existing.groupId = groupId;
            if (name) existing.name = name.slice(0, 255);
            await this.repo.save(existing);
            return;
        }
        await this.repo.save(this.repo.create({ listingId, groupId, name: name ? name.slice(0, 255) : null }));
    }

    /**
     * (Re)build the map from Hostify. For every distinct listing ID we know about
     * (listing_info + inbox conversations), look up its parent_listing_id and
     * record groupId = parent (or self). Idempotent; safe to re-run.
     */
    async rebuildFromHostify(opts: { onlyMissing?: boolean } = {}): Promise<{ processed: number; groups: number }> {
        const infoIds = (await this.listingRepo.find({ select: ["id"], withDeleted: true })).map((l) => Number(l.id));
        const convIds = (
            await this.convRepo
                .createQueryBuilder("c")
                .select("DISTINCT c.listingId", "listingId")
                .where("c.listingId IS NOT NULL")
                .getRawMany()
        ).map((r) => Number(r.listingId));
        const allIds = Array.from(new Set([...infoIds, ...convIds])).filter((n) => Number.isFinite(n) && n > 0);

        let existing = new Set<number>();
        if (opts.onlyMissing) {
            existing = new Set((await this.repo.find({ select: ["listingId"] })).map((r) => Number(r.listingId)));
        }

        let processed = 0;
        for (const id of allIds) {
            if (opts.onlyMissing && existing.has(id)) continue;
            try {
                const details: any = await this.hostify.getListingDetails(this.apiKey, String(id));
                const li = details?.listing;
                const parent = Number(li?.parent_listing_id);
                const groupId = Number.isFinite(parent) && parent > 0 ? parent : id;
                await this.upsert(id, groupId, li?.name ?? null);
                // Make sure the parent maps to itself too, so siblings resolve.
                if (groupId !== id && !allIds.includes(groupId)) {
                    await this.upsert(groupId, groupId, li?.name ?? null);
                }
                processed++;
            } catch (err: any) {
                logger.warn(`[ListingGroup] resolve failed for ${id}: ${err.message}`);
                // Fall back to self-group so the listing is at least mapped.
                await this.upsert(id, id, null).catch(() => {});
            }
        }
        ListingGroupService.invalidateCache();
        const groups = (await this.repo.createQueryBuilder("m").select("COUNT(DISTINCT m.groupId)", "n").getRawOne())?.n;
        logger.info(`[ListingGroup] rebuild complete: processed ${processed} listings into ${groups} groups`);
        return { processed, groups: Number(groups) || 0 };
    }
}
