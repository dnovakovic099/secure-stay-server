import { In, LessThan } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { AIMessageSuggestionEntity } from "../entity/AIMessageSuggestion";
import { AIOpsAlertEntity } from "../entity/AIOpsAlert";
import { AIProposedActionEntity } from "../entity/AIProposedAction";
import { UserDirectedNotificationEntity } from "../entity/UserDirectedNotification";
import { UsersEntity } from "../entity/Users";
import { Employee } from "../entity/Employee";
import { AIMessagingSettingsEntity } from "../entity/AIMessagingSettings";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";
import { InboxAIService } from "./InboxAIService";
import { adminEmails } from "./AdminInsightsService";
import sendEmail from "../utils/sendEmai";
import logger from "../utils/logger.utils";

export type RescueStatus = "watching" | "active" | "recovering" | "resolved" | "dismissed";

export type RescuePlaybook = {
    cause: string;
    checks: string[];
    allowedGestures: string[];
    forbidden: string[];
    draftSkeleton: string;
};

export type RescuePack = {
    enabled: boolean;
    active: boolean;
    status: RescueStatus | null;
    cause: string | null;
    why: string | null;
    gesture: string | null;
    playbook: RescuePlaybook | null;
    moodScore: number | null;
    moodLabel: string | null;
    moodNote: string | null;
    reviewRisk: {
        severity: string;
        detail: string | null;
        recommendation: string | null;
    } | null;
    urgentType: string | null;
    urgentReason: string | null;
    draft: string | null;
    suggestionId: number | null;
    proposedActions: Array<{
        id: number;
        actionType: string;
        title: string | null;
        proposedReply: string | null;
        status: string;
    }>;
    activatedAt: string | null;
    dismissedUntil: string | null;
    failedAt: string | null;
    signals: string[];
};

const DISMISS_HOURS = 24;
const HARD_URGENT = new Set(["payment", "access", "safety", "extension_price"]);
const PING_COOLDOWN_MS = 2 * 60 * 60 * 1000;

const PLAYBOOKS: Record<string, Omit<RescuePlaybook, "allowedGestures"> & { baseGestures: string[] }> = {
    access: {
        cause: "access",
        checks: [
            "Confirm reservation is paid / not blocked",
            "Pull live lock code for this reservation",
            "Verify lock online / battery OK",
            "Resend step-by-step check-in instructions",
        ],
        baseGestures: [
            "Stay on thread until guest confirms they are inside",
            "Offer a quick call if still stuck after code resend",
        ],
        forbidden: ["Invent a door code", "Promise a free night for lock issues without manager"],
        draftSkeleton:
            "I'm sorry you're having trouble getting in — I'm checking the live access code now and will send the exact steps right away.",
    },
    safety: {
        cause: "safety",
        checks: [
            "Acknowledge immediately",
            "Escalate to on-call / manager",
            "Document what the guest reported",
            "Do not leave them waiting",
        ],
        baseGestures: ["Escalate to manager now", "Offer to stay in contact until resolved"],
        forbidden: ["Downplay the issue", "Ask them to wait without a clear next step"],
        draftSkeleton:
            "I'm sorry you're dealing with this — your safety comes first. I'm escalating to the team right now and will update you as soon as I have next steps.",
    },
    cleanliness: {
        cause: "cleanliness",
        checks: [
            "Ask which areas/rooms need attention",
            "Check if turnover already completed",
            "Create/confirm cleaning ticket with photos if possible",
        ],
        baseGestures: [
            "Same-day cleaner dispatch when available",
            "Offer late checkout or small amenity gesture if policy allows",
        ],
        forbidden: ["Promise a full refund", "Blame the guest"],
        draftSkeleton:
            "I'm really sorry the place wasn't up to our standard — I'm arranging a cleaning follow-up now and will confirm timing shortly.",
    },
    noise: {
        cause: "noise",
        checks: ["Clarify source/timing", "Check house rules / quiet hours", "Offer relocation options if available"],
        baseGestures: ["Offer earplugs/fan tip if relevant", "Manager review for goodwill if ongoing"],
        forbidden: ["Promise the noise will stop if we can't control it"],
        draftSkeleton:
            "I'm sorry the noise is disrupting your stay — thank you for flagging it. I'm looking into what we can do on our side and will follow up shortly.",
    },
    amenities: {
        cause: "amenities",
        checks: [
            "Confirm what is documented as on-site",
            "Do not invent storage locations",
            "Create ops ticket for missing/broken amenity",
        ],
        baseGestures: ["Replace/repair when possible", "Offer a documented alternative"],
        forbidden: ["Invent inventory", "Promise delivery ETA we don't have"],
        draftSkeleton:
            "I'm sorry that isn't working as expected — I'm checking what's on-site and will get the team on a fix or alternative right away.",
    },
    billing: {
        cause: "billing",
        checks: [
            "Pull live paid vs due amounts",
            "Clarify what the charge is for",
            "Never invent fees or refunds",
        ],
        baseGestures: ["Send a clear payment link if balance due", "Escalate refund/dispute to manager"],
        forbidden: ["Promise a refund", "Waive fees without manager approval"],
        draftSkeleton:
            "Thanks for flagging this — I'm checking the exact charges on your reservation now and will explain what's owed / paid with a clear next step.",
    },
    review_risk: {
        cause: "review_risk",
        checks: [
            "Name the specific unresolved issue",
            "State the fix + ETA",
            "Offer one policy-allowed goodwill gesture",
        ],
        baseGestures: [
            "Proactive apology + concrete fix",
            "Small goodwill if configured in Rescue settings",
        ],
        forbidden: ["Generic 'your comfort matters' filler", "Fake scarcity or invented compensation"],
        draftSkeleton:
            "I'm sorry we fell short here — here's what I'm doing right now to make it right, and I'll confirm as soon as it's done.",
    },
    guest_upset: {
        cause: "guest_upset",
        checks: [
            "Acknowledge the specific frustration",
            "Say what you're doing now",
            "Give a clear update time",
        ],
        baseGestures: ["Personal follow-up from a human", "Policy-allowed goodwill if appropriate"],
        forbidden: ["Corporate filler", "Over-promise"],
        draftSkeleton:
            "I'm sorry this has been frustrating — I hear you. Here's what I'm doing next, and I'll update you shortly.",
    },
    general: {
        cause: "general",
        checks: ["Re-read the latest guest message", "Confirm facts before promising", "Own the next step"],
        baseGestures: ["Human follow-up with a clear ETA"],
        forbidden: ["Vague 'the team will look into it' with no timing"],
        draftSkeleton:
            "Thanks for letting us know — I'm on this now and will follow up with a concrete update shortly.",
    },
};

/**
 * Rescue Copilot — recovery pack + playbooks + fail→Anj + shift pings + morning brief.
 */
export class RescueCopilotService {
    private conversationRepo() {
        return appDatabase.getRepository(InboxConversationEntity);
    }
    private messageRepo() {
        return appDatabase.getRepository(InboxMessageEntity);
    }
    private alertRepo() {
        return appDatabase.getRepository(AIOpsAlertEntity);
    }
    private suggestionRepo() {
        return appDatabase.getRepository(AIMessageSuggestionEntity);
    }
    private actionRepo() {
        return appDatabase.getRepository(AIProposedActionEntity);
    }
    private notificationRepo() {
        return appDatabase.getRepository(UserDirectedNotificationEntity);
    }
    private usersRepo() {
        return appDatabase.getRepository(UsersEntity);
    }
    private employeeRepo() {
        return appDatabase.getRepository(Employee);
    }

    async getSettings() {
        return new AIMessagingSettingsService().getGlobalCached();
    }

    async isEnabled(): Promise<boolean> {
        try {
            const settings = await this.getSettings();
            return Number((settings as any).rescueCopilotEnabled ?? 1) !== 0;
        } catch {
            return true;
        }
    }

    async shouldBlockAutosend(conversation: InboxConversationEntity): Promise<boolean> {
        if (!(await this.isEnabled())) return false;
        const status = String(conversation.rescueStatus || "");
        if (status !== "active" && status !== "recovering") return false;
        if (conversation.rescueDismissedUntil && new Date(conversation.rescueDismissedUntil).getTime() > Date.now()) {
            return false;
        }
        return true;
    }

    async getPack(threadId: number): Promise<RescuePack> {
        const enabled = await this.isEnabled();
        const conversation = await this.conversationRepo().findOne({ where: { threadId } });
        if (!conversation) return this.emptyPack(enabled);
        if (!enabled) {
            return { ...this.emptyPack(false), status: conversation.rescueStatus as RescueStatus | null };
        }
        try {
            await this.evaluate(threadId);
        } catch (err: any) {
            logger.warn(`[RescueCopilot] evaluate failed (thread ${threadId}): ${err?.message}`);
        }
        const fresh = (await this.conversationRepo().findOne({ where: { threadId } })) || conversation;
        return this.buildPack(fresh, enabled);
    }

    async evaluate(threadId: number): Promise<RescuePack> {
        const enabled = await this.isEnabled();
        const conversation = await this.conversationRepo().findOne({ where: { threadId } });
        if (!conversation) return this.emptyPack(enabled);
        if (!enabled) return this.buildPack(conversation, false);

        if (InboxAIService.isInquiryStatus(conversation.reservationStatus)) {
            if (conversation.rescueStatus === "active" || conversation.rescueStatus === "recovering") {
                conversation.rescueStatus = "resolved";
                await this.conversationRepo().save(conversation);
            }
            return this.buildPack(conversation, enabled);
        }

        const dismissedUntil = conversation.rescueDismissedUntil
            ? new Date(conversation.rescueDismissedUntil)
            : null;
        if (dismissedUntil && dismissedUntil.getTime() > Date.now()) {
            conversation.rescueStatus = "dismissed";
            await this.conversationRepo().save(conversation);
            return this.buildPack(conversation, enabled);
        }

        const mood = Number(conversation.guestSentimentScore);
        const moodOk = Number.isFinite(mood) && mood >= 1 && mood <= 10;

        // Fail loop: host already replied (recovering), guest wrote again and
        // is still upset → notify Anj once. Don't fire just because pre-reply
        // mood is still on the conversation.
        if (
            conversation.rescueStatus === "recovering" &&
            moodOk &&
            mood <= 4 &&
            !conversation.rescueNotifiedAt
        ) {
            const lastMsg = await this.messageRepo().findOne({
                where: { threadId: Number(threadId) },
                order: { sentAt: "DESC" as any, id: "DESC" as any },
            });
            if (lastMsg?.direction === "incoming") {
                conversation.rescueFailedAt = new Date();
                conversation.rescueStatus = "active";
                await this.conversationRepo().save(conversation);
                await this.notifyAnjRescueFailed(conversation).catch((e) =>
                    logger.warn(`[RescueCopilot] fail notify: ${e?.message}`)
                );
            }
        }

        // Recovery win.
        if (
            moodOk &&
            mood >= 7 &&
            (conversation.rescueStatus === "active" || conversation.rescueStatus === "recovering")
        ) {
            const prevCause = conversation.rescueCause;
            conversation.rescueStatus = "resolved";
            conversation.rescueWhy = conversation.rescueWhy || "Guest mood recovered";
            await this.conversationRepo().save(conversation);
            await this.storeWinExemplar(conversation, prevCause).catch((e) =>
                logger.warn(`[RescueCopilot] win exemplar: ${e?.message}`)
            );
            return this.buildPack(conversation, enabled);
        }

        const reviewRisk = await this.alertRepo().findOne({
            where: {
                type: "review_risk",
                threadId: Number(threadId),
                status: "open",
                severity: In(["medium", "high", "critical"]) as any,
            },
            order: { updatedAt: "DESC" as any },
        });

        const urgentType = Number(conversation.emergency) === 1 ? String(conversation.emergencyType || "") : "";
        const hardUrgent = HARD_URGENT.has(urgentType.toLowerCase());

        const latestSuggestion = await this.suggestionRepo().findOne({
            where: { threadId: Number(threadId) },
            order: { generatedAt: "DESC" as any, id: "DESC" as any },
        });

        const recentGuest = await this.messageRepo().find({
            where: { threadId: Number(threadId), direction: "incoming" as any },
            order: { sentAt: "DESC" as any },
            take: 4,
        });
        const guestBlob = recentGuest.map((m) => String(m.body || "")).join("\n");

        const signals: string[] = [];
        let soft = 0;
        let hard = 0;

        if (moodOk && mood <= 3) {
            hard++;
            signals.push(`mood_${mood}`);
        } else if (moodOk && mood <= 4) {
            soft++;
            signals.push(`mood_${mood}`);
        }
        if (reviewRisk) {
            hard++;
            signals.push(`review_risk_${reviewRisk.severity}`);
        }
        if (hardUrgent) {
            hard++;
            signals.push(`urgent_${urgentType}`);
        }
        if (latestSuggestion && Number(latestSuggestion.escalationRequired) === 1) {
            soft++;
            signals.push("escalation_required");
        }

        const shouldActivate = hard >= 1 || soft >= 2;
        const settings = await this.getSettings();

        if (shouldActivate) {
            const cause = this.pickCause({ mood, urgentType, reviewRisk: !!reviewRisk, guestText: guestBlob });
            const playbook = await this.buildPlaybook(cause, settings);
            const why =
                conversation.guestSentimentNote ||
                reviewRisk?.detail ||
                conversation.emergencyReason ||
                latestSuggestion?.escalationReason ||
                "Guest needs proactive recovery";
            const gesture =
                this.constrainGesture(reviewRisk?.recommendation, playbook) ||
                playbook.allowedGestures[0] ||
                this.defaultGesture(cause);

            const wasInactive = conversation.rescueStatus !== "active" && conversation.rescueStatus !== "recovering";
            conversation.rescueStatus = conversation.rescueStatus === "recovering" ? "recovering" : "active";
            if (wasInactive || !conversation.rescueActivatedAt) {
                conversation.rescueActivatedAt = new Date();
                conversation.rescueMoodAtActivate = moodOk ? mood : null;
                conversation.rescueFailedAt = null;
                conversation.rescueNotifiedAt = null;
            }
            conversation.rescueCause = cause;
            conversation.rescueWhy = String(why).slice(0, 500);
            conversation.rescueGesture = String(gesture || "").slice(0, 500) || null;
            conversation.rescueDismissedUntil = null;
            await this.conversationRepo().save(conversation);
            logger.info(
                `[RescueCopilot] ACTIVE thread=${threadId} cause=${cause} signals=${signals.join(",")}`
            );
        } else if (conversation.rescueStatus === "active" && !shouldActivate) {
            conversation.rescueStatus = "watching";
            await this.conversationRepo().save(conversation);
        } else if (!conversation.rescueStatus && signals.length) {
            conversation.rescueStatus = "watching";
            await this.conversationRepo().save(conversation);
        }

        const pack = await this.buildPack(conversation, enabled);
        pack.signals = signals;
        return pack;
    }

    async dismiss(threadId: number, hours = DISMISS_HOURS): Promise<RescuePack> {
        const conversation = await this.conversationRepo().findOne({ where: { threadId } });
        if (!conversation) return this.emptyPack(await this.isEnabled());
        const until = new Date(Date.now() + Math.max(1, hours) * 60 * 60 * 1000);
        conversation.rescueStatus = "dismissed";
        conversation.rescueDismissedUntil = until;
        await this.conversationRepo().save(conversation);
        return this.buildPack(conversation, await this.isEnabled());
    }

    async markRecovering(threadId: number): Promise<void> {
        const conversation = await this.conversationRepo().findOne({ where: { threadId } });
        if (!conversation || conversation.rescueStatus !== "active") return;
        conversation.rescueStatus = "recovering";
        await this.conversationRepo().save(conversation);
    }

    /**
     * Phase 3: ping on-shift reps (or Anj off-shift) for active rescues unanswered too long.
     */
    async sweepUnansweredRescues(): Promise<{ checked: number; pinged: number }> {
        if (!(await this.isEnabled())) return { checked: 0, pinged: 0 };
        const settings = await this.getSettings();
        const minutes = Math.max(10, Number((settings as any).rescueUnansweredMinutes) || 30);
        const cutoff = new Date(Date.now() - minutes * 60 * 1000);
        const rows = await this.conversationRepo().find({
            where: {
                rescueStatus: In(["active", "recovering"]) as any,
                rescueActivatedAt: LessThan(cutoff) as any,
            },
            take: 40,
        });

        let pinged = 0;
        for (const c of rows) {
            if (c.rescueLastPingAt && Date.now() - new Date(c.rescueLastPingAt).getTime() < PING_COOLDOWN_MS) {
                continue;
            }
            const last = await this.messageRepo().findOne({
                where: { threadId: Number(c.threadId) },
                order: { sentAt: "DESC" as any, id: "DESC" as any },
            });
            // Only ping if the guest is still waiting on us.
            if (!last || last.direction !== "incoming") continue;

            const onShift = await this.resolveOnShiftUserUids();
            const targets = onShift.length ? onShift : await this.resolveAnjUserUids();
            if (!targets.length) continue;

            const href = `/messages/inbox-v2?thread=${c.threadId}`;
            const title = `Rescue unanswered · ${c.guestName || "Guest"}`;
            const body = [
                `Rescue active ${minutes}+ min with no host reply.`,
                c.rescueCause ? `Cause: ${c.rescueCause}.` : null,
                c.rescueWhy ? `Why: ${c.rescueWhy}` : null,
                c.guestSentimentScore != null ? `Mood: ${c.guestSentimentScore}/10` : null,
            ]
                .filter(Boolean)
                .join(" ");

            for (const uid of targets) {
                await this.notificationRepo().save(
                    this.notificationRepo().create({
                        userUid: uid,
                        actorUid: null,
                        actorName: "Rescue Copilot",
                        type: "escalation",
                        title,
                        body: body.slice(0, 2000),
                        href,
                        threadId: Number(c.threadId),
                        messageExternalId: last.externalId != null ? Number(last.externalId) : null,
                        escalationId: null,
                        readAt: null,
                    })
                );
            }
            c.rescueLastPingAt = new Date();
            await this.conversationRepo().save(c);
            pinged++;
            logger.info(`[RescueCopilot] shift ping thread=${c.threadId} targets=${targets.length}`);
        }
        return { checked: rows.length, pinged };
    }

    /**
     * Phase 3: morning email section of overnight / open rescues.
     */
    async sendMorningBrief(): Promise<{ sent: number; rescues: number }> {
        if (!(await this.isEnabled())) return { sent: 0, rescues: 0 };
        const settings = await appDatabase
            .getRepository(AIMessagingSettingsEntity)
            .findOne({ where: { listingId: null as any } });
        const recipients = String(settings?.opsAlertEmails || "")
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter((s) => /.+@.+\..+/.test(s));
        // Always include admin insights emails when configured via ops list empty —
        // still send if opsAlertEmails set; if empty, fall back to Anj allowlist.
        const fallback = [...adminEmails()];
        const to = recipients.length ? recipients : fallback;
        if (!to.length) return { sent: 0, rescues: 0 };

        const since = new Date(Date.now() - 18 * 60 * 60 * 1000);
        const open = await this.conversationRepo().find({
            where: { rescueStatus: In(["active", "recovering"]) as any },
            order: { rescueActivatedAt: "DESC" as any },
            take: 40,
        });
        const failed = await this.conversationRepo()
            .createQueryBuilder("c")
            .where("c.rescueFailedAt IS NOT NULL")
            .andWhere("c.rescueFailedAt >= :since", { since })
            .orderBy("c.rescueFailedAt", "DESC")
            .take(20)
            .getMany();

        if (!open.length && !failed.length) return { sent: 0, rescues: 0 };

        const dashboardUrl = (process.env.DASHBOARD_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
        const esc = (s: any) =>
            String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const rowHtml = (c: InboxConversationEntity, tag: string) => `
          <tr>
            <td style="padding:6px 10px 6px 0;vertical-align:top">
              <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#ffe4e6;color:#9f1239">${esc(tag)}</span>
            </td>
            <td style="padding:6px 0">
              <div style="font-weight:600;color:#111">${esc(c.guestName || "Guest")} · ${esc(c.listingName || "listing")}</div>
              <div style="color:#555;font-size:13px;margin-top:2px">
                ${c.guestSentimentScore != null ? `Mood ${esc(c.guestSentimentScore)}/10 · ` : ""}
                ${c.rescueCause ? `Cause: ${esc(c.rescueCause)} · ` : ""}
                ${esc(c.rescueWhy || "")}
              </div>
              ${
                  c.threadId && dashboardUrl
                      ? `<a href="${dashboardUrl}/messages/inbox-v2?thread=${c.threadId}" style="font-size:12px;color:#4f46e5">Open rescue</a>`
                      : ""
              }
            </td>
          </tr>`;

        const openRows = open.map((c) => rowHtml(c, c.rescueStatus || "active")).join("");
        const failRows = failed.map((c) => rowHtml(c, "failed")).join("");
        const subject = `Rescue brief: ${open.length} open, ${failed.length} failed overnight`;
        const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px">
        <h2 style="color:#111">Anj Rescue morning brief</h2>
        <p style="color:#555">Overnight / open Rescue Copilot cases that need eyes.</p>
        ${
            open.length
                ? `<h3 style="margin:18px 0 4px;color:#111">Open rescues (${open.length})</h3>
        <table style="border-collapse:collapse;width:100%">${openRows}</table>`
                : ""
        }
        ${
            failed.length
                ? `<h3 style="margin:18px 0 4px;color:#111">Failed after reply (${failed.length})</h3>
        <table style="border-collapse:collapse;width:100%">${failRows}</table>`
                : ""
        }
        ${
            dashboardUrl
                ? `<p style="margin-top:20px"><a href="${dashboardUrl}/messages/inbox-v2" style="background:#e11d48;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open Inbox</a></p>`
                : ""
        }
      </div>`;

        const from = process.env.EMAIL_FROM;
        const results = await Promise.allSettled(to.map((addr) => sendEmail(subject, html, from as string, addr)));
        const sent = results.filter((r) => r.status === "fulfilled").length;
        logger.info(`[RescueCopilot] morning brief sent ${sent}/${to.length}, open=${open.length}, failed=${failed.length}`);
        return { sent, rescues: open.length + failed.length };
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private pickCause(input: {
        mood: number;
        urgentType: string;
        reviewRisk: boolean;
        guestText: string;
    }): string {
        const u = String(input.urgentType || "").toLowerCase();
        if (u === "access") return "access";
        if (u === "safety") return "safety";
        if (u === "payment" || u === "extension_price") return "billing";

        const t = String(input.guestText || "").toLowerCase();
        if (/\b(code|lock|door|keypad|lockbox|can't get in|cant get in|locked out)\b/.test(t)) return "access";
        if (/\b(dirty|filthy|not clean|messy|hair|trash|smell|stain)\b/.test(t)) return "cleanliness";
        if (/\b(noise|loud|party|music|neighbors?)\b/.test(t)) return "noise";
        if (/\b(wifi|hot tub|pool|ac|a\/c|heater|fridge|oven|tv|broken|not working)\b/.test(t)) {
            return "amenities";
        }
        if (/\b(charge|charged|refund|payment|deposit|fee|invoice|bill)\b/.test(t)) return "billing";
        if (input.reviewRisk) return "review_risk";
        if (Number.isFinite(input.mood) && input.mood <= 4) return "guest_upset";
        return "general";
    }

    private async buildPlaybook(
        cause: string,
        settings: AIMessagingSettingsEntity
    ): Promise<RescuePlaybook> {
        const base = PLAYBOOKS[cause] || PLAYBOOKS.general;
        const configured = String((settings as any).rescueGestures || "")
            .split(/[\n,;]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        const allowedGestures = [...base.baseGestures, ...configured].slice(0, 8);
        return {
            cause: base.cause,
            checks: base.checks,
            allowedGestures,
            forbidden: base.forbidden,
            draftSkeleton: base.draftSkeleton,
        };
    }

    private constrainGesture(raw: string | null | undefined, playbook: RescuePlaybook): string | null {
        const g = String(raw || "").trim();
        if (!g) return null;
        const lower = g.toLowerCase();
        if (playbook.forbidden.some((f) => lower.includes(f.toLowerCase().slice(0, 12)))) {
            return playbook.allowedGestures[0] || null;
        }
        // Prefer configured/allowed list if Ops Radar gesture is too open-ended.
        if (/\b(refund|free night|comp(?:limentary)?|waive)\b/i.test(g) && playbook.cause !== "billing") {
            const allowed = playbook.allowedGestures.find((a) => !/\brefund\b/i.test(a));
            return allowed || playbook.allowedGestures[0] || g.slice(0, 500);
        }
        return g.slice(0, 500);
    }

    private defaultGesture(cause: string): string {
        return (PLAYBOOKS[cause] || PLAYBOOKS.general).baseGestures[0];
    }

    private async notifyAnjRescueFailed(conversation: InboxConversationEntity): Promise<void> {
        const settings = await this.getSettings();
        if (Number((settings as any).rescueNotifyAnjEnabled ?? 1) === 0) return;
        const uids = await this.resolveAnjUserUids();
        if (!uids.length) return;

        const href = `/messages/inbox-v2?thread=${conversation.threadId}`;
        const title = `Rescue failed · ${conversation.guestName || "Guest"}`;
        const body = [
            "Guest is still upset after a rescue reply.",
            conversation.rescueCause ? `Cause: ${conversation.rescueCause}.` : null,
            conversation.guestSentimentScore != null ? `Mood now: ${conversation.guestSentimentScore}/10.` : null,
            conversation.rescueWhy ? `Context: ${conversation.rescueWhy}` : null,
        ]
            .filter(Boolean)
            .join(" ");

        for (const uid of uids) {
            await this.notificationRepo().save(
                this.notificationRepo().create({
                    userUid: uid,
                    actorUid: null,
                    actorName: "Rescue Copilot",
                    type: "escalation",
                    title,
                    body: body.slice(0, 2000),
                    href,
                    threadId: Number(conversation.threadId),
                    messageExternalId: null,
                    escalationId: null,
                    readAt: null,
                })
            );
        }
        conversation.rescueNotifiedAt = new Date();
        await this.conversationRepo().save(conversation);
        logger.info(`[RescueCopilot] notified Anj fail thread=${conversation.threadId}`);
    }

    private async resolveAnjUserUids(): Promise<string[]> {
        const emails = [...adminEmails()].map((e) => e.toLowerCase());
        if (!emails.length) return [];
        const users = await this.usersRepo()
            .createQueryBuilder("u")
            .where("LOWER(u.email) IN (:...emails)", { emails })
            .getMany();
        return users.map((u) => String(u.uid)).filter(Boolean);
    }

    private async resolveOnShiftUserUids(): Promise<string[]> {
        try {
            const employees = await this.employeeRepo().find({
                where: { isActive: true } as any,
                relations: ["user"],
                take: 80,
            });
            const uids: string[] = [];
            for (const e of employees) {
                if (!e.schedule || !this.isCurrentTimeInSchedule(e.schedule)) continue;
                const uid = (e as any).user?.uid;
                if (uid) uids.push(String(uid));
            }
            return [...new Set(uids)];
        } catch (err: any) {
            logger.warn(`[RescueCopilot] on-shift resolve failed: ${err?.message}`);
            return [];
        }
    }

    /** Same schedule parser used by GR escalation manager (America/New_York). */
    private isCurrentTimeInSchedule(schedule: string): boolean {
        if (!schedule) return false;
        try {
            const now = new Date();
            const parts = new Intl.DateTimeFormat("en-US", {
                timeZone: "America/New_York",
                weekday: "short",
                hour: "numeric",
                minute: "numeric",
                hour12: false,
            }).formatToParts(now);
            const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
            const currentDay = parts.find((part) => part.type === "weekday")?.value || "Sun";
            const currentDayNum = dayMap[currentDay] ?? 0;
            const currentHour = parseInt(parts.find((part) => part.type === "hour")?.value || "0", 10);
            const currentMinute = parseInt(parts.find((part) => part.type === "minute")?.value || "0", 10);
            const currentMinutes = currentHour * 60 + currentMinute;

            const lower = schedule.toLowerCase();
            const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
            const matchedDays = lower.match(/(sun|mon|tue|wed|thu|fri|sat)/g) || [];
            if (matchedDays.length > 0 && !matchedDays.some((day) => dayNames.indexOf(day) === currentDayNum)) {
                return false;
            }

            const timeMatch = lower.match(
                /(\d{1,2})(:\d{2})?\s*(am|pm)?\s*-\s*(\d{1,2})(:\d{2})?\s*(am|pm)?/
            );
            if (!timeMatch) return true;

            let startHour = parseInt(timeMatch[1], 10);
            const startMinute = timeMatch[2] ? parseInt(timeMatch[2].slice(1), 10) : 0;
            let endHour = parseInt(timeMatch[4], 10);
            const endMinute = timeMatch[5] ? parseInt(timeMatch[5].slice(1), 10) : 0;

            if (timeMatch[3] === "pm" && startHour < 12) startHour += 12;
            if (timeMatch[3] === "am" && startHour === 12) startHour = 0;
            if (timeMatch[6] === "pm" && endHour < 12) endHour += 12;
            if (timeMatch[6] === "am" && endHour === 12) endHour = 0;

            const start = startHour * 60 + startMinute;
            const end = endHour * 60 + endMinute;
            if (end < start) return currentMinutes >= start || currentMinutes <= end;
            return currentMinutes >= start && currentMinutes <= end;
        } catch {
            return false;
        }
    }

    private async storeWinExemplar(conversation: InboxConversationEntity, cause: string | null): Promise<void> {
        try {
            const { ExemplarService } = await import("./ExemplarService");
            if (!ExemplarService.isEnabled()) return;
            const msgs = await this.messageRepo().find({
                where: { threadId: Number(conversation.threadId) },
                order: { sentAt: "DESC" as any },
                take: 12,
            });
            const guestAsk = msgs.find((m) => m.direction === "incoming");
            const hostReply = msgs.find((m) => m.direction === "outgoing" && !m.isAutomatic);
            if (!guestAsk?.body || !hostReply?.body) return;
            const question = `[rescue:${cause || "general"}] ${String(guestAsk.body).slice(0, 500)}`;
            const answer = String(hostReply.body).slice(0, 1500);
            const groupId = conversation.listingId ? Number(conversation.listingId) : null;
            await new ExemplarService().embedAndStore([
                {
                    kind: "qa",
                    refId: guestAsk.externalId != null ? Number(guestAsk.externalId) : null,
                    listingId: conversation.listingId != null ? Number(conversation.listingId) : null,
                    groupId,
                    scope: "property",
                    text: question,
                    payload: answer,
                    dedupKey: `rescue|${conversation.threadId}|${hostReply.id || hostReply.externalId}`,
                },
            ]);
            logger.info(`[RescueCopilot] stored win exemplar thread=${conversation.threadId}`);
        } catch (err: any) {
            logger.warn(`[RescueCopilot] storeWinExemplar: ${err?.message}`);
        }
    }

    private async buildPack(conversation: InboxConversationEntity, enabled: boolean): Promise<RescuePack> {
        const threadId = Number(conversation.threadId);
        const status = (conversation.rescueStatus as RescueStatus) || null;
        const active = enabled && (status === "active" || status === "recovering");

        const reviewRisk = await this.alertRepo().findOne({
            where: { type: "review_risk", threadId, status: "open" },
            order: { updatedAt: "DESC" as any },
        });

        const latestSuggestion = await this.suggestionRepo().findOne({
            where: { threadId },
            order: { generatedAt: "DESC" as any, id: "DESC" as any },
        });

        const actions = await this.actionRepo().find({
            where: { threadId, status: "proposed" as any },
            order: { id: "DESC" as any },
            take: 6,
        });

        const settings = await this.getSettings();
        const playbook = conversation.rescueCause
            ? await this.buildPlaybook(conversation.rescueCause, settings)
            : null;

        let draft = latestSuggestion?.suggestedReply || null;
        if (active && playbook && (!draft || draft.length < 40)) {
            draft = playbook.draftSkeleton;
        }

        return {
            enabled,
            active,
            status,
            cause: conversation.rescueCause,
            why: conversation.rescueWhy,
            gesture: conversation.rescueGesture,
            playbook,
            moodScore: conversation.guestSentimentScore,
            moodLabel: conversation.guestSentimentLabel,
            moodNote: conversation.guestSentimentNote,
            reviewRisk:
                reviewRisk && ["medium", "high", "critical"].includes(String(reviewRisk.severity))
                    ? {
                          severity: reviewRisk.severity,
                          detail: reviewRisk.detail,
                          recommendation: reviewRisk.recommendation,
                      }
                    : null,
            urgentType: Number(conversation.emergency) === 1 ? conversation.emergencyType : null,
            urgentReason: Number(conversation.emergency) === 1 ? conversation.emergencyReason : null,
            draft,
            suggestionId: latestSuggestion?.id ?? null,
            proposedActions: actions.map((a) => ({
                id: a.id,
                actionType: a.actionType,
                title: a.title || a.actionType,
                proposedReply: a.proposedReply,
                status: a.status,
            })),
            activatedAt: conversation.rescueActivatedAt
                ? new Date(conversation.rescueActivatedAt).toISOString()
                : null,
            dismissedUntil: conversation.rescueDismissedUntil
                ? new Date(conversation.rescueDismissedUntil).toISOString()
                : null,
            failedAt: conversation.rescueFailedAt
                ? new Date(conversation.rescueFailedAt).toISOString()
                : null,
            signals: [],
        };
    }

    private emptyPack(enabled: boolean): RescuePack {
        return {
            enabled,
            active: false,
            status: null,
            cause: null,
            why: null,
            gesture: null,
            playbook: null,
            moodScore: null,
            moodLabel: null,
            moodNote: null,
            reviewRisk: null,
            urgentType: null,
            urgentReason: null,
            draft: null,
            suggestionId: null,
            proposedActions: [],
            activatedAt: null,
            dismissedUntil: null,
            failedAt: null,
            signals: [],
        };
    }
}
