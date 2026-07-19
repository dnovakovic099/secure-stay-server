import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { QuoConversationEntity } from "../entity/QuoConversation";
import { QuoMessageEntity } from "../entity/QuoMessage";
import { ActionItems } from "../entity/ActionItems";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";
import { resolveDetectorInstructions, collectCategoryNames } from "./AIDetectorInstructions";

const DETECTION_MODEL = process.env.AI_ITEM_DETECTION_MODEL || "gpt-4.1-mini";

interface QuoDetectedItem {
    item: string;
    category?: string;
    urgency?: number; // 1 (low) .. 3 (high)
}

/**
 * QuoItemDetectionService — creates action items straight from Quo SMS
 * conversations (PM + GR lines). Unlike the Hostify inbox detector (which
 * only writes proposals), Quo items land directly in the live action_items
 * table tagged source='quo' so they show up on the Action Items page with
 * their own filter.
 *
 * Kill switch: QUO_ITEM_DETECTION_ENABLED=false.
 */
export class QuoItemDetectionService {
    private conversationRepo = appDatabase.getRepository(QuoConversationEntity);
    private messageRepo = appDatabase.getRepository(QuoMessageEntity);
    private actionItemsRepo = appDatabase.getRepository(ActionItems);

    static isEnabled(): boolean {
        return String(process.env.QUO_ITEM_DETECTION_ENABLED || "true").toLowerCase() !== "false";
    }

    // Burst debounce for webhook-driven detection: texts arrive in flurries, so
    // wait for the thread to settle and scan once instead of per message.
    private static pendingTimers = new Map<string, NodeJS.Timeout>();
    private static DEBOUNCE_MS = Number(process.env.QUO_ITEM_DETECTION_DEBOUNCE_MS || 3 * 60 * 1000);

    static scheduleDetection(conversationId: string): void {
        if (!QuoItemDetectionService.isEnabled()) return;
        const existing = QuoItemDetectionService.pendingTimers.get(conversationId);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            QuoItemDetectionService.pendingTimers.delete(conversationId);
            new QuoItemDetectionService()
                .detectForConversation(conversationId)
                .catch((err) => logger.error(`[QuoDetect] Scheduled detection failed for ${conversationId}: ${err?.message}`));
        }, QuoItemDetectionService.DEBOUNCE_MS);
        timer.unref?.();
        QuoItemDetectionService.pendingTimers.set(conversationId, timer);
    }

    private getClient(): OpenAI {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
        return new OpenAI({ apiKey });
    }

    /**
     * Run detection for conversations with new incoming messages. Called from
     * the sync cron; bounded so a busy sweep can't run away.
     */
    async detectForConversations(conversationIds: string[], maxConversations = 10): Promise<{ created: number }> {
        if (!QuoItemDetectionService.isEnabled() || !conversationIds.length) return { created: 0 };
        let created = 0;
        for (const id of Array.from(new Set(conversationIds)).slice(0, maxConversations)) {
            try {
                created += await this.detectForConversation(id);
            } catch (err: any) {
                logger.error(`[QuoDetect] Detection failed for ${id}: ${err?.message}`);
            }
        }
        return { created };
    }

    async detectForConversation(conversationId: string): Promise<number> {
        const conv = await this.conversationRepo.findOne({ where: { conversationId } });
        if (!conv) return 0;

        // Skip if nothing new since the last run.
        if (conv.lastDetectAt && conv.lastMessageAt && new Date(conv.lastMessageAt) <= new Date(conv.lastDetectAt)) {
            return 0;
        }

        const messages = await this.messageRepo.find({
            where: { conversationId },
            order: { sentAt: "DESC" },
            take: 40,
        });
        if (!messages.some((m) => m.direction === "incoming")) return 0;

        // Items already tracked for this conversation — passed to the model so
        // it doesn't re-create duplicates.
        const existing = await this.actionItemsRepo.find({
            where: { quoConversationId: conversationId },
            order: { createdAt: "DESC" },
            take: 20,
        });

        const transcript = messages
            .slice()
            .reverse()
            .map((m) => {
                const who = m.direction === "incoming" ? "CONTACT" : `US${m.senderName ? ` (${m.senderName})` : ""}`;
                return `[${new Date(m.sentAt).toISOString().slice(0, 16).replace("T", " ")}] ${who}: ${m.body || "(media)"}`;
            })
            .join("\n");

        const contextLines = [
            `Inbox line: ${conv.lineName || "unknown"} (${conv.lineNumber || "?"})`,
            conv.guestName ? `Linked guest: ${conv.guestName}` : "No linked guest",
            conv.listingName ? `Linked property: ${conv.listingName}` : "No linked property",
            conv.reservationId ? `Linked reservation: ${conv.reservationId}` : "No linked reservation",
            existing.length
                ? `Already-tracked items (do NOT duplicate):\n${existing.map((e) => `- ${e.item}`).join("\n")}`
                : "No items tracked yet for this conversation.",
        ].join("\n");

        // Admin-editable prompt + unified category list (falls back to the
        // built-in defaults when the setting is null).
        const settings = await new AIMessagingSettingsService()
            .getGlobalCached()
            .catch(() => null);
        const { quoSystemPrompt } = resolveDetectorInstructions(settings);
        const categoryNames = collectCategoryNames(settings);
        const categoryLine = categoryNames.length
            ? `Categories: ${categoryNames.join(", ")}.`
            : "Categories: Maintenance, Cleaning, Guest Request, Owner Request, Access/Check-in, Billing/Refund, Escalation, Other.";
        const system = [quoSystemPrompt, categoryLine].join("\n");

        const client = this.getClient();
        const completion = await client.chat.completions.create({
            model: DETECTION_MODEL,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: system },
                { role: "user", content: `${contextLines}\n\nConversation:\n${transcript}` },
            ],
        });

        let items: QuoDetectedItem[] = [];
        try {
            const parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
            items = Array.isArray(parsed.items) ? parsed.items : [];
        } catch {
            items = [];
        }

        let created = 0;
        for (const it of items) {
            const text = String(it.item || "").trim();
            if (!text) continue;
            // Cheap dedupe against existing items for this conversation.
            const dup = existing.some(
                (e) => String(e.item || "").toLowerCase().trim() === text.toLowerCase()
            );
            if (dup) continue;

            await this.actionItemsRepo.save(
                this.actionItemsRepo.create({
                    item: text,
                    category: it.category || "Other",
                    status: "incomplete",
                    urgency: it.urgency && it.urgency >= 1 && it.urgency <= 3 ? it.urgency : null,
                    guestName: conv.guestName || conv.contactName || conv.participantPhone || null,
                    listingId: conv.listingId ? Number(conv.listingId) : null,
                    listingName: conv.listingName || null,
                    reservationId: conv.reservationId ? Number(conv.reservationId) : null,
                    createdBy: "quo-ai",
                    source: "quo",
                    quoConversationId: conversationId,
                } as Partial<ActionItems>)
            );
            created++;
        }

        conv.lastDetectAt = new Date();
        await this.conversationRepo.save(conv);
        if (created) {
            logger.info(`[QuoDetect] Created ${created} action item(s) from conversation ${conversationId}`);
        }
        return created;
    }
}
