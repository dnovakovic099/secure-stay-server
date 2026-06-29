import OpenAI from "openai";
import { MoreThanOrEqual } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { GuestCommunicationEntity } from "../entity/GuestCommunication";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Listing } from "../entity/Listing";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { PropertyInfo } from "../entity/PropertyInfo";
import { UpSellEntity } from "../entity/UpSell";
import { UpSellPropertyConfig } from "../entity/UpSellPropertyConfig";
import { LLBuddySuggestionEntity } from "../entity/LLBuddySuggestion";
import { LLBuddyGeneratedItemEntity } from "../entity/LLBuddyGeneratedItem";
import { LLBuddyFeedbackEntity } from "../entity/LLBuddyFeedback";
import { LLBuddyLearningCandidateEntity } from "../entity/LLBuddyLearningCandidate";
import { LLBuddyAuditLogEntity } from "../entity/LLBuddyAuditLog";
import { LLBuddyConversationEntity } from "../entity/LLBuddyConversation";
import { LLBuddyMessageEntity } from "../entity/LLBuddyMessage";
import { MessagingService } from "./MessagingServices";
import logger from "../utils/logger.utils";

type Decision = {
    categoryName: string;
    itemType: "action_item" | "guest_issue" | null;
    priority: string;
    confidence: number;
    title: string;
    reason: string;
    warnings: string[];
    proposedResolution: string;
};

type LLBuddyContext = {
    latestMessage: {
        id: string;
        body: string;
        source: string;
        direction: string;
        senderName: string | null;
        communicatedAt: Date;
    };
    conversationHistory: Array<{
        id: string;
        direction: string;
        senderName: string | null;
        body: string;
        sentAt: Date | null;
        receivedAt: Date | null;
        sendStatus: string | null;
    }>;
    reservation: Record<string, any> | null;
    listing: Record<string, any> | null;
    allListingsKnowledge: Record<string, any> | null;
    upsells: {
        propertyUpsells: Array<Record<string, any>>;
        globalUpsells: Array<Record<string, any>>;
        propertyUpsellConfigs: Array<Record<string, any>>;
        internalNoteExcluded: true;
    };
    activeItems: Array<Record<string, any>>;
    priorFeedback: Array<Record<string, any>>;
    approvedLearning: Array<Record<string, any>>;
    safety: {
        autoSendEnabled: boolean;
        autoSendAllowed: false;
        hostBuddySourceUsed: false;
        excludedFields: string[];
        sensitiveTerms: string[];
    };
};

type AIDecision = Decision & {
    suggestedReply: string;
    internalSummary: string;
    sourceReferences?: Record<string, any>;
    model: string;
    promptVersion: string;
};

const AUTO_SEND_ENABLED = process.env.AI_MESSAGING_AUTOSEND_ENABLED === "true";
const PROMPT_VERSION = "ll-buddy-context-v2";
const HOSTIFY_WEBHOOK_CONFIRMATION_NOTE = "Ask Ange to ask Darko about the HostBuddy/Hostify webhook setup and expected payloads.";

const SENSITIVE_TERMS = [
    "refund",
    "discount",
    "cancel",
    "cancellation",
    "lawsuit",
    "lawyer",
    "police",
    "fire",
    "medical",
    "emergency",
    "deposit",
    "damage",
    "compensation",
    "discrimination",
];

const CATEGORY_RULES: Array<{
    categoryName: string;
    itemType: "action_item" | "guest_issue";
    priority: string;
    terms: string[];
}> = [
    { categoryName: "Maintenance", itemType: "guest_issue", priority: "High", terms: ["broken", "not working", "leak", "ac", "heater", "toilet", "sink", "lock", "code", "wifi", "power"] },
    { categoryName: "Cleanliness", itemType: "guest_issue", priority: "High", terms: ["dirty", "unclean", "hair", "stain", "trash", "smell", "cleaned"] },
    { categoryName: "Access", itemType: "guest_issue", priority: "Critical", terms: ["locked out", "can't get in", "cannot get in", "door code", "access code"] },
    { categoryName: "Guest Request", itemType: "action_item", priority: "Medium", terms: ["early check", "late checkout", "late check", "extra towels", "more towels", "blanket", "parking", "pet", "extend"] },
    { categoryName: "Policy Review", itemType: "action_item", priority: "High", terms: ["refund", "discount", "cancel", "deposit", "damage", "compensation"] },
];

export class LLBuddyService {
    private readonly communicationRepo = appDatabase.getRepository(GuestCommunicationEntity);
    private readonly reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private readonly listingRepo = appDatabase.getRepository(Listing);
    private readonly clientPropertyRepo = appDatabase.getRepository(ClientPropertyEntity);
    private readonly propertyInfoRepo = appDatabase.getRepository(PropertyInfo);
    private readonly upsellRepo = appDatabase.getRepository(UpSellEntity);
    private readonly upsellConfigRepo = appDatabase.getRepository(UpSellPropertyConfig);
    private readonly suggestionRepo = appDatabase.getRepository(LLBuddySuggestionEntity);
    private readonly itemRepo = appDatabase.getRepository(LLBuddyGeneratedItemEntity);
    private readonly feedbackRepo = appDatabase.getRepository(LLBuddyFeedbackEntity);
    private readonly learningRepo = appDatabase.getRepository(LLBuddyLearningCandidateEntity);
    private readonly auditRepo = appDatabase.getRepository(LLBuddyAuditLogEntity);
    private readonly conversationRepo = appDatabase.getRepository(LLBuddyConversationEntity);
    private readonly messageRepo = appDatabase.getRepository(LLBuddyMessageEntity);
    private readonly messagingService = new MessagingService();
    private readonly openai: OpenAI | null = process.env.OPENAI_API_KEY
        ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        : null;

    async getOverview() {
        const [
            pendingSuggestions,
            actionItems,
            guestIssues,
            learningPending,
            feedbackCount,
            auditCount,
        ] = await Promise.all([
            this.suggestionRepo.count({ where: { status: "pending_review" } }),
            this.itemRepo.count({ where: { itemType: "action_item" } }),
            this.itemRepo.count({ where: { itemType: "guest_issue" } }),
            this.learningRepo.count({ where: { status: "pending" } }),
            this.feedbackRepo.count(),
            this.auditRepo.count(),
        ]);

        const recentSuggestions = await this.suggestionRepo.find({ order: { createdAt: "DESC" }, take: 5 });
        const recentItems = await this.itemRepo.find({ order: { createdAt: "DESC" }, take: 5 });

        return {
            summary: {
                pendingSuggestions,
                actionItems,
                guestIssues,
                learningPending,
                feedbackCount,
                auditCount,
                autoSendEnabled: AUTO_SEND_ENABLED,
                hostBuddySourceUsed: false,
                webhookConfirmationNote: HOSTIFY_WEBHOOK_CONFIRMATION_NOTE,
            },
            recentSuggestions,
            recentItems,
        };
    }

    async getSuggestions() {
        return this.suggestionRepo.find({ order: { createdAt: "DESC" }, take: 100 });
    }

    async getConversations(filters: Record<string, any> = {}) {
        await this.syncRecentCommunications(75, "conversation_list");
        const keyword = String(filters.keyword || "").trim().toLowerCase();
        const page = Math.max(Number(filters.page || 1), 1);
        const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 100);
        const rows = await this.conversationRepo.find({ order: { lastMessageAt: "DESC", updatedAt: "DESC" }, take: 500 });
        const filteredRows = keyword ? rows.filter((row) => [
            row.guestName,
            row.propertyName,
            row.lastMessagePreview,
            row.sourceSystem,
            row.channel,
            row.reservationId,
        ].join(" ").toLowerCase().includes(keyword)) : rows;
        const start = (page - 1) * limit;

        return {
            conversations: filteredRows.slice(start, start + limit),
            pagination: {
                page,
                limit,
                total: filteredRows.length,
                hasMore: start + limit < filteredRows.length,
            },
            sync: {
                primarySource: "guest_communication",
                latestLocalSyncAt: rows[0]?.lastSyncedAt || null,
                webhookConfirmationNote: HOSTIFY_WEBHOOK_CONFIRMATION_NOTE,
            },
        };
    }

    async getConversationDetail(conversationId: string) {
        const conversation = await this.conversationRepo.findOne({ where: { id: conversationId } });
        if (!conversation) return null;
        const messages = await this.messageRepo.find({
            where: { conversationId },
            order: { receivedAt: "ASC", sentAt: "ASC", createdAt: "ASC" },
        });
        const suggestions = await this.suggestionRepo.find({
            where: { reservationId: conversation.reservationId || undefined },
            order: { createdAt: "DESC" },
            take: 10,
        });
        return { conversation, messages, suggestions };
    }

    async sendReply(conversationId: string, body: string, userId: string) {
        const trimmed = String(body || "").trim();
        if (!trimmed) throw new Error("Reply body is required");
        const conversation = await this.conversationRepo.findOne({ where: { id: conversationId } });
        if (!conversation) throw new Error("Conversation not found");

        const threadId = conversation.externalConversationId || conversation.metadata?.inboxId || conversation.metadata?.threadId;
        if (!threadId || conversation.sourceSystem !== "hostify_message") {
            throw new Error("This conversation does not have a Hostify thread ID for sending yet.");
        }

        const draft = await this.messageRepo.save(this.messageRepo.create({
            conversationId: conversation.id,
            externalMessageId: null,
            sourceSystem: conversation.sourceSystem,
            channel: conversation.channel,
            direction: "outbound",
            senderType: "team",
            senderName: userId,
            senderExternalId: null,
            securestayUserId: userId,
            body: trimmed,
            attachments: [],
            sentAt: new Date(),
            receivedAt: null,
            sendStatus: "sending",
            rawPayload: null,
            sourceCommunicationId: null,
        }));

        try {
            const result = await this.messagingService.postHostifyReply(String(threadId), trimmed);
            draft.sendStatus = "sent";
            draft.externalMessageId = result?.message_id ? String(result.message_id) : null;
            draft.rawPayload = result || null;
            await this.messageRepo.save(draft);
            await this.updateConversationFromMessage(conversation, draft);
            await this.audit("message_sent", "conversation", conversation.id, "LL Buddy reply sent through Hostify", { messageId: draft.id, threadId }, userId);
            return draft;
        } catch (error: any) {
            draft.sendStatus = "failed";
            draft.rawPayload = { error: error.message };
            await this.messageRepo.save(draft);
            await this.audit("message_send_failed", "conversation", conversation.id, "LL Buddy Hostify reply failed", { messageId: draft.id, threadId, error: error.message }, userId);
            throw error;
        }
    }

    async getGeneratedItems(itemType?: "action_item" | "guest_issue") {
        return this.itemRepo.find({
            where: itemType ? { itemType } : {},
            order: { createdAt: "DESC" },
            take: 150,
        });
    }

    async getFeedback() {
        return this.feedbackRepo.find({ order: { createdAt: "DESC" }, take: 150 });
    }

    async getLearningCandidates() {
        return this.learningRepo.find({ order: { createdAt: "DESC" }, take: 150 });
    }

    async getAuditLogs() {
        return this.auditRepo.find({ order: { createdAt: "DESC" }, take: 200 });
    }

    async recordFeedback(suggestionId: string, data: Record<string, any>, userId: string) {
        const suggestion = await this.suggestionRepo.findOne({ where: { id: suggestionId } });
        const feedback = await this.feedbackRepo.save(this.feedbackRepo.create({
            suggestionId,
            rating: data.rating || "edited",
            finalReply: data.finalReply || null,
            notes: data.notes || null,
            tags: Array.isArray(data.tags) ? data.tags : [],
            createdBy: userId,
        }));
        await this.suggestionRepo.update({ id: suggestionId }, {
            status: data.rating === "rejected" ? "rejected" : "reviewed",
            updatedBy: userId,
        });
        const learningCandidate = await this.createLearningCandidateFromFeedback(suggestion, feedback);
        await this.audit("feedback_recorded", "suggestion", suggestionId, `Feedback recorded: ${feedback.rating}`, { feedbackId: feedback.id }, userId);
        if (learningCandidate) {
            await this.audit("learning_candidate_created", "learning_candidate", learningCandidate.id, "Feedback created a Learning Review candidate", {
                feedbackId: feedback.id,
                suggestionId,
            }, userId);
        }
        return feedback;
    }

    async reviewLearningCandidate(id: string, data: Record<string, any>, userId: string) {
        const status = ["approved", "edited", "declined", "needs_more_evidence"].includes(data.status)
            ? data.status
            : "pending";
        await this.learningRepo.update({ id }, {
            status,
            proposedText: typeof data.proposedText === "string" && data.proposedText.trim() ? data.proposedText.trim() : undefined,
            decisionReason: data.reason || null,
            reviewedBy: userId,
            reviewedAt: new Date(),
        });
        await this.audit("learning_candidate_reviewed", "learning_candidate", id, `Learning candidate ${status}`, data, userId);
        return this.learningRepo.findOne({ where: { id } });
    }

    async processNightlyLearning(userId = "system") {
        const editedFeedback = await this.feedbackRepo.find({
            order: { createdAt: "DESC" },
            take: 100,
        });

        let created = 0;
        for (const feedback of editedFeedback) {
            if (!["edited", "accepted_with_edits", "rejected"].includes(feedback.rating)) continue;
            const suggestion = await this.suggestionRepo.findOne({ where: { id: feedback.suggestionId } });
            const candidate = await this.createLearningCandidateFromFeedback(suggestion, feedback);
            if (candidate) created += 1;
        }

        await this.audit("nightly_learning_review_prepared", null, null, `Prepared ${created} Learning Review candidates`, {
            scannedFeedback: editedFeedback.length,
            created,
            schedule: "Daily 10 PM America/New_York",
            autoPromotedToKnowledge: false,
        }, userId);
        return { scannedFeedback: editedFeedback.length, created };
    }

    async analyzeRecent(limit = 25, userId = "system") {
        const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 14);
        const communications = await this.communicationRepo.find({
            where: { communicatedAt: MoreThanOrEqual(since) },
            order: { communicatedAt: "DESC" },
            take: Math.min(Math.max(limit, 1), 100),
        });

        let analyzed = 0;
        for (const communication of communications.reverse()) {
            await this.syncCommunicationToConversation(communication, userId);
            const result = await this.analyzeCommunication(communication, userId);
            if (result.createdSuggestion) analyzed += 1;
        }

        await this.audit("recent_analysis_completed", null, null, `Analyzed ${communications.length} recent communications`, { analyzed }, userId);
        return { scanned: communications.length, analyzed };
    }

    async analyzeCommunication(communication: GuestCommunicationEntity, userId = "system") {
        if (!communication?.id || communication.direction !== "inbound" || !String(communication.content || "").trim()) {
            return { createdSuggestion: false };
        }

        await this.syncCommunicationToConversation(communication, userId);

        const existing = await this.suggestionRepo.findOne({ where: { communicationId: communication.id } });
        if (existing) return { createdSuggestion: false, suggestion: existing };

        const context = await this.buildSuggestionContext(communication);
        const aiDecision = await this.generateAIDecision(context);
        const reservation = await this.reservationRepo.findOne({ where: { id: communication.reservationId } });
        const sourceReferences = this.buildSourceReferences(communication, reservation, aiDecision, context);

        const suggestion = await this.suggestionRepo.save(this.suggestionRepo.create({
            reservationId: communication.reservationId,
            listingId: reservation?.listingMapId || Number(communication.metadata?.listingId) || null,
            communicationId: communication.id,
            guestName: reservation?.guestName || communication.senderName || "Guest",
            propertyName: reservation?.listingName || null,
            guestMessage: communication.content,
            suggestedReply: aiDecision.suggestedReply,
            internalSummary: aiDecision.internalSummary,
            confidence: aiDecision.confidence,
            status: "pending_review",
            autoSendAllowed: false,
            sourceReferences,
            warnings: aiDecision.warnings,
            dedupeKey: `suggestion:${communication.id}`,
            promptVersion: aiDecision.promptVersion,
            model: aiDecision.model,
            createdBy: userId,
            updatedBy: userId,
        }));

        let generatedItem: LLBuddyGeneratedItemEntity | null = null;
        if (aiDecision.itemType) {
            generatedItem = await this.createGeneratedItem(communication, reservation, aiDecision, sourceReferences, userId);
        }

        const learningCandidate = await this.maybeCreateLearningCandidate(communication, reservation, aiDecision, sourceReferences);
        await this.audit("communication_analyzed", "communication", communication.id, "LL Buddy analyzed an inbound communication", {
            suggestionId: suggestion.id,
            generatedItemId: generatedItem?.id || null,
            learningCandidateId: learningCandidate?.id || null,
            autoSendAllowed: false,
            model: aiDecision.model,
            promptVersion: aiDecision.promptVersion,
        }, userId);

        return { createdSuggestion: true, suggestion, generatedItem, learningCandidate };
    }

    async syncRecentCommunications(limit = 75, userId = "system") {
        const communications = await this.communicationRepo.find({
            order: { communicatedAt: "DESC" },
            take: Math.min(Math.max(limit, 1), 250),
        });
        for (const communication of communications.reverse()) {
            await this.syncCommunicationToConversation(communication, userId);
        }
        return { synced: communications.length };
    }

    async syncCommunicationToConversation(communication: GuestCommunicationEntity, userId = "system") {
        if (!communication?.id || !communication.reservationId) return null;

        const reservation = await this.reservationRepo.findOne({ where: { id: communication.reservationId } });
        const externalConversationId = this.getExternalConversationId(communication);
        const sourceSystem = communication.source || "local";
        const existingConversation = await this.conversationRepo.findOne({
            where: externalConversationId
                ? { externalConversationId, sourceSystem }
                : { reservationId: communication.reservationId, sourceSystem },
        });

        let conversation = existingConversation || this.conversationRepo.create({
            externalConversationId,
            sourceSystem,
            channel: this.formatChannel(sourceSystem),
            reservationId: communication.reservationId,
            listingId: reservation?.listingMapId || Number(communication.metadata?.listingId) || null,
            guestName: reservation?.guestName || communication.senderName || "Guest",
            propertyName: reservation?.listingName || null,
            status: "open",
            unread: false,
            unresponded: false,
            metadata: {
                inboxId: communication.metadata?.inboxId,
                threadId: communication.metadata?.inboxId || communication.metadata?.threadId,
                source: communication.source,
                webhookConfirmationNote: HOSTIFY_WEBHOOK_CONFIRMATION_NOTE,
            },
        });

        if (!conversation.id) {
            conversation = await this.conversationRepo.save(conversation);
        }

        const message = await this.upsertMessage(conversation, communication);
        conversation.syncStatus = "synced";
        conversation.lastSyncedAt = new Date();
        conversation.syncError = null;
        await this.updateConversationFromMessage(conversation, message);
        await this.conversationRepo.save(conversation);
        await this.audit("message_synced", "communication", communication.id, "Stored communication synced to LL Buddy conversation", {
            conversationId: conversation.id,
            messageId: message.id,
        }, userId);
        return conversation;
    }

    private async upsertMessage(conversation: LLBuddyConversationEntity, communication: GuestCommunicationEntity) {
        const externalMessageId = communication.externalId || communication.id;
        const existing = await this.messageRepo.findOne({ where: { externalMessageId, sourceSystem: communication.source } });
        if (existing) return existing;

        return this.messageRepo.save(this.messageRepo.create({
            conversationId: conversation.id,
            externalMessageId,
            sourceSystem: communication.source,
            channel: this.formatChannel(communication.source),
            direction: communication.direction === "outbound" ? "outbound" : "inbound",
            senderType: communication.direction === "outbound" ? "team" : "guest",
            senderName: communication.senderName || (communication.direction === "outbound" ? "SecureStay Team" : "Guest"),
            senderExternalId: communication.metadata?.guestId ? String(communication.metadata.guestId) : null,
            securestayUserId: null,
            body: communication.content || "",
            attachments: communication.metadata?.attachmentUrl ? [{ url: communication.metadata.attachmentUrl }] : [],
            sentAt: communication.direction === "outbound" ? communication.communicatedAt : null,
            receivedAt: communication.direction === "outbound" ? null : communication.communicatedAt,
            sendStatus: communication.direction === "outbound" ? "sent" : "received",
            rawPayload: communication.metadata || null,
            sourceCommunicationId: communication.id,
        }));
    }

    private async updateConversationFromMessage(conversation: LLBuddyConversationEntity, message: LLBuddyMessageEntity) {
        const eventTime = message.sentAt || message.receivedAt || message.createdAt || new Date();
        conversation.lastMessageAt = eventTime;
        conversation.lastMessagePreview = message.body.slice(0, 240);
        if (message.direction === "inbound") {
            conversation.lastInboundMessageAt = eventTime;
            conversation.unread = true;
            conversation.unresponded = true;
        }
        if (message.direction === "outbound") {
            conversation.lastOutboundMessageAt = eventTime;
            conversation.unresponded = false;
            conversation.unread = false;
        }
        await this.conversationRepo.save(conversation);
    }

    private getExternalConversationId(communication: GuestCommunicationEntity) {
        const threadId = communication.metadata?.inboxId || communication.metadata?.threadId || communication.metadata?.conversationId;
        return threadId ? String(threadId) : `reservation:${communication.reservationId}:${communication.source}`;
    }

    private formatChannel(source: string) {
        if (source.includes("hostify")) return "Hostify";
        if (source.includes("openphone")) return "OpenPhone";
        return source || "Local";
    }

    private async buildSuggestionContext(communication: GuestCommunicationEntity): Promise<LLBuddyContext> {
        const reservation = await this.reservationRepo.findOne({ where: { id: communication.reservationId } });
        const listingId = reservation?.listingMapId || Number(communication.metadata?.listingId) || null;
        const [listing, clientProperty, activeItems, priorFeedback, approvedLearning] = await Promise.all([
            listingId ? this.listingRepo.findOne({ where: { id: listingId } }) : Promise.resolve(null),
            this.findClientPropertyForListing(listingId),
            this.itemRepo.find({
                where: { reservationId: communication.reservationId },
                order: { createdAt: "DESC" },
                take: 20,
            }),
            this.feedbackRepo.find({ order: { createdAt: "DESC" }, take: 25 }),
            this.learningRepo.find({
                where: { status: "approved" },
                order: { updatedAt: "DESC" },
                take: 40,
            }),
        ]);

        const conversationId = this.getExternalConversationId(communication);
        const conversation = await this.conversationRepo.findOne({
            where: { externalConversationId: conversationId, sourceSystem: communication.source },
        });
        const conversationHistory = conversation
            ? await this.messageRepo.find({
                where: { conversationId: conversation.id },
                order: { receivedAt: "ASC", sentAt: "ASC", createdAt: "ASC" },
                take: 80,
            })
            : [];

        const propertyInfo = clientProperty?.propertyInfo || (
            clientProperty?.id
                ? await this.propertyInfoRepo.findOne({
                    where: { clientProperty: { id: clientProperty.id } as any },
                    relations: ["propertyUpsells", "propertyParkingInfo"],
                })
                : null
        );

        const [globalUpsells, propertyUpsellConfigs] = await Promise.all([
            this.upsellRepo.find({ where: { isActive: true as any }, order: { title: "ASC" as any }, take: 100 }),
            listingId ? this.upsellConfigRepo.find({ where: { listingId }, take: 100 }) : Promise.resolve([]),
        ]);

        return {
            latestMessage: {
                id: communication.id,
                body: this.truncate(communication.content || "", 4000),
                source: communication.source,
                direction: communication.direction,
                senderName: communication.senderName || null,
                communicatedAt: communication.communicatedAt,
            },
            conversationHistory: conversationHistory.map((message) => ({
                id: message.id,
                direction: message.direction,
                senderName: message.senderName || null,
                body: this.truncate(message.body || "", 2500),
                sentAt: message.sentAt,
                receivedAt: message.receivedAt,
                sendStatus: message.sendStatus,
            })),
            reservation: reservation ? {
                id: reservation.id,
                confirmationCode: reservation.confirmation_code || reservation.channelReservationId || reservation.reservationId,
                channelName: reservation.channelName,
                status: reservation.status,
                listingName: reservation.listingName,
                listingMapId: reservation.listingMapId,
                guestName: reservation.guestName,
                guestFirstName: reservation.guestFirstName,
                numberOfGuests: reservation.numberOfGuests,
                adults: reservation.adults,
                children: reservation.children,
                infants: reservation.infants,
                pets: reservation.pets,
                arrivalDate: reservation.arrivalDate,
                departureDate: reservation.departureDate,
                checkInTime: reservation.checkInTime,
                checkOutTime: reservation.checkOutTime,
                paymentStatus: reservation.paymentStatus,
                totalPrice: reservation.totalPrice,
                currency: reservation.currency,
                cancellationPolicy: this.truncate(reservation.airbnbCancellationPolicy || "", 1200),
                hostNote: this.truncate(reservation.hostNote || "", 1200),
                tags: reservation.tags,
            } : null,
            listing: listing ? {
                id: listing.id,
                name: listing.name,
                internalListingName: listing.internalListingName,
                externalListingName: listing.externalListingName,
                address: listing.address,
                city: listing.city,
                state: listing.state,
                country: listing.country,
                propertyType: listing.propertyType,
                bedroomsNumber: listing.bedroomsNumber,
                bathroomsNumber: listing.bathroomsNumber,
                personCapacity: listing.personCapacity,
                guests: listing.guests,
                checkInTimeStart: listing.checkInTimeStart,
                checkInTimeEnd: listing.checkInTimeEnd,
                checkOutTime: listing.checkOutTime,
                timeZoneName: listing.timeZoneName,
                minNights: listing.minNights,
                maxNights: listing.maxNights,
                wifiUsername: listing.wifiUsername,
                wifiPassword: listing.wifiPassword,
                description: this.truncate(listing.description || "", 2000),
                tags: listing.tags,
            } : null,
            allListingsKnowledge: propertyInfo ? this.shapePropertyInfoForGuestContext(propertyInfo) : null,
            upsells: {
                propertyUpsells: (propertyInfo?.propertyUpsells || []).map((upsell) => ({
                    upsellName: upsell.upsellName,
                    allowUpsell: upsell.allowUpsell,
                    feeType: upsell.feeType,
                    fee: upsell.fee,
                    maxAdditionalHours: upsell.maxAdditionalHours,
                    notes: this.truncate(upsell.notes || "", 1200),
                })),
                globalUpsells: globalUpsells.map((upsell) => ({
                    upSellId: upsell.upSellId,
                    title: upsell.title,
                    serviceType: upsell.serviceType,
                    price: upsell.price,
                    timePeriod: upsell.timePeriod,
                    availability: upsell.availability,
                    description: this.truncate(String(upsell.description || ""), 1200),
                    status: upsell.status,
                    actualFee: upsell.actualFee,
                    pmFee: upsell.pmFee,
                    processingFee: upsell.processingFee,
                })),
                propertyUpsellConfigs: propertyUpsellConfigs.map((config) => ({
                    upSellId: config.upSellId,
                    listingId: config.listingId,
                    serviceType: config.serviceType,
                    pmFee: config.pmFee,
                    actualFee: config.actualFee,
                    processingFee: config.processingFee,
                    chargeType: config.chargeType,
                    rateConfiguration: config.rateConfiguration,
                    pricingRules: this.truncate(config.pricingRules || "", 1000),
                    upsellFee: config.upsellFee,
                    pairSyncStatus: config.pairSyncStatus,
                })),
                internalNoteExcluded: true,
            },
            activeItems: activeItems.map((item) => ({
                id: item.id,
                itemType: item.itemType,
                title: item.title,
                categoryName: item.categoryName,
                priority: item.priority,
                status: item.status,
                proposedResolution: item.proposedResolution,
                flagReason: item.flagReason,
            })),
            priorFeedback: priorFeedback.map((feedback) => ({
                suggestionId: feedback.suggestionId,
                rating: feedback.rating,
                finalReply: this.truncate(feedback.finalReply || "", 1200),
                notes: this.truncate(feedback.notes || "", 800),
                tags: feedback.tags,
            })),
            approvedLearning: approvedLearning.map((candidate) => ({
                id: candidate.id,
                candidateType: candidate.candidateType,
                listingId: candidate.listingId,
                propertyName: candidate.propertyName,
                topic: candidate.topic,
                proposedText: this.truncate(candidate.proposedText || "", 1200),
                reason: candidate.reason,
                confidence: candidate.confidence,
            })),
            safety: {
                autoSendEnabled: AUTO_SEND_ENABLED,
                autoSendAllowed: false,
                hostBuddySourceUsed: false,
                excludedFields: ["UpSellEntity.internalNotes", "UpSellPropertyConfig.internalNotes", "HostBuddy categories", "HostBuddy action items", "HostBuddy guest issues"],
                sensitiveTerms: SENSITIVE_TERMS,
            },
        };
    }

    private async findClientPropertyForListing(listingId: number | null) {
        if (!listingId) return null;
        return this.clientPropertyRepo.findOne({
            where: [
                { listingId: String(listingId) },
                { hostifyListingId: String(listingId) },
            ],
            relations: ["propertyInfo", "propertyInfo.propertyUpsells", "propertyInfo.propertyParkingInfo"],
        });
    }

    private shapePropertyInfoForGuestContext(propertyInfo: PropertyInfo) {
        return {
            propertyInfoId: propertyInfo.id,
            listingNames: {
                internalListingName: propertyInfo.internalListingName,
                externalListingName: propertyInfo.externalListingName,
            },
            address: propertyInfo.address,
            capacity: {
                personCapacity: propertyInfo.personCapacity,
                bedroomsNumber: propertyInfo.bedroomsNumber,
                bathroomsNumber: propertyInfo.bathroomsNumber,
                guestBathroomsNumber: propertyInfo.guestBathroomsNumber,
            },
            checkInOut: {
                checkInTimeStart: propertyInfo.checkInTimeStart,
                checkInTimeEnd: propertyInfo.checkInTimeEnd,
                checkOutTime: propertyInfo.checkOutTime,
                checkInInstructions: this.truncate(propertyInfo.checkInInstructions || "", 1600),
                checkOutInstructions: this.truncate(propertyInfo.checkOutInstructions || "", 1600),
                allowLuggageDropoffBeforeCheckIn: propertyInfo.allowLuggageDropoffBeforeCheckIn,
            },
            houseRules: {
                allowPartiesAndEvents: propertyInfo.allowPartiesAndEvents,
                allowSmoking: propertyInfo.allowSmoking,
                allowPets: propertyInfo.allowPets,
                petFee: propertyInfo.petFee,
                petFeeType: propertyInfo.petFeeType,
                numberOfPetsAllowed: propertyInfo.numberOfPetsAllowed,
                petRestrictionsNotes: this.truncate(propertyInfo.petRestrictionsNotes || "", 1200),
                otherHouseRules: this.truncate(propertyInfo.otherHouseRules || "", 1200),
                houseRulesText: this.truncate(propertyInfo.houseRulesText || "", 2000),
                houseManualText: this.truncate(propertyInfo.houseManualText || "", 2000),
            },
            access: {
                checkInProcess: propertyInfo.checkInProcess,
                doorLockType: propertyInfo.doorLockType,
                doorLockCodeType: propertyInfo.doorLockCodeType,
                standardDoorCode: propertyInfo.standardDoorCode,
                lockboxLocation: propertyInfo.lockboxLocation,
                lockboxCode: propertyInfo.lockboxCode,
                doorLockInstructions: this.truncate(propertyInfo.doorLockInstructions || "", 1600),
                emergencyBackUpCode: this.truncate(propertyInfo.emergencyBackUpCode || "", 600),
            },
            parking: {
                parkingInstructions: this.truncate(propertyInfo.parkingInstructions || "", 1600),
                parkingRows: (propertyInfo.propertyParkingInfo || []).map((row) => ({
                    parkingType: row.parkingType,
                    parkingFee: row.parkingFee,
                    parkingFeeType: row.parkingFeeType,
                    numberOfParkingSpots: row.numberOfParkingSpots,
                })),
            },
            amenities: {
                amenities: propertyInfo.amenities,
                otherAmenities: this.truncate(propertyInfo.otherAmenities || "", 1200),
                wifiAvailable: propertyInfo.wifiAvailable,
                wifiUsername: propertyInfo.wifiUsername,
                wifiPassword: propertyInfo.wifiPassword,
                wifiSpeed: propertyInfo.wifiSpeed,
                locationOfModem: this.truncate(propertyInfo.locationOfModem || "", 800),
                swimmingPoolNotes: this.truncate(propertyInfo.swimmingPoolNotes || "", 1200),
                hotTubInstructions: this.truncate(propertyInfo.hotTubInstructions || "", 1200),
                hotTubAvailability: propertyInfo.hotTubAvailability,
                firePlaceNotes: this.truncate(propertyInfo.firePlaceNotes || "", 900),
                firepitNotes: this.truncate(propertyInfo.firepitNotes || "", 900),
                gameConsoleNotes: this.truncate(propertyInfo.gameConsoleNotes || "", 900),
                gymNotes: this.truncate(propertyInfo.gymNotes || "", 900),
                saunaNotes: this.truncate(propertyInfo.saunaNotes || "", 900),
            },
            waste: {
                wasteCollectionDays: this.truncate(propertyInfo.wasteCollectionDays || "", 800),
                wasteBinLocation: this.truncate(propertyInfo.wasteBinLocation || "", 800),
                wasteManagementInstructions: this.truncate(propertyInfo.wasteManagementInstructions || "", 1200),
            },
            listingTexts: {
                theSpace: this.truncate(propertyInfo.theSpace || "", 1600),
                theNeighborhood: this.truncate(propertyInfo.theNeighborhood || "", 1600),
                summaryText: this.truncate(propertyInfo.summaryText || "", 1600),
                guestAccessText: this.truncate(propertyInfo.guestAccessText || "", 1600),
                interactionWithGuestsText: this.truncate(propertyInfo.interactionWithGuestsText || "", 1200),
                otherThingsToNoteText: this.truncate(propertyInfo.otherThingsToNoteText || "", 1200),
            },
            additionalServices: {
                additionalServiceNotes: this.truncate(propertyInfo.additionalServiceNotes || "", 1200),
            },
            safetyAmenities: {
                securityCameraLocations: this.truncate(propertyInfo.securityCameraLocations || "", 900),
                carbonMonoxideDetectorLocation: this.truncate(propertyInfo.carbonMonoxideDetectorLocation || "", 600),
                smokeDetectorLocation: this.truncate(propertyInfo.smokeDetectorLocation || "", 600),
                fireExtinguisherLocation: this.truncate(propertyInfo.fireExtinguisherLocation || "", 600),
                firstAidKitLocation: this.truncate(propertyInfo.firstAidKitLocation || "", 600),
                emergencyExitLocation: this.truncate(propertyInfo.emergencyExitLocation || "", 600),
            },
        };
    }

    private async generateAIDecision(context: LLBuddyContext): Promise<AIDecision> {
        const fallback = this.buildFallbackAIDecision(context);
        if (!this.openai) return fallback;

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4.1",
                temperature: 0.2,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content: [
                            "You are LL Buddy, SecureStay's guest messaging assistant.",
                            "Return only valid JSON.",
                            "Suggest replies for human review only. Do not mark anything as auto-sendable.",
                            "Never invent facts. If context is missing, say the team will verify.",
                            "Do not use HostBuddy categories or HostBuddy-generated items.",
                            "Do not use or expose Upsell internal notes; they have been excluded from context.",
                            "Escalate sensitive issues: refunds, discounts, cancellation, legal, safety, medical, police, fire, damage, discrimination, and compensation.",
                        ].join(" "),
                    },
                    {
                        role: "user",
                        content: JSON.stringify({
                            requiredShape: {
                                categoryName: "string",
                                itemType: "action_item | guest_issue | null",
                                priority: "Low | Medium | High | Critical",
                                confidence: "number from 0 to 1",
                                title: "short internal title",
                                reason: "why this classification was selected",
                                warnings: ["safety or policy warnings"],
                                proposedResolution: "internal next step",
                                suggestedReply: "guest-facing draft reply",
                                internalSummary: "internal summary of guest need and evidence used",
                            },
                            context,
                        }),
                    },
                ],
            });
            const content = response.choices?.[0]?.message?.content;
            if (!content) return fallback;
            const parsed = JSON.parse(content);
            return this.normalizeAIDecision(parsed, fallback, "gpt-4.1");
        } catch (error: any) {
            logger.warn(`[LLBuddy] OpenAI suggestion failed; using rules fallback: ${error.message}`);
            return fallback;
        }
    }

    private normalizeAIDecision(parsed: Record<string, any>, fallback: AIDecision, model: string): AIDecision {
        const itemType = parsed.itemType === "action_item" || parsed.itemType === "guest_issue" ? parsed.itemType : null;
        const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map((warning) => String(warning)).filter(Boolean) : fallback.warnings;
        const confidence = Number(parsed.confidence);
        return {
            categoryName: this.truncate(String(parsed.categoryName || fallback.categoryName), 120),
            itemType,
            priority: ["Low", "Medium", "High", "Critical"].includes(parsed.priority) ? parsed.priority : fallback.priority,
            confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : fallback.confidence,
            title: this.truncate(String(parsed.title || fallback.title), 200),
            reason: this.truncate(String(parsed.reason || fallback.reason), 1000),
            warnings,
            proposedResolution: this.truncate(String(parsed.proposedResolution || fallback.proposedResolution), 1600),
            suggestedReply: this.truncate(String(parsed.suggestedReply || fallback.suggestedReply), 4000),
            internalSummary: this.truncate(String(parsed.internalSummary || fallback.internalSummary), 1600),
            model,
            promptVersion: PROMPT_VERSION,
        };
    }

    private buildFallbackAIDecision(context: LLBuddyContext): AIDecision {
        const decision = this.classifyMessage(context.latestMessage.body);
        return {
            ...decision,
            suggestedReply: this.buildSuggestedReplyFromContext(context, decision),
            internalSummary: `Guest asked about ${decision.categoryName.toLowerCase()}. ${decision.reason}`,
            model: "rules-fallback",
            promptVersion: PROMPT_VERSION,
        };
    }

    private classifyMessage(content: string): Decision {
        const text = content.toLowerCase();
        const matched = CATEGORY_RULES.find((rule) => rule.terms.some((term) => text.includes(term)));
        const warnings = SENSITIVE_TERMS.filter((term) => text.includes(term));
        const itemType = matched?.itemType || null;
        const categoryName = matched?.categoryName || "General Reply";

        return {
            categoryName,
            itemType,
            priority: warnings.length ? "High" : matched?.priority || "Low",
            confidence: matched ? (warnings.length ? 0.72 : 0.82) : 0.58,
            title: matched ? `${categoryName}: ${content.slice(0, 80)}` : `Guest reply needed: ${content.slice(0, 80)}`,
            reason: matched ? `Matched ${categoryName} language.` : "No operational issue was confidently detected; reply suggestion only.",
            warnings: warnings.map((term) => `Sensitive topic detected: ${term}`),
            proposedResolution: warnings.length
                ? "Human review required before promising refunds, discounts, policy exceptions, safety actions, or compensation."
                : "Review the guest request, confirm against property knowledge, then reply manually from Inbox.",
        };
    }

    private buildSuggestedReplyFromContext(context: LLBuddyContext, decision: Decision) {
        const guestName = context.reservation?.guestFirstName || context.reservation?.guestName?.split(" ")?.[0] || context.latestMessage.senderName || "there";
        const propertyName = context.reservation?.listingName ? ` for ${context.reservation.listingName}` : "";
        const caution = decision.warnings.length
            ? " I’m going to have our team review this carefully before confirming next steps."
            : " I’ll check the details and follow up with the best next step.";
        return `Hi ${guestName}, thanks for reaching out${propertyName}.${caution}`;
    }

    private buildSourceReferences(communication: GuestCommunicationEntity, reservation: ReservationInfoEntity | null, decision: Decision, context?: LLBuddyContext) {
        return {
            conversation: {
                communicationId: communication.id,
                source: communication.source,
                direction: communication.direction,
                communicatedAt: communication.communicatedAt,
                historyMessageCount: context?.conversationHistory.length || 0,
            },
            reservation: reservation ? {
                reservationId: reservation.id,
                confirmationCode: reservation.confirmation_code || reservation.channelReservationId || reservation.reservationId,
                arrivalDate: reservation.arrivalDate,
                departureDate: reservation.departureDate,
                guestName: reservation.guestName,
            } : null,
            listing: reservation ? {
                listingId: reservation.listingMapId,
                listingName: reservation.listingName,
                checkInTime: reservation.checkInTime,
                checkOutTime: reservation.checkOutTime,
            } : null,
            knowledge: {
                considersAllListingsKnowledgeBase: Boolean(context?.allListingsKnowledge),
                considersListingSubtab: Boolean(context?.listing || context?.allListingsKnowledge?.listingTexts),
                considersUpsellSubtab: Boolean((context?.upsells.propertyUpsells.length || 0) > 0 || (context?.upsells.globalUpsells.length || 0) > 0),
                considersPropertyUpsellConfigs: Boolean((context?.upsells.propertyUpsellConfigs.length || 0) > 0),
                excludesUpsellInternalNote: true,
                approvedLearningCount: context?.approvedLearning.length || 0,
                priorFeedbackCount: context?.priorFeedback.length || 0,
                activeGeneratedItemsCount: context?.activeItems.length || 0,
                excludedFields: context?.safety.excludedFields || ["UpSellEntity.internalNotes", "UpSellPropertyConfig.internalNotes"],
            },
            controlCenter: {
                categoryName: decision.categoryName,
                priority: decision.priority,
                autoSendEnabled: AUTO_SEND_ENABLED,
                autoSendAllowedForSuggestion: false,
            },
        };
    }

    private truncate(value: string, maxLength: number) {
        if (!value) return "";
        return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
    }

    private async createGeneratedItem(
        communication: GuestCommunicationEntity,
        reservation: ReservationInfoEntity | null,
        decision: Decision,
        sourceReferences: Record<string, any>,
        userId: string,
    ) {
        const dedupeKey = `${decision.itemType}:${communication.id}`;
        const existing = await this.itemRepo.findOne({ where: { dedupeKey } });
        if (existing) return existing;

        return this.itemRepo.save(this.itemRepo.create({
            itemType: decision.itemType!,
            reservationId: communication.reservationId,
            listingId: reservation?.listingMapId || Number(communication.metadata?.listingId) || null,
            guestName: reservation?.guestName || communication.senderName || "Guest",
            propertyName: reservation?.listingName || null,
            title: decision.title.slice(0, 200),
            description: communication.content,
            categoryName: decision.categoryName,
            priority: decision.priority,
            status: "New",
            confidence: decision.confidence,
            proposedResolution: decision.proposedResolution,
            flagReason: decision.reason,
            messageIds: [communication.id],
            sourceReferences,
            dedupeKey,
            createdBy: userId,
            updatedBy: userId,
        }));
    }

    private async maybeCreateLearningCandidate(
        communication: GuestCommunicationEntity,
        reservation: ReservationInfoEntity | null,
        decision: Decision,
        sourceReferences: Record<string, any>,
    ) {
        const text = communication.content.trim();
        if (decision.warnings.length || text.length < 40) return null;
        const learningTerms = ["parking", "wifi", "pool", "hot tub", "trash", "checkout", "check-in", "check in"];
        const topic = learningTerms.find((term) => text.toLowerCase().includes(term));
        if (!topic) return null;

        return this.learningRepo.save(this.learningRepo.create({
            candidateType: "property_knowledge",
            listingId: reservation?.listingMapId || Number(communication.metadata?.listingId) || null,
            propertyName: reservation?.listingName || null,
            topic,
            proposedText: `Review and document ${topic} guidance for this property based on the guest conversation.`,
            reason: "Guest asked a property-specific question that may benefit from approved Knowledge Base coverage.",
            confidence: 0.62,
            evidenceCount: 1,
            evidence: { communicationId: communication.id, sourceReferences },
            warnings: [],
            status: "pending",
        }));
    }

    private async createLearningCandidateFromFeedback(
        suggestion: LLBuddySuggestionEntity | null,
        feedback: LLBuddyFeedbackEntity,
    ) {
        if (!suggestion) return null;
        if (!["edited", "accepted_with_edits", "rejected"].includes(feedback.rating)) return null;

        const evidenceKey = `feedback:${feedback.id}`;
        const existing = await this.learningRepo
            .createQueryBuilder("candidate")
            .where("JSON_EXTRACT(candidate.evidence, '$.feedbackId') = :feedbackId", { feedbackId: feedback.id })
            .getOne()
            .catch(() => null);
        if (existing) return null;

        const topic = this.inferLearningTopic([
            suggestion.guestMessage,
            suggestion.suggestedReply,
            feedback.finalReply || "",
            feedback.notes || "",
            (feedback.tags || []).join(" "),
        ].join(" "));

        const warnings = (suggestion.warnings || []).slice();
        const candidateType = suggestion.listingId ? "property_knowledge" : "company_guidance";
        const correctedText = feedback.finalReply || feedback.notes || "";

        return this.learningRepo.save(this.learningRepo.create({
            candidateType,
            listingId: suggestion.listingId || null,
            propertyName: suggestion.propertyName,
            topic,
            proposedText: correctedText
                ? this.truncate(`Staff correction for ${topic}: ${correctedText}`, 3000)
                : this.truncate(`Review ${topic} guidance because staff marked the AI suggestion as ${feedback.rating}.`, 3000),
            reason: "Created from staff feedback. This is evidence only until a reviewer approves or edits it in Learning Review.",
            confidence: feedback.rating === "rejected" ? 0.48 : 0.7,
            evidenceCount: 1,
            evidence: {
                evidenceKey,
                feedbackId: feedback.id,
                suggestionId: suggestion.id,
                communicationId: suggestion.communicationId,
                guestMessage: this.truncate(suggestion.guestMessage || "", 1500),
                aiSuggestion: this.truncate(suggestion.suggestedReply || "", 1500),
                finalReply: this.truncate(feedback.finalReply || "", 1500),
                notes: this.truncate(feedback.notes || "", 1000),
                sourceReferences: suggestion.sourceReferences,
            },
            warnings,
            status: "pending",
        }));
    }

    private inferLearningTopic(text: string) {
        const lower = text.toLowerCase();
        const topics = ["parking", "wifi", "access", "check-in", "checkout", "refund", "pet", "pool", "hot tub", "trash", "maintenance", "cleaning", "upsell", "early check-in", "late checkout"];
        return topics.find((topic) => lower.includes(topic)) || "guest_messaging_guidance";
    }

    private async audit(eventType: string, entityType: string | null, entityId: string | null, summary: string, details: Record<string, any> | null, userId: string) {
        await this.auditRepo.save(this.auditRepo.create({
            eventType,
            entityType,
            entityId,
            summary,
            details,
            createdBy: userId,
        }));
    }
}
