import { appDatabase } from "./database.util";

export interface ResolvedRequestUser {
    /** Numeric users.id, or null when the caller has no matching users row. */
    userId: number | null;
    /** Best display name we can derive (users table first, then Supabase metadata). */
    userName: string | null;
    email: string | null;
}

/**
 * Resolve the authenticated request user (as set by verifySession) to the
 * internal numeric users.id + display name, for attribution columns.
 *
 * verifySession already looks up users.uid for JWT logins and sets
 * secureStayUserId; this helper additionally falls back to a direct uid lookup
 * (covers callers holding only the Supabase UUID) so attribution is never
 * silently dropped when secureStayUserId is missing.
 */
export async function resolveRequestUser(user: any): Promise<ResolvedRequestUser> {
    const email: string | null = user?.email || user?.user_metadata?.email || null;
    let userId: number | null = Number(user?.secureStayUserId) || null;
    let userName: string | null =
        user?.user_metadata?.full_name || user?.user_metadata?.name || user?.name || null;

    try {
        let row: any = null;
        if (userId) {
            const rows: any[] = await appDatabase.query(
                "SELECT id, firstName, lastName, email FROM users WHERE id = ? LIMIT 1",
                [userId]
            );
            row = rows[0] || null;
        } else if (typeof user?.id === "string" && user.id.includes("-")) {
            const rows: any[] = await appDatabase.query(
                "SELECT id, firstName, lastName, email FROM users WHERE uid = ? AND deletedAt IS NULL LIMIT 1",
                [user.id]
            );
            row = rows[0] || null;
        }
        if (row) {
            userId = Number(row.id) || userId;
            const full = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
            userName = full || userName || row.email || null;
        }
    } catch {
        /* attribution is best-effort — never block the actual operation */
    }
    return { userId, userName: userName || email, email };
}
