import { appDatabase } from "../utils/database.util";
import { AIDetectedItemEntity } from "../entity/AIDetectedItem";
import { Issue } from "../entity/Issue";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { IssuesService } from "./IssuesService";
import logger from "../utils/logger.utils";

/**
 * AIActionItemsTestingService
 *
 * TESTING/EXPERIMENTAL. Surfaces the action items the NEW inbox-v2 AI chatbot
 * proposes as part of every reply suggestion (ai_message_suggestions
 * .suggestedActionItems — a JSON string[]). Each suggested task is flattened into
 * its own row and enriched with conversation context (guest, listing, channel).
 *
 * This is completely isolated from the legacy `action_items` product and from
 * Action Items (Beta). It reads only inbox-v2 AI tables and never writes.
 */
export interface TestingActionItem {
    id: string; // `${suggestionId}-${index}` (reply bot) or `d-${id}` (detector)
    suggestionId: number;
    threadId: number;
    listingId: number | null;
    listingName: string | null;
    guestName: string | null;
    channel: string | null;
    checkIn: string | null;
    checkOut: string | null;
    item: string;
    confidence: number | null;
    escalationRequired: boolean;
    status: string;
    generatedAt: string | null;
    /** "detector" = dedicated whole-conversation scanner; "reply_bot" = side-product of a reply suggestion. */
    source: "detector" | "reply_bot";
    category: string | null;
    priority: string | null;
    /** Detector rows only: "action_item" | "guest_issue". */
    itemType: string | null;
    /** Detector rows only: raw detected_item id, used for the Convert action. */
    detectedItemId: number | null;
    /** Set when this proposal has already been promoted to a Guest Issue row. */
    convertedIssueId: number | null;
}

export class AIActionItemsTestingService {
    async list(opts: {
        limit?: number;
        offset?: number;
        search?: string;
        channel?: string;
        propertyName?: string;
        dateType?: string;
        startDate?: string;
        endDate?: string;
    } = {}): Promise<{ items: TestingActionItem[]; total: number; channels: string[]; propertyNames: string[] }> {
        const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 1000);
        const offset = Math.max(Number(opts.offset) || 0, 0);

        // (a) Items from the dedicated whole-conversation detector (rich:
        // title/description/category/priority), newest first. Also carries
        // convertedIssueId so the UI knows whether to offer "Open ticket" or
        // "Convert & open".
        const detectorRows: any[] = await appDatabase.query(
            `SELECT d.id, d.type, d.threadId, d.listingId, d.title, d.description,
                    d.category, d.priority, d.confidence, d.status, d.createdAt,
                    d.convertedIssueId,
                    c.listingName, c.guestName, c.channel, c.checkin, c.checkout
             FROM ai_detected_items d
             LEFT JOIN inbox_conversations c ON c.threadId = d.threadId
             WHERE d.status NOT IN ('duplicate', 'dismissed')
             ORDER BY d.createdAt DESC
             LIMIT 2000`
        );

        // (b) Items the reply bot jotted down while drafting suggestions. Kept
        // generous then flattened + filtered in JS.
        const rows: any[] = await appDatabase.query(
            `SELECT s.id, s.threadId, s.listingId, s.suggestedActionItems, s.confidence,
                    s.escalationRequired, s.status, s.generatedAt,
                    c.listingName, c.guestName, c.channel, c.checkin, c.checkout
             FROM ai_message_suggestions s
             LEFT JOIN inbox_conversations c ON c.threadId = s.threadId
             WHERE s.suggestedActionItems IS NOT NULL
               AND s.suggestedActionItems NOT IN ('', '[]')
             ORDER BY s.generatedAt DESC
             LIMIT 4000`
        );

        const search = (opts.search || "").trim().toLowerCase();
        const channelFilter = (opts.channel || "").trim().toLowerCase();
        const propertyFilter = (opts.propertyName || "").trim().toLowerCase();
        const dateType = opts.dateType === "checkIn" || opts.dateType === "checkOut" ? opts.dateType : "created";
        const startDate = this.parseDateBoundary(opts.startDate, false);
        const endDate = this.parseDateBoundary(opts.endDate, true);
        const channelSet = new Set<string>();
        const propertyNameSet = new Set<string>();

        const flat: TestingActionItem[] = [];

        for (const d of detectorRows) {
            const text = [d.title, d.description].filter(Boolean).join(" — ");
            if (d.channel) channelSet.add(String(d.channel));
            if (d.listingName) propertyNameSet.add(String(d.listingName));
            if (channelFilter && String(d.channel || "").toLowerCase() !== channelFilter) continue;
            if (propertyFilter && String(d.listingName || "").toLowerCase() !== propertyFilter) continue;
            if (!this.matchesDateRange(this.getRowDate(d, dateType, "createdAt"), startDate, endDate)) continue;
            if (search && !text.toLowerCase().includes(search)) continue;
            flat.push({
                id: `d-${d.id}`,
                suggestionId: 0,
                threadId: Number(d.threadId),
                listingId: d.listingId != null ? Number(d.listingId) : null,
                listingName: d.listingName ?? null,
                guestName: d.guestName ?? null,
                channel: d.channel ?? null,
                checkIn: this.formatDateForResponse(d.checkin),
                checkOut: this.formatDateForResponse(d.checkout),
                item: text,
                confidence: d.confidence != null ? Number(d.confidence) : null,
                escalationRequired: ["urgent", "critical", "high"].includes(String(d.priority || "").toLowerCase()),
                status: d.status || "proposed",
                generatedAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
                source: "detector",
                category: d.category ?? null,
                priority: d.priority ?? null,
                itemType: d.type ?? null,
                detectedItemId: Number(d.id),
                convertedIssueId: d.convertedIssueId != null ? Number(d.convertedIssueId) : null,
            });
        }

        for (const r of rows) {
            let items: string[] = [];
            try {
                const parsed = JSON.parse(r.suggestedActionItems);
                if (Array.isArray(parsed)) items = parsed.map((x) => String(x || "").trim()).filter(Boolean);
            } catch {
                /* skip malformed */
            }
            if (r.channel) channelSet.add(String(r.channel));
            if (r.listingName) propertyNameSet.add(String(r.listingName));
            if (channelFilter && String(r.channel || "").toLowerCase() !== channelFilter) continue;
            if (propertyFilter && String(r.listingName || "").toLowerCase() !== propertyFilter) continue;
            if (!this.matchesDateRange(this.getRowDate(r, dateType, "generatedAt"), startDate, endDate)) continue;

            items.forEach((text, idx) => {
                if (search && !text.toLowerCase().includes(search)) return;
                flat.push({
                    id: `${r.id}-${idx}`,
                    suggestionId: Number(r.id),
                    threadId: Number(r.threadId),
                    listingId: r.listingId != null ? Number(r.listingId) : null,
                    listingName: r.listingName ?? null,
                    guestName: r.guestName ?? null,
                    channel: r.channel ?? null,
                    checkIn: this.formatDateForResponse(r.checkin),
                    checkOut: this.formatDateForResponse(r.checkout),
                    item: text,
                    confidence: r.confidence != null ? Number(r.confidence) : null,
                    escalationRequired: Number(r.escalationRequired) === 1,
                    status: r.status || "suggested",
                    generatedAt: r.generatedAt ? new Date(r.generatedAt).toISOString() : null,
                    source: "reply_bot",
                    category: null,
                    priority: null,
                    itemType: null,
                    detectedItemId: null,
                    convertedIssueId: null,
                });
            });
        }

        // Merge both sources newest-first so detector items interleave naturally.
        flat.sort((a, b) => (b.generatedAt || "").localeCompare(a.generatedAt || ""));

        const total = flat.length;
        const items = flat.slice(offset, offset + limit);
        return { items, total, channels: Array.from(channelSet).sort(), propertyNames: Array.from(propertyNameSet).sort() };
    }

    private parseDateBoundary(value: string | undefined, endOfDay: boolean): Date | null {
        if (!value) return null;
        const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    private getRowDate(row: any, dateType: "created" | "checkIn" | "checkOut", createdField: "createdAt" | "generatedAt"): Date | null {
        const value = dateType === "checkIn" ? row.checkin : dateType === "checkOut" ? row.checkout : row[createdField];
        if (!value) return null;
        const text = String(value);
        const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00.000`) : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    private formatDateForResponse(value: any): string | null {
        if (!value) return null;
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.toISOString().slice(0, 10);
        }
        const text = String(value);
        if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
            return text.slice(0, 10);
        }
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }

    private matchesDateRange(value: Date | null, startDate: Date | null, endDate: Date | null): boolean {
        if (!startDate && !endDate) return true;
        if (!value) return false;
        if (startDate && value < startDate) return false;
        if (endDate && value > endDate) return false;
        return true;
    }

    /**
     * Promote a detected proposal into a real Guest Issue row so the Action
     * Items (Testing) UI can hand the user off to the standard IssueEditModal
     * — that modal already provides vendor threads, expenses, hyperlinks,
     * Slack, activity timeline, etc., so a single conversion unlocks feature
     * parity without duplicating the modal.
     *
     * Idempotent: repeated calls return the same Issue.
     */
    async convertToIssue(detectedItemId: number, userId: string): Promise<Issue> {
        const detectedRepo = appDatabase.getRepository(AIDetectedItemEntity);
        const issueRepo = appDatabase.getRepository(Issue);
        const conversationRepo = appDatabase.getRepository(InboxConversationEntity);

        const detected = await detectedRepo.findOne({ where: { id: detectedItemId } });
        if (!detected) {
            throw Object.assign(new Error("Detected item not found"), { status: 404 });
        }

        // Already promoted — return the existing Issue.
        if (detected.convertedIssueId) {
            const existing = await issueRepo.findOne({ where: { id: detected.convertedIssueId } });
            if (existing) return existing;
        }

        const conversation = detected.threadId
            ? await conversationRepo.findOne({ where: { threadId: detected.threadId } })
            : null;

        // Map detector priority ("urgent" | "high" | "medium" | "low") to the
        // Issue urgency numeric scale (higher = more urgent, matches other flows).
        const urgencyMap: Record<string, number> = {
            urgent: 5,
            critical: 5,
            high: 4,
            medium: 3,
            normal: 3,
            low: 2,
        };
        const priorityKey = String(detected.priority || "").toLowerCase();
        const urgency = urgencyMap[priorityKey] ?? null;

        const issueData: Partial<Issue> = {
            status: "New",
            gr_status: "New",
            listing_id: conversation?.listingId ? String(conversation.listingId) : "0",
            listing_name: conversation?.listingName || null as any,
            reservation_id: conversation?.reservationId
                ? String(conversation.reservationId)
                : (null as any),
            channel: conversation?.channel || (null as any),
            guest_name: conversation?.guestName || (null as any),
            issue_description: [detected.title, detected.description].filter(Boolean).join(" — "),
            category: detected.category || (null as any),
            urgency: urgency as any,
            creator: userId || "ai-testing",
            date_time_reported: new Date(),
            source: detected.type === "guest_issue" ? "ai_inbox" : "ai_inbox",
            aiConfidence:
                detected.confidence != null ? (Number(detected.confidence) / 100).toFixed(3) : (null as any),
            aiSourceRef: `ai_detected_items:${detected.id}`,
        };

        const savedIssue = await new IssuesService().createIssue(
            issueData,
            userId || "ai-testing"
        );

        detected.convertedIssueId = savedIssue.id;
        detected.status = "created";
        await detectedRepo.save(detected);

        logger.info(
            `[AIActionItemsTesting] converted detected #${detected.id} -> issue #${savedIssue.id}`
        );
        return savedIssue;
    }
}
