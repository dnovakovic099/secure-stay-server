import { Request, Response } from "express";
import { ActionItemsBetaService } from "../services/ActionItemsBetaService";
import logger from "../utils/logger.utils";

interface RequestWithUser extends Request {
    user?: {
        id?: string;
        email?: string;
    };
}

export class ActionItemsBetaController {
    private readonly service = new ActionItemsBetaService();

    private getUserId(req: RequestWithUser) {
        return req.user?.id || req.user?.email || "system";
    }

    getOverview = async (req: Request, res: Response) => {
        try {
            const filters = this.parseFilters(req);
            const data = await this.service.getOverview(filters);
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] getOverview error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load Action Items Beta overview" });
        }
    };

    getItems = async (req: Request, res: Response) => {
        try {
            const filters = this.parseFilters(req);
            const data = await this.service.getItems(filters);
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] getItems error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load action items" });
        }
    };

    getItemById = async (req: Request, res: Response) => {
        try {
            const data = await this.service.getItemById(req.params.id);
            if (!data) {
                res.status(404).json({ success: false, error: "Action item not found" });
                return;
            }
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] getItemById error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load action item details" });
        }
    };

    updateItem = async (req: RequestWithUser, res: Response) => {
        try {
            const data = await this.service.updateItem(req.params.id, req.body || {}, this.getUserId(req));
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] updateItem error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to update action item" });
        }
    };

    approveItem = async (req: RequestWithUser, res: Response) => {
        try {
            const data = await this.service.approveItem(req.params.id, req.body || {}, this.getUserId(req));
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] approveItem error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to approve action item" });
        }
    };

    rejectItem = async (req: RequestWithUser, res: Response) => {
        try {
            const data = await this.service.rejectItem(req.params.id, req.body?.reason || null, this.getUserId(req));
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] rejectItem error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to reject action item" });
        }
    };

    analyzeReservation = async (req: RequestWithUser, res: Response) => {
        try {
            const reservationId = Number(req.params.reservationId);
            if (!reservationId) {
                res.status(400).json({ success: false, error: "Invalid reservation ID" });
                return;
            }

            const data = await this.service.analyzeReservation(reservationId, {
                inboxId: req.body?.inboxId,
                triggeredBy: this.getUserId(req),
            });
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] analyzeReservation error:", error.message);
            res.status(500).json({ success: false, error: error.message || "Failed to analyze reservation" });
        }
    };

    backfillItems = async (req: RequestWithUser, res: Response) => {
        try {
            const fromDate = typeof req.body?.fromDate === "string" ? req.body.fromDate : "2026-01-01";
            const data = await this.service.backfillHistoricalItems({
                fromDate,
                triggeredBy: this.getUserId(req),
            });
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] backfillItems error:", error.message);
            res.status(500).json({ success: false, error: error.message || "Failed to run historical backfill" });
        }
    };

    replyToItem = async (req: RequestWithUser, res: Response) => {
        try {
            if (!req.body?.content || !String(req.body.content).trim()) {
                res.status(400).json({ success: false, error: "Message content is required" });
                return;
            }
            const data = await this.service.replyToItem(req.params.id, String(req.body.content), this.getUserId(req));
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] replyToItem error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to send action item reply" });
        }
    };

    testDetection = async (req: Request, res: Response) => {
        try {
            if (!req.body?.message) {
                res.status(400).json({ success: false, error: "Message is required" });
                return;
            }
            const data = await this.service.testDetection(req.body);
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] testDetection error:", error.message);
            res.status(500).json({ success: false, error: error.message || "Failed to test detection" });
        }
    };

    getCategories = async (_req: Request, res: Response) => {
        try {
            const data = await this.service.getCategories();
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] getCategories error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load categories" });
        }
    };

    createCategory = async (req: RequestWithUser, res: Response) => {
        try {
            const data = await this.service.createCategory(req.body, this.getUserId(req));
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] createCategory error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to create category" });
        }
    };

    updateCategory = async (req: RequestWithUser, res: Response) => {
        try {
            const data = await this.service.updateCategory(req.params.id, req.body, this.getUserId(req));
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] updateCategory error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to update category" });
        }
    };

    deleteCategory = async (req: RequestWithUser, res: Response) => {
        try {
            const data = await this.service.deleteCategory(req.params.id, req.body?.replacementCategoryId, this.getUserId(req));
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] deleteCategory error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to delete category", details: error.details || null });
        }
    };

    getRules = async (_req: Request, res: Response) => {
        try {
            const data = await this.service.getRules();
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] getRules error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load rules" });
        }
    };

    createRule = async (req: RequestWithUser, res: Response) => {
        try {
            const data = await this.service.createRule(req.body, this.getUserId(req));
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] createRule error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to create rule" });
        }
    };

    updateRule = async (req: RequestWithUser, res: Response) => {
        try {
            const data = await this.service.updateRule(req.params.id, req.body, this.getUserId(req));
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] updateRule error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to update rule" });
        }
    };

    deleteRule = async (req: Request, res: Response) => {
        try {
            const data = await this.service.deleteRule(req.params.id);
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] deleteRule error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to delete rule" });
        }
    };

    getSettings = async (_req: Request, res: Response) => {
        try {
            const data = await this.service.getSettings();
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] getSettings error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load settings" });
        }
    };

    updateSettings = async (req: RequestWithUser, res: Response) => {
        try {
            const data = await this.service.updateSettings(req.body || {}, this.getUserId(req));
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[ActionItemsBetaController] updateSettings error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to update settings" });
        }
    };

    private parseFilters(req: Request) {
        const parseList = (value: unknown) => {
            if (!value) return [];
            return String(value)
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean);
        };

        return {
            status: parseList(req.query.status),
            category: parseList(req.query.category),
            property: parseList(req.query.property),
            source: parseList(req.query.source),
            assignedTo: parseList(req.query.assignedTo),
            priority: parseList(req.query.priority),
            search: typeof req.query.search === "string" ? req.query.search : "",
        };
    }
}
