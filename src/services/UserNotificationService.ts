import { appDatabase } from "../utils/database.util";
import { UserNotificationSettingsEntity } from "../entity/UserNotificationSettings";
import { UserDirectedNotificationEntity } from "../entity/UserDirectedNotification";
import logger from "../utils/logger.utils";

export type NotificationSettingsDto = {
    notificationsEnabled: boolean;
    soundEnabled: boolean;
    notifyMessages: boolean;
    notifyReservations: boolean;
    notifyActionItems: boolean;
    lastSeenAt: string | null;
};

export type NotificationEvent = {
    id: string;
    type: "message" | "reservation" | "action_item" | "escalation";
    title: string;
    body: string;
    href: string;
    createdAt: string;
};

type NotificationListResponse = {
    settings: NotificationSettingsDto;
    events: NotificationEvent[];
    hasMore: boolean;
    nextBefore: string | null;
};

const DEFAULTS: Omit<NotificationSettingsDto, "lastSeenAt"> = {
    notificationsEnabled: true,
    soundEnabled: true,
    notifyMessages: true,
    notifyReservations: true,
    notifyActionItems: true,
};

export class UserNotificationService {
    private repo() {
        return appDatabase.getRepository(UserNotificationSettingsEntity);
    }

    private toDto(row: UserNotificationSettingsEntity | null): NotificationSettingsDto {
        if (!row) {
            return { ...DEFAULTS, lastSeenAt: null };
        }
        return {
            notificationsEnabled: !!row.notificationsEnabled,
            soundEnabled: !!row.soundEnabled,
            notifyMessages: !!row.notifyMessages,
            notifyReservations: !!row.notifyReservations,
            notifyActionItems: !!row.notifyActionItems,
            lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
        };
    }

    async getSettings(userUid: string): Promise<NotificationSettingsDto> {
        if (!userUid) return { ...DEFAULTS, lastSeenAt: null };
        const row = await this.repo().findOne({ where: { userUid } });
        return this.toDto(row);
    }

    async updateSettings(
        userUid: string,
        patch: Partial<Omit<NotificationSettingsDto, "lastSeenAt">>
    ): Promise<NotificationSettingsDto> {
        if (!userUid) throw new Error("userUid required");
        let row = await this.repo().findOne({ where: { userUid } });
        if (!row) {
            row = this.repo().create({
                userUid,
                ...DEFAULTS,
                lastSeenAt: null,
            });
        }
        if (patch.notificationsEnabled !== undefined) row.notificationsEnabled = !!patch.notificationsEnabled;
        if (patch.soundEnabled !== undefined) row.soundEnabled = !!patch.soundEnabled;
        if (patch.notifyMessages !== undefined) row.notifyMessages = !!patch.notifyMessages;
        if (patch.notifyReservations !== undefined) row.notifyReservations = !!patch.notifyReservations;
        if (patch.notifyActionItems !== undefined) row.notifyActionItems = !!patch.notifyActionItems;
        await this.repo().save(row);
        return this.toDto(row);
    }

    async markSeen(userUid: string, at?: string | null): Promise<NotificationSettingsDto> {
        if (!userUid) throw new Error("userUid required");
        let row = await this.repo().findOne({ where: { userUid } });
        if (!row) {
            row = this.repo().create({
                userUid,
                ...DEFAULTS,
                lastSeenAt: null,
            });
        }
        row.lastSeenAt = at ? new Date(at) : new Date();
        await this.repo().save(row);
        return this.toDto(row);
    }

    /**
     * Recent events for the notification center. Filtered by the caller's
     * per-user type toggles. `since` defaults to lastSeenAt or 24h ago.
     */
    async listEvents(
        userUid: string,
        opts: { since?: string | null; before?: string | null; limit?: number } = {}
    ): Promise<NotificationListResponse> {
        const settings = await this.getSettings(userUid);
        if (!settings.notificationsEnabled) {
            return { settings, events: [], hasMore: false, nextBefore: null };
        }

        const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
        const pageLimit = limit + 1;
        const before = opts.before ? new Date(opts.before) : null;
        const beforeValid = before && Number.isFinite(before.getTime()) ? before : null;
        const sinceIso =
            beforeValid ? null :
            opts.since ||
            settings.lastSeenAt ||
            new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const since = sinceIso ? new Date(sinceIso) : null;
        if (since && !Number.isFinite(since.getTime())) {
            return { settings, events: [], hasMore: false, nextBefore: null };
        }

        const events: NotificationEvent[] = [];
        try {
            // Directed notifications (e.g. message escalations assigned to this user).
            try {
                const directedParams: any[] = [userUid];
                const directedWhere = ["userUid = ?"];
                if (beforeValid) {
                    directedWhere.push("createdAt < ?");
                    directedParams.push(beforeValid);
                } else if (since) {
                    directedWhere.push("createdAt >= ?");
                    directedParams.push(since);
                }
                directedParams.push(pageLimit);
                const directed: UserDirectedNotificationEntity[] = await appDatabase.query(
                    `SELECT id, type, title, body, href, createdAt
                     FROM user_directed_notifications
                     WHERE ${directedWhere.join(" AND ")}
                     ORDER BY createdAt DESC
                     LIMIT ?`,
                    directedParams
                );
                for (const d of directed) {
                    events.push({
                        id: `directed:${d.id}`,
                        type: (d.type as NotificationEvent["type"]) || "escalation",
                        title: d.title,
                        body: d.body || "",
                        href: d.href,
                        createdAt: new Date(d.createdAt).toISOString(),
                    });
                }
            } catch (dirErr: any) {
                logger.warn(`[UserNotification] directed fetch failed: ${dirErr?.message}`);
            }

            if (settings.notifyMessages) {
                const messageParams: any[] = [];
                const messageWindow = beforeValid ? "m.sentAt < ?" : "m.sentAt >= ?";
                messageParams.push(beforeValid || since);
                messageParams.push(Math.ceil(pageLimit / 2));
                const rows: any[] = await appDatabase.query(
                    `SELECT m.id AS messageId, m.threadId, m.sentAt, m.body,
                            c.guestName, c.listingName
                     FROM inbox_messages m
                     JOIN inbox_conversations c ON c.threadId = m.threadId
                     WHERE m.direction = 'incoming'
                       AND COALESCE(m.isAutomatic, 0) = 0
                       AND ${messageWindow}
                     ORDER BY m.sentAt DESC
                     LIMIT ?`,
                    messageParams
                );
                for (const r of rows) {
                    const snippet = String(r.body || "")
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 140);
                    events.push({
                        id: `message:${r.messageId}`,
                        type: "message",
                        title: `New message · ${r.guestName || "Guest"}`,
                        body: snippet || (r.listingName ? String(r.listingName) : "Open conversation"),
                        href: `/messages/inbox-v2?thread=${r.threadId}`,
                        createdAt: new Date(r.sentAt).toISOString(),
                    });
                }
            }

            if (settings.notifyReservations) {
                // reservation_info has no createdAt — Hostify's reservationDate is the booking time.
                const reservationParams: any[] = [];
                const reservationWindow = beforeValid ? "reservationDate < ?" : "reservationDate >= ?";
                reservationParams.push(beforeValid || since);
                reservationParams.push(Math.ceil(pageLimit / 3));
                const rows: any[] = await appDatabase.query(
                    `SELECT id, guestName, listingName, status, reservationDate
                     FROM reservation_info
                     WHERE reservationDate IS NOT NULL
                       AND reservationDate <> ''
                       AND ${reservationWindow}
                       AND LOWER(COALESCE(status, '')) NOT IN (
                           'cancelled','canceled','inquiry','expired','declined','denied','blocked'
                       )
                     ORDER BY reservationDate DESC
                     LIMIT ?`,
                    reservationParams
                );
                for (const r of rows) {
                    const when = new Date(r.reservationDate);
                    if (!Number.isFinite(when.getTime())) continue;
                    events.push({
                        id: `reservation:${r.id}`,
                        type: "reservation",
                        title: `New reservation · ${r.guestName || "Guest"}`,
                        body: `${r.listingName || "Property"}${r.status ? ` · ${r.status}` : ""}`,
                        href: `/messages/inbox-v2?search=${encodeURIComponent(String(r.guestName || r.id))}`,
                        createdAt: when.toISOString(),
                    });
                }
            }

            if (settings.notifyActionItems) {
                const actionParams: any[] = [];
                const actionWindow = beforeValid ? "createdAt < ?" : "createdAt >= ?";
                actionParams.push(beforeValid || since);
                actionParams.push(Math.ceil(pageLimit / 3));
                const rows: any[] = await appDatabase.query(
                    `SELECT id, guestName, listingName, item, createdAt
                     FROM action_items
                     WHERE ${actionWindow}
                       AND deletedAt IS NULL
                     ORDER BY createdAt DESC
                     LIMIT ?`,
                    actionParams
                );
                for (const r of rows) {
                    events.push({
                        id: `action_item:${r.id}`,
                        type: "action_item",
                        title: `Action item · ${r.guestName || r.listingName || "Task"}`,
                        body: String(r.item || "New action item").replace(/\s+/g, " ").trim().slice(0, 140),
                        href: `/messages/action-items`,
                        createdAt: new Date(r.createdAt).toISOString(),
                    });
                }
            }
        } catch (err: any) {
            logger.warn(`[UserNotification] listEvents failed: ${err?.message}`);
        }

        events.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        const page = events.slice(0, limit);
        return {
            settings,
            events: page,
            hasMore: events.length > limit,
            nextBefore: page[page.length - 1]?.createdAt || null,
        };
    }
}
