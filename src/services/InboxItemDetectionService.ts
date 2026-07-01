import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { AIDetectedItemEntity } from "../entity/AIDetectedItem";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";

const DETECTION_MODEL = process.env.AI_ITEM_DETECTION_MODEL || process.env.AI_MESSAGING_MODEL || "gpt-4.1";
const DETECTION_PROMPT_VERSION = "inbox-detect-v1";

interface DetectedActionItem {
    title: string;
    description?: string;
    category?: string;
    priority?: string; // low | medium | high | urgent
    confidence?: number; // 0..1
}
interface DetectedGuestIssue {
    title: string;
    description?: string;
    category?: string;
    severity?: string; // low | medium | high | critical
    confidence?: number; // 0..1
}
interface DetectionOutput {
    action_items: DetectedActionItem[];
    guest_issues: DetectedGuestIssue[];
}

/**
 * InboxItemDetectionService
 *
 * Detects and PROPOSES our own Action Items and Guest Issues from guest messages
 * (so we no longer depend on HostBuddy to create them).
 *
 * IMPORTANT — this is DORMANT by default and fully non-activating:
 *   - Requires BOTH env AI_ITEM_DETECTION_ENABLED=true AND the
 *     ai_messaging_settings.itemDetectionEnabled toggle. Either off => no-op.
 *   - Even when on, it only writes PROPOSALS to ai_detected_items. It never
 *     writes to the live action-item / issue tables until we explicitly wire
 *     that promotion step. So turning it on cannot disrupt existing HostBuddy
 *     data — it just starts collecting proposals for review.
 */
export class InboxItemDetectionService {
    private conversationRepo = appDatabase.getRepository(InboxConversationEntity);
    private messageRepo = appDatabase.getRepository(InboxMessageEntity);
    private detectedRepo = appDatabase.getRepository(AIDetectedItemEntity);

    /** Env kill-switch (default OFF). */
    static isEnabledByEnv(): boolean {
        return String(process.env.AI_ITEM_DETECTION_ENABLED || "").toLowerCase() === "true";
    }

    /** Both env AND the DB toggle must be on. */
    static async resolveEnabled(): Promise<boolean> {
        if (!InboxItemDetectionService.isEnabledByEnv()) return false;
        try {
            const s = await new AIMessagingSettingsService().getGlobalCached();
            return Boolean(s.itemDetectionEnabled);
        } catch {
            return false;
        }
    }

    private getClient(): OpenAI {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
        return new OpenAI({ apiKey });
    }

    /**
     * Detect proposals for a thread. Safe to call unconditionally: it self-gates
     * and returns { detected: 0 } when disabled, so callers stay simple.
     */
    async detectForThread(
        threadId: number,
        messageId?: number | null
    ): Promise<{ detected: number; reason?: string }> {
        if (!(await InboxItemDetectionService.resolveEnabled())) {
            return { detected: 0, reason: "detection_disabled" };
        }
        try {
            const conversation = await this.conversationRepo.findOne({ where: { threadId } });
            if (!conversation) return { detected: 0, reason: "no_conversation" };

            const messages = await this.messageRepo.find({
                where: { threadId },
                order: { sentAt: "ASC", id: "ASC" },
            });
            if (!messages.length) return { detected: 0, reason: "no_messages" };

            const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);
            const context = this.buildContext(conversation, messages);

            let output: DetectionOutput;
            let raw = "";
            try {
                const client = this.getClient();
                const completion = await client.chat.completions.create({
                    model: DETECTION_MODEL,
                    temperature: 0.2,
                    response_format: { type: "json_object" },
                    messages: [
                        { role: "system", content: this.systemPrompt(settings) },
                        { role: "user", content: context },
                    ],
                });
                raw = completion.choices?.[0]?.message?.content || "";
                output = JSON.parse(raw);
            } catch (err: any) {
                logger.error(`[ItemDetection] model/parse failed (thread ${threadId}): ${err.message}`);
                return { detected: 0, reason: "generation_failed" };
            }

            const rows: AIDetectedItemEntity[] = [];
            for (const ai of output.action_items || []) {
                if (!ai?.title) continue;
                rows.push(
                    this.detectedRepo.create({
                        type: "action_item",
                        threadId,
                        messageId: messageId ?? null,
                        reservationId: (conversation.reservationId as any) ?? null,
                        listingId: (conversation.listingId as any) ?? null,
                        title: String(ai.title).slice(0, 255),
                        description: ai.description || null,
                        category: ai.category ? String(ai.category).slice(0, 120) : null,
                        priority: ai.priority ? String(ai.priority).slice(0, 20) : null,
                        confidence: ai.confidence != null ? Math.round(ai.confidence * 100) : null,
                        status: "proposed",
                        payload: JSON.stringify(ai),
                        modelName: DETECTION_MODEL,
                        promptVersion: DETECTION_PROMPT_VERSION,
                    })
                );
            }
            for (const gi of output.guest_issues || []) {
                if (!gi?.title) continue;
                rows.push(
                    this.detectedRepo.create({
                        type: "guest_issue",
                        threadId,
                        messageId: messageId ?? null,
                        reservationId: (conversation.reservationId as any) ?? null,
                        listingId: (conversation.listingId as any) ?? null,
                        title: String(gi.title).slice(0, 255),
                        description: gi.description || null,
                        category: gi.category ? String(gi.category).slice(0, 120) : null,
                        priority: gi.severity ? String(gi.severity).slice(0, 20) : null,
                        confidence: gi.confidence != null ? Math.round(gi.confidence * 100) : null,
                        status: "proposed",
                        payload: JSON.stringify(gi),
                        modelName: DETECTION_MODEL,
                        promptVersion: DETECTION_PROMPT_VERSION,
                    })
                );
            }

            if (!rows.length) return { detected: 0, reason: "nothing_detected" };
            await this.detectedRepo.save(rows);
            logger.info(`[ItemDetection] thread ${threadId}: proposed ${rows.length} item(s)`);
            return { detected: rows.length };
        } catch (err: any) {
            logger.error(`[ItemDetection] unexpected error (thread ${threadId}): ${err.message}`);
            return { detected: 0, reason: "error" };
        }
    }

    /** Recent proposals for the review surface. */
    async listProposals(opts: { type?: string; status?: string; limit?: number } = {}) {
        const where: any = {};
        if (opts.type) where.type = opts.type;
        if (opts.status) where.status = opts.status;
        return this.detectedRepo.find({
            where,
            order: { createdAt: "DESC", id: "DESC" },
            take: Math.min(Math.max(opts.limit || 50, 1), 200),
        });
    }

    private systemPrompt(settings?: any): string {
        const actionRules = (settings?.actionItemRules || "").trim();
        const issueRules = (settings?.guestIssueRules || "").trim();
        const feedback = (settings?.detectionFeedback || "").trim();
        const extra: string[] = [];
        if (actionRules) extra.push(`ACTION ITEM RULES:\n${actionRules}`);
        if (issueRules) extra.push(`GUEST ISSUE RULES:\n${issueRules}`);
        if (feedback) extra.push(`TEAM FEEDBACK ON HOW TO IMPROVE DETECTION:\n${feedback}`);

        return [
            "You analyze a short-term-rental guest conversation and extract structured operational items.",
            "You produce two lists: action_items (tasks the team must do) and guest_issues (problems the guest is experiencing).",
            "Only extract items that are clearly supported by the conversation. Do NOT invent or speculate.",
            "If nothing qualifies, return empty arrays.",
            "",
            ...(extra.length ? [...extra, ""] : []),
            "OUTPUT: STRICT JSON only, exactly this shape:",
            "{",
            '  "action_items": [ { "title": "string", "description": "string", "category": "string", "priority": "low|medium|high|urgent", "confidence": 0.0 } ],',
            '  "guest_issues": [ { "title": "string", "description": "string", "category": "string", "severity": "low|medium|high|critical", "confidence": 0.0 } ]',
            "}",
            "confidence is 0..1. No text outside the JSON.",
        ].join("\n");
    }

    private buildContext(conversation: InboxConversationEntity, messages: InboxMessageEntity[]): string {
        const lines: string[] = [];
        lines.push(`Channel: ${conversation.channel || "unknown"}`);
        lines.push(`Guest: ${conversation.guestName || "unknown"}`);
        lines.push(`Listing: ${conversation.listingName || "unknown"}`);
        lines.push("");
        lines.push("Conversation (oldest first):");
        for (const m of messages.slice(-30)) {
            const who = m.direction === "incoming" ? "GUEST" : m.isAutomatic ? "AUTOMATED" : "TEAM";
            const body = (m.body || (m.note ? `[note] ${m.note}` : "")).replace(/\s+/g, " ").trim();
            if (body) lines.push(`- ${who}: ${body}`);
        }
        lines.push("");
        lines.push("Extract action_items and guest_issues as STRICT JSON per the schema.");
        return lines.join("\n");
    }
}
