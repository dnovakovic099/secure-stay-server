import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { AIMessageSuggestionEntity } from "../entity/AIMessageSuggestion";
import { AIOpsAlertEntity } from "../entity/AIOpsAlert";
import { AIProposedActionEntity } from "../entity/AIProposedAction";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";
import { InboxAIService } from "./InboxAIService";
import logger from "../utils/logger.utils";

export type RescueStatus = "watching" | "active" | "recovering" | "resolved" | "dismissed";

export type RescuePack = {
    enabled: boolean;
    active: boolean;
    status: RescueStatus | null;
    cause: string | null;
    why: string | null;
    gesture: string | null;
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
    signals: string[];
};

const DISMISS_HOURS = 24;
const HARD_URGENT = new Set(["payment", "access", "safety", "extension_price"]);

/**
 * Rescue Copilot — stitches sentiment + Ops Radar review risk + urgent pins
 * into an in-thread recovery pack, and blocks autosend while active.
 */
export class RescueCopilotService {
    private conversationRepo() {
        return appDatabase.getRepository(InboxConversationEntity);
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

    async isEnabled(): Promise<boolean> {
        try {
            const settings = await new AIMessagingSettingsService().getGlobalCached();
            // Default ON when column missing / null.
            return Number((settings as any).rescueCopilotEnabled ?? 1) !== 0;
        } catch {
            return true;
        }
    }

    /** True when autosend must stay off for this thread. */
    async shouldBlockAutosend(conversation: InboxConversationEntity): Promise<boolean> {
        if (!(await this.isEnabled())) return false;
        if (String(conversation.rescueStatus || "") !== "active") return false;
        if (conversation.rescueDismissedUntil && new Date(conversation.rescueDismissedUntil).getTime() > Date.now()) {
            return false;
        }
        return true;
    }

    async getPack(threadId: number): Promise<RescuePack> {
        const enabled = await this.isEnabled();
        const conversation = await this.conversationRepo().findOne({ where: { threadId } });
        if (!conversation) {
            return this.emptyPack(enabled);
        }
        if (!enabled) {
            return { ...this.emptyPack(false), status: conversation.rescueStatus as RescueStatus | null };
        }

        // Refresh evaluation (best-effort) so opening a thread activates rescue.
        try {
            await this.evaluate(threadId);
        } catch (err: any) {
            logger.warn(`[RescueCopilot] evaluate failed (thread ${threadId}): ${err?.message}`);
        }

        const fresh = (await this.conversationRepo().findOne({ where: { threadId } })) || conversation;
        return this.buildPack(fresh, enabled);
    }

    /**
     * Recompute rescue state from live signals. Called after AI suggestions
     * and when the inbox opens a thread.
     */
    async evaluate(threadId: number): Promise<RescuePack> {
        const enabled = await this.isEnabled();
        const conversation = await this.conversationRepo().findOne({ where: { threadId } });
        if (!conversation) return this.emptyPack(enabled);
        if (!enabled) return this.buildPack(conversation, false);

        // Pre-booking inquiries are sales, not rescue.
        if (InboxAIService.isInquiryStatus(conversation.reservationStatus)) {
            if (conversation.rescueStatus === "active") {
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

        // Recovery: guest cheered up.
        if (
            moodOk &&
            mood >= 7 &&
            (conversation.rescueStatus === "active" || conversation.rescueStatus === "recovering")
        ) {
            conversation.rescueStatus = "resolved";
            conversation.rescueWhy = conversation.rescueWhy || "Guest mood recovered";
            await this.conversationRepo().save(conversation);
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

        if (shouldActivate) {
            const cause = this.pickCause({ mood, urgentType, reviewRisk: !!reviewRisk });
            const why =
                conversation.guestSentimentNote ||
                reviewRisk?.detail ||
                conversation.emergencyReason ||
                latestSuggestion?.escalationReason ||
                "Guest needs proactive recovery";
            const gesture =
                reviewRisk?.recommendation ||
                this.defaultGesture(cause);

            conversation.rescueStatus = "active";
            conversation.rescueCause = cause;
            conversation.rescueWhy = String(why).slice(0, 500);
            conversation.rescueGesture = String(gesture || "").slice(0, 500) || null;
            if (!conversation.rescueActivatedAt) conversation.rescueActivatedAt = new Date();
            conversation.rescueDismissedUntil = null;
            await this.conversationRepo().save(conversation);
            logger.info(
                `[RescueCopilot] ACTIVE thread=${threadId} cause=${cause} signals=${signals.join(",")}`
            );
        } else if (conversation.rescueStatus === "active" && !shouldActivate) {
            // Signals cleared without mood recovery — keep watching.
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

    private pickCause(input: { mood: number; urgentType: string; reviewRisk: boolean }): string {
        const u = String(input.urgentType || "").toLowerCase();
        if (u === "access") return "access";
        if (u === "safety") return "safety";
        if (u === "payment" || u === "extension_price") return "billing";
        if (input.reviewRisk) return "review_risk";
        if (Number.isFinite(input.mood) && input.mood <= 4) return "guest_upset";
        return "general";
    }

    private defaultGesture(cause: string): string {
        if (cause === "access") return "Confirm the live lock code, resend check-in steps, and stay with them until they're in.";
        if (cause === "safety") return "Acknowledge immediately, escalate to on-call, and do not leave them waiting.";
        if (cause === "billing") return "Clarify what is owed / what was charged and offer a clear next step — no vague promises.";
        if (cause === "review_risk") return "Own the issue, state the fix + ETA, and offer one concrete goodwill gesture if policy allows.";
        return "Acknowledge the specific issue, say what you're doing now, and give a clear next update time.";
    }

    private async buildPack(conversation: InboxConversationEntity, enabled: boolean): Promise<RescuePack> {
        const threadId = Number(conversation.threadId);
        const status = (conversation.rescueStatus as RescueStatus) || null;
        const active = enabled && status === "active";

        const reviewRisk = await this.alertRepo().findOne({
            where: {
                type: "review_risk",
                threadId,
                status: "open",
            },
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

        return {
            enabled,
            active,
            status,
            cause: conversation.rescueCause,
            why: conversation.rescueWhy,
            gesture: conversation.rescueGesture,
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
            draft: latestSuggestion?.suggestedReply || null,
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
            signals: [],
        };
    }
}
