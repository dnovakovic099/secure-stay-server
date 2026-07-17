import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIOpsAlertEntity } from "../entity/AIOpsAlert";
import { ActionItems } from "../entity/ActionItems";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";

const REVIEW_RISK_MODEL = process.env.AI_ITEM_DETECTION_MODEL || "gpt-4.1-mini";

/** mysql DATE/DATETIME columns arrive as Date objects or strings — normalize to YYYY-MM-DD. */
const isoDate = (v: any): string | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) {
        const m = String(v).match(/\d{4}-\d{2}-\d{2}/);
        return m ? m[0] : null;
    }
    return d.toISOString().slice(0, 10);
};

/** Root-cause radar topic buckets — deterministic and explainable. */
const ISSUE_TOPICS: { topic: string; label: string; re: RegExp; fix: string }[] = [
    {
        topic: "wifi",
        label: "WiFi / internet",
        re: /\bwi-?fi\b|internet|router|modem|network/i,
        fix: "Repeated connectivity complaints usually mean failing hardware or an ISP problem — consider replacing the router or upgrading the plan instead of resetting it again.",
    },
    {
        topic: "hvac",
        label: "AC / heating",
        re: /\ba\/?c\b|air.?condition|heat(er|ing)?\b|hvac|thermostat|too (hot|cold)/i,
        fix: "Recurring HVAC complaints point to a unit that needs servicing (filter, refrigerant, thermostat) — book a preventive service visit.",
    },
    {
        topic: "plumbing",
        label: "Water / plumbing",
        re: /leak|clog|drain|toilet|plumb|no hot water|water (pressure|heater)|faucet|shower/i,
        fix: "Multiple plumbing tickets at one property warrant a plumber inspection of the whole unit, not another spot fix.",
    },
    {
        topic: "lock",
        label: "Locks / access",
        re: /\block(ed)?\b|keypad|door code|access code|key\b|smart ?lock/i,
        fix: "Repeated access problems suggest a failing lock or battery pattern — replace the lock or tighten the code workflow.",
    },
    {
        topic: "appliance",
        label: "Appliances",
        re: /washer|dryer|dishwasher|fridge|refrigerator|oven|stove|microwave|tv\b|television|garbage disposal/i,
        fix: "The same appliance failing repeatedly is cheaper to replace than to keep servicing.",
    },
    {
        topic: "cleaning",
        label: "Cleanliness",
        re: /dirty|not clean|wasn'?t clean|stain|hair\b|dust|smell|odor|trash|cleaning/i,
        fix: "A cleanliness pattern at one listing is a cleaner-quality problem — review the assigned cleaner or add a post-clean photo checklist.",
    },
    {
        topic: "pest",
        label: "Pests",
        re: /bug|roach|ant(s)?\b|mice|mouse|rat(s)?\b|pest|spider|mosquito/i,
        fix: "Multiple pest reports need professional extermination and prevention, not one-off sprays.",
    },
    {
        topic: "supplies",
        label: "Supplies",
        re: /out of (toilet paper|towels|soap|paper towels|coffee)|ran out|missing (towels|linens|soap)|no (towels|toilet paper|soap)/i,
        fix: "Repeated supply shortages mean the restock par levels are too low for this unit's occupancy — raise the standard stock.",
    },
];

export interface OpsAlertInput {
    type: string;
    dedupeKey: string;
    severity?: string;
    listingId?: number | null;
    listingName?: string | null;
    threadId?: number | null;
    reservationId?: number | null;
    title: string;
    detail?: string | null;
    recommendation?: string | null;
    payload?: any;
    actionItemId?: number | null;
}

/**
 * OpsRadarService — the manager's manage-by-exception feed.
 *
 * Five sweeps write into one alert table:
 *  1. sweepMaintenance    — smart-lock battery/offline telemetry, pre-check-in
 *  2. sweepRootCauses     — recurring issue clusters per listing (90 days)
 *  3. sweepSLA            — unanswered guest threads + stale tickets past SLA
 *  4. sweepReviewRisks    — active stays trending toward a bad review (LLM)
 *  5. sweepTurnoverRisks  — same-day turnovers with stacked risk factors
 *
 * All sweeps are idempotent (dedupeKey upserts), self-resolving (alerts close
 * when the condition clears), and respect human dismissals.
 */
export class OpsRadarService {
    private repo = appDatabase.getRepository(AIOpsAlertEntity);
    private conversationRepo = appDatabase.getRepository(InboxConversationEntity);
    private messageRepo = appDatabase.getRepository(InboxMessageEntity);

    static isEnabled(): boolean {
        return String(process.env.AI_MESSAGING_ENABLED || "").toLowerCase() === "true";
    }

    // ------------------------------------------------------------------
    // Alert store
    // ------------------------------------------------------------------

    /**
     * Insert or refresh an alert. Dismissed alerts stay dismissed while the
     * same condition persists; resolved alerts reopen if the condition recurs.
     */
    async upsertAlert(input: OpsAlertInput): Promise<AIOpsAlertEntity | null> {
        const now = new Date();
        const existing = await this.repo.findOne({ where: { dedupeKey: input.dedupeKey } });
        if (existing) {
            existing.lastSeenAt = now;
            existing.severity = input.severity || existing.severity;
            existing.title = input.title;
            existing.detail = input.detail ?? existing.detail;
            existing.recommendation = input.recommendation ?? existing.recommendation;
            if (input.payload !== undefined) existing.payload = JSON.stringify(input.payload);
            if (input.actionItemId != null) existing.actionItemId = input.actionItemId;
            if (existing.status === "resolved") {
                existing.status = "open";
                existing.resolvedAt = null;
            }
            // dismissed stays dismissed
            return this.repo.save(existing);
        }
        return this.repo.save(
            this.repo.create({
                type: input.type,
                dedupeKey: input.dedupeKey.slice(0, 160),
                severity: input.severity || "medium",
                status: "open",
                listingId: input.listingId ?? null,
                listingName: input.listingName ?? null,
                threadId: input.threadId ?? null,
                reservationId: input.reservationId ?? null,
                title: input.title.slice(0, 300),
                detail: input.detail ?? null,
                recommendation: input.recommendation ?? null,
                payload: input.payload !== undefined ? JSON.stringify(input.payload) : null,
                actionItemId: input.actionItemId ?? null,
                lastSeenAt: now,
            })
        );
    }

    /** Close every open/dismissed alert of a type whose condition has cleared. */
    private async autoResolve(type: string, activeDedupeKeys: string[]) {
        const qb = this.repo
            .createQueryBuilder()
            .update()
            .set({ status: "resolved", resolvedAt: new Date() })
            .where("type = :type", { type })
            .andWhere("status IN ('open','dismissed')");
        if (activeDedupeKeys.length) {
            qb.andWhere("dedupeKey NOT IN (:...keys)", { keys: activeDedupeKeys });
        }
        await qb.execute();
    }

    async listAlerts(opts: { type?: string; status?: string; limit?: number } = {}) {
        const where: any = {};
        where.status = opts.status || "open";
        if (opts.type) where.type = opts.type;
        return this.repo.find({
            where,
            order: { severity: "ASC", lastSeenAt: "DESC" },
            take: Math.min(Math.max(opts.limit || 200, 1), 500),
        });
    }

    async summary() {
        const rows: any[] = await appDatabase.query(
            `SELECT type, severity, COUNT(*) n FROM ai_ops_alerts WHERE status = 'open' GROUP BY type, severity`
        );
        const byType: Record<string, { total: number; critical: number; high: number }> = {};
        for (const r of rows) {
            const t = (byType[r.type] = byType[r.type] || { total: 0, critical: 0, high: 0 });
            t.total += Number(r.n);
            if (r.severity === "critical") t.critical += Number(r.n);
            if (r.severity === "high") t.high += Number(r.n);
        }
        return byType;
    }

    async dismiss(id: number, userId?: number | null) {
        const alert = await this.repo.findOne({ where: { id } });
        if (!alert) throw new Error(`Alert ${id} not found`);
        alert.status = "dismissed";
        alert.dismissedByUserId = userId ?? null;
        return this.repo.save(alert);
    }

    async resolve(id: number) {
        const alert = await this.repo.findOne({ where: { id } });
        if (!alert) throw new Error(`Alert ${id} not found`);
        alert.status = "resolved";
        alert.resolvedAt = new Date();
        return this.repo.save(alert);
    }

    // ------------------------------------------------------------------
    // 1) Predictive maintenance — smart-lock telemetry
    // ------------------------------------------------------------------

    /**
     * Battery levels live in smart_lock_devices.provider_metadata (Seam sync:
     * properties.battery_level as a 0–1 fraction). Low battery or an offline
     * device *before an upcoming check-in* is exactly the failure that becomes
     * a locked-out guest at 11pm — raise it while it's still a $5 fix. When
     * severity is critical and a check-in is imminent, auto-create a ticket.
     */
    async sweepMaintenance(): Promise<{ alerts: number; ticketsCreated: number }> {
        let alerts = 0;
        let ticketsCreated = 0;
        const activeKeys: string[] = [];

        const devices: any[] = await appDatabase.query(
            `SELECT d.id deviceId, d.device_name deviceName, d.is_online isOnline,
                    CAST(JSON_EXTRACT(d.provider_metadata, '$.properties.battery_level') AS DECIMAL(4,3)) battery,
                    pd.property_id listingId, li.name listingName,
                    (SELECT MIN(r.arrivalDate) FROM reservation_info r
                      WHERE r.listingMapId = pd.property_id AND r.arrivalDate >= CURDATE()
                        AND (r.status IS NULL OR r.status NOT LIKE 'cancel%')) nextCheckin
             FROM property_devices pd
             JOIN smart_lock_devices d ON d.id = pd.device_id
             LEFT JOIN listing_info li ON li.id = pd.property_id
             WHERE pd.is_active = 1`
        );

        for (const d of devices) {
            const battery = d.battery != null ? Number(d.battery) : null;
            const offline = Number(d.isOnline) === 0;
            const lowBattery = battery != null && battery <= 0.25;
            if (!offline && !lowBattery) continue;

            const nextCheckin = isoDate(d.nextCheckin);
            const daysToCheckin = nextCheckin
                ? Math.ceil((new Date(nextCheckin).getTime() - Date.now()) / 86400000)
                : null;

            const critical =
                offline || (battery != null && battery <= 0.15) || (lowBattery && daysToCheckin != null && daysToCheckin <= 3);
            const severity = critical ? "critical" : "high";
            const pct = battery != null ? Math.round(battery * 100) : null;

            const problem = offline
                ? `is OFFLINE`
                : `battery is at ${pct}%`;
            const key = `maintenance:lock:${d.deviceId}:${offline ? "offline" : "battery"}`;
            activeKeys.push(key);

            // Auto-ticket once per alert when critical.
            let actionItemId: number | null = null;
            const existing = await this.repo.findOne({ where: { dedupeKey: key } });
            if (critical && (!existing || existing.actionItemId == null)) {
                try {
                    const repo = appDatabase.getRepository(ActionItems);
                    const saved = await repo.save(
                        repo.create({
                            item: `Smart lock "${d.deviceName || "device " + d.deviceId}" at ${d.listingName || "listing " + d.listingId} ${problem}${nextCheckin ? ` — next check-in ${nextCheckin}` : ""}. Replace battery / restore connectivity before it strands a guest.`,
                            category: "Maintenance",
                            status: "incomplete",
                            urgency: 2,
                            listingId: d.listingId ? Number(d.listingId) : null,
                            listingName: d.listingName || null,
                            createdBy: "ops-radar",
                            source: "ops_radar",
                        } as Partial<ActionItems>)
                    );
                    actionItemId = saved.id;
                    ticketsCreated++;
                } catch (err: any) {
                    logger.warn(`[OpsRadar] maintenance ticket failed for device ${d.deviceId}: ${err.message}`);
                }
            }

            await this.upsertAlert({
                type: "maintenance",
                dedupeKey: key,
                severity,
                listingId: d.listingId ? Number(d.listingId) : null,
                listingName: d.listingName || null,
                title: `Lock "${d.deviceName || d.deviceId}" ${problem}${d.listingName ? ` — ${d.listingName}` : ""}`,
                detail: nextCheckin
                    ? `Next check-in at this property is ${nextCheckin}${daysToCheckin != null ? ` (${daysToCheckin} day${daysToCheckin === 1 ? "" : "s"} away)` : ""}. A dead lock at check-in is a guaranteed emergency call.`
                    : `No upcoming check-in on the calendar yet, but the device needs attention before the next arrival.`,
                recommendation: offline
                    ? "Check the lock's hub/bridge power and wifi; if it stays offline, dispatch someone before the next arrival."
                    : `Replace the battery on the next cleaner visit${nextCheckin ? ` — before ${nextCheckin}` : ""}.`,
                payload: { deviceId: d.deviceId, battery: pct, offline, nextCheckin },
                actionItemId,
            });
            alerts++;
        }

        await this.autoResolve("maintenance", activeKeys);
        return { alerts, ticketsCreated };
    }

    // ------------------------------------------------------------------
    // 2) Root-cause radar — recurring issue clusters
    // ------------------------------------------------------------------

    /**
     * Buckets the last 90 days of action items per (listing, topic) with
     * deterministic keyword matching. 3+ occurrences of the same topic at the
     * same listing = a pattern worth one permanent fix instead of N tickets.
     */
    async sweepRootCauses(): Promise<{ alerts: number }> {
        let alerts = 0;
        const activeKeys: string[] = [];

        const items: any[] = await appDatabase.query(
            `SELECT id, item, listingId, listingName, status, createdAt
             FROM action_items
             WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
               AND deletedAt IS NULL AND listingId IS NOT NULL AND item IS NOT NULL`
        );

        // cluster: listingId -> topic -> items
        const clusters = new Map<string, { listingId: number; listingName: string | null; topic: (typeof ISSUE_TOPICS)[0]; items: any[] }>();
        for (const it of items) {
            for (const topic of ISSUE_TOPICS) {
                if (!topic.re.test(String(it.item))) continue;
                const key = `${it.listingId}:${topic.topic}`;
                const c = clusters.get(key) || { listingId: Number(it.listingId), listingName: it.listingName, topic, items: [] };
                c.items.push(it);
                clusters.set(key, c);
                break; // one topic per item
            }
        }

        for (const [k, c] of clusters) {
            if (c.items.length < 3) continue;
            const openCount = c.items.filter((i) => String(i.status || "").toLowerCase() !== "completed").length;
            // 3-count clusters must still have an open item to surface; bigger
            // clusters surface regardless (pattern worth a permanent fix).
            if (c.items.length < 4 && openCount === 0) continue;
            const key = `root_cause:${k}`;
            activeKeys.push(key);
            const first = isoDate(c.items[c.items.length - 1].createdAt);
            const samples = c.items
                .slice(0, 4)
                .map((i) => `• ${String(i.item).slice(0, 140)} (${isoDate(i.createdAt)})`)
                .join("\n");

            await this.upsertAlert({
                type: "root_cause",
                dedupeKey: key,
                severity: c.items.length >= 5 ? "high" : "medium",
                listingId: c.listingId,
                listingName: c.listingName,
                title: `${c.topic.label}: ${c.items.length} tickets in 90 days at ${c.listingName || "listing " + c.listingId}`,
                detail: `Same category keeps recurring since ${first} (${openCount} still open):\n${samples}`,
                recommendation: c.topic.fix,
                payload: {
                    topic: c.topic.topic,
                    count: c.items.length,
                    open: openCount,
                    itemIds: c.items.map((i) => i.id).slice(0, 20),
                },
            });
            alerts++;
        }

        await this.autoResolve("root_cause", activeKeys);
        return { alerts };
    }

    // ------------------------------------------------------------------
    // 3) SLA watchdog
    // ------------------------------------------------------------------

    /**
     * Unanswered guest threads and stale open tickets past their SLA —
     * deliberately narrow so the feed stays manage-by-exception (a first run
     * against the full historic ticket backlog produced 3,000+ alerts, which
     * is a report, not an exception feed):
     *
     *   guest thread, emergency flag:      15m high, 45m critical
     *   guest thread, pre-booking inquiry: 60m high, 4h critical (revenue!)
     *   guest thread, normal:              2h medium, 6h high — only while the
     *     guest is still relevant (not cancelled/expired, checkout within 2d)
     *   ticket urgency>=2:                 24h high, 72h critical — only for
     *     tickets < 14 days old (older = historic backlog, not an exception)
     *   non-urgent tickets:                never alerted here
     */
    async sweepSLA(): Promise<{ alerts: number }> {
        let alerts = 0;
        const activeKeys: string[] = [];
        const now = Date.now();
        const ageMin = (d: any) => (now - new Date(d).getTime()) / 60000;

        // --- Unanswered guest threads ---
        const threads = await this.conversationRepo
            .createQueryBuilder("c")
            .where("c.answered = 0")
            .andWhere("c.isArchived = 0")
            .andWhere("c.lastMessageAt IS NOT NULL")
            .andWhere("c.lastMessageAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)")
            .andWhere("c.lastMessageAt <= DATE_SUB(NOW(), INTERVAL 30 MINUTE)")
            .andWhere(
                "(c.reservationStatus IS NULL OR c.reservationStatus NOT IN ('cancelled','expired','timedout','declined','denied','not_possible'))"
            )
            .getMany();

        for (const c of threads) {
            const min = ageMin(c.lastMessageAt);
            const inquiry = /^(inquiry|preapproved|offer|pending)/i.test(String(c.reservationStatus || ""));
            // Post-stay threads (checked out > 2 days ago) aren't SLA material.
            if (!inquiry && !c.emergency && c.checkout) {
                const daysSinceCheckout = (now - new Date(c.checkout).getTime()) / 86400000;
                if (daysSinceCheckout > 2) continue;
            }
            let severity: string | null = null;
            if (c.emergency) severity = min >= 45 ? "critical" : min >= 15 ? "high" : null;
            else if (inquiry) severity = min >= 240 ? "critical" : min >= 60 ? "high" : null;
            else severity = min >= 360 ? "high" : min >= 120 ? "medium" : null;
            if (!severity) continue;

            const key = `sla:thread:${c.threadId}`;
            activeKeys.push(key);
            const hrs = Math.floor(min / 60);
            const waiting = hrs >= 1 ? `${hrs}h ${Math.round(min % 60)}m` : `${Math.round(min)}m`;
            await this.upsertAlert({
                type: "sla",
                dedupeKey: key,
                severity,
                threadId: Number(c.threadId),
                listingId: c.listingId ? Number(c.listingId) : null,
                listingName: c.listingName,
                title: `${c.guestName || "Guest"} waiting ${waiting}${c.emergency ? " — EMERGENCY thread" : inquiry ? " — booking inquiry" : ""}`,
                detail: `"${String(c.lastMessageText || "").slice(0, 200)}"${c.listingName ? ` — ${c.listingName}` : ""}`,
                recommendation: c.emergency
                    ? "Emergency-flagged thread with no reply — needs a human right now."
                    : inquiry
                    ? "Unanswered inquiries kill conversion and platform ranking — answer or assign now."
                    : "Past the response-time SLA — answer or reassign.",
                payload: { waitingMinutes: Math.round(min), emergency: !!c.emergency, inquiry },
            });
            alerts++;
        }

        // --- Stale open URGENT tickets, aggregated per listing ---
        // One alert per property ("9 urgent tickets sitting >24h at X"), not one
        // per ticket: individual rows at this volume are a report, not an
        // exception feed.
        const tickets: any[] = await appDatabase.query(
            `SELECT id, item, listingId, listingName, urgency, assignee, createdAt
             FROM action_items
             WHERE deletedAt IS NULL AND (status IS NULL OR status NOT IN ('completed'))
               AND urgency >= 2
               AND createdAt >= DATE_SUB(NOW(), INTERVAL 14 DAY)
               AND createdAt <= DATE_SUB(NOW(), INTERVAL 24 HOUR)
             ORDER BY createdAt ASC`
        );
        const byListing = new Map<string, any[]>();
        for (const t of tickets) {
            const k = t.listingId ? String(t.listingId) : "none";
            const arr = byListing.get(k) || [];
            arr.push(t);
            byListing.set(k, arr);
        }
        for (const [lid, group] of byListing) {
            const oldestMin = ageMin(group[0].createdAt);
            const oldestDays = Math.floor(oldestMin / 1440);
            const severity = oldestMin >= 72 * 60 ? "critical" : "high";
            const unassigned = group.filter((t) => !t.assignee).length;
            const listingName = group.find((t) => t.listingName)?.listingName || null;
            const key = `sla:tickets:${lid}`;
            activeKeys.push(key);
            const samples = group
                .slice(0, 3)
                .map((t) => `• ${String(t.item).slice(0, 120)} (${Math.floor(ageMin(t.createdAt) / 1440)}d)`)
                .join("\n");
            await this.upsertAlert({
                type: "sla",
                dedupeKey: key,
                severity,
                listingId: lid !== "none" ? Number(lid) : null,
                listingName,
                title:
                    lid === "none"
                        ? `${group.length} urgent unassigned ticket${group.length === 1 ? "" : "s"} sitting >24h (no property linked), oldest ${oldestDays}d`
                        : `${group.length} urgent ticket${group.length === 1 ? "" : "s"} sitting >24h at ${listingName || "listing " + lid}, oldest ${oldestDays}d`,
                detail: samples,
                recommendation:
                    unassigned === group.length
                        ? "None of these have an owner. Triage and assign them."
                        : "Past the urgent-ticket SLA — nudge the assignees or reprioritize.",
                payload: {
                    count: group.length,
                    unassigned,
                    oldestDays,
                    ticketIds: group.map((t) => t.id).slice(0, 25),
                },
            });
            alerts++;
        }

        await this.autoResolve("sla", activeKeys);
        return { alerts };
    }

    // ------------------------------------------------------------------
    // 4) Review-risk early warning
    // ------------------------------------------------------------------

    /**
     * Scores active stays whose guests have messaged recently. One cheap LLM
     * call per thread, cached by last guest message time so a thread is only
     * re-scored when the guest says something new. Medium/high risks become
     * alerts with a suggested service-recovery gesture — while the review is
     * still winnable.
     */
    async sweepReviewRisks(opts: { maxLLMCalls?: number } = {}): Promise<{ scored: number; alerts: number }> {
        const maxCalls = Math.max(1, opts.maxLLMCalls ?? 40);
        let scored = 0;
        let alerts = 0;
        const activeKeys: string[] = [];

        const stays = await this.conversationRepo
            .createQueryBuilder("c")
            .where("c.checkin <= CURDATE()")
            .andWhere("c.checkout >= CURDATE()")
            .andWhere("c.isArchived = 0")
            .andWhere("c.lastMessageAt >= DATE_SUB(NOW(), INTERVAL 5 DAY)")
            .andWhere("(c.reservationStatus IS NULL OR c.reservationStatus NOT LIKE 'cancel%')")
            .andWhere("(c.reservationStatus IS NULL OR c.reservationStatus NOT LIKE 'inquiry%')")
            .getMany();

        for (const c of stays) {
            const key = `review_risk:${c.threadId}`;
            const existing = await this.repo.findOne({ where: { dedupeKey: key } });
            const lastScoredAt = existing?.payload ? JSON.parse(existing.payload)?.lastMessageAt || null : null;
            const lastMsgIso = c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : null;

            // Nothing new since the last scoring — keep the current alert state.
            if (existing && lastScoredAt && lastMsgIso && lastScoredAt === lastMsgIso) {
                if (existing.status !== "resolved" && ["medium", "high", "critical"].includes(existing.severity)) {
                    activeKeys.push(key);
                }
                continue;
            }
            if (scored >= maxCalls) continue;

            const messages = await this.messageRepo.find({
                where: { threadId: Number(c.threadId) },
                order: { sentAt: "DESC", id: "DESC" },
                take: 14,
            });
            const guestMsgs = messages.filter((m) => m.direction === "incoming");
            if (!guestMsgs.length) continue;

            const transcript = messages
                .reverse()
                .map((m) => `${m.direction === "incoming" ? "GUEST" : "HOST"}: ${String(m.body || "").slice(0, 400)}`)
                .join("\n");

            let result: { risk: string; reason: string; gesture: string } | null = null;
            try {
                const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                const completion = await client.chat.completions.create({
                    model: REVIEW_RISK_MODEL,
                    temperature: 0,
                    response_format: { type: "json_object" },
                    messages: [
                        {
                            role: "system",
                            content:
                                'You assess review risk for a short-term-rental guest who is CURRENTLY staying. Given the conversation, return JSON {"risk":"low"|"medium"|"high","reason":"<one sentence, cite the guest\'s words>","gesture":"<one concrete service-recovery suggestion, or empty if low>"}. High = guest expressed real dissatisfaction (problems unresolved, repeated complaints, frustration). Medium = friction or an issue that was handled but left annoyance. Low = neutral/positive.',
                        },
                        { role: "user", content: `Stay: ${c.checkin} → ${c.checkout} at ${c.listingName || "listing"}.\n\n${transcript}` },
                    ],
                });
                const raw = completion.choices[0]?.message?.content || "{}";
                const parsed = JSON.parse(raw);
                result = {
                    risk: ["low", "medium", "high"].includes(String(parsed.risk)) ? String(parsed.risk) : "low",
                    reason: String(parsed.reason || "").slice(0, 400),
                    gesture: String(parsed.gesture || "").slice(0, 400),
                };
                scored++;
            } catch (err: any) {
                logger.warn(`[OpsRadar] review-risk scoring failed (thread ${c.threadId}): ${err.message}`);
                continue;
            }

            if (result.risk === "low") {
                // Score is stored so we don't re-run the LLM; resolve any old alert.
                if (existing && existing.status === "open") {
                    existing.status = "resolved";
                    existing.resolvedAt = new Date();
                    existing.payload = JSON.stringify({ ...(existing.payload ? JSON.parse(existing.payload) : {}), lastMessageAt: lastMsgIso, risk: "low" });
                    await this.repo.save(existing);
                } else if (existing) {
                    existing.payload = JSON.stringify({ ...(existing.payload ? JSON.parse(existing.payload) : {}), lastMessageAt: lastMsgIso, risk: "low" });
                    await this.repo.save(existing);
                } else {
                    // Persist a resolved marker purely as a scoring cache.
                    await this.repo.save(
                        this.repo.create({
                            type: "review_risk",
                            dedupeKey: key,
                            severity: "low",
                            status: "resolved",
                            threadId: Number(c.threadId),
                            listingId: c.listingId ? Number(c.listingId) : null,
                            listingName: c.listingName,
                            title: `${c.guestName || "Guest"} — no review risk detected`,
                            payload: JSON.stringify({ lastMessageAt: lastMsgIso, risk: "low" }),
                            resolvedAt: new Date(),
                            lastSeenAt: new Date(),
                        })
                    );
                }
                continue;
            }

            const severity = result.risk === "high" ? "high" : "medium";
            activeKeys.push(key);
            await this.upsertAlert({
                type: "review_risk",
                dedupeKey: key,
                severity,
                threadId: Number(c.threadId),
                listingId: c.listingId ? Number(c.listingId) : null,
                listingName: c.listingName,
                reservationId: c.reservationId ? Number(c.reservationId) : null,
                title: `${c.guestName || "Guest"} at ${c.listingName || "listing"} — ${result.risk} review risk (checkout ${c.checkout})`,
                detail: result.reason,
                recommendation: result.gesture || "Reach out proactively and make it right before checkout.",
                payload: { lastMessageAt: lastMsgIso, risk: result.risk, checkout: c.checkout },
            });
            alerts++;
        }

        await this.autoResolve("review_risk", activeKeys);
        return { scored, alerts };
    }

    // ------------------------------------------------------------------
    // 5) Turnover failure forecaster
    // ------------------------------------------------------------------

    /**
     * Looks 3 days ahead for same-day turnovers and stacks risk factors:
     *  +2 same-day turnover (checkout and check-in on the same date)
     *  +2 late checkout already approved on the departing stay
     *  +1 early check-in approved on the arriving stay
     *  +1 no turnover/cleaner notification configured for the listing
     * Score >= 3 => high, == 2 => medium. Below that, no alert.
     */
    async sweepTurnoverRisks(): Promise<{ alerts: number }> {
        let alerts = 0;
        const activeKeys: string[] = [];

        const turnovers: any[] = await appDatabase.query(
            `SELECT dep.id depId, dep.listingMapId listingId, dep.listingName,
                    dep.departureDate date, dep.guestName departingGuest,
                    arr.id arrId, arr.guestName arrivingGuest
             FROM reservation_info dep
             JOIN reservation_info arr
               ON arr.listingMapId = dep.listingMapId
              AND arr.arrivalDate = dep.departureDate
              AND (arr.status IS NULL OR arr.status NOT LIKE 'cancel%')
             WHERE dep.departureDate BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY)
               AND (dep.status IS NULL OR dep.status NOT LIKE 'cancel%')`
        );
        if (!turnovers.length) {
            await this.autoResolve("turnover_risk", []);
            return { alerts };
        }

        const listingIds = [...new Set(turnovers.map((t) => Number(t.listingId)).filter(Boolean))];
        const settingsRows: any[] = listingIds.length
            ? await appDatabase
                  .query(
                      `SELECT listing_id listingId FROM turnover_settings
                       WHERE listing_id IN (${listingIds.map(() => "?").join(",")})
                         AND (pre_stay_enabled = 1 OR post_stay_enabled = 1)`,
                      listingIds
                  )
                  .catch(() => [])
            : [];
        const hasTurnoverConfig = new Set(settingsRows.map((r) => Number(r.listingId)));

        for (const t of turnovers) {
            let score = 2; // same-day turnover by construction
            const factors: string[] = ["same-day turnover (checkout + check-in on the same date)"];

            const [late]: any[] = await appDatabase.query(
                `SELECT id FROM ai_proposed_actions
                 WHERE actionType = 'late_checkout' AND status = 'executed' AND reservationId = ? LIMIT 1`,
                [t.depId]
            );
            if (late) {
                score += 2;
                factors.push("late checkout was APPROVED for the departing guest");
            }
            const [early]: any[] = await appDatabase.query(
                `SELECT id FROM ai_proposed_actions
                 WHERE actionType = 'early_check_in' AND status = 'executed' AND reservationId = ? LIMIT 1`,
                [t.arrId]
            );
            if (early) {
                score += 1;
                factors.push("early check-in was approved for the arriving guest");
            }
            if (t.listingId && !hasTurnoverConfig.has(Number(t.listingId))) {
                score += 1;
                factors.push("no cleaner notifications configured for this listing");
            }

            if (score < 2 || (score === 2 && !late && !early && hasTurnoverConfig.has(Number(t.listingId)))) {
                // plain same-day turnover with cleaner flow configured — routine.
                continue;
            }

            const severity = score >= 4 ? "critical" : score >= 3 ? "high" : "medium";
            const date = isoDate(t.date);
            const key = `turnover_risk:${t.listingId}:${date}`;
            activeKeys.push(key);
            await this.upsertAlert({
                type: "turnover_risk",
                dedupeKey: key,
                severity,
                listingId: t.listingId ? Number(t.listingId) : null,
                listingName: t.listingName,
                reservationId: t.arrId ? Number(t.arrId) : null,
                title: `Risky turnover ${date} at ${t.listingName || "listing " + t.listingId}: ${t.departingGuest || "guest"} out, ${t.arrivingGuest || "guest"} in`,
                detail: `Risk factors:\n${factors.map((f) => `• ${f}`).join("\n")}`,
                recommendation:
                    score >= 3
                        ? "Confirm the cleaner's window explicitly today and line up a backup — this one has little slack."
                        : "Confirm the cleaner has this turnover on their schedule.",
                payload: { date, score, factors, departingReservationId: t.depId, arrivingReservationId: t.arrId },
            });
            alerts++;
        }

        await this.autoResolve("turnover_risk", activeKeys);
        return { alerts };
    }

    // ------------------------------------------------------------------
    // Orchestration
    // ------------------------------------------------------------------

    /** Run every sweep; used by the daily cron and the "Scan now" button. */
    async runAll(): Promise<Record<string, any>> {
        const out: Record<string, any> = {};
        const t0 = Date.now();
        out.maintenance = await this.sweepMaintenance().catch((e) => ({ error: e.message }));
        out.rootCauses = await this.sweepRootCauses().catch((e) => ({ error: e.message }));
        out.sla = await this.sweepSLA().catch((e) => ({ error: e.message }));
        out.turnoverRisks = await this.sweepTurnoverRisks().catch((e) => ({ error: e.message }));
        out.reviewRisks = await this.sweepReviewRisks().catch((e) => ({ error: e.message }));
        out.tookMs = Date.now() - t0;
        logger.info(`[OpsRadar] full scan: ${JSON.stringify(out)}`);
        return out;
    }
}
