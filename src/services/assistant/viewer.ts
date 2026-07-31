import { appDatabase } from "../../utils/database.util";
import { isAdminEmail } from "../AdminInsightsService";

/**
 * Who is asking, and what they are allowed to ask about.
 *
 * IMPORTANT — this is the assistant's security boundary, and it is deliberately
 * STRICTER than the rest of the API. Most SecureStay endpoints are gated by
 * verifySession alone, which means any logged-in employee can already read other
 * people's payroll and reply counts even though the UI hides those screens. The
 * assistant does not inherit that: capabilities are granted explicitly here and
 * enforced inside each tool, never in the prompt. A jailbreak in the chat box
 * cannot reach past this file.
 *
 * Some data is unreachable through the assistant at ANY tier because no
 * conversational workflow needs it: employees.payment_info, payroll_notes,
 * employee_notes, and user_api_key. There are no tools that read those columns.
 */

export type Capability =
    /** Property/ops knowledge: check-in, house rules, amenities, parking, policy. */
    | "property.knowledge"
    /** Door codes, lockbox codes, wifi passwords. Always audited. */
    | "property.credentials"
    /** Reservations, guests, issues, vendors, upsells. */
    | "ops.read"
    /** The caller's own productivity numbers, tasks and time. */
    | "activity.self"
    /** Per-person productivity for OTHER employees. Admin only. */
    | "activity.team"
    /** Expenses, vendor spend, owner statements. */
    | "accounting.read"
    /** Names, departments, job titles. Not compensation. */
    | "employee.directory"
    /** Hourly rates, bonuses, timesheets. Super admin only. */
    | "payroll.read";

export interface Viewer {
    userId: number | null;
    userName: string | null;
    email: string | null;
    userType: string | null;
    isSuperAdmin: boolean;
    isAdmin: boolean;
    isInsightsAdmin: boolean;
    departments: string[];
    capabilities: Set<Capability>;
}

/** Granted to every active employee. */
const BASE_CAPABILITIES: Capability[] = [
    "property.knowledge",
    "property.credentials",
    "ops.read",
    "activity.self",
    "accounting.read",
    "employee.directory",
];

/**
 * Resolve the request user (as set by verifySession) into a Viewer with a
 * computed capability set. Falls back to the narrowest possible identity: if we
 * cannot resolve a numeric users.id, the caller gets base capabilities only and
 * every self-scoped tool will return nothing rather than everything.
 */
export async function resolveViewer(user: any): Promise<Viewer> {
    const email: string | null = user?.email || user?.user_metadata?.email || null;
    let userId: number | null = Number(user?.secureStayUserId) || null;
    let row: any = null;

    try {
        if (userId) {
            const rows: any[] = await appDatabase.query(
                `SELECT id, firstName, lastName, email, userType, isSuperAdmin
                 FROM users WHERE id = ? AND deletedAt IS NULL LIMIT 1`,
                [userId]
            );
            row = rows[0] || null;
        } else if (typeof user?.id === "string" && user.id.includes("-")) {
            const rows: any[] = await appDatabase.query(
                `SELECT id, firstName, lastName, email, userType, isSuperAdmin
                 FROM users WHERE uid = ? AND deletedAt IS NULL LIMIT 1`,
                [user.id]
            );
            row = rows[0] || null;
        } else if (email) {
            const rows: any[] = await appDatabase.query(
                `SELECT id, firstName, lastName, email, userType, isSuperAdmin
                 FROM users WHERE email = ? AND deletedAt IS NULL LIMIT 1`,
                [email]
            );
            row = rows[0] || null;
        }
    } catch {
        /* fall through to the narrowest identity */
    }

    if (row) userId = Number(row.id) || userId;

    let departments: string[] = [];
    if (userId) {
        try {
            const rows: any[] = await appDatabase.query(
                `SELECT d.name FROM user_departments ud
                 JOIN departments d ON d.id = ud.departmentId
                 WHERE ud.userId = ?`,
                [userId]
            );
            departments = rows.map((r) => String(r.name)).filter(Boolean);
        } catch {
            /* departments are advisory only — never a gate on their own */
        }
    }

    const userType: string | null = row?.userType ?? null;
    const isSuperAdmin = Boolean(row?.isSuperAdmin) || userType === "super admin";
    const isAdmin = isSuperAdmin || userType === "admin";
    const isInsightsAdmin = isAdminEmail(email);

    const capabilities = new Set<Capability>(BASE_CAPABILITIES);
    if (isAdmin || isInsightsAdmin) capabilities.add("activity.team");
    if (isSuperAdmin) capabilities.add("payroll.read");

    const fullName = row
        ? [row.firstName, row.lastName].filter(Boolean).join(" ").trim()
        : null;

    return {
        userId,
        userName: fullName || email,
        email: email || row?.email || null,
        userType,
        isSuperAdmin,
        isAdmin,
        isInsightsAdmin,
        departments,
        capabilities,
    };
}

export function can(viewer: Viewer, capability: Capability): boolean {
    return viewer.capabilities.has(capability);
}

/** Thrown by a tool when the viewer lacks the capability it requires. */
export class CapabilityDenied extends Error {
    readonly capability: Capability;

    constructor(capability: Capability, message: string) {
        super(message);
        this.name = "CapabilityDenied";
        this.capability = capability;
    }
}

/**
 * Gate a tool. The message is surfaced to the model (and therefore the user), so
 * it explains what to do instead rather than just refusing.
 */
export function requireCapability(viewer: Viewer, capability: Capability, why: string): void {
    if (!can(viewer, capability)) throw new CapabilityDenied(capability, why);
}

/** Human-readable tier, for the system prompt so the model sets expectations. */
export function describeAccess(viewer: Viewer): string {
    if (viewer.isSuperAdmin) return "super admin (full access including payroll)";
    if (viewer.isAdmin) return "admin (team-wide activity, no payroll)";
    if (viewer.isInsightsAdmin) return "insights admin (team-wide activity, no payroll)";
    return "employee (own activity only; cannot see other people's numbers)";
}
