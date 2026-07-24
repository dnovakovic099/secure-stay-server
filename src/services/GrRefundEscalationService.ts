import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { Issue } from "../entity/Issue";
import { UsersEntity } from "../entity/Users";
import { AssignedTask } from "../entity/AssignedTask";
import { UserDirectedNotificationEntity } from "../entity/UserDirectedNotification";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";

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
        if (category === "REFUNDS") return true;
        if (category === "RESERVATION CHANGES") {
            return /cancel|cancellation|refund|reimburse|compensation|goodwill/.test(text);
        }
        return /cancel(?:lation)?\s+(?:request|the\s+)?(?:reservation|booking)|full\s+refund|request(?:ed|ing)?\s+a?\s*refund/.test(
            text
        );
    }

    async escalateIssue(issue: Issue, actor?: { uid?: string | null; name?: string | null }): Promise<GrRefundEscalateResult> {
        if (!this.isRefundOrCancellationIssue(issue)) {
            return { escalated: false, reason: "not_refund_or_cancellation", managers: [], tasksCreated: 0, notificationsCreated: 0, mitigationUpdated: false };
        }

        // Idempotent: don't re-fire if we already logged escalation for this issue.
        try {
            const prior: any[] = await appDatabase.query(
                `SELECT id FROM issues_updates
                 WHERE issueId = ? AND deletedAt IS NULL
                   AND updates LIKE 'GR refund/cancellation escalated to%'
                 LIMIT 1`,
                [issue.id]
            );
            if (prior?.length) {
                return { escalated: false, reason: "already_escalated", managers: [], tasksCreated: 0, notificationsCreated: 0, mitigationUpdated: false };
            }
        } catch {
            /* continue */
        }

        const managers = await this.resolveManagers();
        if (!managers.length) {
            logger.warn(`[GrRefundEscalation] No managers resolved for issue #${issue.id}`);
            return { escalated: false, reason: "no_managers", managers: [], tasksCreated: 0, notificationsCreated: 0, mitigationUpdated: false };
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
                        type: "gr_refund_escalation",
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

        // Assign issue to first manager if unset; bump GR status for visibility.
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
        if (Number.isFinite(reservationId) && reservationId > 0) {
            try {
                const rows: any[] = await appDatabase.query(
                    `SELECT id, assignee FROM review_checkout
                     WHERE reservationInfoId = ? AND deletedAt IS NULL
                     ORDER BY id DESC LIMIT 1`,
                    [reservationId]
                );
                if (rows?.[0]?.id) {
                    if (!rows[0].assignee) {
                        await appDatabase.query(
                            `UPDATE review_checkout SET assignee = ? WHERE id = ?`,
                            [managers[0].uid, rows[0].id]
                        );
                    }
                    mitigationUpdated = true;
                }
            } catch (err: any) {
                logger.warn(`[GrRefundEscalation] mitigation update failed: ${err?.message}`);
            }
        }

        const names = managers.map((m) => m.name || m.email || m.uid).join(", ");
        try {
            const { IssuesService } = require("./IssuesService");
            await new IssuesService().createIssueUpdates(
                {
                    issueId: issue.id,
                    updates: `GR refund/cancellation escalated to ${names}. Tasks + notifications created. Mitigation: ${
                        mitigationUpdated ? "assignee set" : "no review_checkout yet — open via /mitigation when available"
                    }.`,
                    source: "system",
                },
                "system"
            );
        } catch (err: any) {
            logger.warn(`[GrRefundEscalation] timeline log failed: ${err?.message}`);
        }

        logger.info(
            `[GrRefundEscalation] issue #${issue.id} → ${managers.length} managers, tasks=${tasksCreated}, notes=${notificationsCreated}`
        );

        return {
            escalated: true,
            managers,
            tasksCreated,
            notificationsCreated,
            mitigationUpdated,
        };
    }

    /**
     * Managers from Settings emails (admin-editable), falling back to Anj + Jade by name/email.
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
        const seen = new Set<string>();
        for (const u of byEmail) {
            if (!u.uid || seen.has(u.uid)) continue;
            seen.add(u.uid);
            out.push({
                uid: String(u.uid),
                email: u.email || null,
                name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.uid,
                userId: Number(u.id),
            });
        }

        // Always try to include Jade / Anj by first name when not already present
        // (covers email mismatches until Settings is filled in).
        const nameTargets = ["jade", "anj", "angelica"];
        const named = await this.usersRepo()
            .createQueryBuilder("u")
            .where("u.isActive = 1")
            .andWhere(
                nameTargets.map((_, i) => `LOWER(u.firstName) LIKE :n${i}`).join(" OR "),
                Object.fromEntries(nameTargets.map((n, i) => [`n${i}`, `${n}%`]))
            )
            .take(10)
            .getMany();
        for (const u of named) {
            if (!u.uid || seen.has(u.uid)) continue;
            // Only auto-add when using defaults (no admin override list), or email matched defaults.
            if (configured.length) continue;
            seen.add(u.uid);
            out.push({
                uid: String(u.uid),
                email: u.email || null,
                name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.uid,
                userId: Number(u.id),
            });
        }

        return out.filter((m) => Number.isFinite(m.userId) && m.userId > 0);
    }
}
