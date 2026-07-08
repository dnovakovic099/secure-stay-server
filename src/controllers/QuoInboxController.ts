import { NextFunction, Request, Response } from "express";
import { QuoInboxService } from "../services/QuoInboxService";
import { QuoItemDetectionService } from "../services/QuoItemDetectionService";
import { InboxAIService } from "../services/InboxAIService";
import logger from "../utils/logger.utils";

export class QuoInboxController {
    private service = new QuoInboxService();

    listLines = async (req: Request, res: Response, next: NextFunction) => {
        try {
            // Refresh from Quo only when asked (initial page load / lines modal);
            // the badge polling every ~25s reads straight from our DB.
            if (req.query.refresh === "true") {
                try {
                    await this.service.syncPhoneLines();
                } catch (err: any) {
                    logger.warn(`[QuoInbox] Line refresh failed: ${err?.message}`);
                }
            }
            const lines = await this.service.listLines();
            res.status(200).json({ status: true, data: lines });
        } catch (error) {
            next(error);
        }
    };

    updateLine = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const line = await this.service.updateLine(Number(req.params.id), {
                enabled: req.body?.enabled,
                category: req.body?.category,
                name: req.body?.name,
            });
            if (!line) return res.status(404).json({ status: false, message: "Line not found" });
            res.status(200).json({ status: true, data: line });
        } catch (error) {
            next(error);
        }
    };

    listConversations = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const q = req.query;
            const result = await this.service.listConversations({
                page: q.page ? Number(q.page) : 1,
                perPage: q.perPage ? Number(q.perPage) : 30,
                phoneNumberId: (q.phoneNumberId as string) || null,
                category: (q.category as string) || null,
                keyword: (q.keyword as string) || null,
                unreadOnly: q.unreadOnly === "true",
                linked: (q.linked as "linked" | "unlinked") || null,
            });
            res.status(200).json({ status: true, data: result });
        } catch (error) {
            next(error);
        }
    };

    getConversation = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await this.service.getConversation(String(req.params.conversationId));
            if (!result) return res.status(404).json({ status: false, message: "Conversation not found" });
            res.status(200).json({ status: true, data: result });
        } catch (error) {
            next(error);
        }
    };

    reply = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const body = String(req.body?.body || "").trim();
            if (!body) return res.status(400).json({ status: false, message: "Message body is required" });
            const user: any = (req as any).user;
            const senderName = user?.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : null;
            const message = await this.service.sendReply(String(req.params.conversationId), body, senderName);
            res.status(200).json({ status: true, data: message });
        } catch (error) {
            next(error);
        }
    };

    /** AI reply suggestion for a Quo SMS thread (persisted; nothing is sent). */
    suggest = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!InboxAIService.isEnabled()) {
                return res.status(200).json({ status: false, message: "AI messaging is disabled" });
            }
            const conversationId = String(req.params.conversationId);
            const force = req.body?.force === true;
            const result = await new InboxAIService().quoSuggestReply(conversationId, { force });
            if (!result) return res.status(400).json({ status: false, message: "No inbound message to reply to" });
            const { suggestion, ...payload } = result;
            res.status(200).json({ status: true, data: { ...payload, suggestionId: suggestion.id } });
        } catch (error) {
            next(error);
        }
    };

    markRead = async (req: Request, res: Response, next: NextFunction) => {
        try {
            await this.service.markRead(String(req.params.conversationId));
            res.status(200).json({ status: true });
        } catch (error) {
            next(error);
        }
    };

    link = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const reservationId = req.body?.reservationId != null ? Number(req.body.reservationId) : null;
            const conv = await this.service.manualLink(String(req.params.conversationId), reservationId);
            if (!conv) return res.status(404).json({ status: false, message: "Conversation or reservation not found" });
            res.status(200).json({ status: true, data: conv });
        } catch (error) {
            next(error);
        }
    };

    /** Inbound Quo message webhook — authenticated by the token in the URL. */
    webhook = async (req: Request, res: Response) => {
        // Always 200 quickly; Quo retries/disables noisy endpoints otherwise.
        try {
            if (String(req.query.token || "") !== QuoInboxService.webhookToken()) {
                return res.status(401).json({ status: false });
            }
            const result = await this.service.handleWebhookEvent(req.body);
            if (result.handled && result.incoming && result.conversationId) {
                QuoItemDetectionService.scheduleDetection(result.conversationId);
                // Shadow AI suggestion (persisted for the audit/analytics loop).
                InboxAIService.scheduleQuoSuggestion(result.conversationId);
            }
            res.status(200).json({ status: true });
        } catch (error: any) {
            logger.error(`[QuoInbox] Webhook handling failed: ${error?.message}`);
            res.status(200).json({ status: true });
        }
    };

    /** Register (or verify) the webhook with Quo. */
    registerWebhook = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await this.service.ensureWebhook();
            res.status(200).json({ status: true, data: result });
        } catch (error) {
            next(error);
        }
    };

    sync = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const deep = req.body?.deep === true;
            const result = await this.service.syncAll({ deep });
            // Run detection for any conversations with new incoming messages.
            if (result.newIncoming.length) {
                const detector = new QuoItemDetectionService();
                detector.detectForConversations(result.newIncoming).catch((err) =>
                    logger.error(`[QuoInbox] Post-sync detection failed: ${err?.message}`)
                );
                for (const cid of result.newIncoming) InboxAIService.scheduleQuoSuggestion(cid);
            }
            res.status(200).json({ status: true, data: result });
        } catch (error) {
            next(error);
        }
    };
}
