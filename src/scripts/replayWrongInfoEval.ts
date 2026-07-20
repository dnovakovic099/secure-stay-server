/**
 * Offline replay of historical wrong_info misses.
 *
 * For each case: cut thread at the guest ask (nothing after), generate
 * baseline + hard_fact drafts, LLM-judge both against the team's actual reply.
 *
 * Usage:
 *   npx ts-node src/scripts/replayWrongInfoEval.ts [limit=80]
 *
 * Writes:
 *   tmp/wrong-info-replay-<timestamp>.json
 *   tmp/wrong-info-replay-<timestamp>.md
 */
import "reflect-metadata";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";

const LIMIT = Math.max(1, Math.min(100, Number(process.argv[2] || 80)));

type JudgeResult = {
    ai_verdict: "addressed" | "missed" | "unknown";
    ai_category: string | null;
    ai_note: string | null;
};

type ModeResult = {
    reply: string;
    confidence: number | null;
    verifierConfidence: number | null;
    escalationRequired: boolean;
    escalationReason: string | null;
    ungrounded: string[];
    judge: JudgeResult;
    outcome: "fixed" | "deferred_safe" | "still_wrong" | "other_miss" | "unknown";
};

type CaseReport = {
    suggestionId: number;
    threadId: number;
    listingId: number | null;
    channel: string | null;
    guestAsk: string;
    originalAi: string;
    originalNote: string | null;
    teamReply: string;
    baseline: ModeResult | null;
    hardFact: ModeResult | null;
    error?: string;
};

function outcomeFrom(judge: JudgeResult, escalationRequired: boolean, ungrounded: string[]): ModeResult["outcome"] {
    if (judge.ai_verdict === "addressed") return "fixed";
    if (judge.ai_verdict !== "missed") return "unknown";
    if (judge.ai_category === "wrong_info") return "still_wrong";
    if (judge.ai_category === "deferral" || (escalationRequired && !ungrounded.length)) return "deferred_safe";
    return "other_miss";
}

async function judgeDraft(
    client: OpenAI,
    guest: string,
    team: string,
    ai: string
): Promise<JudgeResult> {
    const system = [
        "You judge short-term-rental AI reply quality against a human TEAM reply (ground truth for facts).",
        "Judge ONLY whether the AI reply would be a genuine mistake if sent as-is, given the GUEST message.",
        'Return STRICT JSON: {"ai_verdict":"addressed|missed|unknown","ai_category":"wrong_info|deferral|ignored_ask|missing_info|other|null","ai_note":"<=20 words"}',
        '- "missed"+"wrong_info" if the AI asserts a fact the TEAM contradicts (time, price, amenity, deposit, capacity, link, policy).',
        '- "missed"+"deferral" if the AI only hedges/defers when the team answered with substance AND the AI did not state a wrong fact.',
        '- "addressed" if safe to send: correct facts, or a careful deferral that does NOT restate the wrong fact the original bot said.',
        "A safe escalate/hedge that avoids the wrong claim counts as addressed (or deferral), NOT wrong_info.",
    ].join("\n");
    try {
        const resp = await client.chat.completions.create({
            model: process.env.AI_VERIFIER_MODEL || process.env.AI_MODEL || "gpt-4.1",
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: system },
                {
                    role: "user",
                    content:
                        `GUEST: ${guest.slice(0, 500)}\n` +
                        `TEAM REPLY (ground truth): ${team.replace(/\s+/g, " ").slice(0, 500)}\n` +
                        `AI REPLY: ${ai.replace(/\s+/g, " ").slice(0, 500)}`,
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
        return { ai_verdict: "unknown", ai_category: null, ai_note: e.message?.slice(0, 80) || "judge failed" };
    }
}

async function main() {
    // Force TS entity globs — server .env sets NODE_ENV=production (dist entities).
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
        .andWhere("s.aiReplyQualityCategory = :c", { c: "wrong_info" })
        .andWhere("s.actualReplyText IS NOT NULL")
        .andWhere("CHAR_LENGTH(s.actualReplyText) > 10")
        .andWhere("s.suggestedReply IS NOT NULL")
        .andWhere("s.source = :src", { src: "hostify" })
        .orderBy("s.id", "DESC")
        .take(LIMIT)
        .getMany();

    // Skip independent verifier during replay (large latency); claim-gate + judge remain.
    process.env.AI_REPLAY_SKIP_VERIFIER = process.env.AI_REPLAY_SKIP_VERIFIER || "1";
    const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.AI_REPLAY_CONCURRENCY || 4)));
    console.log(
        `Loaded ${rows.length} wrong_info hostify cases (limit ${LIMIT}, concurrency ${CONCURRENCY}, skipVerifier=${process.env.AI_REPLAY_SKIP_VERIFIER})`
    );

    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(CONCURRENCY);
    let done = 0;
    const reports: CaseReport[] = await Promise.all(
        rows.map((s, idx) =>
            limit(async () => {
                const label = `[${idx + 1}/${rows.length}] id=${s.id} thread=${s.threadId}`;
                const report: CaseReport = {
                    suggestionId: s.id,
                    threadId: Number(s.threadId),
                    listingId: s.listingId != null ? Number(s.listingId) : null,
                    channel: null,
                    guestAsk: "",
                    originalAi: (s.suggestedReply || "").replace(/\s+/g, " ").trim(),
                    originalNote: s.aiReplyQualityNote,
                    teamReply: (s.actualReplyText || "").replace(/\s+/g, " ").trim(),
                    baseline: null,
                    hardFact: null,
                };
                try {
                    const conversation = await conversationRepo.findOne({
                        where: { threadId: Number(s.threadId) },
                    });
                    if (!conversation) throw new Error("conversation missing");
                    report.channel = conversation.channel || null;

                    const messages = await messageRepo.find({
                        where: { threadId: Number(s.threadId) },
                        order: { sentAt: "ASC", id: "ASC" },
                    });
                    let target: InstanceType<typeof InboxMessageEntity> | null = null;
                    if (s.messageId != null) {
                        target = messages.find((m) => Number(m.externalId) === Number(s.messageId)) || null;
                    }
                    if (!target) {
                        const inbound = messages.filter((m) => m.direction === "incoming");
                        target = inbound.length ? inbound[inbound.length - 1] : null;
                    }
                    if (!target) throw new Error("no target guest message");

                    const targetIdx = messages.findIndex((m) => m.id === target!.id);
                    const cut = targetIdx >= 0 ? messages.slice(0, targetIdx + 1) : messages;
                    report.guestAsk = (target.body || "").replace(/\s+/g, " ").trim();

                    for (const mode of ["baseline", "hard_fact"] as const) {
                        const draft = await ai.generateReplayDraft({
                            conversation,
                            messagesThroughTarget: cut,
                            targetMessage: target,
                            mode,
                        });
                        const judge = await judgeDraft(client, report.guestAsk, report.teamReply, draft.reply);
                        const modeResult: ModeResult = {
                            reply: draft.reply.replace(/\s+/g, " ").trim(),
                            confidence: draft.confidence,
                            verifierConfidence: draft.verifierConfidence,
                            escalationRequired: draft.escalationRequired,
                            escalationReason: draft.escalationReason,
                            ungrounded: draft.ungrounded,
                            judge,
                            outcome: outcomeFrom(judge, draft.escalationRequired, draft.ungrounded),
                        };
                        if (mode === "baseline") report.baseline = modeResult;
                        else report.hardFact = modeResult;
                    }
                    done++;
                    console.log(
                        `${label} base=${report.baseline?.outcome} hard=${report.hardFact?.outcome}` +
                            (report.hardFact?.ungrounded?.length
                                ? ` ungated=${report.hardFact.ungrounded.length}`
                                : "") +
                            ` (${done}/${rows.length})`
                    );
                } catch (e: any) {
                    report.error = e.message || String(e);
                    done++;
                    console.log(`${label} ERROR ${report.error} (${done}/${rows.length})`);
                }
                return report;
            })
        )
    );

    const summary = summarize(reports);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outDir = path.join(process.cwd(), "tmp");
    fs.mkdirSync(outDir, { recursive: true });
    const jsonPath = path.join(outDir, `wrong-info-replay-${stamp}.json`);
    const mdPath = path.join(outDir, `wrong-info-replay-${stamp}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify({ summary, reports }, null, 2));
    fs.writeFileSync(mdPath, renderMarkdown(summary, reports));
    console.log("\n=== SUMMARY ===");
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nWrote ${jsonPath}`);
    console.log(`Wrote ${mdPath}`);

    await appDatabase.destroy().catch(() => undefined);
}

function summarize(reports: CaseReport[]) {
    const ok = reports.filter((r) => !r.error && r.baseline && r.hardFact);
    const count = (mode: "baseline" | "hardFact", outcome: string) =>
        ok.filter((r) => r[mode]!.outcome === outcome).length;
    const hardFixedOrSafe = ok.filter(
        (r) => r.hardFact!.outcome === "fixed" || r.hardFact!.outcome === "deferred_safe"
    ).length;
    const worse = ok.filter(
        (r) =>
            r.hardFact!.outcome === "still_wrong" &&
            (r.baseline!.outcome === "fixed" || r.baseline!.outcome === "deferred_safe")
    ).length;
    const stillWrongHard = count("hardFact", "still_wrong");
    const stillWrongBase = count("baseline", "still_wrong");
    return {
        totalLoaded: reports.length,
        evaluated: ok.length,
        errors: reports.filter((r) => r.error).length,
        baseline: {
            fixed: count("baseline", "fixed"),
            deferred_safe: count("baseline", "deferred_safe"),
            still_wrong: stillWrongBase,
            other_miss: count("baseline", "other_miss"),
            unknown: count("baseline", "unknown"),
        },
        hardFact: {
            fixed: count("hardFact", "fixed"),
            deferred_safe: count("hardFact", "deferred_safe"),
            still_wrong: stillWrongHard,
            other_miss: count("hardFact", "other_miss"),
            unknown: count("hardFact", "unknown"),
        },
        hardFixedOrSafePct: ok.length ? Math.round((1000 * hardFixedOrSafe) / ok.length) / 10 : 0,
        worseCount: worse,
        worsePct: ok.length ? Math.round((1000 * worse) / ok.length) / 10 : 0,
        wrongInfoShareDropPp: ok.length
            ? Math.round((1000 * (stillWrongBase - stillWrongHard)) / ok.length) / 10
            : 0,
        passBar: {
            fixedOrSafeAtLeast40: ok.length ? hardFixedOrSafe / ok.length >= 0.4 : false,
            worseAtMost10: ok.length ? worse / ok.length <= 0.1 : false,
            wrongInfoShareDown: stillWrongHard < stillWrongBase,
        },
    };
}

function renderMarkdown(summary: any, reports: CaseReport[]): string {
    const lines: string[] = [];
    lines.push("# Wrong-info replay eval");
    lines.push("");
    lines.push("## Summary");
    lines.push("```json");
    lines.push(JSON.stringify(summary, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("## Cases (hard_fact still_wrong first)");
    const ordered = [...reports].sort((a, b) => {
        const rank = (r: CaseReport) =>
            r.hardFact?.outcome === "still_wrong" ? 0 : r.hardFact?.outcome === "fixed" ? 2 : 1;
        return rank(a) - rank(b);
    });
    for (const r of ordered.slice(0, 40)) {
        lines.push(`### #${r.suggestionId} — hard=${r.hardFact?.outcome || r.error} base=${r.baseline?.outcome || "?"}`);
        lines.push(`- Listing: ${r.listingId} / ${r.channel || "?"}`);
        lines.push(`- Guest: ${r.guestAsk.slice(0, 180)}`);
        lines.push(`- Team: ${r.teamReply.slice(0, 180)}`);
        lines.push(`- Original miss: ${r.originalNote || ""}`);
        lines.push(`- Original AI: ${r.originalAi.slice(0, 180)}`);
        if (r.hardFact) {
            lines.push(`- Hard AI: ${r.hardFact.reply.slice(0, 220)}`);
            lines.push(
                `- Hard judge: ${r.hardFact.judge.ai_verdict}/${r.hardFact.judge.ai_category} — ${r.hardFact.judge.ai_note || ""}`
            );
            if (r.hardFact.ungrounded.length) lines.push(`- Ungrounded: ${r.hardFact.ungrounded.join("; ")}`);
        }
        if (r.baseline) {
            lines.push(`- Base AI: ${r.baseline.reply.slice(0, 180)}`);
            lines.push(
                `- Base judge: ${r.baseline.judge.ai_verdict}/${r.baseline.judge.ai_category} — ${r.baseline.judge.ai_note || ""}`
            );
        }
        lines.push("");
    }
    return lines.join("\n");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
