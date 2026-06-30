import { NextFunction, Request, Response } from "express";
import { InboxService } from "../services/InboxService";
import { MessagingService } from "../services/MessagingServices";

interface CustomRequest extends Request {
    user?: any;
}

/**
 * Controller for the v2 Inbox. Reads come from the local DB (inbox_conversations
 * / inbox_messages); replies are delivered to Hostify and recorded locally with
 * the internal sender's attribution.
 */
export class InboxV2Controller {
    async listConversations(request: Request, response: Response, next: NextFunction) {
        try {
            const inboxService = new InboxService();
            const result = await inboxService.listConversations({
                page: parseInt(request.query.page as string) || 1,
                perPage: parseInt(request.query.per_page as string) || 30,
                keyword: (request.query.keyword as string) || undefined,
                channel: (request.query.channel as string) || undefined,
                unreadOnly: request.query.unreadOnly === "true",
            });
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    async getConversation(request: Request, response: Response, next: NextFunction) {
        try {
            const threadId = Number(request.params.threadId);
            if (!Number.isFinite(threadId)) {
                return response.status(400).json({ status: false, message: "Invalid threadId" });
            }
            const inboxService = new InboxService();
            const result = await inboxService.getConversation(threadId);
            if (!result) {
                return response.status(404).json({ status: false, message: "Conversation not found" });
            }
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    async reply(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const threadId = Number(request.params.threadId);
            const { message } = request.body;
            if (!Number.isFinite(threadId)) {
                return response.status(400).json({ status: false, message: "Invalid threadId" });
            }
            if (!message?.trim()) {
                return response.status(400).json({ status: false, message: "Message is required" });
            }
            const inboxService = new InboxService();
            const saved = await inboxService.sendReply(threadId, message.trim(), request.user);
            return response.status(201).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    /**
     * Trigger a Hostify -> local DB backfill/sync. Optionally limited to a single
     * thread (?threadId=) or a page budget (?maxPages=, ?perPage=).
     */
    async sync(request: Request, response: Response, next: NextFunction) {
        try {
            const inboxService = new InboxService();
            const result = await inboxService.syncFromHostify({
                maxPages: parseInt(request.query.maxPages as string) || undefined,
                perPage: parseInt(request.query.perPage as string) || undefined,
                threadId: (request.query.threadId as string) || undefined,
            });
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    /**
     * Reservation details for the right-hand panel. Reuses the existing
     * messaging service (local reservation + live Hostify enrichment).
     */
    async reservationDetails(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationId = Number(request.params.reservationId);
            if (!Number.isFinite(reservationId)) {
                return response.status(400).json({ status: false, message: "Invalid reservationId" });
            }
            const messagingService = new MessagingService();
            const details = await messagingService.getGuestReservationDetails(reservationId);
            if (!details) {
                return response.status(404).json({ status: false, message: "Reservation not found" });
            }
            return response.status(200).json({ status: true, data: details });
        } catch (error) {
            return next(error);
        }
    }
}
