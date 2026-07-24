import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { Issue } from "../entity/Issue";
import { UsersEntity } from "../entity/Users";
import { AssignedTask } from "../entity/AssignedTask";
import { UserDirectedNotificationEntity } from "../entity/UserDirectedNotification";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";

/** Prefer the primary Luxury Lodging email; avoid notifying Anj's personal Gmail twice. */
const DEFAULT_MANAGER_EMAILS = ["angelica@luxurylodgingpm.com"];

export type GrRefundEscalateResult = {
    escalated: boolean;
    reason?: string;
    managers: Array<{ uid: string; email: string | null; name: string; userId: number }>;
    tasksCreated: number;
    notificationsCreated: number;
    mitigationUpdated: boolean;
};

/**
 * Refund / cancellation Guest Relations escalation:
 * - Resolve configurable managers (Settings → GR refund managers)
 * - Create an Assigned Task + in-app notification for each
 * - Surface on Mitigation (/mitigation?reservationId=) when a review_checkout exists
 */
export class GrRefundEscalationService {
    private usersRepo = () => appDatabase.getRepository(UsersEntity);
    private taskRepo = () => appDatabase.getRepository(AssignedTask);
    private notificationRepo = () => appDatabase.getRepository(UserDirectedNotificationEntity);
    private issueRepo = () => appDatabase.getRepository(Issue);

    isRefundOrCancellationIssue(issue: Issue): boolean {
        const category = String(issue.category || "")
            .trim()
            .toUpperCase()
            .replace(/\s+/g, " ");
        const text = `${issue.ai_short_title || ""} ${issue.issue_description || ""} ${issue.owner_notes || ""}`.toLowerCase();

        // Strict category gate — do NOT escalate MAINTENANCE/etc. that mention "refund".
        if (category === "REFUNDS") return true;

        if (category === "RESERVATION CHANGES") {
            // Don't treat pure early/late fee asks as cancellations.
            const isEarlyLate =
                /early\s*check[\s-]*in|late\s*check[\s-]*out|check[\s-]*in\s*early|check[\s-]*out\s*late/.test(
                    text
                );
            if (isEarlyLate && !/cancel|cancellation/.test(text)) return false;
            return /cancel|cancellation|refund|reimburse|compensation|goodwill/.test(text);
        }
        return false;
    }

    async escalateIssue(issue: Issue, actor?: { uid?: string | null; name?: string | null }): Promise<GrRefundEscalateResult> {
        if (!this.isRefundOrCancellationIssue(issue)) {
            return {
                escalated: false,
                reason: "not_refund_or_cancellation",
                managers: [],
                tasksCreated: 0,
                notificationsCreated: 0,
                mitigationUpdated: false,
            };
        }

        // Claim idempotency marker FIRST so retries cannot double-create tasks.
        const claim = await this.claimEscalationMarker(issue.id);
        if (!claim.claimed) {
            return {
                escalated: false,
                reason: claim.reason || "already_escalated",
                managers: [],
                tasksCreated: 0,
                notificationsCreated: 0,
                mitigationUpdated: false,
            };
        }

        const managers = await this.resolveManagers();
        if (!managers.length) {
            logger.warn(`[GrRefundEscalation] No managers resolved for issue #${issue.id}`);
            return {
                escalated: false,
                reason: "no_managers",
                managers: [],
                tasksCreated: 0,
                notificationsCreated: 0,
                mitigationUpdated: false,
            };
        }

        const dashboardUrl = (process.env.DASHBOARD_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
        const reservationId = Number(issue.reservation_id);
        const href =
            Number.isFinite(reservationId) && reservationId > 0
                ? `/mitigation?reservationId=${reservationId}`
                : `/issues?issueId=${issue.id}`;
        const title = `Refund/cancel · ${issue.guest_name || "Guest"} · #${issue.id}`;
        const body = [
            `Listing: ${issue.listing_name || issue.listing_id || "—"}`,
            `Category: ${issue.category || "—"}`,
            issue.ai_short_title || null,
            String(issue.issue_description || "").slice(0, 400) || null,
            `Open: ${dashboardUrl ? dashboardUrl + href : href}`,
        ]
            .filter(Boolean)
            .join("\n");

        let tasksCreated = 0;
        let notificationsCreated = 0;
        const actorUid = actor?.uid || null;
        const actorName = actor?.name || "SecureStay";

        for (const m of managers) {
            try {
                await this.taskRepo().save(
                    this.taskRepo().create({
                        title: title.slice(0, 255),
                        description: body,
                        status: "Pending",
                        taskType: "Client Ticket",
                        assigneeId: m.userId,
                        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
                        isRecurring: false,
                        createdBy: null,
                    })
                );
                tasksCreated += 1;
            } catch (err: any) {
                logger.warn(`[GrRefundEscalation] task create failed for ${m.email}: ${err?.message}`);
            }

            try {
                await this.notificationRepo().save(
                    this.notificationRepo().create({
                        userUid: m.uid,
                        actorUid,
                        actorName,
                        // Must be "escalation" so Notification Center filters/sounds work.
                        type: "escalation",
                        title: title.slice(0, 255),
                        body: body.slice(0, 2000),
                        href,
                        threadId: null,
                        messageExternalId: null,
                        escalationId: null,
                        readAt: null,
                    })
                );
                notificationsCreated += 1;
            } catch (err: any) {
                logger.warn(`[GrRefundEscalation] notify failed for ${m.uid}: ${err?.message}`);
            }
        }

        try {
            let dirty = false;
            if (!issue.assignee) {
                issue.assignee = managers[0].uid;
                dirty = true;
            }
            if (!issue.gr_status || issue.gr_status === "New") {
                issue.gr_status = "Need Help";
                dirty = true;
            }
            if (dirty) await this.issueRepo().save(issue);
        } catch (err: any) {
            logger.warn(`[GrRefundEscalation] issue assign failed: ${err?.message}`);
        }

        let mitigationUpdated = false;
        let mitigationAssigneeSet = false;
        if (Number.isFinite(reservationId) && reservationId > 0) {
            try {
                const rows: any[] = await appDatabase.query(
                    `SELECT id, assignee FROM review_checkout
                     WHERE reservationInfoId = ? AND deletedAt IS NULL
                     ORDER BY id DESC LIMIT 1`,
                    [reservationId]
                );
                if (rows?.[0]?.id) {
                    mitigationUpdated = true;
                    if (!rows[0].assignee) {
                        await appDatabase.query(`UPDATE review_checkout SET assignee = ? WHERE id = ?`, [
                            managers[0].uid,
                            rows[0].id,
                        ]);
                        mitigationAssigneeSet = true;
                    }
                }
            } catch (err: any) {
                logger.warn(`[GrRefundEscalation] mitigation update failed: ${err?.message}`);
            }
        }

        const names = managers.map((m) => m.name || m.email || m.uid).join(", ");
        try {
            await appDatabase.query(
                `UPDATE issues_updates
                 SET updates = ?
                 WHERE id = ?`,
                [
                    `GR refund/cancellation escalated to ${names}. Tasks=${tasksCreated}, notifications=${notificationsCreated}. Mitigation: ${
                        mitigationAssigneeSet
                            ? "assignee set"
                            : mitigationUpdated
                              ? "row found (assignee already set)"
                              : "no review_checkout yet — open via /mitigation when available"
                    }.`,
                    claim.updateId,
                ]
            );
        } catch (err: any) {
            logger.warn(`[GrRefundEscalation] timeline finalize failed: ${err?.message}`);
        }

        logger.info(
            `[GrRefundEscalation] issue #${issue.id} → ${managers.length} managers, tasks=${tasksCreated}, notes=${notificationsCreated}`
        );

        return {
            escalated: true,
            managers,
            tasksCreated,
            notificationsCreated,
            mitigationUpdated: mitigationAssigneeSet,
        };
    }

    /** Insert a claim row; returns claimed=false if another worker already escalated. */
    private async claimEscalationMarker(issueId: number): Promise<{ claimed: boolean; reason?: string; updateId?: number }> {
        try {
            const prior: any[] = await appDatabase.query(
                `SELECT id FROM issues_updates
                 WHERE issueId = ? AND deletedAt IS NULL
                   AND updates LIKE 'GR refund/cancellation escalated%'
                 LIMIT 1`,
                [issueId]
            );
            if (prior?.length) return { claimed: false, reason: "already_escalated" };
        } catch (err: any) {
            logger.warn(`[GrRefundEscalation] prior-check failed: ${err?.message}`);
            // Fail closed — do not escalate without a reliable marker check.
            return { claimed: false, reason: "prior_check_failed" };
        }

        try {
            const result: any = await appDatabase.query(
                `INSERT INTO issues_updates (updates, createdBy, source, issueId, createdAt, updatedAt)
                 VALUES (?, 'system', 'system', ?, NOW(), NOW())`,
                [`GR refund/cancellation escalated (pending) for #${issueId}`, issueId]
            );
            const updateId = Number(result?.insertId || 0);
            if (!updateId) return { claimed: false, reason: "claim_insert_failed" };
            return { claimed: true, updateId };
        } catch (err: any) {
            logger.warn(`[GrRefundEscalation] claim insert failed: ${err?.message}`);
            return { claimed: false, reason: "claim_insert_failed" };
        }
    }

    /**
     * Managers from Settings emails (admin-editable), falling back to Anj + Jade.
     */
    async resolveManagers(): Promise<Array<{ uid: string; email: string | null; name: string; userId: number }>> {
        const settings = await new AIMessagingSettingsService().getGlobalCached();
        const configured = String((settings as any).grRefundManagerEmails || "")
            .split(/[\s,;]+/)
            .map((s) => s.trim().toLowerCase())
            .filter((s) => /.+@.+\..+/.test(s));

        const emails = configured.length ? configured : DEFAULT_MANAGER_EMAILS;
        const byEmail = await this.usersRepo()
            .createQueryBuilder("u")
            .where("LOWER(u.email) IN (:...emails)", { emails })
            .andWhere("u.isActive = 1")
            .getMany();

        const out: Array<{ uid: string; email: string | null; name: string; userId: number }> = [];
        const seenUid = new Set<string>();
        const seenEmail = new Set<string>();
        const pushUser = (u: UsersEntity) => {
            if (!u?.uid || seenUid.has(u.uid)) return;
            const email = String(u.email || "").toLowerCase();
            // Prefer a single Angelica account (company email over gmail).
            if (email && seenEmail.has(email)) return;
            const local = email.split("@")[0] || "";
            if (local.startsWith("angelica") && [...seenEmail].some((e) => e.startsWith("angelica@"))) {
                // Already have angelica@… — skip angelica.luxurylodging@gmail etc.
                if (!email.endsWith("@luxurylodgingpm.com")) return;
            }
            seenUid.add(u.uid);
            if (email) seenEmail.add(email);
            out.push({
                uid: String(u.uid),
                email: u.email || null,
                name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.uid,
                userId: Number(u.id),
            });
        };

        for (const u of byEmail) pushUser(u);

        if (!configured.length) {
            // Jade often isn't firstName=Jade in SS — match email or exact first name only.
            const jadeLike = await this.usersRepo()
                .createQueryBuilder("u")
                .where("u.isActive = 1")
                .andWhere(
                    `(LOWER(u.firstName) = 'jade'
                      OR LOWER(u.email) LIKE 'jade%@%'
                      OR LOWER(u.email) LIKE '%jade%@luxurylodging%'
                      OR LOWER(CONCAT(COALESCE(u.firstName,''),' ',COALESCE(u.lastName,''))) LIKE '% jade %'
                      OR LOWER(u.lastName) = 'jade')`
                )
                .take(5)
                .getMany();
            for (const u of jadeLike) pushUser(u);
        }

        return out.filter((m) => Number.isFinite(m.userId) && m.userId > 0);
    }
}
