import { MoreThanOrEqual } from "typeorm";
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
        opts: { since?: string | null; limit?: number } = {}
    ): Promise<{ settings: NotificationSettingsDto; events: NotificationEvent[] }> {
        const settings = await this.getSettings(userUid);
        if (!settings.notificationsEnabled) {
            return { settings, events: [] };
        }

        const limit = Math.min(Math.max(opts.limit ?? 40, 1), 80);
        const sinceIso =
            opts.since ||
            settings.lastSeenAt ||
            new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const since = new Date(sinceIso);
        if (!Number.isFinite(since.getTime())) {
            return { settings, events: [] };
        }

        const events: NotificationEvent[] = [];
        try {
            // Directed notifications (e.g. message escalations assigned to this user).
            try {
                const directed = await appDatabase.getRepository(UserDirectedNotificationEntity).find({
                    where: {
                        userUid,
                        createdAt: MoreThanOrEqual(since) as any,
                    },
                    order: { createdAt: "DESC" },
                    take: limit,
                });
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
                const rows: any[] = await appDatabase.query(
                    `SELECT m.id AS messageId, m.threadId, m.sentAt, m.body,
                            c.guestName, c.listingName
                     FROM inbox_messages m
                     JOIN inbox_conversations c ON c.threadId = m.threadId
                     WHERE m.direction = 'incoming'
                       AND COALESCE(m.isAutomatic, 0) = 0
                       AND m.sentAt >= ?
                     ORDER BY m.sentAt DESC
                     LIMIT ?`,
                    [since, Math.ceil(limit / 2)]
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
                const rows: any[] = await appDatabase.query(
                    `SELECT id, guestName, listingName, status, reservationDate
                     FROM reservation_info
                     WHERE reservationDate IS NOT NULL
                       AND reservationDate <> ''
                       AND reservationDate >= ?
                       AND LOWER(COALESCE(status, '')) NOT IN (
                           'cancelled','canceled','inquiry','expired','declined','denied','blocked'
                       )
                     ORDER BY reservationDate DESC
                     LIMIT ?`,
                    [since, Math.ceil(limit / 3)]
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
                const rows: any[] = await appDatabase.query(
                    `SELECT id, guestName, listingName, item, createdAt
                     FROM action_items
                     WHERE createdAt >= ?
                       AND deletedAt IS NULL
                     ORDER BY createdAt DESC
                     LIMIT ?`,
                    [since, Math.ceil(limit / 3)]
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
        return { settings, events: events.slice(0, limit) };
    }
}
