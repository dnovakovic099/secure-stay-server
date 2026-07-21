import { NextFunction, Request, Response } from "express";
import { InboxService } from "../services/InboxService";
import { InboxAIService } from "../services/InboxAIService";
import { MessagingService } from "../services/MessagingServices";
import { AILearningPromptService } from "../services/AILearningPromptService";
import { AIProposedActionService } from "../services/AIProposedActionService";

interface CustomRequest extends Request {
    user?: any;
}

const toNum = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

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
                arrival: (request.query.arrival as string) || undefined,
                stayTiming: (request.query.stayTiming as string) || undefined,
                lastMessageFrom: request.query.lastMessageFrom as any,
                repliedBy: request.query.repliedBy as any,
                unresponded: request.query.unresponded === "true",
                dateType: (request.query.dateType as string) || undefined,
                dateFrom: (request.query.dateFrom as string) || undefined,
                dateTo: (request.query.dateTo as string) || undefined,
                checkinFrom: (request.query.checkinFrom as string) || undefined,
                checkinTo: (request.query.checkinTo as string) || undefined,
                checkoutFrom: (request.query.checkoutFrom as string) || undefined,
                checkoutTo: (request.query.checkoutTo as string) || undefined,
                propertyType: (request.query.propertyType as string) || undefined,
                serviceType: (request.query.serviceType as string) || undefined,
                portfolio: (request.query.portfolio as string) || undefined,
                listingId: request.query.listingId as any,
                reservationStatus: (request.query.reservationStatus as string) || undefined,
                searchFields: request.query.searchFields as any,
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
            const { message, suggestionId, aiStatus, attachmentUrls } = request.body;
            if (!Number.isFinite(threadId)) {
                return response.status(400).json({ status: false, message: "Invalid threadId" });
            }
            if (!message?.trim()) {
                return response.status(400).json({ status: false, message: "Message is required" });
            }
            const inboxService = new InboxService();
            const saved = await inboxService.sendReply(threadId, message.trim(), request.user, {
                attachmentUrls: Array.isArray(attachmentUrls) ? attachmentUrls.map(String) : [],
            });

            // If this reply came from an AI suggestion, record what the human did
            // with it (accepted/edited) and link the sent message for learning.
            const suggId = toNum(suggestionId);
            if (suggId && InboxAIService.isEnabled()) {
                try {
                    const status = aiStatus === "edited" ? "edited" : "accepted";
                    await new InboxAIService().updateSuggestionStatus(suggId, status, {
                        acceptedByUserId: toNum(request.user?.secureStayUserId ?? request.user?.id),
                        finalSentMessageId: toNum((saved as any)?.externalId),
                    });
                } catch (linkErr: any) {
                    // Non-fatal: never fail a successful send because of suggestion bookkeeping.
                    return response.status(201).json({ status: true, data: saved });
                }
            }
            return response.status(201).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    async internalNote(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const threadId = Number(request.params.threadId);
            const { note, attachmentUrls } = request.body || {};
            if (!Number.isFinite(threadId)) {
                return response.status(400).json({ status: false, message: "Invalid threadId" });
            }
            if (!String(note || "").trim() && (!Array.isArray(attachmentUrls) || attachmentUrls.length === 0)) {
                return response.status(400).json({ status: false, message: "Internal note or attachment is required" });
            }
            const saved = await new InboxService().addInternalNote(threadId, String(note || "").trim(), request.user, {
                attachmentUrls: Array.isArray(attachmentUrls) ? attachmentUrls.map(String) : [],
            });
            return response.status(201).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    async uploadAttachment(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const threadId = Number(request.params.threadId);
            if (!Number.isFinite(threadId)) {
                return response.status(400).json({ status: false, message: "Invalid threadId" });
            }
            if (!request.file) {
                return response.status(400).json({ status: false, message: "No file uploaded" });
            }
            const publicPath = `/public/inbox-v2/${request.file.filename}`;
            const baseUrl = String(process.env.BASE_URL || `${request.protocol}://${request.get("host")}`).replace(/\/$/, "");
            return response.status(201).json({
                status: true,
                data: {
                    url: `${baseUrl}${publicPath}`,
                    path: publicPath,
                    name: request.file.originalname,
                    mimeType: request.file.mimetype,
                    size: request.file.size,
                },
            });
        } catch (error) {
            return next(error);
        }
    }

    // -------------------------------------------------------------------------
    // Learning prompts (bot asks staff to fill a knowledge gap for a conversation)
    // -------------------------------------------------------------------------

    async getLearningPrompt(request: Request, response: Response, next: NextFunction) {
        try {
            const threadId = Number(request.params.threadId);
            if (!Number.isFinite(threadId)) {
                return response.status(400).json({ status: false, message: "Invalid threadId" });
            }
            const prompt = await new AILearningPromptService().getPendingForThread(threadId);
            return response.status(200).json({ status: true, data: prompt });
        } catch (error) {
            return next(error);
        }
    }

    async answerLearningPrompt(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = Number(request.params.id);
            const { answer, scope, listingIds, phases } = request.body || {};
            if (!Number.isFinite(id)) {
                return response.status(400).json({ status: false, message: "Invalid id" });
            }
            if (!answer || !String(answer).trim()) {
                return response.status(400).json({ status: false, message: "Answer is required" });
            }
            const normalizedScope: "property" | "portfolio" | "selected" =
                scope === "portfolio" ? "portfolio" : scope === "selected" ? "selected" : "property";
            const normalizedListingIds: number[] = Array.isArray(listingIds)
                ? listingIds
                      .map((v: any) => Number(v))
                      .filter((n: number) => Number.isFinite(n) && n > 0)
                : [];
            const normalizedPhases: string[] = Array.isArray(phases)
                ? phases.map((v: any) => String(v).trim().toLowerCase()).filter(Boolean)
                : [];
            const saved = await new AILearningPromptService().answer(id, {
                answer: String(answer),
                scope: normalizedScope,
                userId: toNum(request.user?.secureStayUserId ?? request.user?.id),
                listingIds: normalizedListingIds,
                phases: normalizedPhases,
            });
            if (!saved) return response.status(404).json({ status: false, message: "Prompt not found" });
            return response.status(200).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    async recommendLearningPromptAnswer(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = Number(request.params.id);
            if (!Number.isFinite(id)) {
                return response.status(400).json({ status: false, message: "Invalid id" });
            }
            const data = await new AILearningPromptService().recommendAnswer(id);
            if (!data.answer && data.reason === "Prompt not found") {
                return response.status(404).json({ status: false, message: data.reason });
            }
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async dismissLearningPrompt(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = Number(request.params.id);
            if (!Number.isFinite(id)) {
                return response.status(400).json({ status: false, message: "Invalid id" });
            }
            const ok = await new AILearningPromptService().dismiss(
                id,
                toNum(request.user?.secureStayUserId ?? request.user?.id)
            );
            return response.status(200).json({ status: ok });
        } catch (error) {
            return next(error);
        }
    }

    // -------------------------------------------------------------------------
    // AI suggested replies (suggestion-only; never auto-sends)
    // -------------------------------------------------------------------------

    /** Whether the AI messaging assistant (and auto-send bot) is enabled. */
    async aiConfig(_request: Request, response: Response) {
        return response.status(200).json({
            status: true,
            data: {
                enabled: InboxAIService.isEnabled(),
                autosend: await InboxAIService.autosendConfigAsync(),
            },
        });
    }

    /** Generate (or return cached) AI suggestion for the latest guest message. */
    async aiSuggest(request: Request, response: Response, next: NextFunction) {
        try {
            if (!InboxAIService.isEnabled()) {
                return response.status(503).json({ status: false, disabled: true, message: "AI messaging is disabled" });
            }
            const threadId = Number(request.params.threadId);
            if (!Number.isFinite(threadId)) {
                return response.status(400).json({ status: false, message: "Invalid threadId" });
            }
            const service = new InboxAIService();
            const suggestion = await service.generateSuggestion(threadId, {
                messageId: toNum(request.body?.messageId),
                force: request.body?.force === true || request.body?.force === "true",
                // Composer steering: "Generate" sends instructions only; "Refine"
                // sends instructions + the current draft to revise.
                instructions:
                    typeof request.body?.instructions === "string" ? request.body.instructions : null,
                baseDraft: typeof request.body?.baseDraft === "string" ? request.body.baseDraft : null,
            });
            return response.status(200).json({ status: true, data: suggestion });
        } catch (error) {
            return next(error);
        }
    }

    /** Latest persisted suggestion for a thread (optionally a specific message). */
    async aiGetSuggestion(request: Request, response: Response, next: NextFunction) {
        try {
            if (!InboxAIService.isEnabled()) {
                return response.status(200).json({ status: true, data: null, disabled: true });
            }
            const threadId = Number(request.params.threadId);
            if (!Number.isFinite(threadId)) {
                return response.status(400).json({ status: false, message: "Invalid threadId" });
            }
            const service = new InboxAIService();
            const data = await service.getLatestSuggestion(threadId, toNum(request.query.messageId));
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** All suggestions for a thread (for the compare/history view). */
    async aiListSuggestions(request: Request, response: Response, next: NextFunction) {
        try {
            if (!InboxAIService.isEnabled()) {
                return response.status(200).json({ status: true, data: [], disabled: true });
            }
            const threadId = Number(request.params.threadId);
            if (!Number.isFinite(threadId)) {
                return response.status(400).json({ status: false, message: "Invalid threadId" });
            }
            const service = new InboxAIService();
            const data = await service.listSuggestionsForThread(threadId);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** Record human feedback on a suggestion / sent reply. */
    async aiFeedback(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const b = request.body || {};
            const service = new InboxAIService();
            const saved = await service.recordFeedback({
                suggestionId: toNum(b.suggestionId),
                threadId: toNum(b.threadId),
                messageId: toNum(b.messageId),
                listingId: toNum(b.listingId),
                reservationId: toNum(b.reservationId),
                userId: toNum(request.user?.secureStayUserId ?? request.user?.id),
                rating: typeof b.rating === "string" ? b.rating : null,
                categories: Array.isArray(b.categories) ? b.categories.map(String) : null,
                feedbackText: typeof b.feedbackText === "string" ? b.feedbackText : null,
                correctedResponse: typeof b.correctedResponse === "string" ? b.correctedResponse : null,
            });
            return response.status(201).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    // -------------------------------------------------------------------------
    // AI proposed actions (one-click, human-approved operations)
    // -------------------------------------------------------------------------

    /** Open proposed actions for a thread (late checkout, code resend, ops ticket). */
    async aiListActions(request: Request, response: Response, next: NextFunction) {
        try {
            if (!InboxAIService.isEnabled()) {
                return response.status(200).json({ status: true, data: [], disabled: true });
            }
            const threadId = Number(request.params.threadId);
            if (!Number.isFinite(threadId)) {
                return response.status(400).json({ status: false, message: "Invalid threadId" });
            }
            const data = await new AIProposedActionService().listForThread(threadId, {
                includeResolved: request.query.includeResolved === "true",
            });
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** Approve + execute a proposed action (optionally with edited reply/task text). */
    async aiExecuteAction(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = Number(request.params.id);
            if (!Number.isFinite(id)) {
                return response.status(400).json({ status: false, message: "Invalid action id" });
            }
            const b = request.body || {};
            const saved = await new AIProposedActionService().execute(id, request.user, {
                replyOverride: typeof b.reply === "string" ? b.reply : null,
                taskOverride: typeof b.task === "string" ? b.task : null,
                sendReply: typeof b.sendReply === "boolean" ? b.sendReply : undefined,
            });
            return response.status(200).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    /** Dismiss a proposed action. */
    async aiDismissAction(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = Number(request.params.id);
            if (!Number.isFinite(id)) {
                return response.status(400).json({ status: false, message: "Invalid action id" });
            }
            const saved = await new AIProposedActionService().dismiss(id, request.user);
            return response.status(200).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    /**
     * Cancel a queued delayed auto-send (human veto from the inbox). The
     * suggestion moves to "ignored" so webhook retries can never re-queue it;
     * the draft text remains editable/sendable in the inbox.
     */
    async aiVetoDelayedSend(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = Number(request.params.id);
            if (!Number.isFinite(id)) {
                return response.status(400).json({ status: false, message: "Invalid suggestion id" });
            }
            const saved = await new InboxAIService().vetoDelayedAutosend(
                id,
                toNum(request.user?.secureStayUserId ?? request.user?.id)
            );
            return response.status(200).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    /** Disable/enable Hostify auto-respond for this guest (persists by guestId). */
    async setAiAutoRespondDisabled(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const threadId = Number(request.params.threadId);
            if (!Number.isFinite(threadId)) {
                return response.status(400).json({ status: false, message: "Invalid threadId" });
            }
            const disabled = Boolean(request.body?.disabled);
            const disabledBy =
                request.user?.name ||
                request.user?.email ||
                String(request.user?.secureStayUserId ?? request.user?.id ?? "") ||
                null;
            const saved = await new InboxAIService().setConversationAutoRespondDisabled(
                threadId,
                disabled,
                disabledBy
            );
            return response.status(200).json({ status: true, data: saved });
        } catch (error) {
            return next(error);
        }
    }

    /** Update a suggestion's lifecycle status (ignored/rejected from the UI). */
    async aiUpdateSuggestionStatus(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const id = Number(request.params.id);
            if (!Number.isFinite(id)) {
                return response.status(400).json({ status: false, message: "Invalid suggestion id" });
            }
            const service = new InboxAIService();
            const saved = await service.updateSuggestionStatus(id, String(request.body?.status || ""), {
                acceptedByUserId: toNum(request.user?.secureStayUserId ?? request.user?.id),
            });
            return response.status(200).json({ status: true, data: saved });
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

    /**
     * Update reservation host note and/or cleaning note. Persists locally and
     * pushes the change to Hostify (returns the refreshed details + sync status).
     */
    async updateReservationNotes(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationId = Number(request.params.reservationId);
            if (!Number.isFinite(reservationId)) {
                return response.status(400).json({ status: false, message: "Invalid reservationId" });
            }
            const { hostNote, cleaningNote } = request.body || {};
            if (hostNote === undefined && cleaningNote === undefined) {
                return response.status(400).json({ status: false, message: "Nothing to update" });
            }
            const messagingService = new MessagingService();
            const result = await messagingService.updateGuestReservationNotes(reservationId, {
                hostNote: hostNote === undefined ? undefined : (hostNote ?? ""),
                cleaningNote: cleaningNote === undefined ? undefined : (cleaningNote ?? ""),
            });
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }
}
