import { appDatabase } from "../utils/database.util";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { ListingGroupMapEntity } from "../entity/ListingGroupMap";

/**
 * When Hostify converts an inquiry into a booking it often leaves the original
 * inquiry thread around alongside a new "accepted" thread for the same guest,
 * property, and check-in day (Anj / Stephanie, Jul 2026). The inquiry is dead
 * weight: CI Today, New inquiries, and the AI sales path all treat it as live.
 *
 * Match is intentionally narrow: same guest name (required) + same property
 * (listing or listing group) + same check-in day. GuestId alone is not enough —
 * Hostify reuses ids across guests and we must not hide an unrelated inquiry.
 */

export function isInquiryLikeStatus(status?: string | null): boolean {
    const s = String(status || "").toLowerCase();
    if (!s) return false;
    return (
        s.startsWith("inquiry") ||
        s.startsWith("preapproved") ||
        s.startsWith("offer") ||
        s.startsWith("pending")
    );
}

export function isAcceptedStayStatus(status?: string | null): boolean {
    const s = String(status || "").toLowerCase();
    return s === "accepted" || s === "confirmed" || s.startsWith("checked");
}

/** Normalize guest names for equality: trim + collapse whitespace + casefold. */
export function normalizeGuestName(name?: string | null): string {
    return String(name || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

/**
 * SQL fragment for listConversations. Expects aliases:
 *   c   = inbox_conversations (the candidate row)
 *   lgm = listing_group_map for c.listingId (may be NULL)
 *
 * Returns true (row kept) unless c is an inquiry superseded by an accepted stay
 * for the same guest name.
 */
export const NOT_SUPERSEDED_INQUIRY_SQL = `
(
    NOT (
        (
            LOWER(COALESCE(c.reservationStatus, '')) LIKE 'inquiry%'
            OR LOWER(COALESCE(c.reservationStatus, '')) LIKE 'preapproved%'
            OR LOWER(COALESCE(c.reservationStatus, '')) LIKE 'offer%'
            OR LOWER(COALESCE(c.reservationStatus, '')) LIKE 'pending%'
        )
        AND c.checkin IS NOT NULL
        AND c.guestName IS NOT NULL
        AND TRIM(c.guestName) <> ''
        AND (
            EXISTS (
                SELECT 1
                FROM inbox_conversations acc
                LEFT JOIN listing_group_map lgm_acc ON lgm_acc.listingId = acc.listingId
                WHERE acc.threadId <> c.threadId
                  AND acc.isArchived = 0
                  AND acc.checkin IS NOT NULL
                  AND DATE(acc.checkin) = DATE(c.checkin)
                  AND acc.guestName IS NOT NULL
                  AND TRIM(acc.guestName) <> ''
                  AND LOWER(TRIM(acc.guestName)) = LOWER(TRIM(c.guestName))
                  AND (
                      LOWER(COALESCE(acc.reservationStatus, '')) IN ('accepted', 'confirmed')
                      OR LOWER(COALESCE(acc.reservationStatus, '')) LIKE 'checked%'
                  )
                  AND (
                      (c.listingId IS NOT NULL AND acc.listingId = c.listingId)
                      OR (lgm.groupId IS NOT NULL AND lgm_acc.groupId IS NOT NULL AND lgm.groupId = lgm_acc.groupId)
                  )
            )
            OR EXISTS (
                SELECT 1
                FROM reservation_info r
                LEFT JOIN listing_group_map lgm_r ON lgm_r.listingId = r.listingMapId
                WHERE r.arrivalDate IS NOT NULL
                  AND DATE(r.arrivalDate) = DATE(c.checkin)
                  AND (c.reservationId IS NULL OR r.id <> c.reservationId)
                  AND r.guestName IS NOT NULL
                  AND TRIM(r.guestName) <> ''
                  -- reservation_info and inbox_conversations were created with
                  -- different default collations in prod (utf8mb4_general_ci vs
                  -- utf8mb4_unicode_ci); force a common collation so equality
                  -- doesn't raise "Illegal mix of collations".
                  AND LOWER(TRIM(r.guestName)) COLLATE utf8mb4_unicode_ci = LOWER(TRIM(c.guestName)) COLLATE utf8mb4_unicode_ci
                  AND (
                      LOWER(COALESCE(r.status, '')) IN ('accepted', 'confirmed')
                      OR LOWER(COALESCE(r.status, '')) LIKE 'checked%'
                  )
                  AND (
                      (c.listingId IS NOT NULL AND r.listingMapId = c.listingId)
                      OR (lgm.groupId IS NOT NULL AND lgm_r.groupId IS NOT NULL AND lgm.groupId = lgm_r.groupId)
                  )
            )
        )
    )
)
`;

/**
 * Async check used by getConversation / AI / ticket detection — same rules as
 * the list SQL, but against a single hydrated conversation row.
 */
export async function isInquirySupersededByAcceptedStay(
    conversation: Pick<
        InboxConversationEntity,
        | "threadId"
        | "reservationStatus"
        | "reservationId"
        | "listingId"
        | "guestId"
        | "guestName"
        | "guestPhone"
        | "guestEmail"
        | "checkin"
    >
): Promise<boolean> {
    if (!isInquiryLikeStatus(conversation.reservationStatus)) return false;
    if (!conversation.checkin) return false;

    const guestName = normalizeGuestName(conversation.guestName);
    if (!guestName) return false;

    const rawCheckin: any = conversation.checkin;
    const checkin =
        rawCheckin instanceof Date
            ? rawCheckin.toISOString().slice(0, 10)
            : String(rawCheckin).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin)) return false;

    let groupId: number | null = null;
    if (conversation.listingId) {
        const map = await appDatabase.getRepository(ListingGroupMapEntity).findOne({
            where: { listingId: Number(conversation.listingId) } as any,
        });
        groupId = map?.groupId != null ? Number(map.groupId) : null;
    }

    const rows: Array<{ hit: number }> = await appDatabase.query(
        `
        SELECT 1 AS hit
        FROM inbox_conversations acc
        LEFT JOIN listing_group_map lgm_acc ON lgm_acc.listingId = acc.listingId
        WHERE acc.threadId <> ?
          AND acc.isArchived = 0
          AND acc.checkin IS NOT NULL
          AND DATE(acc.checkin) = ?
          AND acc.guestName IS NOT NULL
          AND TRIM(acc.guestName) <> ''
          AND LOWER(TRIM(acc.guestName)) = ?
          AND (
              LOWER(COALESCE(acc.reservationStatus, '')) IN ('accepted', 'confirmed')
              OR LOWER(COALESCE(acc.reservationStatus, '')) LIKE 'checked%'
          )
          AND (
              (? IS NOT NULL AND acc.listingId = ?)
              OR (? IS NOT NULL AND lgm_acc.groupId = ?)
          )
        LIMIT 1
        `,
        [
            Number(conversation.threadId),
            checkin,
            guestName,
            conversation.listingId ?? null,
            conversation.listingId ?? null,
            groupId,
            groupId,
        ]
    );
    if (rows?.length) return true;

    const resRows: Array<{ hit: number }> = await appDatabase.query(
        `
        SELECT 1 AS hit
        FROM reservation_info r
        LEFT JOIN listing_group_map lgm_r ON lgm_r.listingId = r.listingMapId
        WHERE r.arrivalDate IS NOT NULL
          AND DATE(r.arrivalDate) = ?
          AND (? IS NULL OR r.id <> ?)
          AND r.guestName IS NOT NULL
          AND TRIM(r.guestName) <> ''
          AND LOWER(TRIM(r.guestName)) COLLATE utf8mb4_unicode_ci = ?
          AND (
              LOWER(COALESCE(r.status, '')) IN ('accepted', 'confirmed')
              OR LOWER(COALESCE(r.status, '')) LIKE 'checked%'
          )
          AND (
              (? IS NOT NULL AND r.listingMapId = ?)
              OR (? IS NOT NULL AND lgm_r.groupId = ?)
          )
        LIMIT 1
        `,
        [
            checkin,
            conversation.reservationId ?? null,
            conversation.reservationId ?? null,
            guestName,
            conversation.listingId ?? null,
            conversation.listingId ?? null,
            groupId,
            groupId,
        ]
    );
    return Boolean(resRows?.length);
}
