import { Request, Response } from "express";
import { LLBuddyService } from "../services/LLBuddyService";
import logger from "../utils/logger.utils";

interface RequestWithUser extends Request {
    user?: {
        id?: string;
        email?: string;
    };
}

export class LLBuddyController {
    private readonly service = new LLBuddyService();

    private getUserId(req: RequestWithUser) {
        return req.user?.id || req.user?.email || "system";
    }

    overview = async (_req: Request, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.getOverview() });
        } catch (error: any) {
            logger.error("[LLBuddyController] overview error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load LL Buddy overview" });
        }
    };

    suggestions = async (_req: Request, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.getSuggestions() });
        } catch (error: any) {
            logger.error("[LLBuddyController] suggestions error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load suggestions" });
        }
    };

    conversations = async (req: Request, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.getConversations(req.query || {}) });
        } catch (error: any) {
            logger.error("[LLBuddyController] conversations error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load LL Buddy conversations" });
        }
    };

    conversationDetail = async (req: Request, res: Response) => {
        try {
            const data = await this.service.getConversationDetail(req.params.id);
            if (!data) {
                res.status(404).json({ success: false, error: "Conversation not found" });
                return;
            }
            res.json({ success: true, data });
        } catch (error: any) {
            logger.error("[LLBuddyController] conversationDetail error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load LL Buddy conversation" });
        }
    };

    sendReply = async (req: RequestWithUser, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.sendReply(req.params.id, req.body?.body || req.body?.message || "", this.getUserId(req)) });
        } catch (error: any) {
            logger.error("[LLBuddyController] sendReply error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to send LL Buddy reply" });
        }
    };

    actionItems = async (_req: Request, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.getGeneratedItems("action_item") });
        } catch (error: any) {
            logger.error("[LLBuddyController] actionItems error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load action items" });
        }
    };

    guestIssues = async (_req: Request, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.getGeneratedItems("guest_issue") });
        } catch (error: any) {
            logger.error("[LLBuddyController] guestIssues error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load guest issues" });
        }
    };

    feedback = async (_req: Request, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.getFeedback() });
        } catch (error: any) {
            logger.error("[LLBuddyController] feedback error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load feedback" });
        }
    };

    learning = async (_req: Request, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.getLearningCandidates() });
        } catch (error: any) {
            logger.error("[LLBuddyController] learning error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load learning candidates" });
        }
    };

    auditLogs = async (_req: Request, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.getAuditLogs() });
        } catch (error: any) {
            logger.error("[LLBuddyController] auditLogs error:", error.message);
            res.status(500).json({ success: false, error: "Failed to load audit logs" });
        }
    };

    analyzeRecent = async (req: RequestWithUser, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.analyzeRecent(Number(req.body?.limit || 25), this.getUserId(req)) });
        } catch (error: any) {
            logger.error("[LLBuddyController] analyzeRecent error:", error.message);
            res.status(500).json({ success: false, error: "Failed to analyze recent communications" });
        }
    };

    syncRecent = async (req: RequestWithUser, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.syncRecentCommunications(Number(req.body?.limit || 75), this.getUserId(req)) });
        } catch (error: any) {
            logger.error("[LLBuddyController] syncRecent error:", error.message);
            res.status(500).json({ success: false, error: "Failed to sync recent communications" });
        }
    };

    processLearning = async (req: RequestWithUser, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.processNightlyLearning(this.getUserId(req)) });
        } catch (error: any) {
            logger.error("[LLBuddyController] processLearning error:", error.message);
            res.status(500).json({ success: false, error: "Failed to prepare LL Buddy learning review" });
        }
    };

    recordFeedback = async (req: RequestWithUser, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.recordFeedback(req.params.suggestionId, req.body || {}, this.getUserId(req)) });
        } catch (error: any) {
            logger.error("[LLBuddyController] recordFeedback error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to record feedback" });
        }
    };

    reviewLearning = async (req: RequestWithUser, res: Response) => {
        try {
            res.json({ success: true, data: await this.service.reviewLearningCandidate(req.params.id, req.body || {}, this.getUserId(req)) });
        } catch (error: any) {
            logger.error("[LLBuddyController] reviewLearning error:", error.message);
            res.status(400).json({ success: false, error: error.message || "Failed to review learning candidate" });
        }
    };
}
