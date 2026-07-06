import { appDatabase } from "../utils/database.util";

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
    id: string; // `${suggestionId}-${index}`
    suggestionId: number;
    threadId: number;
    listingId: number | null;
    listingName: string | null;
    guestName: string | null;
    channel: string | null;
    item: string;
    confidence: number | null;
    escalationRequired: boolean;
    status: string;
    generatedAt: string | null;
}

export class AIActionItemsTestingService {
    async list(opts: {
        limit?: number;
        offset?: number;
        search?: string;
        channel?: string;
    } = {}): Promise<{ items: TestingActionItem[]; total: number; channels: string[] }> {
        const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 1000);
        const offset = Math.max(Number(opts.offset) || 0, 0);

        // Pull suggestions that carry at least one action item, newest first, with
        // conversation context. Kept generous then flattened + filtered in JS.
        const rows: any[] = await appDatabase.query(
            `SELECT s.id, s.threadId, s.listingId, s.suggestedActionItems, s.confidence,
                    s.escalationRequired, s.status, s.generatedAt,
                    c.listingName, c.guestName, c.channel
             FROM ai_message_suggestions s
             LEFT JOIN inbox_conversations c ON c.threadId = s.threadId
             WHERE s.suggestedActionItems IS NOT NULL
               AND s.suggestedActionItems NOT IN ('', '[]')
             ORDER BY s.generatedAt DESC
             LIMIT 4000`
        );

        const search = (opts.search || "").trim().toLowerCase();
        const channelFilter = (opts.channel || "").trim().toLowerCase();
        const channelSet = new Set<string>();

        const flat: TestingActionItem[] = [];
        for (const r of rows) {
            let items: string[] = [];
            try {
                const parsed = JSON.parse(r.suggestedActionItems);
                if (Array.isArray(parsed)) items = parsed.map((x) => String(x || "").trim()).filter(Boolean);
            } catch {
                /* skip malformed */
            }
            if (r.channel) channelSet.add(String(r.channel));
            if (channelFilter && String(r.channel || "").toLowerCase() !== channelFilter) continue;

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
                    item: text,
                    confidence: r.confidence != null ? Number(r.confidence) : null,
                    escalationRequired: Number(r.escalationRequired) === 1,
                    status: r.status || "suggested",
                    generatedAt: r.generatedAt ? new Date(r.generatedAt).toISOString() : null,
                });
            });
        }

        const total = flat.length;
        const items = flat.slice(offset, offset + limit);
        return { items, total, channels: Array.from(channelSet).sort() };
    }
}
