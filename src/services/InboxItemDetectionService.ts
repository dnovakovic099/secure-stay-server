import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { AIDetectedItemEntity } from "../entity/AIDetectedItem";
import { AIDiscardFeedbackEntity } from "../entity/AIDiscardFeedback";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";
import {
    resolveDetectorInstructions,
    collectCategoryNames,
    resolveTicketCategories,
} from "./AIDetectorInstructions";
import { IssuesService } from "./IssuesService";
import { Issue } from "../entity/Issue";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Listing } from "../entity/Listing";

// Mini is plenty for "extract tasks from a conversation" and keeps the
// per-message cost at pennies; override with AI_ITEM_DETECTION_MODEL if needed.
const DETECTION_MODEL = process.env.AI_ITEM_DETECTION_MODEL || "gpt-4.1-mini";
const DETECTION_PROMPT_VERSION = "inbox-detect-v5";

// Guests send messages in bursts. Instead of scanning per message we wait for
// the burst to settle and scan the thread once — fewer calls, better context,
// and far fewer near-duplicate items.
const BURST_DELAY_MS = Number(process.env.AI_ITEM_DETECTION_DEBOUNCE_MS || 4 * 60 * 1000);

// Every detected item is now a ticket destined for the Guest Issues page.
// The Action Items concept is retired — see AIDetectorInstructions.ts for the
// updated persona / exclusion rules.
interface DetectedTicket {
    title: string;
    description?: string;
    category?: string;
    priority?: string; // low | medium | high | urgent
    confidence?: number; // 0..1
}
interface DetectionOutput {
    // New shape emitted by the current prompt.
    tickets?: DetectedTicket[];
    // Backward-compat: older cached prompts may still emit these; we merge them
    // in as tickets so no live traffic drops between rollouts.
    action_items?: DetectedTicket[];
    guest_issues?: DetectedTicket[];
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
    private discardFeedbackRepo = appDatabase.getRepository(AIDiscardFeedbackEntity);

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

    /**
     * True when the counterparty on the thread is Airbnb Support (case
     * workers), not a real guest. Mirrors the InboxAIService helper — same
     * regex, same signals — so both pipelines agree on what an Airbnb Support
     * thread is.
     */
    static isAirbnbSupportThread(
        conversation: InboxConversationEntity,
        messages: InboxMessageEntity[]
    ): boolean {
        if (/airbnb\s*support/i.test(conversation.guestName || "")) return true;
        return messages.some(
            (m) => m.direction === "incoming" && /airbnb\s*support/i.test(m.senderName || "")
        );
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

            // Skip Airbnb Support threads outright — the counterparty is a
            // case worker, not a guest, and their messages routinely mention
            // property issues in a way the model would otherwise turn into
            // spurious tickets. Same signal InboxAIService.isAirbnbSupportThread
            // uses (regex on guestName / senderName).
            if (InboxItemDetectionService.isAirbnbSupportThread(conversation, messages)) {
                return { detected: 0, reason: "airbnb_support_thread" };
            }

            // A guest ticket requires a guest reservation. If the thread has
            // no reservationId (pre-booking inquiry, support channel, orphan
            // chat), skip detection entirely — no reservation means no
            // property / stay context, which produces low-quality tickets and
            // matches the pattern the team flagged in production.
            if (!conversation.reservationId) {
                return { detected: 0, reason: "no_reservation" };
            }

            const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);

            // Team discards are the strongest negative signal: each row is an
            // action item a human explicitly said was NOT needed, with why.
            // Feed the most recent ones into the prompt as counter-examples.
            const discardExamples = await this.loadDiscardExamples();

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
                        { role: "system", content: this.systemPrompt(settings, discardExamples) },
                        { role: "user", content: context },
                    ],
                });
                raw = completion.choices?.[0]?.message?.content || "";
                output = JSON.parse(raw);
            } catch (err: any) {
                logger.error(`[ItemDetection] model/parse failed (thread ${threadId}): ${err.message}`);
                return { detected: 0, reason: "generation_failed" };
            }

            // Unified ticket list: prefer the new `tickets[]` shape; fold in the
            // legacy split arrays if the model still emits them (rolling prompt
            // upgrades, cached responses).
            const modelTickets: DetectedTicket[] = [
                ...(output.tickets || []),
                ...(output.guest_issues || []),
                ...(output.action_items || []),
            ];

            const rows: AIDetectedItemEntity[] = [];
            for (const t of modelTickets) {
                if (!t?.title) continue;
                rows.push(
                    this.detectedRepo.create({
                        // Every detection is now a Guest Issues ticket. The
                        // legacy 'action_item' type is retired.
                        type: "guest_issue",
                        threadId,
                        messageId: messageId ?? null,
                        reservationId: (conversation.reservationId as any) ?? null,
                        listingId: (conversation.listingId as any) ?? null,
                        title: String(t.title).slice(0, 255),
                        description: t.description || null,
                        category: t.category ? String(t.category).slice(0, 120) : null,
                        priority: t.priority ? String(t.priority).slice(0, 20) : null,
                        confidence: t.confidence != null ? Math.round(t.confidence * 100) : null,
                        status: "proposed",
                        payload: JSON.stringify(t),
                        modelName: DETECTION_MODEL,
                        promptVersion: DETECTION_PROMPT_VERSION,
                    })
                );
            }

            if (!rows.length) return { detected: 0, reason: "nothing_detected" };

            // Confidence floor: the prompt asks the model to omit anything below
            // the configured floor, but enforce it here too (audit: low-confidence
            // items were overwhelmingly noise). Floor is admin-editable via
            // AIMessagingSettings.detectionConfidenceFloor.
            const floorPct = Math.round(resolveDetectorInstructions(settings).confidenceFloor * 100);
            const confident = rows.filter((r) => r.confidence == null || Number(r.confidence) >= floorPct);
            if (!confident.length) return { detected: 0, reason: "below_confidence_floor" };

            // Dedup: never re-raise a task we already proposed for this thread
            // recently (repeated scans of the same conversation see the same facts).
            const recent = await this.detectedRepo
                .createQueryBuilder("d")
                .where("d.threadId = :tid", { tid: threadId })
                .andWhere("d.createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)")
                .getMany();
            const isDupOf = (r: AIDetectedItemEntity, e: { title?: string | null; description?: string | null }) =>
                InboxItemDetectionService.similar(e.title || "", r.title || "") ||
                InboxItemDetectionService.similar(
                    `${e.title || ""} ${e.description || ""}`,
                    `${r.title || ""} ${r.description || ""}`
                );
            const fresh: AIDetectedItemEntity[] = [];
            for (const r of confident) {
                // Compare against recent DB rows AND items accepted earlier in this batch.
                if (recent.some((e) => isDupOf(r, e))) continue;
                if (fresh.some((e) => isDupOf(r, e))) continue;
                fresh.push(r);
            }
            if (!fresh.length) return { detected: 0, reason: "all_duplicates" };
            await this.detectedRepo.save(fresh);

            // Auto-promote to real Guest Issues tickets. Categories may opt out
            // via `autoCreate: false` in Settings — those rows stay as 'proposed'
            // for manual review in the Action Items (Testing) surface.
            const promoted = await this.autoCreateIssues(fresh, conversation, settings);

            logger.info(
                `[ItemDetection] thread ${threadId}: detected ${fresh.length} ticket(s), auto-created ${promoted}` +
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

    /**
     * Recent "discarded as not needed" items + reasons, formatted as prompt
     * counter-examples. Cached briefly since every thread scan needs them.
     */
    private static discardCache: { at: number; lines: string[] } | null = null;

    private async loadDiscardExamples(): Promise<string[]> {
        const cached = InboxItemDetectionService.discardCache;
        if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.lines;
        let lines: string[] = [];
        try {
            const rows = await this.discardFeedbackRepo
                .createQueryBuilder("f")
                .where("f.createdAt >= DATE_SUB(NOW(), INTERVAL 120 DAY)")
                .orderBy("f.createdAt", "DESC")
                .take(30)
                .getMany();
            lines = rows
                .filter((r) => (r.itemText || "").trim() && (r.reason || "").trim())
                .map(
                    (r) =>
                        `- "${String(r.itemText).replace(/\s+/g, " ").trim().slice(0, 180)}" — discarded because: ${String(r.reason).replace(/\s+/g, " ").trim().slice(0, 200)}`
                );
        } catch (err: any) {
            logger.warn(`[ItemDetection] failed to load discard feedback: ${err.message}`);
        }
        InboxItemDetectionService.discardCache = { at: Date.now(), lines };
        return lines;
    }

    private systemPrompt(settings?: any, discardExamples: string[] = []): string {
        const instructions = resolveDetectorInstructions(settings);
        const ticketRules = (settings?.guestIssueRules || "").trim();
        const feedback = (settings?.detectionFeedback || "").trim();
        const extra: string[] = [];
        if (ticketRules) extra.push(`TICKET RULES:\n${ticketRules}`);
        if (feedback) extra.push(`TEAM FEEDBACK ON HOW TO IMPROVE DETECTION:\n${feedback}`);
        if (discardExamples.length) {
            extra.push(
                [
                    "TICKETS THE TEAM DISCARDED AS NOT NEEDED (real examples with the team's reason).",
                    "Learn from these: do NOT create tickets of the same kind, and generalize the reasons to similar situations:",
                    ...discardExamples,
                ].join("\n")
            );
        }

        // Unified ticket category list. Prefer the merged `ticketCategories`
        // column; fall back to the union of the legacy split columns for
        // backward compatibility. The same list is exposed on the Guest Issues
        // page — anything the model picks here must be a valid ticket category.
        const categoryNames = collectCategoryNames(settings);
        const categoryLine = categoryNames.length
            ? `category MUST be one of (name-match, case-insensitive): ${categoryNames
                  .map((c) => JSON.stringify(c))
                  .join(", ")}.`
            : "category is a short slug describing the ticket type.";

        return [
            instructions.persona,
            "",
            instructions.exclusionRules,
            "",
            `CONFIDENCE: score how certain you are a manager would open a ticket for this. OMIT anything you would score below ${instructions.confidenceFloor.toFixed(
                2
            )}.`,
            "",
            categoryLine,
            "",
            ...(extra.length ? [...extra, ""] : []),
            "OUTPUT: STRICT JSON only, exactly this shape:",
            "{",
            '  "tickets": [ { "title": "string", "description": "string", "category": "string", "priority": "low|medium|high|urgent", "confidence": 0.0 } ]',
            "}",
            'Each `description` MUST begin with one of: "The guest reported ", "The guest clarified ", "The guest requested ", "The guest complained ", "The guest asked ", "The guest confirmed ".',
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
                lines.push(`- ${(t.title || "").slice(0, 160)}`);
            }
        }
        lines.push("");
        lines.push("Extract tickets as STRICT JSON per the schema.");
        return lines.join("\n");
    }

    /**
     * Promote fresh detections into real Guest Issues rows so they show up on
     * the Guest Issues page immediately — no manual "Open ticket" click. Each
     * detected row is stamped with `convertedIssueId` + `status='created'`,
     * matching the invariants used by `AIActionItemsTestingService.convertToIssue`
     * so the review UI keeps working for anything auto-created here.
     *
     * Rows tied to a category with `autoCreate: false` are intentionally left
     * as 'proposed' so admins can gate risky categories behind a manual review.
     * Returns the count actually promoted.
     */
    private async autoCreateIssues(
        detected: AIDetectedItemEntity[],
        conversation: InboxConversationEntity,
        settings: any
    ): Promise<number> {
        if (!detected.length) return 0;

        // Belt-and-suspenders: the detector should have already bailed for
        // Airbnb Support threads or missing reservations, but guard here too so
        // an accidental future codepath cannot open bogus tickets.
        if (!conversation?.reservationId) return 0;

        // Build a case-insensitive lookup of category → autoCreate flag from
        // the same list the prompt is constrained to. Missing/unknown categories
        // default to auto-create — the safety valve is the confidence floor.
        const autoCreateByName = new Map<string, boolean>();
        for (const c of resolveTicketCategories(settings)) {
            const key = (c?.name || "").trim().toLowerCase();
            if (!key) continue;
            const flag = c?.autoCreate === false ? false : true;
            autoCreateByName.set(key, flag);
        }

        const urgencyMap: Record<string, number> = {
            urgent: 5,
            critical: 5,
            high: 4,
            medium: 3,
            normal: 3,
            low: 2,
        };

        const issuesService = new IssuesService();
        const reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
        const listingRepo = appDatabase.getRepository(Listing);

        // Enrich once per batch: the whole thread shares one reservation +
        // listing, so we look them up ahead of the loop instead of per-row.
        // Property, stay dates and guest phone all need these to render.
        let reservation: ReservationInfoEntity | null = null;
        if (conversation?.reservationId) {
            reservation = await reservationRepo
                .findOne({ where: { id: Number(conversation.reservationId) } })
                .catch(() => null);
        }
        const resolvedListingId =
            conversation?.listingId ??
            (reservation?.listingMapId != null ? Number(reservation.listingMapId) : null);
        let listing: Listing | null = null;
        if (resolvedListingId) {
            listing = await listingRepo
                .findOne({ where: { id: Number(resolvedListingId) }, withDeleted: true })
                .catch(() => null);
        }
        // Listing name resolution — some Listing rows have an empty
        // internalListingName (older Hostify syncs), so we also fall back to
        // reservation.listingName (which is the reservation-scoped display name
        // — e.g. the street address like "3373 N Oakland"). Matches the
        // fallback chain the Guest Issues detail view uses.
        const resolvedListingName =
            conversation?.listingName ||
            reservation?.listingName ||
            (listing as any)?.internalListingName ||
            (listing as any)?.name ||
            null;
        const resolvedGuestName = conversation?.guestName || reservation?.guestName || null;
        const resolvedGuestPhone = (reservation as any)?.phone || null;
        const resolvedCheckIn = (reservation as any)?.arrivalDate || null;

        let promoted = 0;

        for (const row of detected) {
            const catKey = (row.category || "").trim().toLowerCase();
            if (catKey && autoCreateByName.has(catKey) && autoCreateByName.get(catKey) === false) {
                // Admin gated this category — leave as 'proposed' for review.
                continue;
            }

            const priorityKey = String(row.priority || "").toLowerCase();
            const urgency = urgencyMap[priorityKey] ?? null;

            const issueData: Partial<Issue> = {
                status: "New",
                gr_status: "New",
                listing_id: resolvedListingId ? String(resolvedListingId) : "0",
                listing_name: (resolvedListingName || null) as any,
                reservation_id: conversation?.reservationId
                    ? String(conversation.reservationId)
                    : (null as any),
                channel: (conversation?.channel || null) as any,
                guest_name: (resolvedGuestName || null) as any,
                guest_contact_number: (resolvedGuestPhone || null) as any,
                check_in_date: (resolvedCheckIn || null) as any,
                issue_description: [row.title, row.description].filter(Boolean).join(" — "),
                category: row.category || (null as any),
                urgency: urgency as any,
                creator: "AI Assistant",
                date_time_reported: new Date(),
                source: "ai_inbox",
                aiConfidence:
                    row.confidence != null ? (Number(row.confidence) / 100).toFixed(3) : (null as any),
                aiSourceRef: `ai_detected_items:${row.id}`,
            };

            try {
                const saved = await issuesService.createIssue(issueData, "AI Assistant");

                // IssuesService.createIssue does its own Listing lookup and
                // overwrites listing_name with Listing.internalListingName ||
                // "" — so if the Listing row has an empty internalListingName
                // (older Hostify sync), our resolved value gets discarded and
                // the Guest Issues list shows "-" in the Property column even
                // though the detail view can still fall back to the reservation.
                // Patch it back if the shared service wiped it.
                if (!saved.listing_name && resolvedListingName) {
                    saved.listing_name = resolvedListingName;
                    await appDatabase.getRepository(Issue).save(saved).catch((err) => {
                        logger.warn(
                            `[ItemDetection] patch listing_name on issue #${saved.id} failed: ${err?.message}`
                        );
                    });
                }

                row.convertedIssueId = saved.id;
                row.status = "created";
                await this.detectedRepo.save(row);
                promoted++;
            } catch (err: any) {
                logger.error(
                    `[ItemDetection] auto-create failed for detected #${row.id}: ${err?.message}`
                );
            }
        }

        return promoted;
    }
}
