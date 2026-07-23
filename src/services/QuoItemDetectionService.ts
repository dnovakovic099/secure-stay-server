import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { QuoConversationEntity } from "../entity/QuoConversation";
import { QuoMessageEntity } from "../entity/QuoMessage";
import { ActionItems } from "../entity/ActionItems";
import { Issue } from "../entity/Issue";
import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";
import {
    resolveDetectorInstructions,
    collectCategoryNames,
    resolveTicketCategories,
} from "./AIDetectorInstructions";
import { IssuesService } from "./IssuesService";
import {
    applyScheduleCriticalUrgency,
    downloadUrlsAsIssueFiles,
    findDuplicateOpenIssue,
    parseMediaUrlList,
    ticketTextSimilar,
} from "./AITicketCreationHelpers";

const DETECTION_MODEL = process.env.AI_ITEM_DETECTION_MODEL || "gpt-4.1-mini";

interface QuoDetectedItem {
    item: string;
    category?: string;
    urgency?: number; // 1 (low) .. 3 (high)
}

/**
 * QuoItemDetectionService — creates tickets from Quo SMS conversations
 * (PM + GR lines).
 *
 * For each detection we:
 *   1. Always write a live Action Item (source='quo', createdBy='quo-ai')
 *   2. Also auto-create a Guest Issue (source='ai_quo', creator='AI Assistant')
 *      when Settings itemDetectionEnabled is on, the conversation is linked to
 *      a reservation, and the category has autoCreate enabled — same
 *      destination as the Hostify inbox detector.
 *
 * Kill switch: QUO_ITEM_DETECTION_ENABLED=false.
 */
export class QuoItemDetectionService {
    private conversationRepo = appDatabase.getRepository(QuoConversationEntity);
    private messageRepo = appDatabase.getRepository(QuoMessageEntity);
    private actionItemsRepo = appDatabase.getRepository(ActionItems);
    private issueRepo = appDatabase.getRepository(Issue);

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

    /** Token-overlap similarity used to suppress near-duplicate Guest Issues. */
    private static similar(a: string, b: string): boolean {
        return ticketTextSimilar(a, b, 0.55);
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

        const autoCreateByName = new Map<string, boolean>();
        for (const c of resolveTicketCategories(settings)) {
            const key = (c?.name || "").trim().toLowerCase();
            if (!key) continue;
            autoCreateByName.set(key, c?.autoCreate === false ? false : true);
        }

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

        // Guest Issues share the same Settings toggle as Hostify inbox
        // detection. Action Items still create whenever Quo detection is on.
        const guestIssuesEnabled = Boolean(settings?.itemDetectionEnabled);

        let created = 0;
        let issuesCreated = 0;
        for (const it of items) {
            const text = String(it.item || "").trim();
            if (!text) continue;
            // Cheap dedupe against existing items for this conversation.
            const dup = existing.some(
                (e) => String(e.item || "").toLowerCase().trim() === text.toLowerCase()
            );
            if (dup) continue;

            const saved = await this.actionItemsRepo.save(
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
            existing.push(saved);

            if (!guestIssuesEnabled) continue;
            const issueId = await this.maybeCreateGuestIssue(conv, it, text, saved.id, autoCreateByName);
            if (issueId) issuesCreated++;
        }

        conv.lastDetectAt = new Date();
        await this.conversationRepo.save(conv);
        if (created) {
            logger.info(
                `[QuoDetect] Created ${created} action item(s)` +
                    (issuesCreated ? `, ${issuesCreated} guest issue(s)` : "") +
                    ` from conversation ${conversationId}`
            );
        }
        return created;
    }

    /**
     * Promote a Quo detection into a live Guest Issues ticket (source=ai_quo).
     * Skips when: no linked reservation, category autoCreate is off, or a
     * near-duplicate issue already exists for the reservation.
     */
    private async maybeCreateGuestIssue(
        conv: QuoConversationEntity,
        detected: QuoDetectedItem,
        text: string,
        actionItemId: number,
        autoCreateByName: Map<string, boolean>
    ): Promise<number | null> {
        if (!conv.reservationId) return null;

        const catKey = String(detected.category || "").trim().toLowerCase();
        if (catKey && autoCreateByName.has(catKey) && autoCreateByName.get(catKey) === false) {
            return null;
        }

        try {
            const dup = await findDuplicateOpenIssue(conv.reservationId, detected.item || "", text);
            if (dup) {
                logger.info(
                    `[QuoDetect] Skipping guest issue for action_items:${actionItemId} — near-duplicate of open issue #${dup.id}`
                );
                return dup.id;
            }

            const reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
            const listingRepo = appDatabase.getRepository(Listing);
            const reservation = await reservationRepo
                .findOne({ where: { id: Number(conv.reservationId) } })
                .catch(() => null);

            const resolvedListingId =
                conv.listingId != null
                    ? Number(conv.listingId)
                    : reservation?.listingMapId != null
                      ? Number(reservation.listingMapId)
                      : null;
            let listing: Listing | null = null;
            if (resolvedListingId) {
                listing = await listingRepo
                    .findOne({ where: { id: Number(resolvedListingId) }, withDeleted: true })
                    .catch(() => null);
            }

            const resolvedListingName =
                conv.listingName ||
                reservation?.listingName ||
                (listing as any)?.internalListingName ||
                (listing as any)?.name ||
                null;
            const resolvedGuestName =
                conv.guestName || conv.contactName || reservation?.guestName || null;
            const resolvedGuestPhone =
                (reservation as any)?.phone || conv.participantPhone || null;
            const resolvedCheckIn = (reservation as any)?.arrivalDate || null;
            const resolvedChannel =
                (reservation as any)?.channelName || conv.lineName || "SMS";

            // Quo urgency is 1..3; Guest Issues use a wider 1..5 scale.
            const urgencyMap: Record<number, number> = { 1: 2, 2: 3, 3: 4 };
            let urgency =
                detected.urgency && urgencyMap[detected.urgency]
                    ? urgencyMap[detected.urgency]
                    : 3;
            urgency = applyScheduleCriticalUrgency(
                urgency,
                text,
                detected.category,
                reservation,
                listing
            ) as number;

            // Attach guest SMS media (photos) when present on recent inbound messages.
            let guestFiles: Awaited<ReturnType<typeof downloadUrlsAsIssueFiles>> = [];
            try {
                const msgs = await this.messageRepo.find({
                    where: { conversationId: conv.conversationId },
                    order: { sentAt: "DESC", id: "DESC" },
                    take: 30,
                });
                const urls: string[] = [];
                for (const m of msgs) {
                    if (String(m.direction || "").toLowerCase() !== "incoming") continue;
                    for (const u of parseMediaUrlList(m.mediaUrls)) {
                        if (!urls.includes(u)) urls.push(u);
                    }
                    if (urls.length >= 6) break;
                }
                guestFiles = await downloadUrlsAsIssueFiles(urls);
            } catch (err: any) {
                logger.warn(`[QuoDetect] media attach failed: ${err?.message}`);
            }

            const issueData: Partial<Issue> = {
                status: "New",
                gr_status: "New",
                listing_id: resolvedListingId ? String(resolvedListingId) : "0",
                listing_name: (resolvedListingName || null) as any,
                reservation_id: String(conv.reservationId),
                channel: resolvedChannel as any,
                guest_name: (resolvedGuestName || null) as any,
                guest_contact_number: (resolvedGuestPhone || null) as any,
                check_in_date: (resolvedCheckIn || null) as any,
                issue_description: text,
                category: detected.category || (null as any),
                urgency: urgency as any,
                creator: "AI Assistant",
                date_time_reported: new Date(),
                source: "ai_quo",
                aiSourceRef: `action_items:${actionItemId}`,
            };

            const issuesService = new IssuesService();
            const saved = await issuesService.createIssue(
                issueData,
                "AI Assistant",
                guestFiles.length ? guestFiles : undefined
            )

            if (!saved.listing_name && resolvedListingName) {
                saved.listing_name = resolvedListingName;
                await this.issueRepo.save(saved).catch((err) => {
                    logger.warn(
                        `[QuoDetect] patch listing_name on issue #${saved.id} failed: ${err?.message}`
                    );
                });
            }

            return saved.id;
        } catch (err: any) {
            logger.error(
                `[QuoDetect] guest issue create failed for action_items:${actionItemId}: ${err?.message}`
            );
            return null;
        }
    }
}
