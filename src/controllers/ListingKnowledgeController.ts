import { NextFunction, Request, Response } from "express";
import { ListingKnowledgeService } from "../services/ListingKnowledgeService";
import { AILearnedFactsService } from "../services/AILearnedFactsService";

interface CustomRequest extends Request {
    user?: any;
}

const toNum = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const userName = (user: any): string | null =>
    user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || null;

const userId = (user: any): number | null => toNum(user?.secureStayUserId ?? user?.id);

/**
 * CRUD for the per-listing Knowledge Base (backing the All Listings "Knowledge
 * Base" tab). Entries are visible to the whole team and readable by the inbox
 * AI assistant. visibility = 'external' (guest-shareable) | 'internal' (staff).
 */
export class ListingKnowledgeController {
    async list(request: Request, response: Response, next: NextFunction) {
        try {
            const listingId = toNum(request.query.listingId);
            if (listingId == null) {
                return response.status(400).json({ status: false, message: "listingId is required" });
            }
            const service = new ListingKnowledgeService();
            const data = await service.list(listingId, {
                includeArchived: request.query.includeArchived === "true",
                visibility: (request.query.visibility as string) || undefined,
            });
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async create(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const b = request.body || {};
            const listingId = toNum(b.listingId);
            if (listingId == null) {
                return response.status(400).json({ status: false, message: "listingId is required" });
            }
            const service = new ListingKnowledgeService();
            const data = await service.create({
                listingId,
                category: b.category,
                visibility: b.visibility,
                title: b.title,
                content: b.content,
                photos: Array.isArray(b.photos) ? b.photos : null,
                source: b.source,
                userId: userId(request.user),
                userName: userName(request.user),
            });
            return response.status(201).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async update(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = toNum(request.params.id);
            if (id == null) return response.status(400).json({ status: false, message: "Invalid id" });
            const b = request.body || {};
            const service = new ListingKnowledgeService();
            const data = await service.update(id, {
                category: b.category,
                visibility: b.visibility,
                title: b.title,
                content: b.content,
                photos: b.photos === undefined ? undefined : Array.isArray(b.photos) ? b.photos : null,
                userId: userId(request.user),
                userName: userName(request.user),
            });
            // Any KB edit must propagate to a synced learned fact so the two
            // views never drift. Best-effort; sync failures are logged, not
            // fatal to the KB write.
            try {
                await new AILearnedFactsService().syncFromKnowledgeEntry(data);
            } catch {
                /* logged upstream */
            }
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async remove(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = toNum(request.params.id);
            if (id == null) return response.status(400).json({ status: false, message: "Invalid id" });
            const service = new ListingKnowledgeService();
            const data = await service.remove(id, { userId: userId(request.user), userName: userName(request.user) });
            try {
                await new AILearnedFactsService().syncFromKnowledgeEntry(data);
            } catch {
                /* best-effort */
            }
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }
}
