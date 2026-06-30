import { Brackets, In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { Hostify } from "../client/Hostify";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { UsersEntity } from "../entity/Users";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Listing } from "../entity/Listing";

/**
 * Raw Hostify webhook payload for a `message_new` event.
 * (Mirrors HostifyMessagePayload in MessagingServices, kept local to avoid coupling.)
 */
export interface HostifyWebhookMessage {
    thread_id: string | number;
    message_id: number;
    message: string;
    notes?: string | null;
    guest_id?: string | number | null;
    guest_name?: string | null;
    created: string;
    sent_by?: string | null;
    is_automatic?: number;
    is_sms?: boolean | number;
    is_incoming?: number;
    reservation_id?: string | number | null;
    listing_id?: string | number | null;
    attachment_url?: string | null;
    image?: string | null;
    from?: string | null;
    type?: string;
    action?: string;
}

interface SyncOptions {
    maxPages?: number;
    perPage?: number;
    threadId?: string | number;
}

interface ListOptions {
    page?: number;
    perPage?: number;
    keyword?: string;
    channel?: string;
    unreadOnly?: boolean;
}

const toNumberOrNull = (value: any): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const toDateOrNull = (value: any): Date | null => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

const toDateKey = (value: any): string | null => {
    const d = toDateOrNull(value);
    if (!d) return null;
    return d.toISOString().slice(0, 10);
};

export class InboxService {
    private conversationRepo = appDatabase.getRepository(InboxConversationEntity);
    private messageRepo = appDatabase.getRepository(InboxMessageEntity);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private hostify = new Hostify();

    private get apiKey(): string {
        return process.env.HOSTIFY_API_KEY as string;
    }

    /**
     * Map a Hostify `from` value to our normalized direction.
     * Guest messages are incoming; everything else (host/automatic/system) is outgoing.
     */
    private resolveDirection(from?: string | null, isIncoming?: number): string {
        if (typeof isIncoming === "number") {
            return isIncoming === 1 ? "incoming" : "outgoing";
        }
        return String(from || "").toLowerCase() === "guest" ? "incoming" : "outgoing";
    }

    // -------------------------------------------------------------------------
    // Conversation upsert (from a Hostify thread summary)
    // -------------------------------------------------------------------------
    private async upsertConversationFromSummary(summary: any, syncedAt = new Date()) {
        const threadId = toNumberOrNull(summary?.id);
        if (!threadId) return null;

        let conversation = await this.conversationRepo.findOne({ where: { threadId } });
        if (!conversation) {
            conversation = this.conversationRepo.create({ threadId });
        }

        conversation.reservationId = toNumberOrNull(summary?.reservation_id);
        conversation.listingId = toNumberOrNull(summary?.listing_id);
        conversation.guestId = toNumberOrNull(summary?.guest_id);
        conversation.guestName = summary?.guest_name ?? conversation.guestName ?? null;
        conversation.guestPhone = summary?.guest_phone != null ? String(summary.guest_phone) : conversation.guestPhone ?? null;
        conversation.guestEmail = summary?.guest_email ?? conversation.guestEmail ?? null;
        conversation.channel = summary?.integration_type_name ?? conversation.channel ?? null;
        conversation.listingName = summary?.listing ?? summary?.listing_title ?? conversation.listingName ?? null;
        conversation.lastMessageText = summary?.preview ?? conversation.lastMessageText ?? null;
        conversation.lastMessageAt = toDateOrNull(summary?.last_message) ?? conversation.lastMessageAt ?? null;
        conversation.answered = summary?.answered ? 1 : 0;
        conversation.unread = summary?.channel_unread ? 1 : 0;
        conversation.isArchived = summary?.is_archived ? 1 : 0;
        conversation.nights = toNumberOrNull(summary?.nights);
        conversation.guests = toNumberOrNull(summary?.guests);
        conversation.checkin = toDateKey(summary?.checkin) ?? conversation.checkin ?? null;
        conversation.checkout = toDateKey(summary?.checkout) ?? conversation.checkout ?? null;
        conversation.price = toNumberOrNull(summary?.price);
        conversation.currency = summary?.currency ?? conversation.currency ?? null;
        conversation.reservationStatus = summary?.reservation_status ?? conversation.reservationStatus ?? null;
        conversation.guestThumb = summary?.guest_picture ?? summary?.guest_thumb ?? conversation.guestThumb ?? null;
        conversation.listingThumb = summary?.listing_thumb ?? conversation.listingThumb ?? null;
        conversation.source = "hostify";
        conversation.syncedAt = syncedAt;

        return this.conversationRepo.save(conversation);
    }

    /**
     * Enrich a conversation row with locally-known reservation/listing data
     * (guest name, booking cost, dates, channel) when Hostify omits it.
     */
    private async enrichConversation(conversation: InboxConversationEntity) {
        try {
            const reservation = conversation.reservationId
                ? await this.reservationRepo.findOne({ where: { id: conversation.reservationId } })
                : null;
            const listingId = conversation.listingId || reservation?.listingMapId || null;
            const listing = listingId
                ? await this.listingRepo.findOne({ where: { id: Number(listingId) }, withDeleted: true })
                : null;

            if (reservation) {
                conversation.guestName = conversation.guestName || reservation.guestName || null;
                conversation.guestPhone = conversation.guestPhone || (reservation.phone ?? null);
                conversation.guestEmail = conversation.guestEmail || (reservation.guestEmail ?? null);
                conversation.reservationStatus = conversation.reservationStatus || reservation.status || null;
                conversation.checkin = conversation.checkin || toDateKey(reservation.arrivalDate);
                conversation.checkout = conversation.checkout || toDateKey(reservation.departureDate);
                if (conversation.price == null && reservation.totalPrice != null) {
                    conversation.price = Number(reservation.totalPrice);
                }
            }
            if (listing) {
                conversation.listingName =
                    conversation.listingName || listing.internalListingName || listing.name || null;
            }
        } catch (error: any) {
            logger.warn(`[InboxService] enrichConversation failed for thread ${conversation.threadId}: ${error.message}`);
        }
        return conversation;
    }

    // -------------------------------------------------------------------------
    // Message upsert (from a Hostify thread-detail message or webhook payload)
    // -------------------------------------------------------------------------
    private buildMessageFromHostify(
        raw: any,
        ctx: { threadId: number; reservationId: number | null; listingId: number | null; channel: string | null }
    ): InboxMessageEntity | null {
        const externalId = toNumberOrNull(raw?.id ?? raw?.message_id);
        if (!externalId) return null;

        const from = raw?.from ?? null;
        const direction = this.resolveDirection(from, raw?.is_incoming);
        // Sender name lives in different fields depending on source:
        //  - incoming (guest): `guest_name`
        //  - outgoing webhook payload: `sent_by` (rep), while `guest_name` is the guest
        //  - outgoing thread-detail: `guest_name` holds the rep name (no `sent_by`)
        const senderName =
            direction === "incoming"
                ? raw?.guest_name ?? raw?.sender_name ?? null
                : raw?.sent_by ?? raw?.sender_name ?? raw?.guest_name ?? null;
        const message = this.messageRepo.create({
            externalId,
            threadId: ctx.threadId,
            reservationId: ctx.reservationId,
            listingId: ctx.listingId,
            body: raw?.message ?? null,
            note: raw?.notes ?? null,
            direction,
            senderType: from ? String(from).toLowerCase() : direction === "incoming" ? "guest" : "host",
            senderName,
            isAutomatic: raw?.is_automatic ? 1 : 0,
            isSms: raw?.is_sms ? 1 : 0,
            channel: ctx.channel,
            attachmentUrl: raw?.attachment_url ?? raw?.image ?? null,
            guestId: toNumberOrNull(raw?.guest_id),
            sentAt: toDateOrNull(raw?.created) ?? new Date(),
            sentByUserId: null,
            sentByName: null,
            sentVia: "sync",
            source: "hostify",
        });
        return message;
    }

    /**
     * Idempotently persist a batch of Hostify messages for a thread.
     * Existing rows (matched by externalId) are skipped to preserve any local
     * attribution we may already have recorded.
     */
    private async saveMessages(messages: InboxMessageEntity[]) {
        if (!messages.length) return 0;
        const externalIds = messages.map((m) => m.externalId);
        const existing = await this.messageRepo.find({
            where: { externalId: In(externalIds) },
            select: ["externalId"],
        });
        const existingIds = new Set(existing.map((m) => Number(m.externalId)));
        const toInsert = messages.filter((m) => !existingIds.has(Number(m.externalId)));
        if (!toInsert.length) return 0;
        await this.messageRepo.save(toInsert, { chunk: 200 });
        return toInsert.length;
    }

    /**
     * Reconcile locally-sent replies with the canonical Hostify message.
     *
     * When we send from the v2 inbox we insert an immediately-visible row with a
     * synthetic negative externalId (Hostify's reply endpoint may not echo the
     * real id). On the next sync that same message comes back from Hostify with
     * its real id; without reconciliation we'd store it twice. Here we adopt the
     * real id onto our attributed local row so the later insert is skipped.
     */
    private async reconcileOutgoing(threadId: number, rawMessages: any[]) {
        const pending = await this.messageRepo.find({
            where: { threadId, sentVia: "inbox_v2" },
        });
        const synthetic = pending.filter((m) => Number(m.externalId) < 0);
        if (!synthetic.length) return;

        for (const local of synthetic) {
            const match = rawMessages.find((raw) => {
                const from = String(raw?.from || "").toLowerCase();
                const isOutgoing = from && from !== "guest";
                const sameBody =
                    (raw?.message || "").trim() === (local.body || "").trim();
                const realId = toNumberOrNull(raw?.id);
                return isOutgoing && sameBody && realId && realId > 0;
            });
            if (match) {
                local.externalId = toNumberOrNull(match.id) as number;
                await this.messageRepo.save(local);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Webhook ingestion — persist a single message (any direction)
    // -------------------------------------------------------------------------
    async ingestWebhookMessage(payload: HostifyWebhookMessage) {
        const threadId = toNumberOrNull(payload?.thread_id);
        const externalId = toNumberOrNull(payload?.message_id);
        if (!threadId || !externalId) {
            logger.warn("[InboxService] ingestWebhookMessage missing thread_id/message_id");
            return null;
        }

        // Ensure a conversation row exists (best-effort enrichment from Hostify summary).
        let conversation = await this.conversationRepo.findOne({ where: { threadId } });
        if (!conversation) {
            conversation = this.conversationRepo.create({
                threadId,
                reservationId: toNumberOrNull(payload?.reservation_id),
                listingId: toNumberOrNull(payload?.listing_id),
                guestId: toNumberOrNull(payload?.guest_id),
                guestName: payload?.guest_name ?? null,
                source: "hostify",
            });
            conversation = await this.enrichConversation(conversation);
        }

        // Roll the conversation summary forward.
        conversation.lastMessageText = payload?.message ?? conversation.lastMessageText ?? null;
        conversation.lastMessageAt = toDateOrNull(payload?.created) ?? new Date();
        if (this.resolveDirection(payload?.from, payload?.is_incoming) === "incoming") {
            conversation.unread = 1;
            conversation.answered = 0;
        } else {
            conversation.answered = 1;
        }
        await this.conversationRepo.save(conversation);

        const existing = await this.messageRepo.findOne({ where: { externalId } });
        if (existing) {
            logger.info(`[InboxService] webhook message ${externalId} already stored`);
            return existing;
        }

        const message = this.buildMessageFromHostify(payload, {
            threadId,
            reservationId: conversation.reservationId,
            listingId: conversation.listingId,
            channel: conversation.channel,
        });
        if (!message) return null;
        message.sentVia = "webhook";
        const saved = await this.messageRepo.save(message);
        logger.info(`[InboxService] webhook stored message ${externalId} (thread ${threadId}, ${message.direction})`);
        return saved;
    }

    // -------------------------------------------------------------------------
    // Backfill / sync from the Hostify API
    // -------------------------------------------------------------------------
    /**
     * Pull threads (and optionally full message history) from Hostify into the
     * local tables. Safe to re-run: conversations are upserted and messages are
     * inserted only when new.
     */
    async syncFromHostify(options: SyncOptions = {}) {
        const perPage = options.perPage ?? 50;
        const maxPages = options.maxPages ?? 40;
        const syncedAt = new Date();

        let processedThreads = 0;
        let insertedMessages = 0;

        // Single-thread sync (used after sending a reply, or targeted refresh).
        if (options.threadId) {
            const result = await this.syncThread(options.threadId, syncedAt);
            return { threads: result ? 1 : 0, messages: result?.inserted ?? 0 };
        }

        for (let page = 1; page <= maxPages; page++) {
            const { threads } = await this.hostify.listInboxThreads(this.apiKey, page, perPage);
            if (!threads || threads.length === 0) break;

            for (const summary of threads) {
                try {
                    const conversation = await this.upsertConversationFromSummary(summary, syncedAt);
                    if (!conversation) continue;
                    await this.enrichConversation(conversation);
                    await this.conversationRepo.save(conversation);
                    processedThreads++;

                    const detail = await this.hostify.getInboxThread(this.apiKey, String(summary.id));
                    const rawMessages: any[] = (detail as any)?.messages || [];
                    await this.reconcileOutgoing(conversation.threadId, rawMessages);
                    const built = rawMessages
                        .map((m) =>
                            this.buildMessageFromHostify(m, {
                                threadId: conversation.threadId,
                                reservationId: conversation.reservationId,
                                listingId: conversation.listingId,
                                channel: conversation.channel,
                            })
                        )
                        .filter((m): m is InboxMessageEntity => m !== null);
                    insertedMessages += await this.saveMessages(built);
                } catch (error: any) {
                    logger.error(`[InboxService] sync failed for thread ${summary?.id}: ${error.message}`);
                }
            }

            if (threads.length < perPage) break;
        }

        logger.info(`[InboxService] sync complete: ${processedThreads} threads, ${insertedMessages} new messages`);
        return { threads: processedThreads, messages: insertedMessages };
    }

    private async syncThread(threadId: string | number, syncedAt = new Date()) {
        const detail = await this.hostify.getInboxThread(this.apiKey, String(threadId));
        if (!detail) return null;
        const threadSummary = (detail as any)?.thread || {};
        const numericThreadId = toNumberOrNull(threadSummary?.id ?? threadId);
        if (!numericThreadId) return null;

        let conversation = await this.conversationRepo.findOne({ where: { threadId: numericThreadId } });
        if (!conversation) {
            conversation = this.conversationRepo.create({ threadId: numericThreadId, source: "hostify" });
        }
        conversation.reservationId = toNumberOrNull(threadSummary?.reservation_id) ?? conversation.reservationId;
        conversation.listingId = toNumberOrNull(threadSummary?.listing_id) ?? conversation.listingId;
        conversation.guestId = toNumberOrNull(threadSummary?.guest_id) ?? conversation.guestId;
        conversation.channel = threadSummary?.integration_type_name ?? conversation.channel;
        conversation.answered = threadSummary?.answered ? 1 : conversation.answered;
        conversation.lastMessageText = threadSummary?.preview ?? conversation.lastMessageText;
        conversation.lastMessageAt = toDateOrNull(threadSummary?.last_message) ?? conversation.lastMessageAt;
        conversation.syncedAt = syncedAt;
        await this.enrichConversation(conversation);
        await this.conversationRepo.save(conversation);

        const rawMessages: any[] = (detail as any)?.messages || [];
        await this.reconcileOutgoing(conversation.threadId, rawMessages);
        const built = rawMessages
            .map((m) =>
                this.buildMessageFromHostify(m, {
                    threadId: conversation.threadId,
                    reservationId: conversation.reservationId,
                    listingId: conversation.listingId,
                    channel: conversation.channel,
                })
            )
            .filter((m): m is InboxMessageEntity => m !== null);
        const inserted = await this.saveMessages(built);
        return { conversation, inserted };
    }

    // -------------------------------------------------------------------------
    // Reads (local DB) for the v2 inbox UI
    // -------------------------------------------------------------------------
    async listConversations(options: ListOptions = {}) {
        const page = Math.max(options.page ?? 1, 1);
        const perPage = Math.min(Math.max(options.perPage ?? 30, 1), 100);

        const qb = this.conversationRepo
            .createQueryBuilder("c")
            .where("c.isArchived = 0");

        if (options.channel) {
            qb.andWhere("c.channel = :channel", { channel: options.channel });
        }
        if (options.unreadOnly) {
            qb.andWhere("c.unread = 1");
        }
        if (options.keyword) {
            const kw = `%${options.keyword.trim()}%`;
            qb.andWhere(
                new Brackets((b) => {
                    b.where("c.guestName LIKE :kw", { kw })
                        .orWhere("c.guestPhone LIKE :kw", { kw })
                        .orWhere("c.listingName LIKE :kw", { kw })
                        .orWhere("c.lastMessageText LIKE :kw", { kw });
                })
            );
        }

        qb.orderBy("c.lastMessageAt", "DESC")
            .skip((page - 1) * perPage)
            .take(perPage);

        const [conversations, total] = await qb.getManyAndCount();
        return { conversations, total, page, perPage };
    }

    async getConversation(threadId: number) {
        const conversation = await this.conversationRepo.findOne({ where: { threadId } });
        if (!conversation) return null;

        const messages = await this.messageRepo.find({
            where: { threadId },
            order: { sentAt: "ASC", id: "ASC" },
        });

        // Mark as read locally on open.
        if (conversation.unread) {
            conversation.unread = 0;
            await this.conversationRepo.save(conversation);
        }

        return { conversation, messages };
    }

    // -------------------------------------------------------------------------
    // Outgoing reply: send to Hostify, then persist locally with attribution
    // -------------------------------------------------------------------------
    async sendReply(threadId: number, body: string, user: any) {
        const conversation = await this.conversationRepo.findOne({ where: { threadId } });
        if (!conversation) {
            throw new Error(`Conversation ${threadId} not found`);
        }

        // 1) Deliver to the guest via Hostify.
        const hostifyResult = await this.hostify.postInboxReply(this.apiKey, threadId, body);

        // 2) Resolve the internal sender for attribution.
        const { userId, userName } = await this.resolveSender(user);

        // 3) Persist the outgoing message locally. Hostify may not echo a message
        //    id synchronously, so fall back to a negative synthetic id keyed to time.
        const externalId =
            toNumberOrNull(hostifyResult?.message?.id ?? hostifyResult?.id) ?? -Date.now();

        const message = this.messageRepo.create({
            externalId,
            threadId,
            reservationId: conversation.reservationId,
            listingId: conversation.listingId,
            body,
            note: null,
            direction: "outgoing",
            senderType: "host",
            senderName: userName,
            isAutomatic: 0,
            isSms: 0,
            channel: conversation.channel,
            attachmentUrl: null,
            guestId: conversation.guestId,
            sentAt: new Date(),
            sentByUserId: userId,
            sentByName: userName,
            sentVia: "inbox_v2",
            source: "hostify",
        });
        const saved = await this.messageRepo.save(message);

        conversation.lastMessageText = body;
        conversation.lastMessageAt = saved.sentAt;
        conversation.answered = 1;
        conversation.unread = 0;
        await this.conversationRepo.save(conversation);

        // Best-effort: reconcile the real Hostify message id/history shortly after.
        this.syncThread(threadId).catch((err) =>
            logger.warn(`[InboxService] post-reply resync failed for thread ${threadId}: ${err.message}`)
        );

        return saved;
    }

    private async resolveSender(user: any): Promise<{ userId: number | null; userName: string | null }> {
        const secureStayUserId = toNumberOrNull(user?.secureStayUserId ?? user?.id);
        let userName: string | null =
            user?.user_metadata?.full_name ||
            user?.user_metadata?.name ||
            user?.name ||
            null;

        if (secureStayUserId) {
            try {
                const dbUser = await this.usersRepo.findOne({ where: { id: secureStayUserId } });
                if (dbUser) {
                    const full = `${dbUser.firstName || ""} ${dbUser.lastName || ""}`.trim();
                    userName = full || userName || dbUser.email || null;
                }
            } catch {
                /* ignore */
            }
        }
        return { userId: secureStayUserId, userName };
    }
}
