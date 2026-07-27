/**
 * Replay fee/price wrong_info misses through CURRENT production AI
 * (includes Upsells DB quoting) and compare dollar amounts to the team reply.
 *
 * Usage:
 *   npx ts-node src/scripts/replayFeeMissEval.ts [limit=30]
 *
 * Writes:
 *   tmp/fee-miss-replay-<timestamp>.json
 *   tmp/fee-miss-replay-<timestamp>.md
 */
import "reflect-metadata";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";

const LIMIT = Math.max(1, Math.min(60, Number(process.argv[2] || 30)));

const FEE_NOTE_RE =
    /fee|\$|price|rate|pet|early\s*check|late\s*check|deposit|upsell|nightly|check-?in|check-?out/i;

type JudgeResult = {
    ai_verdict: "addressed" | "missed" | "unknown";
    ai_category: string | null;
    ai_note: string | null;
};

type CaseReport = {
    suggestionId: number;
    threadId: number;
    listingId: number | null;
    guestAsk: string;
    originalNote: string | null;
    originalAi: string;
    teamReply: string;
    newAi: string;
    escalationRequired: boolean;
    escalationReason: string | null;
    upsellQuotes: Array<{ title: string; fee: number | null; autoRespond: string; sdto: string }>;
    originalDollars: number[];
    teamDollars: number[];
    newDollars: number[];
    feeVerdict: "fixed_fee" | "safe_defer" | "still_wrong_fee" | "no_fee_in_team" | "unknown";
    judge: JudgeResult | null;
    error?: string;
};

function extractDollars(text: string): number[] {
    const out: number[] = [];
    const re = /\$\s?([\d,]+(?:\.\d+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(String(text || "")))) {
        const n = Number(m[1].replace(/,/g, ""));
        if (Number.isFinite(n)) out.push(Math.round(n * 100) / 100);
    }
    return [...new Set(out)];
}

function nearMatch(a: number, b: number): boolean {
    if (a === b) return true;
    // Allow $154.50 vs 154.5 noise
    return Math.abs(a - b) < 0.02;
}

function anyNear(hay: number[], needle: number[]): boolean {
    return needle.some((n) => hay.some((h) => nearMatch(h, n)));
}

function feeVerdictFor(c: {
    teamDollars: number[];
    newDollars: number[];
    escalationRequired: boolean;
    judge: JudgeResult | null;
}): CaseReport["feeVerdict"] {
    if (!c.teamDollars.length) {
        if (!c.newDollars.length) return "safe_defer";
        // Team had no $ but AI quoted something — often still wrong if inventing.
        if (c.judge?.ai_verdict === "addressed") return "fixed_fee";
        if (c.escalationRequired && c.judge?.ai_category === "deferral") return "safe_defer";
        return "no_fee_in_team";
    }
    if (anyNear(c.newDollars, c.teamDollars)) return "fixed_fee";
    if (!c.newDollars.length && (c.escalationRequired || c.judge?.ai_category === "deferral")) {
        return "safe_defer";
    }
    if (c.judge?.ai_verdict === "addressed") return "fixed_fee";
    if (c.newDollars.length && !anyNear(c.newDollars, c.teamDollars)) return "still_wrong_fee";
    return "unknown";
}

async function judgeDraft(
    client: OpenAI,
    guest: string,
    team: string,
    ai: string
): Promise<JudgeResult> {
    const system = [
        "You judge short-term-rental AI reply quality against a human TEAM reply (ground truth for facts).",
        "Focus on fees, prices, deposits, early/late check-in/out amounts.",
        'Return STRICT JSON: {"ai_verdict":"addressed|missed|unknown","ai_category":"wrong_info|deferral|ignored_ask|missing_info|other|null","ai_note":"<=20 words"}',
        '- "missed"+"wrong_info" if AI asserts a different fee/price/time than TEAM.',
        '- "missed"+"deferral" if AI only hedges when TEAM gave a concrete fee.',
        '- "addressed" if AI fee matches TEAM, OR AI safely defers without stating a wrong dollar amount.',
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
    process.env.NODE_ENV = "development";
    const { appDatabase } = await import("../utils/database.util");
    const { InboxAIService } = await import("../services/InboxAIService");
    const { InboxConversationEntity } = await import("../entity/InboxConversation");
    const { InboxMessageEntity } = await import("../entity/InboxMessage");
    const { AIMessageSuggestionEntity } = await import("../entity/AIMessageSuggestion");
    const { UpsellQuoteService } = await import("../services/UpsellQuoteService");

    await appDatabase.initialize();
    const suggestionRepo = appDatabase.getRepository(AIMessageSuggestionEntity);
    const conversationRepo = appDatabase.getRepository(InboxConversationEntity);
    const messageRepo = appDatabase.getRepository(InboxMessageEntity);
    const ai = new InboxAIService();
    const upsells = new UpsellQuoteService();
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Pull a wider pool, then filter to fee/price notes client-side.
    const pool = await suggestionRepo
        .createQueryBuilder("s")
        .where("s.aiReplyQuality = :q", { q: "missed" })
        .andWhere("s.aiReplyQualityCategory = :c", { c: "wrong_info" })
        .andWhere("s.actualReplyText IS NOT NULL")
        .andWhere("CHAR_LENGTH(s.actualReplyText) > 10")
        .andWhere("s.suggestedReply IS NOT NULL")
        .andWhere("s.source = :src", { src: "hostify" })
        .andWhere("s.generatedAt >= DATE_SUB(NOW(), INTERVAL 21 DAY)")
        .orderBy("s.id", "DESC")
        .take(200)
        .getMany();

    const rows = pool
        .filter(
            (s) =>
                FEE_NOTE_RE.test(s.aiReplyQualityNote || "") ||
                /\$\s?\d/.test(s.suggestedReply || "") ||
                /\$\s?\d/.test(s.actualReplyText || "")
        )
        .slice(0, LIMIT);

    process.env.AI_REPLAY_SKIP_VERIFIER = process.env.AI_REPLAY_SKIP_VERIFIER || "1";
    const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.AI_REPLAY_CONCURRENCY || 3)));
    console.log(`Fee/price cases: ${rows.length} (from pool ${pool.length}), concurrency ${CONCURRENCY}`);

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
                    guestAsk: "",
                    originalNote: s.aiReplyQualityNote,
                    originalAi: (s.suggestedReply || "").replace(/\s+/g, " ").trim(),
                    teamReply: (s.actualReplyText || "").replace(/\s+/g, " ").trim(),
                    newAi: "",
                    escalationRequired: false,
                    escalationReason: null,
                    upsellQuotes: [],
                    originalDollars: extractDollars(s.suggestedReply || ""),
                    teamDollars: extractDollars(s.actualReplyText || ""),
                    newDollars: [],
                    feeVerdict: "unknown",
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

                    const listingId = Number(conversation.listingId || s.listingId);
                    if (Number.isFinite(listingId)) {
                        const quotes = await upsells.listQuotesForListing({
                            listingId,
                            nights: null,
                            checkin: conversation.checkin ? String(conversation.checkin).slice(0, 10) : null,
                            checkout: conversation.checkout
                                ? String(conversation.checkout).slice(0, 10)
                                : null,
                        });
                        report.upsellQuotes = quotes
                            .filter((q) => q.isEarlyCheckin || q.isLateCheckout || /pet/i.test(q.title))
                            .slice(0, 12)
                            .map((q) => ({
                                title: q.title,
                                fee: q.guestFee,
                                autoRespond: q.autoRespond,
                                sdto: q.sdto,
                            }));
                    }

                    const draft = await ai.generateReplayDraft({
                        conversation,
                        messagesThroughTarget: cut,
                        targetMessage: target,
                        mode: "baseline",
                    });
                    report.newAi = (draft.reply || "").replace(/\s+/g, " ").trim();
                    report.escalationRequired = !!draft.escalationRequired;
                    report.escalationReason = draft.escalationReason;
                    report.newDollars = extractDollars(report.newAi);
                    report.judge = await judgeDraft(client, report.guestAsk, report.teamReply, report.newAi);
                    report.feeVerdict = feeVerdictFor(report);

                    done++;
                    console.log(
                        `${label} ${report.feeVerdict} orig=${JSON.stringify(report.originalDollars)} ` +
                            `team=${JSON.stringify(report.teamDollars)} new=${JSON.stringify(report.newDollars)} ` +
                            `judge=${report.judge.ai_verdict}/${report.judge.ai_category} (${done}/${rows.length})`
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

    const ok = reports.filter((r) => !r.error);
    const count = (v: CaseReport["feeVerdict"]) => ok.filter((r) => r.feeVerdict === v).length;
    const improved = ok.filter((r) => r.feeVerdict === "fixed_fee" || r.feeVerdict === "safe_defer");
    const stillWrong = ok.filter((r) => r.feeVerdict === "still_wrong_fee");
    const summary = {
        totalLoaded: reports.length,
        evaluated: ok.length,
        errors: reports.filter((r) => r.error).length,
        fixed_fee: count("fixed_fee"),
        safe_defer: count("safe_defer"),
        still_wrong_fee: count("still_wrong_fee"),
        no_fee_in_team: count("no_fee_in_team"),
        unknown: count("unknown"),
        improvedOrSafePct: ok.length ? Math.round((1000 * improved.length) / ok.length) / 10 : 0,
        stillWrongPct: ok.length ? Math.round((1000 * stillWrong.length) / ok.length) / 10 : 0,
        // Among cases where original AI had a $ different from team
        originalWrongFeeCases: ok.filter(
            (r) => r.originalDollars.length && r.teamDollars.length && !anyNear(r.originalDollars, r.teamDollars)
        ).length,
        originalWrongNowFixedOrSafe: ok.filter(
            (r) =>
                r.originalDollars.length &&
                r.teamDollars.length &&
                !anyNear(r.originalDollars, r.teamDollars) &&
                (r.feeVerdict === "fixed_fee" || r.feeVerdict === "safe_defer")
        ).length,
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outDir = path.join(process.cwd(), "tmp");
    fs.mkdirSync(outDir, { recursive: true });
    const jsonPath = path.join(outDir, `fee-miss-replay-${stamp}.json`);
    const mdPath = path.join(outDir, `fee-miss-replay-${stamp}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify({ summary, reports }, null, 2));

    const lines: string[] = ["# Fee/price miss replay (post-Upsells)", "", "## Summary", "```json", JSON.stringify(summary, null, 2), "```", ""];
    lines.push("## Cases (still_wrong_fee first)");
    const ordered = [...reports].sort((a, b) => {
        const rank = (r: CaseReport) =>
            r.feeVerdict === "still_wrong_fee" ? 0 : r.feeVerdict === "fixed_fee" ? 2 : 1;
        return rank(a) - rank(b);
    });
    for (const r of ordered) {
        lines.push(`### #${r.suggestionId} — ${r.feeVerdict}${r.error ? ` ERROR ${r.error}` : ""}`);
        lines.push(`- Listing ${r.listingId} / thread ${r.threadId}`);
        lines.push(`- Note: ${r.originalNote || ""}`);
        lines.push(`- Guest: ${r.guestAsk.slice(0, 200)}`);
        lines.push(`- Team $: ${JSON.stringify(r.teamDollars)} — ${r.teamReply.slice(0, 180)}`);
        lines.push(`- Original $: ${JSON.stringify(r.originalDollars)} — ${r.originalAi.slice(0, 160)}`);
        lines.push(`- New AI $: ${JSON.stringify(r.newDollars)} — ${r.newAi.slice(0, 200)}`);
        if (r.upsellQuotes.length) {
            lines.push(
                `- Upsell quotes: ${r.upsellQuotes
                    .map((q) => `${q.title}=${q.fee != null ? "$" + q.fee : "null"}/${q.autoRespond}`)
                    .join("; ")}`
            );
        } else {
            lines.push(`- Upsell quotes: (none early/late/pet)`);
        }
        if (r.judge) {
            lines.push(`- Judge: ${r.judge.ai_verdict}/${r.judge.ai_category} — ${r.judge.ai_note || ""}`);
        }
        if (r.escalationRequired) lines.push(`- Escalation: ${r.escalationReason || "yes"}`);
        lines.push("");
    }
    fs.writeFileSync(mdPath, lines.join("\n"));

    console.log("\n=== SUMMARY ===");
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nWrote ${jsonPath}`);
    console.log(`Wrote ${mdPath}`);

    await appDatabase.destroy().catch(() => undefined);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
