import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { QuoPhoneLineEntity } from "../entity/QuoPhoneLine";
import { QuoConversationEntity } from "../entity/QuoConversation";
import { QuoMessageEntity } from "../entity/QuoMessage";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { ClientEntity } from "../entity/Client";
import { ReservationQuoConversationEntity } from "../entity/ReservationQuoConversation";
import { In } from "typeorm";

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
    private reservationQuoLinkRepo = appDatabase.getRepository(ReservationQuoConversationEntity);

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
                        aiAutoRespondEnabled: 0,
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

    async updateLine(id: number, patch: { enabled?: boolean; category?: string; name?: string; aiAutoRespondEnabled?: boolean }): Promise<QuoPhoneLineEntity | null> {
        const line = await this.lineRepo.findOne({ where: { id } });
        if (!line) return null;
        if (patch.enabled !== undefined) line.enabled = patch.enabled ? 1 : 0;
        if (patch.aiAutoRespondEnabled !== undefined) line.aiAutoRespondEnabled = patch.aiAutoRespondEnabled ? 1 : 0;
        if (patch.category !== undefined) {
            line.category = patch.category;
            QuoInboxService.lineCategoryCache = null; // AI persona routing reads this
        }
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
        // Skipped on PM lines: those are owner chats, and owner-block
        // reservations carry the owner's phone, which would false-link the
        // thread to a "reservation" and flip the AI into guest mode.
        if (line.category !== "PM" && (isNew || !conv.reservationId) && conv.linkMethod !== "manual") {
            try {
                await this.resolveReservationLink(conv);
            } catch (err: any) {
                logger.warn(`[QuoInbox] Reservation link failed for ${conv.conversationId}: ${err?.message}`);
            }
        }

        // PM client linking — PM lines carry owner chats; match against clients.
        if (!conv.pmClientId && conv.pmClientLinkMethod !== "manual" && line.category === "PM") {
            try {
                await this.resolvePmClientLink(conv);
            } catch (err: any) {
                logger.warn(`[QuoInbox] PM client link failed for ${conv.conversationId}: ${err?.message}`);
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

    // -------------------------------------------------------------------------
    // PM client linking — conversations on PM lines are chats with property
    // OWNERS (our management clients), not guests. Link them to
    // client_management so the AI gets the client's profile + portfolio.
    // -------------------------------------------------------------------------

    /** phoneNumberId -> line category, cached per process for 10 minutes. */
    private static lineCategoryCache: { map: Map<string, string>; fetchedAt: number } | null = null;

    async lineCategory(phoneNumberId: string): Promise<string | null> {
        const now = Date.now();
        if (!QuoInboxService.lineCategoryCache || now - QuoInboxService.lineCategoryCache.fetchedAt > 10 * 60 * 1000) {
            const lines = await this.lineRepo.find();
            QuoInboxService.lineCategoryCache = {
                map: new Map(lines.map((l) => [l.phoneNumberId, l.category])),
                fetchedAt: now,
            };
        }
        return QuoInboxService.lineCategoryCache.map.get(phoneNumberId) || null;
    }

    /**
     * Match the participant phone against client_management (primary phone) and
     * client_secondary_contacts. Last-10-digit comparison, same as reservations.
     */
    async resolvePmClientLink(conv: QuoConversationEntity): Promise<boolean> {
        const d = QuoInboxService.digits(conv.participantPhone);
        if (d.length < 10) return false;
        const last10 = d.slice(-10);
        const norm = (col: string) =>
            `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col},''),' ',''),'-',''),'(',''),')',''),'+','')`;
        const displayName = (c: { preferredName?: string | null; firstName?: string | null; lastName?: string | null }) =>
            [c.preferredName || c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null;

        // Primary contact first, then secondary contacts (spouse/assistant).
        let clientId: string | null = null;
        let clientName: string | null = null;
        const primary = await appDatabase
            .getRepository(ClientEntity)
            .createQueryBuilder("c")
            .where(`${norm("c.phone")} LIKE :p`, { p: `%${last10}` })
            .getOne();
        if (primary) {
            clientId = primary.id;
            clientName = displayName(primary);
        } else {
            const { ClientSecondaryContact } = await import("../entity/ClientSecondaryContact");
            const sec = await appDatabase
                .getRepository(ClientSecondaryContact)
                .createQueryBuilder("s")
                .innerJoinAndSelect("s.client", "c")
                .where(`${norm("s.phone")} LIKE :p`, { p: `%${last10}` })
                .getOne();
            if (sec?.client) {
                clientId = sec.client.id;
                const primaryName = displayName(sec.client);
                const contactName = [sec.firstName, sec.lastName].filter(Boolean).join(" ").trim();
                clientName = contactName && contactName !== primaryName ? `${contactName} (for ${primaryName})` : primaryName;
            }
        }
        if (!clientId) return false;
        conv.pmClientId = clientId;
        conv.pmClientName = clientName;
        conv.pmClientLinkMethod = "phone";
        await this.conversationRepo.save(conv);
        return true;
    }

    /**
     * Service package per PM client ("FULL" | "PRO" | "LAUNCH" | "MIXED"),
     * derived from their properties' property_service_info rows —
     * client_management.serviceType is almost never filled in, the per-property
     * table is the source of truth. FULL = we handle cleaning/maintenance;
     * PRO/LAUNCH = the client handles those themselves.
     */
    async pmClientServicePackages(clientIds: string[]): Promise<Map<string, string>> {
        const ids = [...new Set(clientIds.filter(Boolean))];
        const map = new Map<string, string>();
        if (!ids.length) return map;
        try {
            const rows: any[] = await appDatabase.query(
                `SELECT cm.id AS clientId,
                        UPPER(TRIM(COALESCE(psi.serviceType, cm.serviceType, ''))) AS svc
                 FROM client_management cm
                 LEFT JOIN client_properties cp ON cp.clientId = cm.id AND cp.deletedAt IS NULL
                 LEFT JOIN property_service_info psi ON psi.clientPropertyId = cp.id AND psi.deletedAt IS NULL
                 WHERE cm.id IN (${ids.map(() => "?").join(",")})`,
                ids
            );
            const byClient = new Map<string, Set<string>>();
            for (const r of rows) {
                const svc = String(r.svc || "").replace(/_SERVICE$/, "").trim();
                if (!svc) continue;
                if (!byClient.has(r.clientId)) byClient.set(r.clientId, new Set());
                byClient.get(r.clientId)!.add(svc);
            }
            for (const [cid, types] of byClient) {
                const arr = [...types];
                map.set(cid, arr.length === 1 ? arr[0] : "MIXED");
            }
        } catch {
            /* badge is best-effort */
        }
        return map;
    }

    /** Decorate conversation rows with pmClientServicePackage for the dashboard. */
    private async attachPmServicePackages(convs: QuoConversationEntity[]): Promise<void> {
        const ids = convs.map((c) => c.pmClientId).filter(Boolean) as string[];
        if (!ids.length) return;
        const map = await this.pmClientServicePackages(ids);
        for (const c of convs) {
            (c as any).pmClientServicePackage = c.pmClientId ? map.get(c.pmClientId) ?? null : null;
        }
    }

    /** Manual PM-client link/unlink from the dashboard. */
    async manualLinkClient(conversationId: string, clientId: string | null): Promise<QuoConversationEntity | null> {
        const conv = await this.conversationRepo.findOne({ where: { conversationId } });
        if (!conv) return null;
        if (!clientId) {
            conv.pmClientId = null;
            conv.pmClientName = null;
            conv.pmClientLinkMethod = null;
        } else {
            const client = await appDatabase.getRepository(ClientEntity).findOne({ where: { id: clientId } });
            if (!client) return null;
            conv.pmClientId = client.id;
            conv.pmClientName =
                [client.preferredName || client.firstName, client.lastName].filter(Boolean).join(" ").trim() || null;
            conv.pmClientLinkMethod = "manual";
        }
        const saved = await this.conversationRepo.save(conv);
        await this.attachPmServicePackages([saved]);
        return saved;
    }

    /**
     * Backfill sweep: link any PM-line conversation that has no client yet.
     * Runs after the daily owner sync so fresh client phone numbers take effect;
     * cheap to rerun (skips manual links and already-linked threads).
     */
    async relinkPmClients(): Promise<{ scanned: number; linked: number }> {
        const convs = await this.conversationRepo
            .createQueryBuilder("c")
            .where("c.pmClientId IS NULL")
            .andWhere("(c.pmClientLinkMethod IS NULL OR c.pmClientLinkMethod != 'manual')")
            .andWhere("c.phoneNumberId IN (SELECT phoneNumberId FROM quo_phone_lines WHERE category = 'PM')")
            .getMany();
        let linked = 0;
        for (const conv of convs) {
            try {
                if (await this.resolvePmClientLink(conv)) linked++;
            } catch (err: any) {
                logger.warn(`[QuoInbox] PM client relink failed for ${conv.conversationId}: ${err?.message}`);
            }
        }
        if (linked) logger.info(`[QuoInbox] PM client relink: linked ${linked}/${convs.length} conversation(s)`);
        return { scanned: convs.length, linked };
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
        await this.attachPmServicePackages(conversations);
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
        await this.attachPmServicePackages([conversation]);
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

        // (Same PM-line skip as the poll path — owner phones false-match reservations.)
        if (line.category !== "PM" && (isNew || !conv.reservationId) && conv.linkMethod !== "manual") {
            try {
                await this.resolveReservationLink(conv);
            } catch (err: any) {
                logger.warn(`[QuoInbox] Reservation link failed for ${conversationId}: ${err?.message}`);
            }
        }

        if (!conv.pmClientId && conv.pmClientLinkMethod !== "manual" && line.category === "PM") {
            try {
                await this.resolvePmClientLink(conv);
            } catch (err: any) {
                logger.warn(`[QuoInbox] PM client link failed for ${conversationId}: ${err?.message}`);
            }
        }

        return { handled: true, conversationId, incoming: direction === "incoming" && !exists };
    }

    // -------------------------------------------------------------------------
    // Send
    // -------------------------------------------------------------------------

    async sendReply(
        conversationId: string,
        body: string,
        senderName?: string | null,
        sentByUserId?: number | null
    ): Promise<QuoMessageEntity> {
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

        const externalId = String(sent.id || `local-${Date.now()}`);
        let msg: QuoMessageEntity;
        try {
            msg = await this.messageRepo.save(
                this.messageRepo.create({
                    externalId,
                    conversationId,
                    phoneNumberId: conv.phoneNumberId,
                    body,
                    direction: "outgoing",
                    fromNumber: conv.lineNumber,
                    toNumbers: to.join(","),
                    status: sent.status || "sent",
                    quoUserId: sent.userId || null,
                    senderName: senderName || null,
                    sentByUserId: sentByUserId ?? null,
                    sentAt,
                })
            );
        } catch (err: any) {
            // Webhook can store the same OpenPhone message id before this save
            // finishes — guest already got the SMS; adopt that row instead of 500.
            if (!String(err?.message || "").includes("Duplicate entry")) throw err;
            const existing = await this.messageRepo.findOne({ where: { externalId } });
            if (!existing) throw err;
            if (senderName) existing.senderName = senderName;
            if (sentByUserId != null) existing.sentByUserId = sentByUserId;
            if (body && !existing.body) existing.body = body;
            msg = await this.messageRepo.save(existing);
            logger.info(`[QuoInbox] outgoing ${externalId} already stored by webhook — attributed`);
        }

        conv.lastMessageText = body;
        conv.lastMessageAt = sentAt;
        conv.lastDirection = "outgoing";
        conv.unread = 0;
        await this.conversationRepo.save(conv);
        return msg;
    }

    // -------------------------------------------------------------------------
    // Inbox v2 integration: portfolio line lookup, per-reservation Quo threads,
    // multi-attach, search-for-attach, and outbound call initiation.
    // -------------------------------------------------------------------------

    /**
     * Detect the "G1" / "G2" portfolio marker on a Quo line — the operator's
     * convention is to encode it in the line's symbol/name (e.g. "GR G1",
     * "G2 GR"). Returns "G1" | "G2" | null.
     */
    private static detectPortfolio(line: QuoPhoneLineEntity): "G1" | "G2" | null {
        const haystack = `${line.symbol || ""} ${line.name || ""}`;
        if (/\bG1\b|\bGroup ?1\b/i.test(haystack)) return "G1";
        if (/\bG2\b|\bGroup ?2\b/i.test(haystack)) return "G2";
        return null;
    }

    /**
     * Enabled Quo lines matching a category (e.g. "GR") and portfolio ("G1" /
     * "G2"). Used by the inbox v2 Quo tab to pick the correct outbound line
     * when the guest has no Quo thread yet.
     */
    async linesForPortfolio(
        category: string,
        portfolio: "G1" | "G2" | string | null
    ): Promise<QuoPhoneLineEntity[]> {
        const lines = await this.lineRepo.find({
            where: { category, enabled: 1 as any },
        });
        const normalized = String(portfolio || "").toUpperCase();
        if (normalized !== "G1" && normalized !== "G2") return lines;
        return lines.filter((line) => QuoInboxService.detectPortfolio(line) === normalized);
    }

    /**
     * Every Quo conversation attached to a reservation:
     *   1. explicit auto-link on quo_conversations.reservationId (matched at
     *      sync time by phone),
     *   2. manual attachments from reservation_quo_conversation,
     *   3. **phone-match fallback** against the reservation's guest phone — v1
     *      finds Quo conversations this way (see /messages/inbox behaviour),
     *      so v2 needs the same fallback for reservations whose auto-link
     *      never ran (or ran before the phone was known). Matching is done
     *      on the last 10 digits so different E.164 formats agree.
     * Ordered newest activity first so the most recent Quo thread surfaces
     * as the first Quo tab in the UI.
     */
    async listConversationsForReservation(reservationId: number): Promise<QuoConversationEntity[]> {
        const reservation = await this.reservationRepo.findOne({ where: { id: reservationId } });
        const [primary, links] = await Promise.all([
            this.conversationRepo.find({ where: { reservationId, isArchived: 0 } }),
            this.reservationQuoLinkRepo.find({ where: { reservationId } }),
        ]);
        const attachedIds = links
            .filter((row) => row.isSuppressed !== 1)
            .map((row) => row.quoConversationId)
            .filter(Boolean);
        const suppressedIds = new Set(
            links
                .filter((row) => row.isSuppressed === 1)
                .map((row) => row.quoConversationId)
                .filter(Boolean)
        );
        const attached = attachedIds.length
            ? await this.conversationRepo.find({
                  where: { conversationId: In(attachedIds), isArchived: 0 },
              })
            : [];

        // Phone-match fallback — mirrors v1's discovery. Only apply when the
        // reservation has a phone; last-10-digit match sidesteps E.164 vs
        // (xxx) xxx-xxxx formatting differences that trip an equality join.
        let phoneMatches: QuoConversationEntity[] = [];
        const digits = QuoInboxService.digits(reservation?.phone || null);
        const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
        if (last10 && last10.length >= 7) {
            phoneMatches = await this.conversationRepo
                .createQueryBuilder("c")
                .where("c.isArchived = 0")
                .andWhere(
                    "RIGHT(REGEXP_REPLACE(COALESCE(c.participantPhone, ''), '[^0-9]', ''), 10) = :last10",
                    { last10 }
                )
                .getMany();
        }

        const dedup = new Map<string, QuoConversationEntity>();
        for (const conv of [...primary, ...attached, ...phoneMatches]) {
            if (suppressedIds.has(conv.conversationId)) continue;
            if (!dedup.has(conv.conversationId)) dedup.set(conv.conversationId, conv);
        }
        const conversations = Array.from(dedup.values()).sort((a, b) => {
            const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
            const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
            return bTime - aTime;
        });
        await this.attachPmServicePackages(conversations);
        return conversations;
    }

    /**
     * Attach an existing Quo conversation to a reservation as a secondary
     * link — the auto-link on quo_conversations.reservationId isn't touched.
     * Idempotent: re-attaching un-hides a previously-suppressed pair.
     */
    async attachConversation(
        reservationId: number,
        quoConversationId: string,
        createdBy?: string | null
    ): Promise<ReservationQuoConversationEntity> {
        const existing = await this.reservationQuoLinkRepo.findOne({
            where: { reservationId, quoConversationId },
        });
        if (existing) {
            if (existing.isSuppressed) {
                existing.isSuppressed = 0;
                await this.reservationQuoLinkRepo.save(existing);
            }
            return existing;
        }
        return this.reservationQuoLinkRepo.save(
            this.reservationQuoLinkRepo.create({
                reservationId,
                quoConversationId,
                isSuppressed: 0,
                createdBy: createdBy || null,
            })
        );
    }

    /**
     * Hide a Quo conversation from a reservation. Because the inbox v2 tab
     * strip resolves conversations from three sources (auto-link, manual
     * attachment, phone-match fallback), a naive delete on the join table
     * would leave the auto-linked or phone-matched conversation reappearing
     * on the next reload. This upserts an isSuppressed=1 marker AND clears
     * the auto-link on quo_conversations.reservationId when it points at
     * this reservation, so the tab actually stays closed.
     */
    async detachConversation(
        reservationId: number,
        quoConversationId: string,
        createdBy?: string | null
    ): Promise<boolean> {
        const existing = await this.reservationQuoLinkRepo.findOne({
            where: { reservationId, quoConversationId },
        });
        if (existing) {
            if (existing.isSuppressed !== 1) {
                existing.isSuppressed = 1;
                await this.reservationQuoLinkRepo.save(existing);
            }
        } else {
            await this.reservationQuoLinkRepo.save(
                this.reservationQuoLinkRepo.create({
                    reservationId,
                    quoConversationId,
                    isSuppressed: 1,
                    createdBy: createdBy || null,
                })
            );
        }
        // Clear the auto-link if it points at this reservation — otherwise a
        // full re-list would still return this conversation via the primary
        // fetch. Only touches the row when the reservationId matches.
        const conv = await this.conversationRepo.findOne({ where: { conversationId: quoConversationId } });
        if (conv && conv.reservationId === reservationId) {
            conv.reservationId = null;
            conv.listingId = null;
            conv.listingName = null;
            conv.guestName = null;
            conv.linkMethod = null;
            await this.conversationRepo.save(conv);
        }
        return true;
    }

    /**
     * Search Quo conversations for the attach modal. Matches on participant
     * phone (last-4 or full E.164), contact/guest name, or line name.
     */
    async searchConversations(opts: {
        phone?: string | null;
        keyword?: string | null;
        limit?: number;
    }): Promise<QuoConversationEntity[]> {
        const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
        const qb = this.conversationRepo
            .createQueryBuilder("c")
            .where("c.isArchived = 0")
            .orderBy("c.lastMessageAt", "DESC")
            .take(limit);

        const phone = String(opts.phone || "").trim();
        const digits = phone.replace(/\D+/g, "");
        const keyword = String(opts.keyword || "").trim();

        if (!phone && !keyword) return [];

        if (phone) {
            const digitsLike = digits.length >= 4 ? `%${digits.slice(-10)}%` : `%${digits}%`;
            qb.andWhere(
                "(c.participantPhone LIKE :phone OR REPLACE(REPLACE(REPLACE(REPLACE(c.participantPhone, '+', ''), '-', ''), ' ', ''), '(', '') LIKE :digitsLike)",
                { phone: `%${phone}%`, digitsLike }
            );
        }
        if (keyword) {
            const kw = `%${keyword}%`;
            qb.andWhere(
                "(c.contactName LIKE :kw OR c.guestName LIKE :kw OR c.lineName LIKE :kw OR c.participants LIKE :kw)",
                { kw }
            );
        }

        return qb.getMany();
    }

    /**
     * Initiate an outbound call from a Quo line. Returns Quo's response
     * envelope on success, or a `{ fallback: "tel:…" }` object when Quo's
     * calls endpoint isn't available on this account (older API tiers) so the
     * frontend can degrade gracefully to a `tel:` link.
     */
    async initiateCall(
        phoneNumberId: string,
        to: string
    ): Promise<{ status: "started" | "fallback"; data: any; fallbackHref?: string }> {
        try {
            const res = await this.client.post("/calls", {
                from: phoneNumberId,
                to: [to],
            });
            return { status: "started", data: res.data?.data ?? res.data ?? null };
        } catch (err: any) {
            const code = err?.response?.status;
            // Quo's REST call-create is gated on paid plans. Any 4xx that
            // isn't auth (401/403) means "not available" — surface a tel:
            // fallback rather than a hard error.
            if (code && code >= 400 && code < 500 && code !== 401 && code !== 403) {
                logger.warn(`[QuoInbox] initiateCall not supported (${code}); falling back to tel: for ${to}`);
                return {
                    status: "fallback",
                    data: null,
                    fallbackHref: `tel:${to.replace(/[^+\d]/g, "")}`,
                };
            }
            throw err;
        }
    }
}
