import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { AIDetectedItemEntity } from "../entity/AIDetectedItem";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";

// Mini is plenty for "extract tasks from a conversation" and keeps the
// per-message cost at pennies; override with AI_ITEM_DETECTION_MODEL if needed.
const DETECTION_MODEL = process.env.AI_ITEM_DETECTION_MODEL || "gpt-4.1-mini";
const DETECTION_PROMPT_VERSION = "inbox-detect-v4";

// Guests send messages in bursts. Instead of scanning per message we wait for
// the burst to settle and scan the thread once — fewer calls, better context,
// and far fewer near-duplicate items.
const BURST_DELAY_MS = Number(process.env.AI_ITEM_DETECTION_DEBOUNCE_MS || 4 * 60 * 1000);

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
     * Per-process burst debounce: the first message of a burst arms a timer;
     * follow-up messages within the window just refresh the latest messageId.
     * When the timer fires we scan the whole thread once. Cluster workers each
     * keep their own map, so cross-worker duplicates are possible — the
     * save-time dedupe below is the authoritative guard.
     */
    private static pendingThreads = new Map<number, { timer: NodeJS.Timeout; messageId: number | null }>();

    static scheduleDetection(threadId: number, messageId?: number | null): void {
        const existing = InboxItemDetectionService.pendingThreads.get(threadId);
        if (existing) {
            existing.messageId = messageId ?? existing.messageId;
            return;
        }
        const entry = {
            messageId: messageId ?? null,
            timer: setTimeout(() => {
                InboxItemDetectionService.pendingThreads.delete(threadId);
                new InboxItemDetectionService()
                    .detectForThread(threadId, entry.messageId)
                    .catch((e) => logger.error(`[ItemDetection] scheduled run failed (thread ${threadId}): ${e.message}`));
            }, BURST_DELAY_MS),
        };
        entry.timer.unref?.();
        InboxItemDetectionService.pendingThreads.set(threadId, entry);
    }

    /** Tokenized overlap for duplicate suppression across repeated scans. */
    private static similar(a: string, b: string): boolean {
        const tok = (s: string) =>
            new Set(String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3));
        const A = tok(a);
        const B = tok(b);
        if (!A.size || !B.size) return false;
        let inter = 0;
        for (const w of A) if (B.has(w)) inter++;
        return inter / Math.min(A.size, B.size) >= 0.55;
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
        // Cross-worker guard: the burst debounce is per-process, so two PM2
        // cluster workers can both arm timers for the same thread and scan it
        // simultaneously — both see "no recent proposals" and both save,
        // duplicating every item (observed July 7: full sets saved twice).
        // A named MySQL lock makes one worker win; the loser skips entirely.
        const runner = appDatabase.createQueryRunner();
        const lockName = `ss_itemdetect_${threadId}`;
        try {
            await runner.connect();
            const lockRows: any[] = await runner.query("SELECT GET_LOCK(?, 0) AS l", [lockName]);
            if (!Number(lockRows?.[0]?.l)) {
                return { detected: 0, reason: "scan_in_progress_elsewhere" };
            }
            return await this.detectForThreadLocked(threadId, messageId);
        } finally {
            await runner.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
            await runner.release().catch(() => undefined);
        }
    }

    private async detectForThreadLocked(
        threadId: number,
        messageId?: number | null
    ): Promise<{ detected: number; reason?: string }> {
        try {
            const conversation = await this.conversationRepo.findOne({ where: { threadId } });
            if (!conversation) return { detected: 0, reason: "no_conversation" };

            const messages = await this.messageRepo.find({
                where: { threadId },
                order: { sentAt: "ASC", id: "ASC" },
            });
            if (!messages.length) return { detected: 0, reason: "no_messages" };

            const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);

            // Per-thread consolidation: tell the model what we already track for
            // this conversation so re-scans of an ongoing saga only emit
            // genuinely NEW facts instead of re-itemizing the whole situation.
            const alreadyTracked = await this.detectedRepo
                .createQueryBuilder("d")
                .where("d.threadId = :tid", { tid: threadId })
                .andWhere("d.status IN ('proposed', 'accepted')")
                .andWhere("d.createdAt >= DATE_SUB(NOW(), INTERVAL 14 DAY)")
                .orderBy("d.createdAt", "DESC")
                .take(40)
                .getMany();

            const context = this.buildContext(conversation, messages, alreadyTracked);

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

            // Confidence floor: the prompt asks the model to omit anything below
            // 0.6, but enforce it here too (audit: low-confidence items were
            // overwhelmingly noise).
            const confident = rows.filter((r) => r.confidence == null || Number(r.confidence) >= 60);
            if (!confident.length) return { detected: 0, reason: "below_confidence_floor" };

            // Dedup: never re-raise a task we already proposed for this thread
            // recently (repeated scans of the same conversation see the same facts).
            const recent = await this.detectedRepo
                .createQueryBuilder("d")
                .where("d.threadId = :tid", { tid: threadId })
                .andWhere("d.createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)")
                .getMany();
            const isDupOf = (r: AIDetectedItemEntity, e: { type?: string; title?: string | null; description?: string | null }) =>
                e.type === r.type &&
                (InboxItemDetectionService.similar(e.title || "", r.title || "") ||
                    InboxItemDetectionService.similar(
                        `${e.title || ""} ${e.description || ""}`,
                        `${r.title || ""} ${r.description || ""}`
                    ));
            const fresh: AIDetectedItemEntity[] = [];
            for (const r of confident) {
                // Compare against recent DB rows AND items accepted earlier in this batch.
                if (recent.some((e) => isDupOf(r, e))) continue;
                if (fresh.some((e) => isDupOf(r, e))) continue;
                fresh.push(r);
            }
            if (!fresh.length) return { detected: 0, reason: "all_duplicates" };
            await this.detectedRepo.save(fresh);
            logger.info(
                `[ItemDetection] thread ${threadId}: proposed ${fresh.length} item(s)` +
                    (rows.length - fresh.length ? ` (${rows.length - fresh.length} duplicate(s) suppressed)` : "")
            );
            return { detected: fresh.length };
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
            "You produce two lists: action_items (offline tasks a HUMAN team member must do) and guest_issues (physical/service problems at the property).",
            "BE SELECTIVE. These become tracked tasks a manager reviews — a July audit found 55% of extracted items were noise. Fewer, higher-quality items beat completeness. If nothing TRULY needs a human, return empty arrays; that is the most common correct answer.",
            "",
            "THE ONE TEST: would a competent operations manager, reading this conversation, assign this to a person as work that happens OUTSIDE the chat? Only then is it an item.",
            "",
            "WHAT COUNTS AS AN ACTION ITEM:",
            "- Reservation changes a human must execute: extension, date change, cancellation intent, adding guests/pets (fee handling), early check-in / late checkout that needs confirming.",
            "- Access problems mid-arrival: codes not working, lockbox confusion, can't find the unit — urgent.",
            "- Listing errors the guest points out (wrong amenity/bathroom count/photos) — task to fix the listing.",
            "- Payment/refund matters requiring human action (failed payment, refund request).",
            "- Genuine special arrangements needing human coordination or approval.",
            "",
            "ESCALATION: if the guest is frustrated, angry, or reports being ignored AND the conversation shows it is not already being handled, create ONE urgent action item describing what they're upset about.",
            "",
            "WHAT TO EXCLUDE (each rule below killed real noise in the audit):",
            "1. RESOLVED: anything the conversation shows was already handled, answered, confirmed done, or that the team said is in motion. Read the WHOLE thread before proposing.",
            "2. A CHAT REPLY IS THE FIX: if answering the guest's question fully resolves the matter (pricing clarification, policy question, information request), there is NO task. Answering is the messaging AI's job, not an item.",
            "3. NO REAL ASK: pleasantries, musings, hypotheticals ('we might stay longer'), observations without a request, or anything the guest explicitly declined or dropped.",
            "4. AUTOMATED FLOWS: check-in instructions, access codes before arrival, pre-check-in reminders, payment-link reminders are all SENT AUTOMATICALLY. Never create 'send check-in instructions/details' tasks.",
            "5. TRIVIA: phone number / contact info updates, 'verify guest count' with no consequence, 'monitor' or 'follow up' filler with no concrete act.",
            "6. ONE ITEM PER FACT: a property problem is ONE guest_issue — do NOT also emit an action_item that restates it ('Fix X' for issue X). Only add a separate action_item when the human work goes beyond fixing the reported problem.",
            "7. ALREADY TRACKED: if the context lists items already tracked for this conversation, NEVER re-emit them or reworded/split/merged variations of them. On a re-scan of an ongoing conversation, only emit facts that are genuinely NEW since those items were created. If everything is already tracked, return empty arrays.",
            "",
            "GUEST ISSUES are ONLY physical or service defects at the property (broken, missing, dirty, not working). Not questions, not requests, not reservation matters.",
            "",
            "CONFIDENCE: score how certain you are a manager would assign this task. OMIT anything you would score below 0.6.",
            "",
            'category MUST be one of: "reservation_change", "guest_request", "property_access", "maintenance", "cleanliness", "hvac", "pest_control", "pool_spa", "landscaping", "listing_error", "escalation", "other".',
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

    private buildContext(
        conversation: InboxConversationEntity,
        messages: InboxMessageEntity[],
        alreadyTracked: AIDetectedItemEntity[] = []
    ): string {
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
        if (alreadyTracked.length) {
            lines.push("");
            lines.push(
                "ALREADY TRACKED for this conversation (do NOT re-emit these or minor variations of them — " +
                    "only emit facts that are genuinely NEW or have materially changed since):"
            );
            for (const t of alreadyTracked) {
                lines.push(`- [${t.type}] ${(t.title || "").slice(0, 160)}`);
            }
        }
        lines.push("");
        lines.push("Extract action_items and guest_issues as STRICT JSON per the schema.");
        return lines.join("\n");
    }
}
