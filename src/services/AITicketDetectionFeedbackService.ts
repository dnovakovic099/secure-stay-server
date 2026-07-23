import { appDatabase } from "../utils/database.util";
import { AIDiscardFeedbackEntity } from "../entity/AIDiscardFeedback";
import { Issue } from "../entity/Issue";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";

export type TicketDetectionFeedbackKind =
    | "wrong_ticket"
    | "duplicate"
    | "missed_ticket"
    | "bad_urgency"
    | "bad_category"
    | "good"
    | "other";

/**
 * Ticket-generation quality feedback.
 * Persisted in ai_discard_feedback (type=guest_issue) and injected into the
 * detector prompt as counter-examples / coaching — same path as Action Item discards.
 */
export class AITicketDetectionFeedbackService {
    private repo = appDatabase.getRepository(AIDiscardFeedbackEntity);
    private issueRepo = appDatabase.getRepository(Issue);

    /** Invalidate the InboxItemDetectionService discard cache by resetting TTL via a no-op write pattern — callers also bump detectionFeedback optionally. */
    static clearDetectionCache(): void {
        try {
            const { InboxItemDetectionService } = require("./InboxItemDetectionService");
            InboxItemDetectionService?.clearDiscardCache?.();
        } catch {
            /* ignore */
        }
    }

    async listRecent(limit = 40): Promise<AIDiscardFeedbackEntity[]> {
        return this.repo.find({
            where: { type: "guest_issue" } as any,
            order: { createdAt: "DESC" },
            take: Math.min(Math.max(limit, 1), 100),
        });
    }

    async record(input: {
        kind: TicketDetectionFeedbackKind | string;
        reason: string;
        issueId?: number | null;
        itemText?: string | null;
        category?: string | null;
        listingId?: number | null;
        listingName?: string | null;
        guestName?: string | null;
        reservationId?: number | null;
        discardedBy?: string | null;
        /** When true, append a short coaching line into Settings.detectionFeedback. */
        promoteToSettingsFeedback?: boolean;
    }): Promise<AIDiscardFeedbackEntity> {
        const kind = String(input.kind || "other").trim() || "other";
        const reasonBody = String(input.reason || "").trim();
        if (!reasonBody && kind !== "good") {
            throw Object.assign(new Error("reason is required"), { status: 400 });
        }

        let issue: Issue | null = null;
        if (input.issueId) {
            issue = await this.issueRepo.findOne({ where: { id: Number(input.issueId) } });
        }

        const taggedReason = `[${kind}] ${reasonBody || "marked good"}`.slice(0, 2000);
        const itemText =
            (input.itemText || "").trim() ||
            (issue?.issue_description || "").trim() ||
            (kind === "missed_ticket" ? "Missed ticket (no issue created)" : null);

        const row = this.repo.create({
            type: "guest_issue",
            actionItemId: issue?.id ?? input.issueId ?? null,
            itemText: itemText ? String(itemText).slice(0, 4000) : null,
            category: input.category || issue?.category || null,
            listingId: input.listingId ?? (issue?.listing_id ? Number(issue.listing_id) : null),
            listingName: input.listingName || issue?.listing_name || null,
            guestName: input.guestName || issue?.guest_name || null,
            reservationId:
                input.reservationId ??
                (issue?.reservation_id ? Number(issue.reservation_id) : null),
            reason: taggedReason,
            discardedBy: input.discardedBy || null,
        });
        const saved = await this.repo.save(row);
        AITicketDetectionFeedbackService.clearDetectionCache();

        if (input.promoteToSettingsFeedback && reasonBody) {
            try {
                const settingsService = new AIMessagingSettingsService();
                const settings = await settingsService.getGlobal();
                const line = `- [${kind}] ${reasonBody}`.slice(0, 300);
                const prev = (settings.detectionFeedback || "").trim();
                const next = prev ? `${prev}\n${line}` : line;
                await settingsService.update({
                    detectionFeedback: next.slice(0, 8000),
                    userName: input.discardedBy || null,
                });
            } catch {
                /* non-fatal */
            }
        }

        return saved;
    }

    /** Aggregate suggestions for the AI Rules “how to improve tickets” panel. */
    async improvementReport(days = 30): Promise<{
        sinceDays: number;
        total: number;
        byKind: Record<string, number>;
        topReasons: { reason: string; count: number }[];
        recent: AIDiscardFeedbackEntity[];
    }> {
        const rows = await this.repo
            .createQueryBuilder("f")
            .where("f.type = :t", { t: "guest_issue" })
            .andWhere("f.createdAt >= DATE_SUB(NOW(), INTERVAL :days DAY)", { days })
            .orderBy("f.createdAt", "DESC")
            .take(200)
            .getMany();

        const byKind: Record<string, number> = {};
        const reasonCounts = new Map<string, number>();
        for (const r of rows) {
            const m = String(r.reason || "").match(/^\[([^\]]+)\]\s*(.*)$/);
            const kind = m?.[1] || "other";
            const body = (m?.[2] || r.reason || "").trim().toLowerCase();
            byKind[kind] = (byKind[kind] || 0) + 1;
            if (body) reasonCounts.set(body, (reasonCounts.get(body) || 0) + 1);
        }
        const topReasons = Array.from(reasonCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([reason, count]) => ({ reason, count }));

        return {
            sinceDays: days,
            total: rows.length,
            byKind,
            topReasons,
            recent: rows.slice(0, 25),
        };
    }
}
