import { NextFunction, Request, Response } from "express";
import { PropertyFactsService } from "../services/PropertyFactsService";

interface CustomRequest extends Request {
    user?: any;
}

const toNum = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const userId = (user: any): number | null => toNum(user?.secureStayUserId ?? user?.id);

/**
 * Verified Property Facts — preset per-property fields (top of the AI
 * knowledge hierarchy) plus the correction-proposal review queue.
 */
export class PropertyFactsController {
    /** Catalog + current values + pending proposals for one listing. */
    async get(request: Request, response: Response, next: NextFunction) {
        try {
            const listingId = toNum(request.query.listingId);
            if (listingId == null) {
                return response.status(400).json({ status: false, message: "listingId is required" });
            }
            const service = new PropertyFactsService();
            const data = await service.getForListing(listingId);
            const proposals = await service.listProposals({ listingId, status: "pending" });
            return response.status(200).json({ status: true, data: { ...data, proposals } });
        } catch (error) {
            return next(error);
        }
    }

    /** Save a field value. Staff edits are verified immediately. */
    async upsert(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const listingId = toNum(request.params.listingId);
            const fieldKey = String(request.params.fieldKey || "");
            if (listingId == null || !fieldKey) {
                return response.status(400).json({ status: false, message: "listingId and fieldKey are required" });
            }
            const b = request.body || {};
            const service = new PropertyFactsService();
            const data = await service.upsert({
                listingId,
                fieldKey,
                value: b.value != null ? String(b.value) : null,
                source: "manual",
                verified: b.verify !== false,
                userId: userId(request.user),
            });
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** Verify an existing (e.g. prefilled) value without editing it. */
    async verify(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = toNum(request.params.id);
            if (id == null) return response.status(400).json({ status: false, message: "id is required" });
            const service = new PropertyFactsService();
            const data = await service.verify(id, userId(request.user));
            if (!data) return response.status(404).json({ status: false, message: "Fact not found" });
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /**
     * Push verified facts to Hostify listing settings.
     * Body { dryRun: true } returns the mapped payload without calling Hostify.
     */
    async pushHostify(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const listingId = toNum(request.params.listingId);
            if (listingId == null) {
                return response.status(400).json({ status: false, message: "listingId is required" });
            }
            const service = new PropertyFactsService();
            const data = await service.pushToHostify(listingId, {
                dryRun: request.body?.dryRun === true,
            });
            return response.status(200).json({ status: true, data });
        } catch (error: any) {
            return response.status(502).json({
                status: false,
                message: error?.message || "Hostify push failed",
            });
        }
    }

    /** Pending proposals, optionally portfolio-wide (no listingId). */
    async listProposals(request: Request, response: Response, next: NextFunction) {
        try {
            const service = new PropertyFactsService();
            const data = await service.listProposals({
                listingId: toNum(request.query.listingId),
                status: (request.query.status as string) || "pending",
            });
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** Accept (optionally with edited value) or reject a proposal. */
    async reviewProposal(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = toNum(request.params.id);
            const action = String(request.body?.action || "");
            if (id == null || (action !== "accept" && action !== "reject")) {
                return response.status(400).json({ status: false, message: "id and action (accept|reject) are required" });
            }
            const service = new PropertyFactsService();
            const data = await service.reviewProposal(id, action, {
                userId: userId(request.user),
                value: request.body?.value != null ? String(request.body.value) : null,
            });
            if (!data) return response.status(404).json({ status: false, message: "Proposal not found" });
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }
}
