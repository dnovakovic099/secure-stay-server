import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { QuoPhoneLineEntity } from "../entity/QuoPhoneLine";
import { QuoConversationEntity } from "../entity/QuoConversation";
import { QuoMessageEntity } from "../entity/QuoMessage";
import { ReservationInfoEntity } from "../entity/ReservationInfo";

/**
 * QuoInboxService — separate SMS inbox for our Quo (OpenPhone) PM/GR lines.
 *
 * - Lines are discovered from the Quo API; only PM/GR-classified lines are
 *   enabled for sync by default (maintenance/sales stay off, toggleable).
 * - Conversations + messages are polled on a cron and persisted locally in
 *   quo_conversations / quo_messages (never mixed with the Hostify inbox).
 * - Each conversation is linked to a Hostify reservation by matching the
 *   participant's phone against reservation_info.phone; if that fails we look
 *   for a confirmation code inside the message text; staff can link manually.
 */
export class QuoInboxService {
    private lineRepo = appDatabase.getRepository(QuoPhoneLineEntity);
    private conversationRepo = appDatabase.getRepository(QuoConversationEntity);
    private messageRepo = appDatabase.getRepository(QuoMessageEntity);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);

    private client: AxiosInstance;

    // Quo workspace users (id -> display name), cached per process for an hour.
    private static userCache: { map: Map<string, string>; fetchedAt: number } | null = null;

    constructor() {
        const apiKey = process.env.QUO_API_KEY || process.env.OPEN_PHONE_API_KEY || "";
        this.client = axios.create({
            baseURL: "https://api.openphone.com/v1",
            timeout: 15000,
            headers: { Authorization: apiKey, "Content-Type": "application/json" },
            paramsSerializer: {
                serialize: (params) => {
                    const sp = new URLSearchParams();
                    for (const key in params) {
                        const value = params[key];
                        if (Array.isArray(value)) value.forEach((v) => sp.append(key, v));
                        else if (value !== undefined && value !== null) sp.append(key, value);
                    }
                    return sp.toString();
                },
            },
        });
    }

    static isConfigured(): boolean {
        return Boolean(process.env.QUO_API_KEY || process.env.OPEN_PHONE_API_KEY);
    }

    // -------------------------------------------------------------------------
    // Phone lines
    // -------------------------------------------------------------------------

    /** Auto-classify a line by its Quo name. Only PM/GR lines sync by default. */
    static classifyLine(name: string | null | undefined): { category: string; enabled: boolean } {
        const n = String(name || "").toLowerCase();
        if (/\bmaint\b|maintenance/.test(n)) return { category: "maintenance", enabled: false };
        if (/\bsales\b|lead outreach|s&m/.test(n)) return { category: "sales", enabled: false };
        if (/\bgr\b|guest relations/.test(n)) return { category: "GR", enabled: true };
        if (/\bpm\b|property manage/.test(n)) return { category: "PM", enabled: true };
        return { category: "other", enabled: false };
    }

    /** Discover lines from Quo and upsert. Existing category/enabled are kept. */
    async syncPhoneLines(): Promise<{ total: number; added: number }> {
        const res = await this.client.get("/phone-numbers");
        const data: any[] = res.data?.data || [];
        let added = 0;
        for (const p of data) {
            const existing = await this.lineRepo.findOne({ where: { phoneNumberId: p.id } });
            if (existing) {
                // Refresh name/number but never clobber the user's category/enabled.
                existing.number = p.number || existing.number;
                existing.name = p.name ?? existing.name;
                existing.symbol = p.symbol ?? existing.symbol;
                await this.lineRepo.save(existing);
            } else {
                const cls = QuoInboxService.classifyLine(p.name);
                await this.lineRepo.save(
                    this.lineRepo.create({
                        phoneNumberId: p.id,
                        number: p.number,
                        name: p.name || null,
                        symbol: p.symbol || null,
                        category: cls.category,
                        enabled: cls.enabled ? 1 : 0,
                    })
                );
                added++;
            }
        }
        return { total: data.length, added };
    }

    /**
     * Lines with per-line "awaiting reply" counts — conversations whose last
     * message is incoming (nobody has replied yet). Drives the filter badges.
     */
    async listLines(): Promise<(QuoPhoneLineEntity & { awaitingReply: number })[]> {
        const lines = await this.lineRepo.find({ order: { enabled: "DESC", name: "ASC" } });
        const counts: { phoneNumberId: string; cnt: string }[] = await this.conversationRepo
            .createQueryBuilder("c")
            .select("c.phoneNumberId", "phoneNumberId")
            .addSelect("COUNT(*)", "cnt")
            .where("c.isArchived = 0 AND c.lastDirection = 'incoming'")
            .groupBy("c.phoneNumberId")
            .getRawMany();
        const countMap = new Map(counts.map((c) => [c.phoneNumberId, Number(c.cnt)]));
        return lines.map((l) => Object.assign(l, { awaitingReply: countMap.get(l.phoneNumberId) || 0 }));
    }

    async updateLine(id: number, patch: { enabled?: boolean; category?: string; name?: string }): Promise<QuoPhoneLineEntity | null> {
        const line = await this.lineRepo.findOne({ where: { id } });
        if (!line) return null;
        if (patch.enabled !== undefined) line.enabled = patch.enabled ? 1 : 0;
        if (patch.category !== undefined) line.category = patch.category;
        if (patch.name !== undefined) line.name = patch.name;
        return this.lineRepo.save(line);
    }

    // -------------------------------------------------------------------------
    // Sync — conversations + messages for all enabled lines
    // -------------------------------------------------------------------------

    /** Prevents the 3-minute cron from stacking on top of a long deep backfill. */
    private static syncInFlight = false;

    async syncAll(opts: { deep?: boolean } = {}): Promise<{
        lines: number;
        conversations: number;
        messages: number;
        newIncoming: string[]; // conversationIds with new incoming messages
    }> {
        if (!QuoInboxService.isConfigured() || QuoInboxService.syncInFlight) {
            return { lines: 0, conversations: 0, messages: 0, newIncoming: [] };
        }
        QuoInboxService.syncInFlight = true;
        try {
            return await this.doSyncAll(opts);
        } finally {
            QuoInboxService.syncInFlight = false;
        }
    }

    private async doSyncAll(opts: { deep?: boolean } = {}): Promise<{
        lines: number;
        conversations: number;
        messages: number;
        newIncoming: string[];
    }> {
        await this.syncPhoneLines();
        const lines = await this.lineRepo.find({ where: { enabled: 1 } });
        let convCount = 0;
        let msgCount = 0;
        const newIncoming: string[] = [];

        for (const line of lines) {
            try {
                // First-ever sync of a line is always a deep backfill so history
                // matches what's visible in the Quo app.
                const deep = opts.deep === true || !line.lastSyncedAt;
                const result = await this.syncLine(line, deep);
                convCount += result.conversations;
                msgCount += result.messages;
                newIncoming.push(...result.newIncoming);
                line.lastSyncedAt = new Date();
                await this.lineRepo.save(line);
            } catch (err: any) {
                logger.error(`[QuoInbox] Sync failed for line ${line.name} (${line.number}): ${err?.message}`, err?.response?.data);
            }
        }
        return { lines: lines.length, conversations: convCount, messages: msgCount, newIncoming };
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /** GET with retry on 429/5xx so deep backfills survive the 10 rps limit. */
    private async apiGet(path: string, params: Record<string, any>): Promise<any> {
        for (let attempt = 0; ; attempt++) {
            try {
                return await this.client.get(path, { params });
            } catch (err: any) {
                const status = err?.response?.status;
                if (attempt < 3 && (status === 429 || status >= 500)) {
                    await this.sleep(1500 * (attempt + 1));
                    continue;
                }
                throw err;
            }
        }
    }

    private async syncLine(line: QuoPhoneLineEntity, deep: boolean): Promise<{
        conversations: number;
        messages: number;
        newIncoming: string[];
    }> {
        // Overlap window so we never miss activity between sweeps.
        const since = line.lastSyncedAt
            ? new Date(line.lastSyncedAt.getTime() - 10 * 60 * 1000)
            : null;
        const backfillDays = Number(process.env.QUO_BACKFILL_DAYS || 90);
        const backfillCutoff = new Date(Date.now() - backfillDays * 24 * 60 * 60 * 1000);
        // IMPORTANT: Quo's /conversations list is NOT ordered by last activity —
        // recently-active old threads sit deep in the list. The previous
        // "walk newest-first and stop when activity gets old" approach therefore
        // silently missed most updates (verified against the live API 2026-07-08).
        // Instead we push the window down to the API with updatedAfter and walk
        // EVERY page it returns.
        const updatedAfter = deep || !since ? backfillCutoff : since;
        const maxPages = deep ? 200 : 40;
        let pageToken: string | undefined;
        let conversations = 0;
        let messages = 0;
        const newIncoming: string[] = [];

        for (let page = 0; page < maxPages; page++) {
            const res = await this.apiGet("/conversations", {
                phoneNumbers: [line.phoneNumberId],
                maxResults: 50,
                updatedAfter: updatedAfter.toISOString(),
                ...(pageToken ? { pageToken } : {}),
            });
            const convs: any[] = res.data?.data || [];

            for (const c of convs) {
                const synced = await this.syncConversation(line, c, deep);
                conversations++;
                messages += synced.messages;
                if (synced.hadNewIncoming) newIncoming.push(c.id);
                if (deep) await this.sleep(120); // stay under the 10 rps limit
            }

            pageToken = res.data?.nextPageToken || undefined;
            if (!pageToken) break;
        }
        return { conversations, messages, newIncoming };
    }

    private async syncConversation(
        line: QuoPhoneLineEntity,
        c: any,
        deep: boolean
    ): Promise<{ messages: number; hadNewIncoming: boolean }> {
        const participants: string[] = (c.participants || []).filter(Boolean);
        if (!participants.length) return { messages: 0, hadNewIncoming: false };

        let conv = await this.conversationRepo.findOne({ where: { conversationId: c.id } });
        const isNew = !conv;
        if (!conv) {
            conv = this.conversationRepo.create({
                conversationId: c.id,
                phoneNumberId: line.phoneNumberId,
                lineNumber: line.number,
                lineName: line.name,
                participantPhone: participants[0],
                participants: participants.join(","),
                contactName: c.name || null,
                unread: 0,
                isArchived: 0,
            });
        } else {
            conv.lineNumber = line.number;
            conv.lineName = line.name;
            conv.contactName = c.name || conv.contactName;
        }

        // Nothing new since we last stored this conversation? Skip the message
        // fetch entirely (makes repeated deep syncs cheap).
        const lastActivityAt = c.lastActivityAt ? new Date(c.lastActivityAt).getTime() : null;
        if (!isNew && conv.lastMessageAt && lastActivityAt && new Date(conv.lastMessageAt).getTime() >= lastActivityAt) {
            conv.syncedAt = new Date();
            await this.conversationRepo.save(conv);
            return { messages: 0, hadNewIncoming: false };
        }

        // Fetch messages (newest first). Non-deep: stop as soon as we hit a
        // message we already have.
        const prevLastAt = conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : 0;
        let pageToken: string | undefined;
        const maxPages = deep ? 4 : 2;
        let saved = 0;
        let hadNewIncoming = false;
        let newest: { text: string | null; at: Date; direction: string } | null = null;

        outer: for (let page = 0; page < maxPages; page++) {
            const res = await this.apiGet("/messages", {
                phoneNumberId: line.phoneNumberId,
                participants,
                maxResults: 50,
                ...(pageToken ? { pageToken } : {}),
            });
            const msgs: any[] = res.data?.data || [];
            for (const m of msgs) {
                if (m.conversationId && m.conversationId !== c.id) continue;
                const exists = await this.messageRepo.findOne({ where: { externalId: m.id } });
                if (exists) {
                    if (!deep) break outer;
                    continue;
                }
                const sentAt = new Date(m.createdAt);
                await this.messageRepo.save(
                    this.messageRepo.create({
                        externalId: m.id,
                        conversationId: c.id,
                        phoneNumberId: m.phoneNumberId || line.phoneNumberId,
                        body: m.text || null,
                        direction: m.direction === "outgoing" ? "outgoing" : "incoming",
                        fromNumber: m.from || null,
                        toNumbers: Array.isArray(m.to) ? m.to.join(",") : null,
                        mediaUrls: Array.isArray(m.media) && m.media.length
                            ? JSON.stringify(m.media.map((x: any) => x.url).filter(Boolean))
                            : null,
                        status: m.status || null,
                        quoUserId: m.userId || null,
                        senderName: m.direction === "outgoing" ? await this.resolveUserName(m.userId) : null,
                        sentAt,
                    })
                );
                saved++;
                if (m.direction === "incoming" && sentAt.getTime() > prevLastAt) hadNewIncoming = true;
                if (!newest || sentAt > newest.at) {
                    newest = { text: m.text || null, at: sentAt, direction: m.direction };
                }
            }
            pageToken = res.data?.nextPageToken || undefined;
            if (!pageToken) break;
        }

        if (newest && (!conv.lastMessageAt || newest.at > new Date(conv.lastMessageAt))) {
            conv.lastMessageText = newest.text;
            conv.lastMessageAt = newest.at;
            conv.lastDirection = newest.direction;
            if (newest.direction === "incoming") conv.unread = 1;
        }
        conv.syncedAt = new Date();
        conv = await this.conversationRepo.save(conv);

        // Reservation linking — on new conversations or when still unlinked.
        if ((isNew || !conv.reservationId) && conv.linkMethod !== "manual") {
            try {
                await this.resolveReservationLink(conv);
            } catch (err: any) {
                logger.warn(`[QuoInbox] Reservation link failed for ${conv.conversationId}: ${err?.message}`);
            }
        }

        return { messages: saved, hadNewIncoming };
    }

    private async resolveUserName(userId?: string | null): Promise<string | null> {
        if (!userId) return null;
        const now = Date.now();
        if (!QuoInboxService.userCache || now - QuoInboxService.userCache.fetchedAt > 60 * 60 * 1000) {
            try {
                const map = new Map<string, string>();
                let pageToken: string | undefined;
                for (let i = 0; i < 5; i++) {
                    const res = await this.client.get("/users", {
                        params: { maxResults: 50, ...(pageToken ? { pageToken } : {}) },
                    });
                    for (const u of res.data?.data || []) {
                        map.set(u.id, [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email);
                    }
                    pageToken = res.data?.nextPageToken || undefined;
                    if (!pageToken) break;
                }
                QuoInboxService.userCache = { map, fetchedAt: now };
            } catch {
                return null;
            }
        }
        return QuoInboxService.userCache.map.get(userId) || null;
    }

    // -------------------------------------------------------------------------
    // Reservation linking
    // -------------------------------------------------------------------------

    private static digits(phone: string | null | undefined): string {
        return String(phone || "").replace(/\D+/g, "");
    }

    /**
     * Try to link a conversation to a Hostify reservation:
     *  1. Match the participant phone against reservation_info.phone.
     *  2. Fallback: look for a confirmation code inside recent message text.
     */
    async resolveReservationLink(conv: QuoConversationEntity): Promise<boolean> {
        // 1. Phone match — compare on the last 10 digits.
        const d = QuoInboxService.digits(conv.participantPhone);
        if (d.length >= 10) {
            const last10 = d.slice(-10);
            const normalizedPhone =
                "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(r.phone,''),' ',''),'-',''),'(',''),')',''),'+','')";
            const matches = await this.reservationRepo
                .createQueryBuilder("r")
                .where(`${normalizedPhone} LIKE :p`, { p: `%${last10}` })
                .andWhere("r.status NOT IN ('cancelled','declined','expired','denied','deleted','voided')")
                .orderBy(
                    // Prefer the stay closest to today (current guests first).
                    "ABS(DATEDIFF(r.arrivalDate, CURDATE()))",
                    "ASC"
                )
                .take(1)
                .getMany();
            if (matches.length) {
                this.applyLink(conv, matches[0], "phone");
                await this.conversationRepo.save(conv);
                return true;
            }
        }

        // 2. Confirmation code inside message text (e.g. guest texting from a
        //    different number than the one on the booking).
        const recent = await this.messageRepo.find({
            where: { conversationId: conv.conversationId },
            order: { sentAt: "DESC" },
            take: 30,
        });
        const codes = new Set<string>();
        for (const m of recent) {
            const found = String(m.body || "").match(/\b[A-Z0-9]{6,14}\b/g) || [];
            for (const code of found) {
                // Require at least one digit AND one letter so plain words/numbers don't hit.
                if (/[0-9]/.test(code) && /[A-Z]/.test(code)) codes.add(code);
            }
        }
        if (codes.size) {
            const match = await this.reservationRepo
                .createQueryBuilder("r")
                .where("r.confirmation_code IN (:...codes)", { codes: Array.from(codes).slice(0, 25) })
                .take(1)
                .getOne();
            if (match) {
                this.applyLink(conv, match, "message");
                await this.conversationRepo.save(conv);
                return true;
            }
        }
        return false;
    }

    private applyLink(conv: QuoConversationEntity, r: ReservationInfoEntity, method: string): void {
        conv.reservationId = r.id;
        conv.listingId = r.listingMapId || null;
        conv.listingName = r.listingName || null;
        conv.guestName = r.guestName || null;
        conv.linkMethod = method;
    }

    /** Manual link/unlink from the dashboard. */
    async manualLink(conversationId: string, reservationId: number | null): Promise<QuoConversationEntity | null> {
        const conv = await this.conversationRepo.findOne({ where: { conversationId } });
        if (!conv) return null;
        if (!reservationId) {
            conv.reservationId = null;
            conv.listingId = null;
            conv.listingName = null;
            conv.guestName = null;
            conv.linkMethod = null;
        } else {
            const r = await this.reservationRepo.findOne({ where: { id: reservationId } });
            if (!r) return null;
            this.applyLink(conv, r, "manual");
        }
        return this.conversationRepo.save(conv);
    }

    // -------------------------------------------------------------------------
    // Reads
    // -------------------------------------------------------------------------

    async listConversations(opts: {
        page?: number;
        perPage?: number;
        phoneNumberId?: string | null;
        category?: string | null; // PM | GR
        keyword?: string | null;
        unreadOnly?: boolean;
        linked?: "linked" | "unlinked" | null;
    } = {}): Promise<{
        conversations: QuoConversationEntity[];
        total: number;
        page: number;
        perPage: number;
    }> {
        const page = Math.max(opts.page ?? 1, 1);
        const perPage = Math.min(Math.max(opts.perPage ?? 30, 1), 100);
        const qb = this.conversationRepo.createQueryBuilder("c").where("c.isArchived = 0");

        if (opts.phoneNumberId) qb.andWhere("c.phoneNumberId = :pn", { pn: opts.phoneNumberId });
        if (opts.category) {
            qb.andWhere(
                "c.phoneNumberId IN (SELECT phoneNumberId FROM quo_phone_lines WHERE category = :cat)",
                { cat: opts.category }
            );
        }
        if (opts.unreadOnly) qb.andWhere("c.unread = 1");
        if (opts.linked === "linked") qb.andWhere("c.reservationId IS NOT NULL");
        if (opts.linked === "unlinked") qb.andWhere("c.reservationId IS NULL");
        if (opts.keyword) {
            const kw = `%${opts.keyword.trim()}%`;
            qb.andWhere(
                "(c.participantPhone LIKE :kw OR c.contactName LIKE :kw OR c.guestName LIKE :kw OR c.listingName LIKE :kw OR c.lastMessageText LIKE :kw OR c.lineName LIKE :kw)",
                { kw }
            );
        }

        qb.orderBy("c.lastMessageAt", "DESC").skip((page - 1) * perPage).take(perPage);
        const [conversations, total] = await qb.getManyAndCount();
        return { conversations, total, page, perPage };
    }

    /** Lightweight conversation row fetch (no messages). */
    async getConversationRow(conversationId: string): Promise<QuoConversationEntity | null> {
        return this.conversationRepo.findOne({ where: { conversationId } });
    }

    async getConversation(conversationId: string): Promise<{
        conversation: QuoConversationEntity;
        messages: QuoMessageEntity[];
    } | null> {
        const conversation = await this.conversationRepo.findOne({ where: { conversationId } });
        if (!conversation) return null;
        const messages = await this.messageRepo.find({
            where: { conversationId },
            order: { sentAt: "ASC" },
            take: 500,
        });
        return { conversation, messages };
    }

    async markRead(conversationId: string): Promise<void> {
        await this.conversationRepo.update({ conversationId }, { unread: 0 });
    }

    // -------------------------------------------------------------------------
    // Webhook — real-time message ingest (poll stays as reconciliation)
    // -------------------------------------------------------------------------

    /** Shared-secret token in the webhook URL, derived from the API key. */
    static webhookToken(): string {
        const key = process.env.QUO_API_KEY || process.env.OPEN_PHONE_API_KEY || "";
        return crypto.createHash("sha256").update(`quo-webhook:${key}`).digest("hex").slice(0, 32);
    }

    static webhookUrl(): string | null {
        const base = process.env.QUO_WEBHOOK_BASE_URL || process.env.BASE_URL;
        if (!base) return null;
        return `${String(base).replace(/\/+$/, "")}/quo-inbox/webhook?token=${QuoInboxService.webhookToken()}`;
    }

    /** Register our message webhook with Quo (idempotent). */
    async ensureWebhook(): Promise<{ url: string | null; created: boolean; skipped?: string }> {
        const url = QuoInboxService.webhookUrl();
        if (!url) return { url: null, created: false, skipped: "BASE_URL is not configured" };
        if (!QuoInboxService.isConfigured()) return { url, created: false, skipped: "API key not configured" };

        const list = await this.apiGet("/webhooks", {});
        const hooks: any[] = list.data?.data || [];
        const existing = hooks.find((w) => String(w?.url || "") === url);
        if (existing) return { url, created: false };

        await this.client.post("/webhooks/messages", {
            url,
            events: ["message.received", "message.delivered"],
            resourceIds: ["*"],
            status: "enabled",
            label: "SecureStay Quo Inbox",
        });
        logger.info(`[QuoInbox] Registered message webhook at ${url.split("?")[0]}`);
        return { url, created: true };
    }

    /**
     * Ingest a message.* webhook event. Returns the conversationId and whether
     * it was an incoming message so the caller can schedule detection.
     *
     * Quo has shipped several payload shapes over API versions:
     *   - v2/v3: data.object = full message incl. phoneNumberId + conversationId
     *   - v4:    data.object = message with `text`, NO conversationId
     *   - beta:  data.resource = bare message; ids live in data.context
     *             (phoneNumberId, conversationId, senderIdentifier, recipientIdentifiers)
     * The original handler only understood the first shape and silently dropped
     * the rest (returned 200 with no log) — the webhook looked "registered and
     * enabled" while ingesting nothing. Normalize all shapes before processing.
     */
    async handleWebhookEvent(payload: any): Promise<{
        handled: boolean;
        conversationId?: string;
        incoming?: boolean;
    }> {
        const type = String(payload?.type || "");
        if (!type.startsWith("message.")) return { handled: false };
        const raw = payload?.data?.object || payload?.data?.resource || null;
        const ctx = payload?.data?.context || {};
        if (!raw?.id) {
            logger.warn(`[QuoInbox] Webhook ${type}: unrecognized payload shape — ${JSON.stringify(payload).slice(0, 400)}`);
            return { handled: false };
        }
        const m = {
            id: raw.id,
            phoneNumberId: raw.phoneNumberId || ctx.phoneNumberId || null,
            conversationId: raw.conversationId || ctx.conversationId || null,
            userId: raw.userId || ctx.userId || null,
            direction: raw.direction,
            from: raw.from || ctx.senderIdentifier || null,
            to: raw.to ?? ctx.recipientIdentifiers ?? null,
            text: raw.text ?? raw.body ?? null,
            media: raw.media,
            status: raw.status || null,
            createdAt: raw.createdAt || null,
        };
        if (!m.phoneNumberId) {
            logger.warn(`[QuoInbox] Webhook ${type}: no phoneNumberId in payload — ${JSON.stringify(payload).slice(0, 400)}`);
            return { handled: false };
        }

        const line = await this.lineRepo.findOne({ where: { phoneNumberId: m.phoneNumberId } });
        if (!line || !line.enabled) return { handled: false }; // excluded line (MAINT/Sales/…) — expected, no log

        const direction = m.direction === "outgoing" ? "outgoing" : "incoming";
        const toArr: string[] = Array.isArray(m.to) ? m.to : m.to ? [m.to] : [];
        const externalNums = (direction === "incoming" ? [m.from] : toArr).filter(Boolean);
        const text = m.text;
        const sentAt = m.createdAt ? new Date(m.createdAt) : new Date();

        let conversationId: string | null = m.conversationId || null;
        if (!conversationId && externalNums.length) {
            const existingConv = await this.conversationRepo.findOne({
                where: { phoneNumberId: line.phoneNumberId, participantPhone: externalNums[0] },
            });
            conversationId = existingConv?.conversationId || null;
        }
        if (!conversationId) {
            // Unknown thread — a quick line sync imports it with proper ids, then
            // report it back so detection / AI suggestion still run for it.
            await this.syncLine(line, false);
            line.lastSyncedAt = new Date();
            await this.lineRepo.save(line);
            if (externalNums.length) {
                const found = await this.conversationRepo.findOne({
                    where: { phoneNumberId: line.phoneNumberId, participantPhone: externalNums[0] },
                });
                if (found) {
                    return { handled: true, conversationId: found.conversationId, incoming: direction === "incoming" };
                }
            }
            logger.warn(`[QuoInbox] Webhook ${type}: could not resolve conversation for message ${m.id} on line ${line.name}`);
            return { handled: true };
        }

        // Message upsert (the poll may already have stored it).
        const exists = await this.messageRepo.findOne({ where: { externalId: m.id } });
        if (!exists) {
            await this.messageRepo.save(
                this.messageRepo.create({
                    externalId: m.id,
                    conversationId,
                    phoneNumberId: line.phoneNumberId,
                    body: text,
                    direction,
                    fromNumber: m.from || null,
                    toNumbers: toArr.join(",") || null,
                    mediaUrls: Array.isArray(m.media) && m.media.length
                        ? JSON.stringify(m.media.map((x: any) => x.url).filter(Boolean))
                        : null,
                    status: m.status || (type === "message.delivered" ? "delivered" : "received"),
                    quoUserId: m.userId || null,
                    senderName: direction === "outgoing" ? await this.resolveUserName(m.userId) : null,
                    sentAt,
                })
            );
        }

        let conv = await this.conversationRepo.findOne({ where: { conversationId } });
        const isNew = !conv;
        if (!conv) {
            conv = this.conversationRepo.create({
                conversationId,
                phoneNumberId: line.phoneNumberId,
                lineNumber: line.number,
                lineName: line.name,
                participantPhone: externalNums[0] || null,
                participants: externalNums.join(","),
                unread: 0,
                isArchived: 0,
            });
        }
        if (!conv.lastMessageAt || sentAt >= new Date(conv.lastMessageAt)) {
            conv.lastMessageText = text;
            conv.lastMessageAt = sentAt;
            conv.lastDirection = direction;
            if (direction === "incoming") conv.unread = 1;
        }
        conv.syncedAt = new Date();
        conv = await this.conversationRepo.save(conv);

        if ((isNew || !conv.reservationId) && conv.linkMethod !== "manual") {
            try {
                await this.resolveReservationLink(conv);
            } catch (err: any) {
                logger.warn(`[QuoInbox] Reservation link failed for ${conversationId}: ${err?.message}`);
            }
        }

        return { handled: true, conversationId, incoming: direction === "incoming" && !exists };
    }

    // -------------------------------------------------------------------------
    // Send
    // -------------------------------------------------------------------------

    async sendReply(conversationId: string, body: string, senderName?: string | null): Promise<QuoMessageEntity> {
        const conv = await this.conversationRepo.findOne({ where: { conversationId } });
        if (!conv) throw new Error("Conversation not found");
        if (!conv.lineNumber) throw new Error("Conversation has no line number");
        const to = (conv.participants || conv.participantPhone || "").split(",").filter(Boolean);
        if (!to.length) throw new Error("Conversation has no participants");

        const res = await this.client.post("/messages", {
            content: body,
            from: conv.lineNumber,
            to,
        });
        const sent = res.data?.data || {};
        const sentAt = sent.createdAt ? new Date(sent.createdAt) : new Date();

        const msg = await this.messageRepo.save(
            this.messageRepo.create({
                externalId: sent.id || `local-${Date.now()}`,
                conversationId,
                phoneNumberId: conv.phoneNumberId,
                body,
                direction: "outgoing",
                fromNumber: conv.lineNumber,
                toNumbers: to.join(","),
                status: sent.status || "sent",
                quoUserId: sent.userId || null,
                senderName: senderName || null,
                sentAt,
            })
        );

        conv.lastMessageText = body;
        conv.lastMessageAt = sentAt;
        conv.lastDirection = "outgoing";
        conv.unread = 0;
        await this.conversationRepo.save(conv);
        return msg;
    }
}
