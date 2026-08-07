/**
 * Replay recent judged misses through the CURRENT draft pipeline and score
 * whether they are fixed. Mistake-reduction scoreboard.
 *
 *   npx ts-node src/scripts/replayRecentMisses.ts [limit=40] [days=7]
 *
 * Writes tmp/mistake-replay-<timestamp>.json + .md
 */
import "reflect-metadata";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";

const LIMIT = Math.max(1, Math.min(80, Number(process.argv[2] || 40)));
const DAYS = Math.max(1, Math.min(30, Number(process.argv[3] || 7)));

type JudgeResult = {
    ai_verdict: "addressed" | "missed" | "unknown";
    ai_category: string | null;
    ai_note: string | null;
};

type CaseReport = {
    suggestionId: number;
    category: string | null;
    originalNote: string | null;
    guestAsk: string;
    originalAi: string;
    teamReply: string;
    newAi: string;
    escalationRequired: boolean;
    outcome: "fixed" | "safe_defer" | "still_wrong" | "still_miss" | "unknown" | "error";
    judge: JudgeResult | null;
    error?: string;
};

async function judgeDraft(
    client: OpenAI,
    guest: string,
    team: string,
    ai: string
): Promise<JudgeResult> {
    try {
        const resp = await client.chat.completions.create({
            model: process.env.AI_VERIFIER_MODEL || "gpt-4.1",
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: [
                        "Judge short-term-rental AI reply quality vs TEAM ground truth.",
                        'STRICT JSON: {"ai_verdict":"addressed|missed|unknown","ai_category":"wrong_info|deferral|ignored_ask|missing_info|other|null","ai_note":"<=20 words"}',
                        "addressed = safe to send (correct, or careful deferral without wrong facts).",
                        "missed+wrong_info = AI asserts a fact TEAM contradicts.",
                        "missed+ignored_ask = AI skipped an explicit guest ask TEAM answered.",
                        "missed+deferral = AI only hedged when TEAM gave a concrete answer.",
                    ].join("\n"),
                },
                {
                    role: "user",
                    content:
                        `GUEST: ${guest.slice(0, 500)}\n` +
                        `TEAM: ${team.replace(/\s+/g, " ").slice(0, 500)}\n` +
                        `AI: ${ai.replace(/\s+/g, " ").slice(0, 500)}`,
                },
            ],
        });
        const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}");
        const v = String(parsed.ai_verdict || "").toLowerCase();
        const ai_verdict = v === "addressed" || v === "missed" ? v : "unknown";
        const cat = String(parsed.ai_category || "").toLowerCase();
        const ai_category =
            ai_verdict === "missed" &&
            ["wrong_info", "deferral", "ignored_ask", "missing_info", "other"].includes(cat)
                ? cat
                : ai_verdict === "missed"
                  ? "other"
                  : null;
        return {
            ai_verdict,
            ai_category,
            ai_note: parsed.ai_note ? String(parsed.ai_note).slice(0, 255) : null,
        };
    } catch (e: any) {
        return { ai_verdict: "unknown", ai_category: null, ai_note: e.message?.slice(0, 80) };
    }
}

function outcomeOf(
    originalCat: string | null,
    judge: JudgeResult | null,
    escalation: boolean
): CaseReport["outcome"] {
    if (!judge) return "unknown";
    if (judge.ai_verdict === "addressed") return "fixed";
    if (judge.ai_verdict !== "missed") return "unknown";
    if (judge.ai_category === "wrong_info") return "still_wrong";
    if (judge.ai_category === "deferral" || escalation) return "safe_defer";
    if (originalCat === "ignored_ask" && judge.ai_category === "ignored_ask") return "still_miss";
    return "still_miss";
}

async function main() {
    process.env.NODE_ENV = "development";
    const { appDatabase } = await import("../utils/database.util");
    const { InboxAIService } = await import("../services/InboxAIService");
    const { InboxConversationEntity } = await import("../entity/InboxConversation");
    const { InboxMessageEntity } = await import("../entity/InboxMessage");
    const { AIMessageSuggestionEntity } = await import("../entity/AIMessageSuggestion");

    await appDatabase.initialize();
    const suggestionRepo = appDatabase.getRepository(AIMessageSuggestionEntity);
    const conversationRepo = appDatabase.getRepository(InboxConversationEntity);
    const messageRepo = appDatabase.getRepository(InboxMessageEntity);
    const ai = new InboxAIService();
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const rows = await suggestionRepo
        .createQueryBuilder("s")
        .where("s.aiReplyQuality = :q", { q: "missed" })
        .andWhere("s.aiReplyQualityCategory IN (:...cats)", {
            cats: ["wrong_info", "ignored_ask", "deferral", "missing_info"],
        })
        .andWhere("s.actualReplyText IS NOT NULL")
        .andWhere("s.suggestedReply IS NOT NULL")
        .andWhere("s.source = :src", { src: "hostify" })
        .andWhere(`s.generatedAt >= DATE_SUB(NOW(), INTERVAL ${DAYS} DAY)`)
        .orderBy("s.id", "DESC")
        .take(LIMIT)
        .getMany();

    console.log(`Replaying ${rows.length} misses from last ${DAYS} days`);
    process.env.AI_REPLAY_SKIP_VERIFIER = process.env.AI_REPLAY_SKIP_VERIFIER || "1";

    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(Math.max(1, Math.min(3, Number(process.env.AI_REPLAY_CONCURRENCY || 2))));
    let done = 0;

    const reports: CaseReport[] = await Promise.all(
        rows.map((s) =>
            limit(async () => {
                const report: CaseReport = {
                    suggestionId: s.id,
                    category: s.aiReplyQualityCategory,
                    originalNote: s.aiReplyQualityNote,
                    guestAsk: "",
                    originalAi: (s.suggestedReply || "").replace(/\s+/g, " ").trim(),
                    teamReply: (s.actualReplyText || "").replace(/\s+/g, " ").trim(),
                    newAi: "",
                    escalationRequired: false,
                    outcome: "unknown",
                    judge: null,
                };
                try {
                    const conversation = await conversationRepo.findOne({
                        where: { threadId: Number(s.threadId) },
                    });
                    if (!conversation) throw new Error("conversation missing");
                    const messages = await messageRepo.find({
                        where: { threadId: Number(s.threadId) },
                        order: { sentAt: "ASC", id: "ASC" },
                    });
                    let target =
                        s.messageId != null
                            ? messages.find((m) => Number(m.externalId) === Number(s.messageId)) || null
                            : null;
                    if (!target) {
                        const inbound = messages.filter((m) => m.direction === "incoming");
                        target = inbound.length ? inbound[inbound.length - 1] : null;
                    }
                    if (!target) throw new Error("no target guest message");
                    const targetIdx = messages.findIndex((m) => m.id === target!.id);
                    const cut = targetIdx >= 0 ? messages.slice(0, targetIdx + 1) : messages;
                    report.guestAsk = (target.body || "").replace(/\s+/g, " ").trim();

                    const draft = await ai.generateReplayDraft({
                        conversation,
                        messagesThroughTarget: cut,
                        targetMessage: target,
                        mode: "baseline",
                    });
                    report.newAi = (draft.reply || "").replace(/\s+/g, " ").trim();
                    report.escalationRequired = !!draft.escalationRequired;
                    report.judge = await judgeDraft(
                        client,
                        report.guestAsk,
                        report.teamReply,
                        report.newAi
                    );
                    report.outcome = outcomeOf(report.category, report.judge, report.escalationRequired);
                } catch (e: any) {
                    report.error = e.message || String(e);
                    report.outcome = "error";
                }
                done++;
                console.log(
                    `[${done}/${rows.length}] #${s.id} ${report.category} → ${report.outcome}` +
                        (report.judge ? ` (${report.judge.ai_verdict}/${report.judge.ai_category})` : "")
                );
                return report;
            })
        )
    );

    const ok = reports.filter((r) => r.outcome !== "error");
    const count = (o: CaseReport["outcome"]) => ok.filter((r) => r.outcome === o).length;
    const byCat: Record<string, Record<string, number>> = {};
    for (const r of ok) {
        const c = r.category || "other";
        byCat[c] = byCat[c] || {};
        byCat[c][r.outcome] = (byCat[c][r.outcome] || 0) + 1;
    }
    const summary = {
        days: DAYS,
        loaded: reports.length,
        evaluated: ok.length,
        errors: reports.length - ok.length,
        fixed: count("fixed"),
        safe_defer: count("safe_defer"),
        still_wrong: count("still_wrong"),
        still_miss: count("still_miss"),
        unknown: count("unknown"),
        fixedOrSafePct: ok.length
            ? Math.round(((count("fixed") + count("safe_defer")) / ok.length) * 1000) / 10
            : null,
        byCategory: byCat,
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(process.cwd(), "tmp");
    fs.mkdirSync(dir, { recursive: true });
    const jsonPath = path.join(dir, `mistake-replay-${stamp}.json`);
    const mdPath = path.join(dir, `mistake-replay-${stamp}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify({ summary, reports }, null, 2));
    const md = [
        `# Mistake replay (${DAYS}d, n=${ok.length})`,
        "",
        `- Fixed: ${summary.fixed}`,
        `- Safe defer: ${summary.safe_defer}`,
        `- Still wrong_info: ${summary.still_wrong}`,
        `- Still other miss: ${summary.still_miss}`,
        `- Fixed or safe: ${summary.fixedOrSafePct}%`,
        "",
        "## By original category",
        "```",
        JSON.stringify(byCat, null, 2),
        "```",
        "",
        "## Still wrong / miss",
        ...ok
            .filter((r) => r.outcome === "still_wrong" || r.outcome === "still_miss")
            .slice(0, 25)
            .map(
                (r) =>
                    `- #${r.suggestionId} [${r.category}] ${r.judge?.ai_note || r.originalNote || ""}\n  GUEST: ${r.guestAsk.slice(0, 160)}\n  NEW: ${r.newAi.slice(0, 160)}`
            ),
    ].join("\n");
    fs.writeFileSync(mdPath, md);
    console.log("\nSUMMARY " + JSON.stringify(summary, null, 2));
    console.log(`Wrote ${jsonPath}`);
    console.log(`Wrote ${mdPath}`);
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
