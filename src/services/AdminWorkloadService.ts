import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import { QuoCallEntity } from "../entity/QuoCall";
import { QuoMessageEntity } from "../entity/QuoMessage";
import { AdminWorkdayGradeEntity } from "../entity/AdminWorkdayGrade";
import { QuoConversationEntity } from "../entity/QuoConversation";
import { OpenPhoneClient } from "../client/OpenPhoneClient";
import logger from "../utils/logger.utils";

/**
 * Port of the standalone quo-team-dashboard "employee workload" pipeline into
 * SecureStay, extended with SecureStay activity:
 *
 *  1. syncQuoCalls  — pull the OpenPhone call log for recently-active
 *     conversations into quo_calls (messages are already synced continuously).
 *  2. buildDailyActivity — per (employee-email, UTC day): Quo calls, Quo texts,
 *     SS inbox replies, and SS AI events (feedback, learning answers, teaching).
 *  3. gradePending — one LLM call per (employee, day) estimating active working
 *     minutes + a quality grade from that day's real content, persisted in
 *     admin_workday_grades (same idea as the quo dashboard's Claude grader).
 *  4. report — aggregates grades into the employee workload table.
 *
 * Identities are joined by lowercased email (OpenPhone users ↔ SS users).
 */

// Bump when the grading prompt/inputs change materially (forces re-grade).
const GRADER_VERSION = 1;

interface DayActivity {
    userKey: string; // lowercased email
    displayName: string;
    date: string; // YYYY-MM-DD (UTC)
    complete: boolean;
    calls: { externalId: string; direction: string; duration: number; occurredAt: Date; participants: string | null }[];
    quoMsgs: { body: string | null; direction: string; sentAt: Date; conversationId: string; fromNumber: string | null }[];
    ssReplies: { body: string | null; sentAt: Date; threadId: number }[];
    ssAiEvents: { kind: string; at: Date; detail: string | null }[];
    talkSec: number;
}

interface RefreshStatus {
    running: boolean;
    phase: string;
    done: number;
    total: number;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
}

export class AdminWorkloadService {
    private static status: RefreshStatus = {
        running: false,
        phase: "idle",
        done: 0,
        total: 0,
        startedAt: null,
        finishedAt: null,
        error: null,
    };

    private op = new OpenPhoneClient();

    static getStatus(): RefreshStatus {
        return { ...AdminWorkloadService.status };
    }

    private get gradeRepo() {
        return appDatabase.getRepository(AdminWorkdayGradeEntity);
    }

    private static graderModel(): string {
        return process.env.ADMIN_GRADER_MODEL || "gpt-4.1";
    }

    // -------------------------------------------------------------------------
    // Quo workspace users (id -> email/name), cached per process.
    // -------------------------------------------------------------------------
    private static quoUsersCache: { map: Map<string, { email: string; name: string }>; at: number } | null = null;

    async quoUsers(): Promise<Map<string, { email: string; name: string }>> {
        const now = Date.now();
        if (AdminWorkloadService.quoUsersCache && now - AdminWorkloadService.quoUsersCache.at < 10 * 60 * 1000) {
            return AdminWorkloadService.quoUsersCache.map;
        }
        const map = new Map<string, { email: string; name: string }>();
        try {
            const res = await this.op.getUsers(100);
            for (const u of res.data || []) {
                const email = (u.email || "").trim().toLowerCase();
                if (!email) continue;
                map.set(u.id, { email, name: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || email });
            }
        } catch (err: any) {
            logger.warn(`[AdminWorkload] quo users fetch failed: ${err?.message}`);
        }
        AdminWorkloadService.quoUsersCache = { map, at: now };
        return map;
    }

    /** SS users keyed by lowercased email. */
    private async ssUsersByEmail(): Promise<Map<string, { id: number; name: string }>> {
        const rows: any[] = await appDatabase.query(
            "SELECT id, email, firstName, lastName FROM users WHERE deletedAt IS NULL AND email IS NOT NULL"
        );
        const map = new Map<string, { id: number; name: string }>();
        for (const u of rows) {
            const email = String(u.email || "").trim().toLowerCase();
            if (!email) continue;
            map.set(email, { id: Number(u.id), name: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || email });
        }
        return map;
    }

    // -------------------------------------------------------------------------
    // 1) Call sync — OpenPhone /calls requires phoneNumberId + ONE participant,
    //    so we drill per recently-active conversation (same as the quo dashboard).
    // -------------------------------------------------------------------------
    async syncQuoCalls(opts: { sinceDays?: number; maxConversations?: number } = {}): Promise<{ conversations: number; calls: number }> {
        const sinceDays = Math.min(Math.max(opts.sinceDays ?? 3, 1), 90);
        const since = new Date(Date.now() - sinceDays * 86400000);
        const sinceISO = since.toISOString();

        const convs = await appDatabase
            .getRepository(QuoConversationEntity)
            .createQueryBuilder("c")
            .where("c.lastMessageAt >= :since", { since })
            .orderBy("c.lastMessageAt", "DESC")
            .take(Math.min(Math.max(opts.maxConversations ?? 4000, 1), 10000))
            .getMany();

        let saved = 0;
        const seen = new Set<string>();
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        // OpenPhone allows ~10 req/s per key (shared with the message sync) —
        // small batches with a pause keep the sweep well under the limit, and
        // 429s get one retry before the conversation is skipped.
        const batchSize = 3;
        const fetchPage = async (params: any, attempt = 0): Promise<any> => {
            try {
                return await this.op.getCalls(params);
            } catch (err: any) {
                if (attempt < 1 && Number(err?.response?.status) === 429) {
                    await sleep(1500);
                    return fetchPage(params, attempt + 1);
                }
                throw err;
            }
        };
        for (let i = 0; i < convs.length; i += batchSize) {
            const batch = convs.slice(i, i + batchSize);
            await Promise.all(
                batch.map(async (c) => {
                    const participants = (c.participants || c.participantPhone || "").split(",").map((p) => p.trim()).filter(Boolean);
                    if (!c.phoneNumberId || !participants.length) return;
                    for (const p of participants) {
                        try {
                            let pageToken: string | undefined;
                            for (let page = 0; page < 10; page++) {
                                const res = await fetchPage({
                                    phoneNumberId: c.phoneNumberId,
                                    participants: [p],
                                    createdAfter: sinceISO,
                                    maxResults: 50,
                                    ...(pageToken ? { pageToken } : {}),
                                });
                                for (const call of res.data || []) {
                                    if (seen.has(call.id)) continue;
                                    seen.add(call.id);
                                    saved += await this.upsertCall(call, c.conversationId);
                                }
                                pageToken = res.nextPageToken || undefined;
                                if (!pageToken || !(res.data || []).length) break;
                            }
                        } catch (err: any) {
                            // transient failures on one conversation shouldn't abort the sweep
                            logger.warn(`[AdminWorkload] calls fetch failed for ${c.conversationId}/${p}: ${err?.message}`);
                        }
                    }
                })
            );
            AdminWorkloadService.status.done = Math.min(i + batchSize, convs.length);
            await sleep(350);
        }
        logger.info(`[AdminWorkload] call sync: ${convs.length} conversations scanned, ${saved} new calls`);
        return { conversations: convs.length, calls: saved };
    }

    private async upsertCall(call: any, conversationId: string): Promise<number> {
        try {
            const repo = appDatabase.getRepository(QuoCallEntity);
            const existing = await repo.findOne({ where: { externalId: call.id } });
            if (existing) return 0;
            await repo.save(
                repo.create({
                    externalId: call.id,
                    conversationId,
                    phoneNumberId: call.phoneNumberId || null,
                    direction: call.direction === "outgoing" ? "outgoing" : "incoming",
                    status: call.status || null,
                    duration: Number(call.duration) || 0,
                    answeredBy: call.answeredBy || null,
                    initiatedBy: call.initiatedBy || null,
                    quoUserId: call.userId || null,
                    participants: Array.isArray(call.participants) ? call.participants.join(",").slice(0, 255) : null,
                    occurredAt: call.createdAt ? new Date(call.createdAt) : new Date(),
                })
            );
            return 1;
        } catch {
            return 0; // duplicate race — fine
        }
    }

    // -------------------------------------------------------------------------
    // 2) Daily activity per (email, UTC date)
    // -------------------------------------------------------------------------
    async buildDailyActivity(days: number): Promise<Map<string, DayActivity>> {
        const since = new Date(Date.now() - days * 86400000);
        const today = new Date().toISOString().slice(0, 10);
        const quoUsers = await this.quoUsers();
        const ssUsers = await this.ssUsersByEmail();
        const ssById = new Map<number, { email: string; name: string }>();
        for (const [email, u] of ssUsers) ssById.set(u.id, { email, name: u.name });

        const map = new Map<string, DayActivity>();
        const ensure = (userKey: string, displayName: string, date: string): DayActivity => {
            const k = `${userKey}|${date}`;
            if (!map.has(k)) {
                map.set(k, {
                    userKey,
                    displayName,
                    date,
                    complete: date < today,
                    calls: [],
                    quoMsgs: [],
                    ssReplies: [],
                    ssAiEvents: [],
                    talkSec: 0,
                });
            }
            return map.get(k)!;
        };
        const dayOf = (d: Date) => new Date(d).toISOString().slice(0, 10);

        // Quo calls
        const calls = await appDatabase
            .getRepository(QuoCallEntity)
            .createQueryBuilder("c")
            .where("c.occurredAt >= :since", { since })
            .getMany();
        for (const c of calls) {
            const quoUid = c.direction === "outgoing" ? c.initiatedBy || c.quoUserId : c.answeredBy;
            if (!quoUid) continue; // unanswered/AI calls aren't attributable
            const u = quoUsers.get(quoUid);
            if (!u) continue;
            const r = ensure(u.email, u.name, dayOf(c.occurredAt));
            r.calls.push({
                externalId: c.externalId,
                direction: c.direction,
                duration: c.duration,
                occurredAt: c.occurredAt,
                participants: c.participants,
            });
            r.talkSec += c.duration || 0;
        }

        // Quo texts (outgoing, attributed via SS user or Quo workspace user)
        const quoMsgs = await appDatabase
            .getRepository(QuoMessageEntity)
            .createQueryBuilder("m")
            .where("m.sentAt >= :since", { since })
            .andWhere("m.direction = 'outgoing'")
            .getMany();
        for (const m of quoMsgs) {
            let email: string | null = null;
            let name: string | null = null;
            if (m.sentByUserId && ssById.has(Number(m.sentByUserId))) {
                const u = ssById.get(Number(m.sentByUserId))!;
                email = u.email;
                name = u.name;
            } else if (m.quoUserId && quoUsers.has(m.quoUserId)) {
                const u = quoUsers.get(m.quoUserId)!;
                email = u.email;
                name = u.name;
            }
            if (!email) continue;
            const r = ensure(email, name || email, dayOf(m.sentAt));
            r.quoMsgs.push({
                body: m.body,
                direction: m.direction,
                sentAt: m.sentAt,
                conversationId: m.conversationId,
                fromNumber: m.fromNumber,
            });
        }

        // SS inbox replies (Hostify guest inbox, sent from our dashboard)
        const ssReplies: any[] = await appDatabase.query(
            `SELECT sentByUserId, body, sentAt, threadId FROM inbox_messages
             WHERE sentVia = 'inbox_v2' AND sentByUserId IS NOT NULL AND sentAt >= ?`,
            [since]
        );
        for (const m of ssReplies) {
            const u = ssById.get(Number(m.sentByUserId));
            if (!u) continue;
            const r = ensure(u.email, u.name, dayOf(new Date(m.sentAt)));
            r.ssReplies.push({ body: m.body, sentAt: new Date(m.sentAt), threadId: Number(m.threadId) });
        }

        // SS AI events: feedback given, learning prompts answered, facts taught/reviewed
        const aiEvents: any[] = await appDatabase.query(
            `SELECT userId, createdAt AS at, CONCAT('ai_feedback:', COALESCE(rating,'text')) AS kind,
                    LEFT(COALESCE(feedbackText, correctedResponse, ''), 160) AS detail
             FROM ai_message_feedback WHERE userId IS NOT NULL AND createdAt >= ?
             UNION ALL
             SELECT answeredByUserId, resolvedAt, CONCAT('learning_', status), LEFT(COALESCE(answerText,''), 160)
             FROM ai_learning_prompts WHERE answeredByUserId IS NOT NULL AND resolvedAt >= ?
             UNION ALL
             SELECT createdByUserId, createdAt, 'fact_taught', LEFT(COALESCE(answer,''), 160)
             FROM ai_learned_facts WHERE createdByUserId IS NOT NULL AND createdAt >= ?`,
            [since, since, since]
        );
        for (const e of aiEvents) {
            const u = ssById.get(Number(e.userId));
            if (!u || !e.at) continue;
            const r = ensure(u.email, u.name, dayOf(new Date(e.at)));
            r.ssAiEvents.push({ kind: String(e.kind), at: new Date(e.at), detail: e.detail || null });
        }

        return map;
    }

    // -------------------------------------------------------------------------
    // 3) LLM day-grading
    // -------------------------------------------------------------------------
    async gradePending(opts: { days?: number; maxCells?: number } = {}): Promise<{ graded: number; pending: number }> {
        const days = Math.min(Math.max(opts.days ?? 30, 1), 90);
        const maxCells = Math.min(Math.max(opts.maxCells ?? 120, 1), 500);
        const activity = await this.buildDailyActivity(days);

        // Which cells still need grading: complete days graded once per version;
        // "today" is re-gradable on each run.
        const existing = await this.gradeRepo
            .createQueryBuilder("g")
            .where("g.date >= :since", { since: new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) })
            .getMany();
        const done = new Set(
            existing.filter((g) => g.complete && g.version === GRADER_VERSION).map((g) => `${g.userKey}|${g.date}`)
        );

        const pending = [...activity.values()]
            .filter((r) => r.calls.length + r.quoMsgs.length + r.ssReplies.length + r.ssAiEvents.length > 0)
            .filter((r) => !done.has(`${r.userKey}|${r.date}`))
            .sort((a, b) => b.date.localeCompare(a.date));

        const toGrade = pending.slice(0, maxCells);
        AdminWorkloadService.status.total = toGrade.length;
        let graded = 0;
        for (const cell of toGrade) {
            try {
                const grade = await this.gradeDay(cell);
                await this.saveGrade(cell, grade);
                graded++;
            } catch (err: any) {
                logger.warn(`[AdminWorkload] grading failed for ${cell.userKey} ${cell.date}: ${err?.message}`);
                // Deterministic fallback so the workload table still has hours.
                await this.saveGrade(cell, this.fallbackEstimate(cell)).catch(() => undefined);
            }
            AdminWorkloadService.status.done = graded;
        }
        logger.info(`[AdminWorkload] graded ${graded}/${pending.length} pending day-cells`);
        return { graded, pending: pending.length };
    }

    /** Deterministic minutes estimate when the LLM is unavailable. */
    private fallbackEstimate(cell: DayActivity) {
        const callMin = Math.round(cell.talkSec / 60 + cell.calls.length * 2);
        const msgMin = Math.round(cell.quoMsgs.length * 1.5 + cell.ssReplies.length * 2);
        const ssMin = Math.round(cell.ssAiEvents.length * 1.5 + cell.ssReplies.length * 2);
        return {
            active_minutes: callMin + msgMin + Math.round(cell.ssAiEvents.length * 1.5),
            call_minutes: callMin,
            message_minutes: msgMin,
            ss_minutes: ssMin,
            workload_grade: null as string | null,
            quality_grade: null as string | null,
            quality_score: null as number | null,
            quality_notes: "Deterministic estimate (AI grading unavailable).",
            summary: null as string | null,
            examples: "[]",
            model: null as string | null,
        };
    }

    private async gradeDay(cell: DayActivity) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
        const openai = new OpenAI({ apiKey });

        // Call transcripts for the longest few calls (speech-to-text, best-effort).
        const topCalls = [...cell.calls].sort((a, b) => b.duration - a.duration).slice(0, 5);
        const callBlocks: string[] = [];
        for (const c of topCalls) {
            let block = `--- ${c.direction} call at ${c.occurredAt.toISOString().slice(11, 16)} UTC (${c.duration}s, ${c.participants || "?"}) ---`;
            try {
                const t = await this.op.getCallTranscript(c.externalId);
                const dialogue = t?.data?.dialogue;
                if (Array.isArray(dialogue) && dialogue.length) {
                    block +=
                        "\n" +
                        dialogue
                            .map((d: any) => `${d.userId ? "AGENT" : "CUSTOMER"}: ${d.content}`)
                            .join("\n")
                            .slice(0, 2200);
                } else {
                    block += " (no transcript available)";
                }
            } catch {
                block += " (no transcript available)";
            }
            callBlocks.push(block);
        }

        const msgLines = cell.quoMsgs
            .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
            .slice(0, 60)
            .map((m) => `[${m.sentAt.toISOString().slice(11, 16)} UTC] SMS out: ${(m.body || "(no text)").slice(0, 220)}`);
        const ssLines = cell.ssReplies
            .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
            .slice(0, 40)
            .map((m) => `[${m.sentAt.toISOString().slice(11, 16)} UTC] Guest-inbox reply: ${(m.body || "(no text)").slice(0, 220)}`);
        const aiLines = cell.ssAiEvents
            .sort((a, b) => a.at.getTime() - b.at.getTime())
            .slice(0, 40)
            .map((e) => `[${e.at.toISOString().slice(11, 16)} UTC] ${e.kind}${e.detail ? `: ${e.detail}` : ""}`);

        const system =
            `You are a contact-center quality & workforce analyst for a short-term-rental property management company. ` +
            `You review one employee's communication activity for a single day — call transcripts, outbound SMS, guest-inbox replies, and AI-training actions — ` +
            `and produce a grounded estimate of ACTIVE working minutes plus a quality grade.\n` +
            `Estimating active time: call talk time is measured; add realistic wrap-up. Estimate texting/reply time from message count and complexity ` +
            `(reading inbound + composing + context switching). AI-training actions (answering the bot's questions, giving feedback, teaching facts) take 1-3 minutes each. Be realistic, not generous.\n` +
            `CALL TRANSCRIPTS ARE AUTOMATED SPEECH-TO-TEXT AND OFTEN INACCURATE — never penalize spelling/names/grammar in calls; judge calls only on substance ` +
            `(tone, accuracy, ownership, resolution). Spelling/grammar only count for typed messages.\n` +
            `Quality grading (A-F), use the full range: A=solved problems/went above and beyond; B=solid professional; C=adequate; D=real service failures; F=rude/harmful. ` +
            `quality_score 0-100 aligned to the letter.\n` +
            `Respond with STRICT JSON only.`;

        const user = `Employee: ${cell.displayName}
Date (UTC): ${cell.date}
Measured activity:
- Calls: ${cell.calls.length} (total talk ${Math.round(cell.talkSec / 60)} min)
- Outbound SMS (Quo): ${cell.quoMsgs.length}
- Guest-inbox replies (SecureStay): ${cell.ssReplies.length}
- AI-training actions (feedback / bot questions answered / facts taught): ${cell.ssAiEvents.length}

=== CALL TRANSCRIPTS (longest ${topCalls.length}) ===
${callBlocks.join("\n\n") || "(no calls)"}

=== OUTBOUND SMS ===
${msgLines.join("\n") || "(none)"}

=== GUEST-INBOX REPLIES ===
${ssLines.join("\n") || "(none)"}

=== AI-TRAINING ACTIONS ===
${aiLines.join("\n") || "(none)"}

Return STRICT JSON exactly:
{"active_minutes": <number>, "call_minutes": <number>, "message_minutes": <number>, "ss_minutes": <number, portion from guest-inbox replies + AI-training>, "workload_grade": "Light"|"Moderate"|"Heavy"|"Overloaded", "quality_grade": "A"|"B"|"C"|"D"|"F", "quality_score": <0-100>, "quality_notes": "<1-2 sentences citing specifics>", "summary": "<1 sentence on what this person handled today>", "examples": [{"time": "<HH:MM UTC>", "channel": "call"|"text"|"inbox"|"ai", "type": "issue"|"positive", "quote": "<short verbatim snippet>", "note": "<what was good/bad + coaching>"}]}`;

        const completion = await openai.chat.completions.create({
            model: AdminWorkloadService.graderModel(),
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
        });
        const p = JSON.parse(completion.choices[0]?.message?.content?.trim() || "{}");
        return {
            active_minutes: Number(p.active_minutes) || 0,
            call_minutes: Number(p.call_minutes) || 0,
            message_minutes: Number(p.message_minutes) || 0,
            ss_minutes: Number(p.ss_minutes) || 0,
            workload_grade: p.workload_grade ? String(p.workload_grade) : null,
            quality_grade: p.quality_grade ? String(p.quality_grade).slice(0, 2) : null,
            quality_score: Number.isFinite(Number(p.quality_score)) ? Math.round(Number(p.quality_score)) : null,
            quality_notes: p.quality_notes ? String(p.quality_notes).slice(0, 1000) : null,
            summary: p.summary ? String(p.summary).slice(0, 500) : null,
            examples: JSON.stringify(Array.isArray(p.examples) ? p.examples.slice(0, 4) : []),
            model: AdminWorkloadService.graderModel(),
        };
    }

    private async saveGrade(cell: DayActivity, g: any): Promise<void> {
        const repo = this.gradeRepo;
        const existing = await repo.findOne({ where: { userKey: cell.userKey, date: cell.date } });
        const row = existing || repo.create({ userKey: cell.userKey, date: cell.date });
        row.displayName = cell.displayName;
        row.model = g.model;
        row.version = GRADER_VERSION;
        row.complete = cell.complete ? 1 : 0;
        row.activeMinutes = g.active_minutes;
        row.callMinutes = g.call_minutes;
        row.messageMinutes = g.message_minutes;
        row.ssMinutes = g.ss_minutes;
        row.workloadGrade = g.workload_grade;
        row.qualityGrade = g.quality_grade;
        row.qualityScore = g.quality_score;
        row.qualityNotes = g.quality_notes;
        row.summary = g.summary;
        row.examples = g.examples;
        row.callsCount = cell.calls.length;
        row.quoMessagesCount = cell.quoMsgs.length;
        row.ssRepliesCount = cell.ssReplies.length;
        row.ssAiEventsCount = cell.ssAiEvents.length;
        row.talkSec = cell.talkSec;
        await repo.save(row);
    }

    // -------------------------------------------------------------------------
    // 4) Aggregated report (per-employee workload table)
    // -------------------------------------------------------------------------
    async report(days: number): Promise<any> {
        const windowDays = Math.min(Math.max(days || 30, 1), 90);
        const since = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
        const rows = await this.gradeRepo
            .createQueryBuilder("g")
            .where("g.date >= :since", { since })
            .orderBy("g.date", "ASC")
            .getMany();

        const byUser = new Map<string, AdminWorkdayGradeEntity[]>();
        for (const r of rows) {
            if (!byUser.has(r.userKey)) byUser.set(r.userKey, []);
            byUser.get(r.userKey)!.push(r);
        }

        const gradeFromScore = (s: number | null) =>
            s == null ? null : s >= 90 ? "A" : s >= 80 ? "B" : s >= 70 ? "C" : s >= 55 ? "D" : "F";
        const weeks = Math.max(windowDays / 7, 1);
        const employees = [...byUser.entries()].map(([userKey, g]) => {
            const total = g.reduce((s, r) => s + (r.activeMinutes || 0), 0);
            const call = g.reduce((s, r) => s + (r.callMinutes || 0), 0);
            const msg = g.reduce((s, r) => s + (r.messageMinutes || 0), 0);
            const ss = g.reduce((s, r) => s + (r.ssMinutes || 0), 0);
            const qs = g.map((r) => r.qualityScore).filter((v): v is number => v != null);
            const avgQ = qs.length ? Math.round(qs.reduce((a, b) => a + b, 0) / qs.length) : null;
            return {
                userKey,
                name: g[g.length - 1]?.displayName || userKey,
                daysGraded: g.length,
                totalActiveHrs: +(total / 60).toFixed(1),
                avgHrsPerActiveDay: g.length ? +(total / 60 / g.length).toFixed(2) : 0,
                predictedWeeklyHrs: +(total / 60 / weeks).toFixed(1),
                callHrs: +(call / 60).toFixed(1),
                msgHrs: +(msg / 60).toFixed(1),
                ssHrs: +(ss / 60).toFixed(1),
                calls: g.reduce((s, r) => s + r.callsCount, 0),
                quoMessages: g.reduce((s, r) => s + r.quoMessagesCount, 0),
                ssReplies: g.reduce((s, r) => s + r.ssRepliesCount, 0),
                ssAiEvents: g.reduce((s, r) => s + r.ssAiEventsCount, 0),
                avgQuality: avgQ,
                avgGrade: gradeFromScore(avgQ),
                latestGrade: g[g.length - 1]?.qualityGrade || null,
                series: g.map((r) => ({
                    date: r.date,
                    activeMin: r.activeMinutes,
                    callMin: r.callMinutes,
                    msgMin: r.messageMinutes,
                    ssMin: r.ssMinutes,
                    quality: r.qualityScore,
                    grade: r.qualityGrade,
                    workload: r.workloadGrade,
                    summary: r.summary,
                    notes: r.qualityNotes,
                    examples: (() => {
                        try {
                            return JSON.parse(r.examples || "[]");
                        } catch {
                            return [];
                        }
                    })(),
                    calls: r.callsCount,
                    messages: r.quoMessagesCount + r.ssRepliesCount,
                })),
            };
        });
        employees.sort((a, b) => b.totalActiveHrs - a.totalActiveHrs);
        return { windowDays, employees, totalGraded: rows.length, status: AdminWorkloadService.getStatus() };
    }

    // -------------------------------------------------------------------------
    // Orchestrated refresh (background) — call sync + grading.
    // -------------------------------------------------------------------------
    async refresh(opts: { sinceDays?: number; gradeDays?: number; maxCells?: number } = {}): Promise<void> {
        const s = AdminWorkloadService.status;
        if (s.running) return;
        s.running = true;
        s.phase = "syncing-calls";
        s.done = 0;
        s.total = 0;
        s.error = null;
        s.startedAt = new Date().toISOString();
        s.finishedAt = null;
        try {
            await this.syncQuoCalls({ sinceDays: opts.sinceDays ?? 3 });
            s.phase = "grading";
            s.done = 0;
            await this.gradePending({ days: opts.gradeDays ?? 30, maxCells: opts.maxCells ?? 120 });
            s.phase = "idle";
        } catch (err: any) {
            s.error = err?.message || "refresh failed";
            s.phase = "error";
            logger.error(`[AdminWorkload] refresh failed: ${err?.message}`);
        } finally {
            s.running = false;
            s.finishedAt = new Date().toISOString();
        }
    }
}
