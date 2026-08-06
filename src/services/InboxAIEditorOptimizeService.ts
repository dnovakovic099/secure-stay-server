import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIEditorLessonRunEntity } from "../entity/AIEditorLessonRun";
import sendSlackMessage from "../utils/sendSlackMsg";

/**
 * Daily Editor optimizer — turns yesterday's judged AI misses into short lessons
 * injected into the reply Editor (second-pass) prompt.
 *
 * Runs after the nightly audit (scheduled 4:00 AM ET) so capture + judge have
 * already labeled yesterday's pairs. Kill with AI_EDITOR_OPTIMIZE_ENABLED=false.
 */

export type EditorLesson = {
    rule: string;
    example: string;
    category: string;
};

type MissRow = {
    id: number;
    cat: string | null;
    note: string | null;
    guestMsg: string | null;
    ai: string | null;
    team: string | null;
    listingId: number | null;
};

const TZ = "America/New_York";
const MAX_MISSES_FOR_LLM = 40;
const MAX_ACTIVE_LESSONS = 14;
const LOOKBACK_DAYS = 3;

let tableEnsured = false;
let lessonsCache: { at: number; text: string } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function clip(v: unknown, n: number): string {
    return String(v || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, n);
}

export class InboxAIEditorOptimizeService {
    static enabled(): boolean {
        return String(process.env.AI_EDITOR_OPTIMIZE_ENABLED || "true").toLowerCase() !== "false";
    }

    private async ensureTable(): Promise<void> {
        if (tableEnsured) return;
        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS ai_editor_lesson_runs (
              id INT NOT NULL AUTO_INCREMENT,
              dayEt VARCHAR(10) NOT NULL,
              missCount INT NOT NULL DEFAULT 0,
              categoryBreakdown TEXT NULL,
              summary TEXT NULL,
              lessonsJson MEDIUMTEXT NULL,
              modelName VARCHAR(64) NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              UNIQUE KEY uq_ai_editor_lesson_runs_day (dayEt)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        tableEnsured = true;
    }

    /** Yesterday's ET calendar date as YYYY-MM-DD (fallback UTC-4 in August). */
    async yesterdayEt(): Promise<string> {
        try {
            const rows: any[] = await appDatabase.query(
                `SELECT DATE_FORMAT(
                    DATE_SUB(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)), INTERVAL 1 DAY),
                    '%Y-%m-%d'
                 ) AS d`,
                [TZ]
            );
            if (rows[0]?.d) return String(rows[0].d);
        } catch {
            /* timezone tables missing */
        }
        const rows: any[] = await appDatabase.query(
            `SELECT DATE_FORMAT(DATE_SUB(DATE(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 4 HOUR)), INTERVAL 1 DAY), '%Y-%m-%d') AS d`
        );
        return String(rows[0]?.d || new Date().toISOString().slice(0, 10));
    }

    private async dayWindowUtc(dayEt: string): Promise<{ start: Date; end: Date }> {
        try {
            const rows: any[] = await appDatabase.query(
                `SELECT
                    CONVERT_TZ(CONCAT(?, ' 00:00:00'), ?, '+00:00') AS s,
                    CONVERT_TZ(CONCAT(DATE_ADD(?, INTERVAL 1 DAY), ' 00:00:00'), ?, '+00:00') AS e`,
                [dayEt, TZ, dayEt, TZ]
            );
            if (rows[0]?.s && rows[0]?.e) {
                return { start: new Date(rows[0].s), end: new Date(rows[0].e) };
            }
        } catch {
            /* fall through */
        }
        // EDT approximation
        return {
            start: new Date(`${dayEt}T04:00:00.000Z`),
            end: new Date(new Date(`${dayEt}T04:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000),
        };
    }

    private async loadMisses(start: Date, end: Date): Promise<MissRow[]> {
        const rows: any[] = await appDatabase.query(
            `
            SELECT s.id,
                   s.aiReplyQualityCategory AS cat,
                   s.aiReplyQualityNote AS note,
                   s.listingId,
                   COALESCE(m.body, qm.body) AS guestMsg,
                   s.suggestedReply AS ai,
                   s.actualReplyText AS team
            FROM ai_message_suggestions s
            LEFT JOIN inbox_messages m
              ON s.source = 'hostify' AND m.threadId = s.threadId AND m.externalId = s.messageId
            LEFT JOIN quo_messages qm
              ON s.source = 'quo' AND qm.id = s.messageId
            WHERE s.generatedAt >= ? AND s.generatedAt < ?
              AND s.aiReplyQuality = 'missed'
              AND s.actualReplyText IS NOT NULL
            ORDER BY FIELD(s.aiReplyQualityCategory, 'wrong_info', 'ignored_ask', 'deferral', 'missing_info', 'other'),
                     s.generatedAt DESC
            LIMIT ?
            `,
            [start, end, MAX_MISSES_FOR_LLM]
        );
        return rows as MissRow[];
    }

    private categoryBreakdown(misses: MissRow[]): Record<string, number> {
        const out: Record<string, number> = {};
        for (const m of misses) {
            const k = String(m.cat || "other");
            out[k] = (out[k] || 0) + 1;
        }
        return out;
    }

    private async distillLessons(
        dayEt: string,
        misses: MissRow[]
    ): Promise<{ summary: string; lessons: EditorLesson[]; modelName: string }> {
        const model = process.env.AI_EDITOR_OPTIMIZE_MODEL || process.env.AI_MESSAGING_MODEL || "gpt-4.1";
        if (!process.env.OPENAI_API_KEY || !misses.length) {
            return {
                summary: misses.length ? "No OpenAI key — skipped distillation." : `No judged misses on ${dayEt}.`,
                lessons: [],
                modelName: model,
            };
        }

        const cases = misses
            .map((m, i) => {
                return [
                    `#${i + 1} id=${m.id} cat=${m.cat || "?"} listing=${m.listingId ?? "none"}`,
                    `NOTE: ${clip(m.note, 220)}`,
                    `GUEST: ${clip(m.guestMsg, 280)}`,
                    `AI: ${clip(m.ai, 280)}`,
                    `TEAM: ${clip(m.team, 280)}`,
                ].join("\n");
            })
            .join("\n\n");

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
            model,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: [
                        "You optimize a second-pass EDITOR for a short-term-rental guest messaging AI.",
                        "You receive yesterday's real mistakes (AI draft vs what the team actually sent).",
                        "Produce SHORT, ACTIONABLE editor lessons the next draft-rewrite model should apply.",
                        "",
                        "Rules for lessons:",
                        "- Each lesson is one concrete failure pattern + how the editor should fix it.",
                        "- Prefer patterns that recur; merge duplicates.",
                        "- Do NOT invent property-specific fees/codes as universal rules — phrase as 'when context has X, do Y; never invent'.",
                        "- Keep examples anonymized and short.",
                        "- Max 10 lessons. Prioritize: ignored multi-part asks, wrong fees, needless deferral, deposit/payment, access codes, amenity facts.",
                        "",
                        "Return STRICT JSON:",
                        '{',
                        '  "summary": "2-4 sentences on yesterday\'s main failure themes",',
                        '  "lessons": [',
                        '    {"category":"ignored_ask|wrong_info|deferral|missing_info|other","rule":"imperative instruction for the editor","example":"one short guest/AI/team contrast"}',
                        "  ]",
                        "}",
                    ].join("\n"),
                },
                {
                    role: "user",
                    content: `Day (ET): ${dayEt}\nMiss count in sample: ${misses.length}\n\nCASES:\n${cases}`,
                },
            ],
        });

        const parsed = JSON.parse(completion.choices[0]?.message?.content?.trim() || "{}");
        const lessons: EditorLesson[] = Array.isArray(parsed.lessons)
            ? parsed.lessons
                  .map((l: any) => ({
                      category: clip(l?.category || "other", 40),
                      rule: clip(l?.rule, 320),
                      example: clip(l?.example, 280),
                  }))
                  .filter((l: EditorLesson) => l.rule)
                  .slice(0, 10)
            : [];
        return {
            summary: clip(parsed.summary || `Distilled ${lessons.length} lessons from ${misses.length} misses.`, 1200),
            lessons,
            modelName: model,
        };
    }

    /**
     * Active lessons for the live Editor prompt: merge last LOOKBACK_DAYS runs,
     * dedupe by rule text, cap at MAX_ACTIVE_LESSONS.
     */
    async getActiveLessons(): Promise<EditorLesson[]> {
        await this.ensureTable();
        const repo = appDatabase.getRepository(AIEditorLessonRunEntity);
        const runs = await repo.find({
            order: { dayEt: "DESC" },
            take: LOOKBACK_DAYS,
        });
        const seen = new Set<string>();
        const out: EditorLesson[] = [];
        for (const run of runs) {
            let list: EditorLesson[] = [];
            try {
                list = JSON.parse(run.lessonsJson || "[]");
            } catch {
                list = [];
            }
            if (!Array.isArray(list)) continue;
            for (const l of list) {
                const key = String(l?.rule || "")
                    .toLowerCase()
                    .replace(/\s+/g, " ")
                    .trim();
                if (!key || seen.has(key)) continue;
                seen.add(key);
                out.push({
                    category: String(l.category || "other"),
                    rule: String(l.rule || "").trim(),
                    example: String(l.example || "").trim(),
                });
                if (out.length >= MAX_ACTIVE_LESSONS) return out;
            }
        }
        return out;
    }

    /** Cached prompt block for the Editor system prompt. */
    async getActiveLessonsPromptBlock(): Promise<string> {
        const now = Date.now();
        if (lessonsCache && now - lessonsCache.at < CACHE_TTL_MS) return lessonsCache.text;
        try {
            const lessons = await this.getActiveLessons();
            if (!lessons.length) {
                lessonsCache = { at: now, text: "" };
                return "";
            }
            const lines = [
                "",
                "RECENT MISTAKES TO WATCH (auto-distilled from the last few days — prioritize these):",
                ...lessons.map(
                    (l, i) =>
                        `${i + 1}. [${l.category}] ${l.rule}` +
                        (l.example ? ` Example: ${l.example}` : "")
                ),
            ];
            const text = lines.join("\n");
            lessonsCache = { at: now, text };
            return text;
        } catch (err: any) {
            logger.warn(`[EditorOptimize] load lessons failed: ${err?.message}`);
            return "";
        }
    }

    static clearLessonsCache(): void {
        lessonsCache = null;
    }

    /**
     * Main entry — analyze yesterday ET, persist lessons, optional Slack ping.
     */
    async runDailyOptimize(opts?: { dayEt?: string; notifySlack?: boolean }): Promise<{
        dayEt: string;
        missCount: number;
        lessonCount: number;
        summary: string;
    }> {
        if (!InboxAIEditorOptimizeService.enabled()) {
            logger.info("[EditorOptimize] disabled via AI_EDITOR_OPTIMIZE_ENABLED=false");
            return { dayEt: "", missCount: 0, lessonCount: 0, summary: "disabled" };
        }

        await this.ensureTable();
        const dayEt = opts?.dayEt || (await this.yesterdayEt());
        const { start, end } = await this.dayWindowUtc(dayEt);

        // Best-effort: catch any pairs the 3:30 audit missed before we distill.
        try {
            const { InboxAIAuditService } = await import("./InboxAIAuditService");
            const audit = new InboxAIAuditService();
            await audit.captureActualReplies(2);
            const { AIMessageSuggestionEntity } = await import("../entity/AIMessageSuggestion");
            const unjudged = await appDatabase
                .getRepository(AIMessageSuggestionEntity)
                .createQueryBuilder("s")
                .where("s.generatedAt >= :start AND s.generatedAt < :end", { start, end })
                .andWhere("s.actualReplyText IS NOT NULL")
                .andWhere("s.aiReplyQuality IS NULL")
                .take(80)
                .getMany();
            if (unjudged.length) {
                await audit.judgeRelevance(unjudged);
                logger.info(`[EditorOptimize] judged ${unjudged.length} previously unjudged pairs for ${dayEt}`);
            }
        } catch (err: any) {
            logger.warn(`[EditorOptimize] pre-judge pass failed (continuing): ${err?.message}`);
        }

        const misses = await this.loadMisses(start, end);
        const breakdown = this.categoryBreakdown(misses);
        const distilled = await this.distillLessons(dayEt, misses);

        const repo = appDatabase.getRepository(AIEditorLessonRunEntity);
        let row = await repo.findOne({ where: { dayEt } });
        if (!row) {
            row = repo.create({ dayEt });
        }
        row.missCount = misses.length;
        row.categoryBreakdown = JSON.stringify(breakdown);
        row.summary = distilled.summary;
        row.lessonsJson = JSON.stringify(distilled.lessons);
        row.modelName = distilled.modelName;
        await repo.save(row);
        InboxAIEditorOptimizeService.clearLessonsCache();

        logger.info(
            `[EditorOptimize] day=${dayEt} misses=${misses.length} lessons=${distilled.lessons.length} ` +
                `cats=${JSON.stringify(breakdown)}`
        );

        const notify =
            opts?.notifySlack !== false &&
            String(process.env.AI_EDITOR_OPTIMIZE_SLACK || "true").toLowerCase() !== "false";
        if (notify && distilled.lessons.length) {
            const channel = process.env.AI_EDITOR_OPTIMIZE_SLACK_CHANNEL || "";
            const body = [
                `*Inbox AI Editor optimize — ${dayEt} ET*`,
                `Misses analyzed: ${misses.length} (${Object.entries(breakdown)
                    .map(([k, v]) => `${k}:${v}`)
                    .join(", ")})`,
                distilled.summary,
                "",
                "*New lessons:*",
                ...distilled.lessons.slice(0, 8).map((l, i) => `${i + 1}. [${l.category}] ${l.rule}`),
            ].join("\n");
            try {
                if (channel) {
                    await sendSlackMessage({ channel, text: body });
                } else {
                    logger.info(`[EditorOptimize] slack summary (no channel set):\n${body}`);
                }
            } catch (err: any) {
                logger.warn(`[EditorOptimize] slack notify failed: ${err?.message}`);
            }
        }

        return {
            dayEt,
            missCount: misses.length,
            lessonCount: distilled.lessons.length,
            summary: distilled.summary,
        };
    }
}
