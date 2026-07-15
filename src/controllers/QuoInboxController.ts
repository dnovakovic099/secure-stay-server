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
            // Supabase users have no firstName/lastName — resolve through the
            // users table so Quo sends are attributed like inbox-v2 sends.
            const { resolveRequestUser } = await import("../utils/requestUser.util");
            const sender = await resolveRequestUser(user);
            const message = await this.service.sendReply(
                String(req.params.conversationId),
                body,
                sender.userName,
                sender.userId
            );

            // Sent from the AI composer → record the suggestion outcome
            // (accepted verbatim vs edited), same lifecycle as Inbox V2.
            const suggestionId = Number(req.body?.suggestionId);
            if (Number.isFinite(suggestionId) && suggestionId > 0) {
                const aiStatus = req.body?.aiStatus === "edited" ? "edited" : "accepted";
                new InboxAIService()
                    .updateSuggestionStatus(suggestionId, aiStatus, {
                        acceptedByUserId: sender.userId,
                        finalSentMessageId: message?.id ?? null,
                    })
                    .catch((err) => logger.warn(`[QuoInbox] Suggestion status update failed: ${err?.message}`));
            }
            res.status(200).json({ status: true, data: message });
        } catch (error) {
            next(error);
        }
    };

    /** Pending "help the bot learn" prompt for a Quo thread (answer/dismiss reuse the inbox-v2 endpoints by prompt id). */
    getLearningPrompt = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const conv = await this.service.getConversationRow(String(req.params.conversationId));
            if (!conv) return res.status(404).json({ status: false, message: "Conversation not found" });
            const { AILearningPromptService } = await import("../services/AILearningPromptService");
            const prompt = await new AILearningPromptService().getPendingForThread(Number(conv.id), "quo");
            res.status(200).json({ status: true, data: prompt || null });
        } catch (error) {
            next(error);
        }
    };

    /** Cached AI suggestion for the thread's latest inbound message (no generation). */
    getSuggestion = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!InboxAIService.isEnabled()) {
                return res.status(200).json({ status: true, data: null, disabled: true });
            }
            const conversationId = String(req.params.conversationId);
            const result = await new InboxAIService().quoGetSuggestion(conversationId);
            if (!result) return res.status(200).json({ status: true, data: null });
            const { suggestion, ...payload } = result;
            res.status(200).json({ status: true, data: { ...payload, suggestionId: suggestion.id } });
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
            const instructions = typeof req.body?.instructions === "string" && req.body.instructions.trim() ? req.body.instructions.trim() : null;
            const baseDraft = typeof req.body?.baseDraft === "string" && req.body.baseDraft.trim() ? req.body.baseDraft.trim() : null;
            const result = await new InboxAIService().quoSuggestReply(conversationId, { force, instructions, baseDraft });
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

    /** Manually link/unlink a PM client (owner) to a conversation. */
    linkClient = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const raw = req.body?.clientId;
            const clientId = raw != null && String(raw).trim() ? String(raw).trim() : null;
            const conv = await this.service.manualLinkClient(String(req.params.conversationId), clientId);
            if (!conv) return res.status(404).json({ status: false, message: "Conversation or client not found" });
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

    /** Every Quo conversation attached to a reservation (auto + manual). */
    listForReservation = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const reservationId = Number(req.params.reservationId);
            if (!Number.isFinite(reservationId)) {
                return res.status(400).json({ status: false, message: "Invalid reservationId" });
            }
            const conversations = await this.service.listConversationsForReservation(reservationId);
            res.status(200).json({ status: true, data: conversations });
        } catch (error) {
            next(error);
        }
    };

    /** Attach an existing Quo conversation to a reservation as a secondary link. */
    attach = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const reservationId = Number(req.params.reservationId);
            const quoConversationId = String(req.body?.quoConversationId || "").trim();
            if (!Number.isFinite(reservationId) || !quoConversationId) {
                return res.status(400).json({
                    status: false,
                    message: "reservationId and quoConversationId are required",
                });
            }
            const user: any = (req as any).user;
            const { resolveRequestUser } = await import("../utils/requestUser.util");
            const sender = await resolveRequestUser(user);
            const link = await this.service.attachConversation(
                reservationId,
                quoConversationId,
                sender.userName || null
            );
            res.status(201).json({ status: true, data: link });
        } catch (error) {
            next(error);
        }
    };

    /** Remove a Quo conversation attachment from a reservation. */
    detach = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const reservationId = Number(req.params.reservationId);
            const quoConversationId = String(req.params.quoConversationId || "").trim();
            if (!Number.isFinite(reservationId) || !quoConversationId) {
                return res.status(400).json({
                    status: false,
                    message: "reservationId and quoConversationId are required",
                });
            }
            const removed = await this.service.detachConversation(reservationId, quoConversationId);
            res.status(200).json({ status: true, data: { removed } });
        } catch (error) {
            next(error);
        }
    };

    /** Search Quo conversations for the attach modal. */
    searchConversations = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const phone = (req.query.phone as string) || null;
            const keyword = (req.query.keyword as string) || null;
            const limit = req.query.limit ? Number(req.query.limit) : undefined;
            const results = await this.service.searchConversations({ phone, keyword, limit });
            res.status(200).json({ status: true, data: results });
        } catch (error) {
            next(error);
        }
    };

    /** Enabled Quo lines matching the requested category + portfolio. */
    linesForPortfolio = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const category = String(req.query.category || "GR");
            const portfolio = req.query.portfolio ? String(req.query.portfolio) : null;
            const lines = await this.service.linesForPortfolio(category, portfolio);
            res.status(200).json({ status: true, data: lines });
        } catch (error) {
            next(error);
        }
    };

    /** Place an outbound call from a Quo line. */
    initiateCall = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const phoneNumberId = String(req.body?.phoneNumberId || "").trim();
            const to = String(req.body?.to || "").trim();
            if (!phoneNumberId || !to) {
                return res.status(400).json({
                    status: false,
                    message: "phoneNumberId and to are required",
                });
            }
            const result = await this.service.initiateCall(phoneNumberId, to);
            res.status(200).json({ status: true, data: result });
        } catch (error) {
            next(error);
        }
    };
}
