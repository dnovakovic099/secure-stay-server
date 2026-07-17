import { Brackets, In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { Hostify } from "../client/Hostify";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { UsersEntity } from "../entity/Users";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Listing } from "../entity/Listing";
import { ListingGroupMapEntity } from "../entity/ListingGroupMap";
import { ListingService } from "./ListingService";
import { ListingGroupService } from "./ListingGroupService";

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
    searchFields?: string | string[];
    channel?: string | string[];
    unreadOnly?: boolean;
    /** Quick day filters: guests checking in / checking out today. */
    arrival?: "checkin_today" | "checkout_today" | string;
    /** Check-in date window (YYYY-MM-DD). Same value in both = exact date. */
    checkinFrom?: string;
    checkinTo?: string;
    checkoutFrom?: string;
    checkoutTo?: string;
    /** Listing tag bucket: "PM" | "Arb" | "Own" (from listing_info tags). */
    propertyType?: string | string[];
    serviceType?: string | string[];
    portfolio?: string | string[];
    listingId?: string | string[];
    stayTiming?: string;
    lastMessageFrom?: string | string[];
    repliedBy?: string | string[];
    unresponded?: boolean | string;
    dateType?: string;
    dateFrom?: string;
    dateTo?: string;
    /** Reservation status bucket: "inquiry" | "confirmed" | "cancelled". */
    reservationStatus?: string | string[];
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

const parseListParam = (value: any): string[] => {
    if (Array.isArray(value)) return value.flatMap(parseListParam);
    return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
};

const toDateKey = (value: any): string | null => {
    const d = toDateOrNull(value);
    if (!d) return null;
    return d.toISOString().slice(0, 10);
};

const isLikelySenderId = (value: any) => /^\d+$/.test(String(value || "").trim());

const firstDisplayName = (...values: any[]) => {
    for (const value of values) {
        const text = String(value || "").trim();
        if (text && !isLikelySenderId(text)) return text;
    }
    return null;
};

const extractAttachmentUrls = (raw: any): string[] => {
    const urls: string[] = [];
    const push = (value: any) => {
        if (typeof value !== "string") return;
        const url = value.trim();
        if (!url) return;
        if (!urls.includes(url)) urls.push(url);
    };
    push(raw?.attachment_url);
    push(raw?.image);
    if (Array.isArray(raw?.attachments)) {
        for (const attachment of raw.attachments) {
            if (typeof attachment === "string") {
                push(attachment);
            } else if (attachment && typeof attachment === "object") {
                push(attachment.url || attachment.attachment_url || attachment.src || attachment.file || attachment.fileUrl);
            }
        }
    }
    if (Array.isArray(raw?.images)) {
        for (const image of raw.images) {
            if (typeof image === "string") push(image);
            else if (image && typeof image === "object") push(image.url || image.src);
        }
    }
    return urls;
};

const pickFirstAttachmentUrl = (raw: any): string | null => {
    const [first] = extractAttachmentUrls(raw);
    return first ?? null;
};

// Split listing tags into normalized tokens so classification uses whole-word
// matches — otherwise "pm" collides with "compare"/"impact" and "arb" with
// "harbor". Tags come from Hostify comma-separated (e.g. "PM, Full, G1").
const tagTokens = (...values: (string | null | undefined)[]): Set<string> => {
    const bag = new Set<string>();
    for (const value of values) {
        if (!value) continue;
        String(value)
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean)
            .forEach((token) => bag.add(token));
    }
    return bag;
};

export class InboxService {
    /** 5-minute cache for the filter dropdown options (see getFilterOptions). */
    private static filterOptionsCache: { at: number; channels: string[]; repliedByUsers: string[] } | null = null;

    private conversationRepo = appDatabase.getRepository(InboxConversationEntity);
    private messageRepo = appDatabase.getRepository(InboxMessageEntity);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private listingService = new ListingService();
    private listingGroupService = new ListingGroupService();
    private hostify = new Hostify();

    private get apiKey(): string {
        return process.env.HOSTIFY_API_KEY as string;
    }

    /**
     * Map a Hostify `from` value to our normalized direction.
     * "system" events (e.g. pre-approval expired) preserve their own bucket so
     * the UI can render them as a centered system notice; guest messages are
     * incoming; everything else (host/automatic) is outgoing.
     */
    private resolveDirection(from?: string | null, isIncoming?: number, isAutomatic?: number): string {
        const fromKey = String(from || "").toLowerCase();
        if (fromKey === "system") return "system";
        // Hostify auto-messages sometimes come through with is_incoming=1 or an
        // unexpected `from` value even though they were sent BY us — treat any
        // is_automatic=1 row as outgoing so the welcome/checkin templates land
        // on the correct side of the thread.
        if (Number(isAutomatic) === 1) return "outgoing";
        if (typeof isIncoming === "number") {
            return isIncoming === 1 ? "incoming" : "outgoing";
        }
        return fromKey === "guest" ? "incoming" : "outgoing";
    }

    private normalizePropertyTypeValue(listing: Listing | null | undefined) {
        const tokens = tagTokens(listing?.tags, listing?.propertyType);
        if (tokens.has("own")) return "Own";
        if (tokens.has("arb")) return "Arb";
        if (tokens.has("pm")) return "PM";
        return null;
    }

    private normalizeServiceTypeValue(listing: Listing | null | undefined, normalizedListing?: any) {
        const tokens = tagTokens(listing?.tags, normalizedListing?.serviceType);
        if (tokens.has("full")) return "Full";
        if (tokens.has("pro")) return "Pro";
        if (tokens.has("launch")) return "Launch";
        return null;
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

        // Never clobber known ids with null — Hostify thread summaries are
        // sparse for inquiries and can omit listing_id/reservation_id that a
        // previous webhook hydrate already resolved.
        conversation.reservationId = toNumberOrNull(summary?.reservation_id) ?? conversation.reservationId ?? null;
        conversation.listingId = toNumberOrNull(summary?.listing_id) ?? conversation.listingId ?? null;
        conversation.guestId = toNumberOrNull(summary?.guest_id) ?? conversation.guestId ?? null;
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

    /**
     * For threads where local data is missing (typically new inquiries or
     * bookings we haven't synced yet), pull details straight from Hostify:
     *  - reservation info (guest contact, dates, price, status) when we have a
     *    reservationId but no local reservation row;
     *  - listing name from the listing details when still unknown.
     * Best-effort and non-fatal.
     */
    private async hydrateFromHostifyReservation(conversation: InboxConversationEntity) {
        try {
            if (!this.apiKey) return conversation;

            const missingGuest = !conversation.guestName || !conversation.checkin || conversation.price == null;
            if (conversation.reservationId && missingGuest) {
                const res: any = await this.hostify.getReservationInfo(this.apiKey, Number(conversation.reservationId));
                const r = res?.reservation ?? res?.data ?? res ?? null;
                if (r) {
                    conversation.guestName = conversation.guestName || r.guest_name || r.name || null;
                    conversation.guestPhone = conversation.guestPhone || (r.phone != null ? String(r.phone) : null);
                    conversation.guestEmail = conversation.guestEmail || r.email || r.guest_email || null;
                    conversation.reservationStatus = conversation.reservationStatus || r.status || null;
                    conversation.checkin = conversation.checkin || toDateKey(r.checkIn ?? r.checkin ?? r.arrival_date);
                    conversation.checkout = conversation.checkout || toDateKey(r.checkOut ?? r.checkout ?? r.departure_date);
                    conversation.nights = conversation.nights ?? toNumberOrNull(r.nights);
                    conversation.guests = conversation.guests ?? toNumberOrNull(r.guests);
                    if (conversation.price == null) conversation.price = toNumberOrNull(r.price ?? r.total_price);
                    conversation.currency = conversation.currency || r.currency || null;
                    conversation.listingId = conversation.listingId ?? toNumberOrNull(r.listing_id);
                    conversation.guestId = conversation.guestId ?? toNumberOrNull(r.guest_id);
                }
            }

            // Guest name/contact usually lives ONLY on the Hostify guest record.
            // Reservations and thread summaries carry a guest_id but no name —
            // especially for new/manual bookings we message first (which is why
            // those threads show "Unknown guest"). Resolve it explicitly.
            if (conversation.guestId && (!conversation.guestName || !conversation.guestPhone || !conversation.guestEmail)) {
                const guest: any = await this.hostify.getGuest(this.apiKey, conversation.guestId);
                if (guest) {
                    const fullName =
                        guest.name ||
                        [guest.first_name, guest.last_name].filter(Boolean).join(" ").trim() ||
                        null;
                    conversation.guestName = conversation.guestName || fullName || null;
                    conversation.guestPhone = conversation.guestPhone || (guest.phone != null ? String(guest.phone) : null);
                    conversation.guestEmail = conversation.guestEmail || guest.email || null;
                    conversation.guestThumb = conversation.guestThumb || guest.picture || guest.thumbnail_url || null;
                }
            }

            if (conversation.listingId && !conversation.listingName) {
                const details: any = await this.hostify.getListingDetails(this.apiKey, String(conversation.listingId));
                const l = details?.listing ?? details?.data ?? details ?? null;
                if (l) conversation.listingName = l.nickname || l.name || l.title || conversation.listingName || null;
            }
        } catch (error: any) {
            logger.warn(`[InboxService] hydrateFromHostifyReservation failed for thread ${conversation.threadId}: ${error.message}`);
        }
        return conversation;
    }

    // -------------------------------------------------------------------------
    // Message upsert (from a Hostify thread-detail message or webhook payload)
    // -------------------------------------------------------------------------
    private buildMessageFromHostify(
        raw: any,
        ctx: { threadId: number; reservationId: number | null; listingId: number | null; channel: string | null; }
    ): InboxMessageEntity | null {
        const externalId = toNumberOrNull(raw?.id ?? raw?.message_id);
        if (!externalId) return null;

        const from = raw?.from ?? null;
        const direction = this.resolveDirection(from, raw?.is_incoming, raw?.is_automatic);
        // Sender name lives in different fields depending on source:
        //  - incoming (guest): `guest_name`
        //  - outgoing webhook payload: `sent_by` (rep), while `guest_name` is the guest
        //  - outgoing thread-detail: `guest_name` holds the rep name (no `sent_by`)
        const senderName =
            direction === "incoming"
                ? firstDisplayName(raw?.guest_name, raw?.sender_name, raw?.sender)
                : firstDisplayName(raw?.user_name, raw?.sender_name, raw?.sender, raw?.sent_by);
        // Hostify exposes attachments in several shapes: a single `attachment_url`
        // (older webhook payloads), an `image` field, or an `attachments[]` /
        // `images[]` array (thread-detail responses can carry multiple photos on
        // one message). Pick the first URL we can find so the thread renders at
        // least one image; the full list is preserved for the frontend via the
        // extractAttachmentUrls() helper below.
        const attachmentUrl = pickFirstAttachmentUrl(raw);
        const message = this.messageRepo.create({
            externalId,
            threadId: ctx.threadId,
            reservationId: ctx.reservationId,
            listingId: ctx.listingId,
            body: raw?.message ?? null,
            note: raw?.notes ?? raw?.note ?? raw?.internal_note ?? null,
            direction,
            senderType: from ? String(from).toLowerCase() : direction === "incoming" ? "guest" : "host",
            senderName,
            isAutomatic: raw?.is_automatic ? 1 : 0,
            isSms: raw?.is_sms ? 1 : 0,
            channel: ctx.channel,
            attachmentUrl,
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
            select: [
                "id",
                "externalId",
                "direction",
                "senderType",
                "senderName",
                "note",
                "attachmentUrl",
                "isAutomatic",
                "sentVia",
            ],
        });
        const existingIds = new Set(existing.map((m) => Number(m.externalId)));
        const existingByExternalId = new Map(existing.map((m) => [Number(m.externalId), m]));
        const toUpdate = messages.flatMap((incoming) => {
            const existingMessage = existingByExternalId.get(Number(incoming.externalId));
            if (!existingMessage) return [];
            let changed = false;

            if (
                incoming.senderName &&
                (!existingMessage.senderName || isLikelySenderId(existingMessage.senderName))
            ) {
                existingMessage.senderName = incoming.senderName;
                changed = true;
            }
            if (incoming.note && !existingMessage.note) {
                existingMessage.note = incoming.note;
                changed = true;
            }
            if (incoming.attachmentUrl && !existingMessage.attachmentUrl) {
                existingMessage.attachmentUrl = incoming.attachmentUrl;
                changed = true;
            }
            // Repair rows written by the old resolveDirection (which mapped
            // Hostify's `system` events and mis-flagged auto-messages to
            // "outgoing"/"incoming" respectively). Only overwrite when the row
            // came from a Hostify sync — never touch locally-attributed sends.
            const locallyAttributed = existingMessage.sentVia === "inbox_v2" || existingMessage.sentVia === "ai_auto";
            if (!locallyAttributed && incoming.direction && incoming.direction !== existingMessage.direction) {
                existingMessage.direction = incoming.direction;
                if (incoming.senderType) existingMessage.senderType = incoming.senderType;
                changed = true;
            }
            if (!locallyAttributed && incoming.isAutomatic && !existingMessage.isAutomatic) {
                existingMessage.isAutomatic = incoming.isAutomatic;
                changed = true;
            }
            return changed ? [existingMessage] : [];
        });
        if (toUpdate.length) {
            await this.messageRepo.save(toUpdate, { chunk: 200 });
        }
        const toInsert = messages.filter((m) => !existingIds.has(Number(m.externalId)));
        if (!toInsert.length) return 0;
        // INSERT IGNORE: a webhook delivery can store one of these messages
        // between our exists-check and this insert (check-then-insert race
        // across cluster workers) — losing that race must not fail the sync.
        const result = await this.messageRepo
            .createQueryBuilder()
            .insert()
            .values(toInsert)
            .orIgnore()
            .execute();
        return result.raw?.affectedRows ?? toInsert.length;
    }

    /**
     * Reconcile locally-sent replies with the canonical Hostify message.
     *
     * When we send from the v2 inbox (or the AI auto-responder) we insert an
     * immediately-visible row with a synthetic negative externalId — Hostify's
     * reply endpoint sometimes doesn't echo the real message id. On the next
     * sync the same message comes back from Hostify with its real id; without
     * reconciliation we'd store it twice, showing the guest the same reply as a
     * duplicate bubble (see: automated welcome messages appearing twice in the
     * thread). Here we adopt the real id onto our attributed local row so the
     * later insert is skipped by `saveMessages`.
     *
     * We also match automated Hostify rows against our own ai_auto rows even
     * when the local row already has a positive externalId — Hostify's message
     * id for auto-sends can differ from the one returned by its reply endpoint,
     * so we compare body + timestamp and adopt the sync-provided id.
     */
    private async reconcileOutgoing(threadId: number, rawMessages: any[]) {
        const pending = await this.messageRepo.find({
            where: { threadId, sentVia: In(["inbox_v2", "ai_auto"]) },
        });
        if (!pending.length) return;

        const bodyKey = (value: string | null | undefined) =>
            (value || "").replace(/\s+/g, " ").trim().toLowerCase();

        for (const local of pending) {
            const localKey = bodyKey(local.body);
            if (!localKey) continue;
            const isSynthetic = Number(local.externalId) < 0;
            const isAuto = local.sentVia === "ai_auto" || Number(local.isAutomatic) === 1;
            // Automated rows may already have a Hostify id from the reply
            // endpoint, but the thread-detail sync sometimes returns a
            // different id for the SAME message (Hostify assigns ids at
            // delivery, not at accept). Allow reconciling those too, matched
            // by body and a ~2-minute send-time window.
            if (!isSynthetic && !isAuto) continue;

            const localSentAt = local.sentAt ? new Date(local.sentAt).getTime() : null;
            const match = rawMessages.find((raw) => {
                const from = String(raw?.from || "").toLowerCase();
                const isOutgoing = from ? from !== "guest" : Number(raw?.is_incoming) === 0;
                if (!isOutgoing) return false;
                if (bodyKey(raw?.message) !== localKey) return false;
                const realId = toNumberOrNull(raw?.id ?? raw?.message_id);
                if (!realId || realId <= 0) return false;
                if (Number(local.externalId) === realId) return false;
                if (!isSynthetic) {
                    // For non-synthetic rows only reconcile if we're the auto
                    // sender AND the sync row is also flagged automatic, to
                    // avoid accidentally collapsing a rep-sent duplicate.
                    if (Number(raw?.is_automatic) !== 1) return false;
                    if (localSentAt) {
                        const rawSentAt = raw?.created ? new Date(raw.created).getTime() : null;
                        if (rawSentAt && Math.abs(rawSentAt - localSentAt) > 2 * 60 * 1000) return false;
                    }
                }
                return true;
            });
            if (match) {
                local.externalId = toNumberOrNull(match.id ?? match.message_id) as number;
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

        // Ensure a conversation row exists.
        let conversation = await this.conversationRepo.findOne({ where: { threadId } });
        const isNew = !conversation;
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

        // New inquiries arrive via webhook with almost no detail ("Unknown guest /
        // No listing linked"). Pull the full thread from Hostify so the guest,
        // listing, dates, price and reservation panel are populated. Best-effort.
        const missingCore = !conversation.guestName || !conversation.listingId || !conversation.listingName;
        if (isNew || missingCore) {
            try {
                const syn = await this.syncThread(threadId);
                if (syn?.conversation) conversation = syn.conversation;
            } catch (err: any) {
                logger.warn(`[InboxService] webhook hydrate failed for thread ${threadId}: ${err.message}`);
            }
        }

        // Roll the conversation summary forward.
        conversation.lastMessageText = payload?.message ?? conversation.lastMessageText ?? null;
        conversation.lastMessageAt = toDateOrNull(payload?.created) ?? new Date();
        const direction = this.resolveDirection(payload?.from, payload?.is_incoming, payload?.is_automatic);
        if (direction === "incoming") {
            conversation.unread = 1;
            conversation.answered = 0;
        } else if (direction === "outgoing") {
            conversation.answered = 1;
        }
        try {
            conversation = await this.conversationRepo.save(conversation);
        } catch (err: any) {
            // Two webhook deliveries for a brand-new thread can race across
            // cluster workers: both miss the lookup, both INSERT, the loser
            // hits the unique threadId key. Merge into the winner's row
            // instead of dropping the message.
            if (!String(err?.message || "").includes("Duplicate entry")) throw err;
            const winner = await this.conversationRepo.findOne({ where: { threadId } });
            if (!winner) throw err;
            winner.lastMessageText = conversation.lastMessageText ?? winner.lastMessageText;
            winner.lastMessageAt = conversation.lastMessageAt ?? winner.lastMessageAt;
            if (direction === "incoming") {
                winner.unread = 1;
                winner.answered = 0;
            } else if (direction === "outgoing") {
                winner.answered = 1;
            }
            conversation = await this.conversationRepo.save(winner);
        }

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
        try {
            const saved = await this.messageRepo.save(message);
            logger.info(`[InboxService] webhook stored message ${externalId} (thread ${threadId}, ${message.direction})`);
            return saved;
        } catch (err: any) {
            // Same webhook delivered twice in parallel across cluster workers:
            // both pass the exists-check, one INSERT loses on the unique
            // externalId key. The message is already stored — return it.
            if (!String(err?.message || "").includes("Duplicate entry")) throw err;
            const dup = await this.messageRepo.findOne({ where: { externalId } });
            if (dup) {
                logger.info(`[InboxService] webhook message ${externalId} stored by a parallel delivery`);
                return dup;
            }
            throw err;
        }
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
                    await this.refreshConversationPreview(conversation);
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

        // Map every field the thread detail exposes (guest name/email/phone,
        // listing, price, dates, nights, guests, status, thumbs, ...) using the
        // same rich mapper as the list sync — this is what populates the
        // reservation-details panel for new inquiries that arrive via webhook.
        const summaryForUpsert = { ...threadSummary, id: numericThreadId };
        let conversation = await this.upsertConversationFromSummary(summaryForUpsert, syncedAt);
        if (!conversation) {
            conversation = await this.conversationRepo.findOne({ where: { threadId: numericThreadId } });
        }
        if (!conversation) return null;
        // Fall back to locally-known reservation/listing data for anything Hostify
        // omitted (and, for inquiries, pull fresh reservation info from Hostify).
        await this.enrichConversation(conversation);
        await this.hydrateFromHostifyReservation(conversation);
        await this.conversationRepo.save(conversation);

        // Populate the listing_group_map (incl. service_pms) for this thread's
        // listing if we haven't seen it yet — this is what lets the inbox list
        // filter out mirror-channel duplicates without waiting for the next
        // manual rebuildFromHostify. Best-effort; a failure here just leaves
        // the row NULL, which the filter treats as visible.
        if (conversation.listingId) {
            await this.listingGroupService
                .ensureListing(conversation.listingId)
                .catch((err: any) =>
                    logger.warn(`[InboxService] ensureListing failed for ${conversation.listingId}: ${err.message}`)
                );
        }

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

        // Inquiries have no reservation, so guest name is often absent from the
        // thread summary. Fall back to the guest name carried on the incoming
        // messages themselves so the UI stops showing a bare "Guest".
        if (!conversation.guestName) {
            const named = built.find(
                (m) => m.direction === "incoming" && !!m.senderName && m.senderName.trim() !== ""
            );
            if (named?.senderName) {
                conversation.guestName = named.senderName.trim();
                await this.conversationRepo.save(conversation);
            }
        }

        const inserted = await this.saveMessages(built);
        await this.refreshConversationPreview(conversation);
        return { conversation, inserted };
    }

    /**
     * Keep the list preview honest: Hostify's thread `preview` field can lag
     * behind the real conversation (the team flagged previews not showing the
     * latest message). After a sync, recompute the preview from the newest
     * stored message for the thread.
     */
    private async refreshConversationPreview(conversation: InboxConversationEntity): Promise<void> {
        try {
            const latest = await this.messageRepo.findOne({
                where: { threadId: conversation.threadId },
                order: { sentAt: "DESC", id: "DESC" },
            });
            if (!latest) return;
            const body = (latest.body || latest.note || "").replace(/\s+/g, " ").trim();
            if (!body) return;
            const latestAt = latest.sentAt ? new Date(latest.sentAt) : null;
            const knownAt = conversation.lastMessageAt ? new Date(conversation.lastMessageAt) : null;
            if (knownAt && latestAt && latestAt < knownAt) return;
            if (conversation.lastMessageText === body) return;
            conversation.lastMessageText = body;
            if (latestAt) conversation.lastMessageAt = latestAt;
            await this.conversationRepo.save(conversation);
        } catch (err: any) {
            logger.warn(
                `[InboxService] preview refresh failed for thread ${conversation.threadId}: ${err.message}`
            );
        }
    }

    // -------------------------------------------------------------------------
    // Reads (local DB) for the v2 inbox UI
    // -------------------------------------------------------------------------
    async listConversations(options: ListOptions = {}) {
        const page = Math.max(options.page ?? 1, 1);
        const perPage = Math.min(Math.max(options.perPage ?? 30, 1), 100);

        const qb = this.conversationRepo
            .createQueryBuilder("c")
            .leftJoin(ReservationInfoEntity, "r", "r.id = c.reservationId")
            .leftJoin(Listing, "l", "l.id = c.listingId")
            // listing_info only stores a subset of listings (mostly parents);
            // channel listings that back inbox threads live in
            // listing_group_map, which is why the service_pms flag has to be
            // read from the map, not from l.
            .leftJoin(ListingGroupMapEntity, "lgm", "lgm.listingId = c.listingId")
            .where("c.isArchived = 0")
            // Hide threads whose listing is a mirror channel listing — Hostify
            // creates a separate thread for every mirror listing, which was
            // surfacing the same guest twice in the inbox. Rules:
            //  • service_pms = 1 → the PMS-managed listing, always show.
            //  • c.listingId IS NULL → inquiry with no listing yet, show.
            //  • service_pms = 0 → mirror listing, always hide.
            //  • service_pms IS NULL (unknown) → show UNLESS a sibling thread
            //    exists with a confirmed service_pms = 1 listing that matches
            //    on ANY of: same guestId, same listing group, same guest
            //    name+phone, or same reservation. Hostify assigns different
            //    guestIds per channel listing for the same real guest, so
            //    matching on guestId alone under-counts duplicates.
            .andWhere(
                `(
                    lgm.service_pms = 1
                    OR c.listingId IS NULL
                    OR (
                        lgm.service_pms IS NULL
                        AND NOT EXISTS (
                            SELECT 1
                            FROM inbox_conversations c2
                            LEFT JOIN listing_group_map lgm2 ON lgm2.listingId = c2.listingId
                            WHERE c2.threadId <> c.threadId
                              AND c2.isArchived = 0
                              AND lgm2.service_pms = 1
                              AND (
                                  (c.guestId IS NOT NULL AND c2.guestId = c.guestId)
                                  OR (lgm.groupId IS NOT NULL AND lgm2.groupId IS NOT NULL AND lgm2.groupId = lgm.groupId)
                                  OR (c.reservationId IS NOT NULL AND c2.reservationId = c.reservationId)
                                  OR (
                                      c.guestName IS NOT NULL AND c.guestName <> ''
                                      AND c2.guestName = c.guestName
                                      AND (
                                          (c.guestPhone IS NOT NULL AND c.guestPhone <> '' AND c2.guestPhone = c.guestPhone)
                                          OR (c.guestEmail IS NOT NULL AND c.guestEmail <> '' AND c2.guestEmail = c.guestEmail)
                                      )
                                  )
                              )
                        )
                    )
                )`
            );

        const channelBuckets = parseListParam(options.channel);
        if (channelBuckets.length) {
            qb.andWhere("c.channel IN (:...channels)", { channels: channelBuckets });
        }
        if (options.unreadOnly) {
            qb.andWhere("c.unread = 1");
        }

        // Day filters. "Today" is the portfolio's local day (guests check in on
        // Chicago time), not UTC — otherwise the filter flips a day early each evening.
        const today = new Intl.DateTimeFormat("en-CA", {
            timeZone: process.env.PORTFOLIO_TIMEZONE || "America/Chicago",
        }).format(new Date());
        if (options.arrival === "checkin_today") {
            qb.andWhere("c.checkin = :today", { today });
        } else if (options.arrival === "checkout_today") {
            qb.andWhere("c.checkout = :today", { today });
        }
        if (options.checkinFrom) qb.andWhere("c.checkin >= :cf", { cf: options.checkinFrom });
        if (options.checkinTo) qb.andWhere("c.checkin <= :ct", { ct: options.checkinTo });
        if (options.checkoutFrom) qb.andWhere("c.checkout >= :cof", { cof: options.checkoutFrom });
        if (options.checkoutTo) qb.andWhere("c.checkout <= :cot", { cot: options.checkoutTo });

        const dateFrom = String(options.dateFrom || "").slice(0, 10);
        const dateTo = String(options.dateTo || options.dateFrom || "").slice(0, 10);
        if (dateFrom || dateTo) {
            const applyDateWindow = (expression: string, fromKey: string, toKey: string) => {
                if (dateFrom) qb.andWhere(`${expression} >= :${fromKey}`, { [fromKey]: dateFrom });
                if (dateTo) qb.andWhere(`${expression} <= :${toKey}`, { [toKey]: dateTo });
            };
            switch (String(options.dateType || "updated").toLowerCase()) {
                case "arrivaldate":
                case "checkin":
                    applyDateWindow("c.checkin", "dateFromCheckin", "dateToCheckin");
                    break;
                case "departuredate":
                case "checkout":
                    applyDateWindow("c.checkout", "dateFromCheckout", "dateToCheckout");
                    break;
                case "confirmed":
                    applyDateWindow("DATE(r.reservationDate)", "dateFromConfirmed", "dateToConfirmed");
                    break;
                case "updated":
                default:
                    applyDateWindow("DATE(c.lastMessageAt)", "dateFromUpdated", "dateToUpdated");
                    break;
            }
        }

        const stayTiming = String(options.stayTiming || "").toLowerCase();
        if (stayTiming === "future") {
            qb.andWhere("c.checkin > :today", { today });
        } else if (stayTiming === "ongoing") {
            qb.andWhere("c.checkin <= :today AND c.checkout >= :today", { today });
        } else if (stayTiming === "past") {
            qb.andWhere("c.checkout < :today", { today });
        }

        const lastMessageBuckets = parseListParam(options.lastMessageFrom).map((value) => value.toLowerCase());
        if (lastMessageBuckets.length) {
            // The stored `answered` flag flips to 1 whenever a rep replies,
            // even if the guest later sends more messages, so relying on it
            // mis-classified threads whose newest message was ours. Look at
            // the actual latest message row instead (mirrors `unresponded`).
            const latestDirectionSubquery = `(
                SELECT latest_message.direction
                FROM inbox_messages latest_message
                WHERE latest_message.threadId = c.threadId
                  AND latest_message.direction IN ('incoming', 'outgoing')
                ORDER BY latest_message.sentAt DESC, latest_message.id DESC
                LIMIT 1
            )`;
            qb.andWhere(
                new Brackets((b) => {
                    lastMessageBuckets.forEach((bucket, index) => {
                        const method = index === 0 ? "where" : "orWhere";
                        if (bucket === "guest") {
                            b[method](`${latestDirectionSubquery} = 'incoming'`);
                        } else if (bucket === "us" || bucket === "host" || bucket === "securestay") {
                            b[method](`${latestDirectionSubquery} = 'outgoing'`);
                        }
                    });
                })
            );
        }
        if (options.unresponded === true || String(options.unresponded || "").toLowerCase() === "true") {
            qb.andWhere(`
                EXISTS (
                    SELECT 1
                    FROM inbox_messages latest_incoming
                    WHERE latest_incoming.threadId = c.threadId
                      AND latest_incoming.direction = 'incoming'
                      AND latest_incoming.id = (
                          SELECT latest_message.id
                          FROM inbox_messages latest_message
                          WHERE latest_message.threadId = c.threadId
                            AND latest_message.direction IN ('incoming', 'outgoing')
                          ORDER BY latest_message.sentAt DESC, latest_message.id DESC
                          LIMIT 1
                      )
                )
            `);
        }

        const repliedByBuckets = parseListParam(options.repliedBy).filter(Boolean);
        if (repliedByBuckets.length) {
            qb.andWhere(
                `EXISTS (
                    SELECT 1
                    FROM inbox_messages replied_by_message
                    WHERE replied_by_message.threadId = c.threadId
                      AND replied_by_message.direction = 'outgoing'
                      AND replied_by_message.sentByUserId IS NOT NULL
                      AND replied_by_message.sentByName IN (:...repliedByBuckets)
                )`,
                { repliedByBuckets }
            );
        }

        // Reservation status buckets (raw Hostify statuses grouped for the UI).
        const statusBuckets = parseListParam(options.reservationStatus).map((value) => value.toLowerCase());
        if (statusBuckets.length) {
            qb.andWhere(
                new Brackets((b) => {
                    statusBuckets.forEach((statusBucket, index) => {
                        const method = index === 0 ? "where" : "orWhere";
                        if (statusBucket === "inquiry") {
                            b[method]("LOWER(COALESCE(c.reservationStatus, '')) LIKE 'inquiry%'");
                        } else if (statusBucket === "confirmed") {
                            b[method]("LOWER(COALESCE(c.reservationStatus, '')) IN ('accepted', 'confirmed')");
                        } else if (statusBucket === "cancelled") {
                            b[method]("LOWER(COALESCE(c.reservationStatus, '')) IN ('cancelled', 'canceled', 'denied', 'voided')");
                        } else {
                            b[method]("LOWER(COALESCE(c.reservationStatus, '')) = :statusBucket", { statusBucket });
                        }
                    });
                })
            );
        }

        // PM / Arb / Own from listing tags. Mirrors normalizePropertyTypeValue's
        // priority (own > arb > pm) so filtering agrees with the badge shown.
        // Uses REGEXP word boundaries — plain LIKE '%pm%' had been matching
        // unrelated tokens (e.g. any listing whose tag string contained
        // "compare" or "shipment"), so filters returned listings that don't
        // wear the PM chip.
        const wordBoundary = (raw: string, token: string) =>
            `${raw} REGEXP '(^|[^a-z0-9])${token}([^a-z0-9]|$)'`;
        const typeBuckets = parseListParam(options.propertyType).map((value) => value.toLowerCase());
        if (typeBuckets.length) {
            const raw = "LOWER(CONCAT(COALESCE(l.tags, ''), ' ', COALESCE(l.propertyType, '')))";
            qb.andWhere(
                new Brackets((b) => {
                    typeBuckets.forEach((typeBucket, index) => {
                        const method = index === 0 ? "where" : "orWhere";
                        if (typeBucket === "own") {
                            b[method](wordBoundary(raw, "own"));
                        } else if (typeBucket === "arb") {
                            b[method](`${wordBoundary(raw, "arb")} AND NOT ${wordBoundary(raw, "own")}`);
                        } else if (typeBucket === "pm") {
                            b[method](`${wordBoundary(raw, "pm")} AND NOT ${wordBoundary(raw, "own")} AND NOT ${wordBoundary(raw, "arb")}`);
                        }
                    });
                })
            );
        }

        // Full > Pro > Launch, mirroring normalizeServiceTypeValue so filtering
        // agrees with the badge shown on each conversation card. Without the
        // cascading NOTs a listing tagged "Full, Pro" would appear under both
        // the Full and Pro filters even though only its Full badge is shown.
        const serviceBuckets = parseListParam(options.serviceType).map((value) => value.toLowerCase());
        if (serviceBuckets.length) {
            const raw = "LOWER(COALESCE(l.tags, ''))";
            qb.andWhere(
                new Brackets((b) => {
                    serviceBuckets.forEach((serviceBucket, index) => {
                        const method = index === 0 ? "where" : "orWhere";
                        if (serviceBucket === "full") {
                            b[method](wordBoundary(raw, "full"));
                        } else if (serviceBucket === "pro") {
                            b[method](`${wordBoundary(raw, "pro")} AND NOT ${wordBoundary(raw, "full")}`);
                        } else if (serviceBucket === "launch") {
                            b[method](`${wordBoundary(raw, "launch")} AND NOT ${wordBoundary(raw, "full")} AND NOT ${wordBoundary(raw, "pro")}`);
                        }
                    });
                })
            );
        }

        const portfolioBuckets = parseListParam(options.portfolio).map((value) => value.toLowerCase());
        if (portfolioBuckets.length) {
            const raw = "LOWER(COALESCE(l.tags, ''))";
            qb.andWhere(
                new Brackets((b) => {
                    portfolioBuckets.forEach((portfolioBucket, index) => {
                        const method = index === 0 ? "where" : "orWhere";
                        if (portfolioBucket === "g1" || portfolioBucket === "group1" || portfolioBucket === "group 1") {
                            b[method](
                                `(${raw} REGEXP '(^|[^a-z0-9])group[ ]?1([^a-z0-9]|$)' OR ${wordBoundary(raw, "g1")})`
                            );
                        } else if (portfolioBucket === "g2" || portfolioBucket === "group2" || portfolioBucket === "group 2") {
                            b[method](
                                `(${raw} REGEXP '(^|[^a-z0-9])group[ ]?2([^a-z0-9]|$)' OR ${wordBoundary(raw, "g2")})`
                            );
                        }
                    });
                })
            );
        }

        const selectedListingIds = parseListParam(options.listingId)
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0);
        if (selectedListingIds.length) {
            qb.andWhere("c.listingId IN (:...selectedListingIds)", { selectedListingIds });
        }

        if (options.keyword) {
            const kw = `%${options.keyword.trim()}%`;
            const searchFields = parseListParam(options.searchFields);
            const fields = searchFields.length ? searchFields : ["guest", "confirmation"];
            qb.andWhere(
                new Brackets((b) => {
                    let hasCondition = false;
                    const addWhere = (condition: string) => {
                        if (hasCondition) b.orWhere(condition, { kw });
                        else {
                            b.where(condition, { kw });
                            hasCondition = true;
                        }
                    };

                    for (const field of fields) {
                        switch (field) {
                            case "guest":
                                addWhere("c.guestName LIKE :kw");
                                break;
                            case "confirmation":
                                addWhere("r.confirmation_code LIKE :kw");
                                break;
                            case "conversation":
                                addWhere(`EXISTS (
                                    SELECT 1 FROM inbox_messages m
                                    WHERE m.threadId = c.threadId
                                    AND (m.body LIKE :kw OR m.note LIKE :kw)
                                )`);
                                break;
                            case "reservationNotes":
                                addWhere("r.hostNote LIKE :kw");
                                break;
                            case "cleaningNotes":
                                addWhere(`EXISTS (
                                    SELECT 1 FROM inbox_messages m
                                    WHERE m.threadId = c.threadId
                                    AND m.note LIKE :kw
                                )`);
                                break;
                            case "phone":
                                addWhere("(c.guestPhone LIKE :kw OR r.phone LIKE :kw)");
                                break;
                            case "email":
                                addWhere("(c.guestEmail LIKE :kw OR r.guestEmail LIKE :kw)");
                                break;
                        }
                    }

                    if (!hasCondition) {
                        b.where("c.guestName LIKE :kw", { kw }).orWhere("r.confirmation_code LIKE :kw", { kw });
                    }
                })
            );
        }

        // Payment/other emergencies are pinned to the top of the list so an
        // unpaid guest arriving today can't be missed; then inquiries the team
        // hasn't replied to yet (fresh leads decay by the minute); then newest
        // activity. All joins are many-to-one so offset/limit is safe (no row
        // fan-out) and avoids TypeORM's two-pass skip/take id subquery.
        qb.orderBy("c.emergency", "DESC")
            // Only recent inquiries get pinned — months-old expired inquiries
            // shouldn't sit above today's conversations forever.
            .addOrderBy(
                "(CASE WHEN c.answered = 0 AND LOWER(COALESCE(c.reservationStatus, '')) LIKE 'inquiry%' AND c.lastMessageAt >= NOW() - INTERVAL 14 DAY THEN 1 ELSE 0 END)",
                "DESC"
            )
            .addOrderBy("c.lastMessageAt", "DESC")
            .offset((page - 1) * perPage)
            // Fetch one extra row to learn whether another page exists. The
            // exact COUNT over the mirror-dedup WHERE took ~15s on prod and ran
            // on every list load AND every 20s poll — it was the reason the
            // inbox felt slow. hasMore makes pagination O(page size).
            .limit(perPage + 1);

        const rows = await qb.getMany();
        const hasMore = rows.length > perPage;
        const conversations = hasMore ? rows.slice(0, perPage) : rows;
        const listingIds = Array.from(
            new Set(
                conversations
                    .map((conversation) => Number(conversation.listingId))
                    .filter((listingId) => Number.isFinite(listingId) && listingId > 0)
            )
        );
        const listings = listingIds.length
            ? await this.listingRepo.find({ where: { id: In(listingIds) }, withDeleted: true })
            : [];
        const listingMap = new Map(listings.map((listing) => [Number(listing.id), listing]));

        const enrichedConversations = await Promise.all(conversations.map(async (conversation) => {
            const listing = listingMap.get(Number(conversation.listingId)) || null;
            const normalizedListing = listing
                ? (this.listingService as any).normalizeListingOverview?.(listing) || null
                : null;
            const parentListingId = await this.listingGroupService.resolve(conversation.listingId);
            return {
                ...conversation,
                parentListingId,
                propertyType: this.normalizePropertyTypeValue(listing),
                serviceType: this.normalizeServiceTypeValue(listing, normalizedListing),
            };
        }));

        const { channels, repliedByUsers } = await this.getFilterOptions();

        // `total` is a legacy field older clients used to derive hasMore; keep
        // it monotonic (loaded-so-far + 1 when more exist) without paying for
        // an exact COUNT over the expensive mirror-dedup WHERE clause.
        const total = (page - 1) * perPage + conversations.length + (hasMore ? 1 : 0);
        return { conversations: enrichedConversations, total, hasMore, page, perPage, channels, repliedByUsers };
    }

    /**
     * Channel + replied-by dropdown options. These only change when a brand
     * new channel appears or a new teammate sends their first reply, so a
     * short in-process cache keeps them off the hot list-conversations path.
     */
    private async getFilterOptions(): Promise<{ channels: string[]; repliedByUsers: string[] }> {
        const cached = InboxService.filterOptionsCache;
        if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
            return { channels: cached.channels, repliedByUsers: cached.repliedByUsers };
        }
        const channelRows: { ch: string; }[] = await this.conversationRepo
            .createQueryBuilder("c")
            .select("DISTINCT c.channel", "ch")
            .where("c.channel IS NOT NULL AND c.channel != ''")
            .getRawMany();
        const channels = channelRows.map((r) => r.ch).filter(Boolean).sort();

        const repliedByRows: { name: string; }[] = await this.messageRepo
            .createQueryBuilder("m")
            .select("DISTINCT m.sentByName", "name")
            .where("m.direction = 'outgoing'")
            .andWhere("m.sentByUserId IS NOT NULL")
            .andWhere("m.sentByName IS NOT NULL")
            .andWhere("m.sentByName != ''")
            .orderBy("m.sentByName", "ASC")
            .getRawMany();
        const repliedByUsers = repliedByRows.map((r) => r.name).filter(Boolean);
        InboxService.filterOptionsCache = { at: Date.now(), channels, repliedByUsers };
        return { channels, repliedByUsers };
    }

    async getConversation(threadId: number) {
        const conversation = await this.conversationRepo.findOne({ where: { threadId } });
        if (!conversation) return null;

        // Refuse to open threads that belong to a mirror channel listing —
        // these are the duplicate threads the inbox list already hides, so
        // navigating to one via a bookmarked URL should also 404 rather than
        // rendering a ghost thread we don't want anyone to reply from.
        // ensureListing lazily fetches service_pms from Hostify if we haven't
        // cached it yet, so this stays correct even for brand-new listing IDs
        // that predate the next full listing_group_map rebuild.
        if (conversation.listingId) {
            const servicePms = await this.listingGroupService.ensureListing(conversation.listingId);
            if (servicePms === 0) return null;
            // service_pms is genuinely unknown (Hostify returned no value) —
            // treat as a duplicate iff a sibling thread exists on a confirmed
            // PMS listing. Match keys mirror the listConversations filter
            // because Hostify hands out different guestIds per channel for
            // the same real guest.
            if (servicePms == null) {
                const groupId = await this.listingGroupService.resolve(conversation.listingId);
                const pmsSibling = await this.conversationRepo
                    .createQueryBuilder("c2")
                    .innerJoin(ListingGroupMapEntity, "lgm2", "lgm2.listingId = c2.listingId")
                    .where("c2.threadId <> :threadId", { threadId: conversation.threadId })
                    .andWhere("c2.isArchived = 0")
                    .andWhere("lgm2.service_pms = 1")
                    .andWhere(
                        new Brackets((b) => {
                            let added = false;
                            const addOr = (condition: string, params: Record<string, any>) => {
                                if (added) b.orWhere(condition, params);
                                else {
                                    b.where(condition, params);
                                    added = true;
                                }
                            };
                            if (conversation.guestId) {
                                addOr("c2.guestId = :guestId", { guestId: conversation.guestId });
                            }
                            if (groupId) {
                                addOr("lgm2.groupId = :groupId", { groupId });
                            }
                            if (conversation.reservationId) {
                                addOr("c2.reservationId = :reservationId", { reservationId: conversation.reservationId });
                            }
                            if (conversation.guestName && (conversation.guestPhone || conversation.guestEmail)) {
                                if (conversation.guestPhone) {
                                    addOr(
                                        "c2.guestName = :guestName AND c2.guestPhone = :guestPhone",
                                        { guestName: conversation.guestName, guestPhone: conversation.guestPhone }
                                    );
                                }
                                if (conversation.guestEmail) {
                                    addOr(
                                        "c2.guestName = :guestName AND c2.guestEmail = :guestEmail",
                                        { guestName: conversation.guestName, guestEmail: conversation.guestEmail }
                                    );
                                }
                            }
                            if (!added) b.where("1 = 0");
                        })
                    )
                    .select("c2.threadId")
                    .limit(1)
                    .getRawOne();
                if (pmsSibling) return null;
            }
        }

        // Backfill guest identity on open for older threads created before we
        // resolved guest names from the Hostify guest record (e.g. reservations
        // we messaged first, which otherwise stay "Unknown guest"). One-time:
        // once the name is saved, subsequent opens skip this.
        if (!conversation.guestName) {
            try {
                await this.enrichConversation(conversation);
                await this.hydrateFromHostifyReservation(conversation);
                await this.conversationRepo.save(conversation);
            } catch (err: any) {
                logger.warn(`[InboxService] getConversation guest backfill failed for thread ${threadId}: ${err.message}`);
            }
        }

        // Pull the freshest thread history from Hostify on open — Hostify's
        // webhooks occasionally miss guest replies (esp. photo-only messages)
        // and running a targeted sync here is what keeps the thread from
        // silently falling behind when someone opens it. Best-effort; the
        // local read below still returns whatever we have on failure.
        try {
            await this.syncThread(threadId);
        } catch (err: any) {
            logger.warn(`[InboxService] on-open sync failed for thread ${threadId}: ${err.message}`);
        }

        const messages = await this.messageRepo.find({
            where: { threadId },
            order: { sentAt: "ASC", id: "ASC" },
        });

        // Mark as read locally on open.
        if (conversation.unread) {
            conversation.unread = 0;
            await this.conversationRepo.save(conversation);
        }

        const parentListingId = await this.listingGroupService.resolve(conversation.listingId);

        return { conversation: { ...conversation, parentListingId }, messages };
    }

    // -------------------------------------------------------------------------
    // Outgoing reply: send to Hostify, then persist locally with attribution
    // -------------------------------------------------------------------------
    /**
     * Persist an outgoing message after Hostify/OpenPhone already accepted it.
     * Hostify webhooks often arrive with the real message id before this save
     * runs — losing that race on uq_inbox_messages_external must NOT 500 the
     * reply endpoint (guest already got the message; Anj was seeing
     * "Internal Server Error" while the send succeeded).
     */
    private async saveOutgoingOrAdoptWebhook(message: InboxMessageEntity): Promise<InboxMessageEntity> {
        try {
            return await this.messageRepo.save(message);
        } catch (err: any) {
            if (!String(err?.message || "").includes("Duplicate entry")) throw err;
            const existing = await this.messageRepo.findOne({ where: { externalId: message.externalId } });
            if (!existing) throw err;
            // Webhook won — stamp human/AI attribution onto its row.
            if (message.sentByUserId != null) existing.sentByUserId = message.sentByUserId;
            if (message.sentByName) existing.sentByName = message.sentByName;
            if (message.sentVia) existing.sentVia = message.sentVia;
            if (message.senderName) existing.senderName = message.senderName;
            if (message.senderType) existing.senderType = message.senderType;
            if (message.isAutomatic != null) existing.isAutomatic = message.isAutomatic;
            if (message.body && !existing.body) existing.body = message.body;
            if (message.attachmentUrl && !existing.attachmentUrl) existing.attachmentUrl = message.attachmentUrl;
            const saved = await this.messageRepo.save(existing);
            logger.info(
                `[InboxService] outgoing ${message.externalId} already stored by webhook — attributed via=${message.sentVia || "inbox"}`
            );
            return saved;
        }
    }

    async sendReply(threadId: number, body: string, user: any, opts: { attachmentUrls?: string[]; } = {}) {
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

        const attachmentUrls = (opts.attachmentUrls || []).filter(Boolean);
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
            attachmentUrl: attachmentUrls[0] || null,
            guestId: conversation.guestId,
            sentAt: new Date(),
            sentByUserId: userId,
            sentByName: userName,
            sentVia: "inbox_v2",
            source: "hostify",
        });
        const saved = await this.saveOutgoingOrAdoptWebhook(message);

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

    async addInternalNote(threadId: number, note: string, user: any, opts: { attachmentUrls?: string[]; } = {}) {
        const conversation = await this.conversationRepo.findOne({ where: { threadId } });
        if (!conversation) {
            throw new Error(`Conversation ${threadId} not found`);
        }

        const { userId, userName } = await this.resolveSender(user);
        const attachmentUrls = (opts.attachmentUrls || []).filter(Boolean);
        const fileText = attachmentUrls.length ? attachmentUrls.map((url) => `Attachment: ${url}`).join("\n") : "";
        const noteText = [note, fileText].filter(Boolean).join("\n\n");

        const message = this.messageRepo.create({
            externalId: -Date.now(),
            threadId,
            reservationId: conversation.reservationId,
            listingId: conversation.listingId,
            body: null,
            note: noteText,
            direction: "outgoing",
            senderType: "host",
            senderName: userName,
            isAutomatic: 0,
            isSms: 0,
            channel: conversation.channel,
            attachmentUrl: attachmentUrls[0] || null,
            guestId: conversation.guestId,
            sentAt: new Date(),
            sentByUserId: userId,
            sentByName: userName,
            sentVia: "inbox_v2",
            source: "securestay",
        });
        const saved = await this.messageRepo.save(message);

        conversation.lastMessageText = `Internal note: ${noteText}`;
        conversation.lastMessageAt = saved.sentAt;
        conversation.unread = 0;
        await this.conversationRepo.save(conversation);

        return saved;
    }

    /**
     * Deliver an AI-generated reply automatically (no human sender). Mirrors
     * sendReply but records the message as automated/AI attribution so the UI
     * and learning loop can distinguish auto-sent replies from human ones.
     *
     * This is only ever invoked by InboxAIService.maybeAutoRespond after its
     * guardrails pass; it performs no gating itself.
     */
    async sendAutomatedReply(threadId: number, body: string, opts: { senderName?: string; } = {}) {
        const conversation = await this.conversationRepo.findOne({ where: { threadId } });
        if (!conversation) {
            throw new Error(`Conversation ${threadId} not found`);
        }
        const senderName = opts.senderName || "AI Assistant";

        // 1) Deliver to the guest via Hostify.
        const hostifyResult = await this.hostify.postInboxReply(this.apiKey, threadId, body);

        // 2) Persist locally with automated attribution.
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
            senderType: "ai",
            senderName,
            isAutomatic: 1,
            isSms: 0,
            channel: conversation.channel,
            attachmentUrl: null,
            guestId: conversation.guestId,
            sentAt: new Date(),
            sentByUserId: null,
            sentByName: senderName,
            sentVia: "ai_auto",
            source: "hostify",
        });
        const saved = await this.saveOutgoingOrAdoptWebhook(message);

        conversation.lastMessageText = body;
        conversation.lastMessageAt = saved.sentAt;
        conversation.answered = 1;
        conversation.unread = 0;
        await this.conversationRepo.save(conversation);

        this.syncThread(threadId).catch((err) =>
            logger.warn(`[InboxService] post-autosend resync failed for thread ${threadId}: ${err.message}`)
        );

        return saved;
    }

    private async resolveSender(user: any): Promise<{ userId: number | null; userName: string | null; }> {
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
