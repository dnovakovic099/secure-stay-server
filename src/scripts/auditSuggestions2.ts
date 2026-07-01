import "reflect-metadata";
import "dotenv/config";
import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import { EmbeddingService } from "../services/EmbeddingService";

const LIMIT = Number(process.argv[2] || 120);

type Pair = {
    id: number; listingId: number | null; guest: string; ai: string; rep: string;
    conf: number | null; sem?: number; verdict?: string; topic?: string; reason?: string;
};

async function judge(client: OpenAI, p: Pair): Promise<{ verdict: string; topic: string; reason: string }> {
    const prompt = `Compare a property manager's ACTUAL reply to the AI's SUGGESTED reply for a guest message.
Return strict JSON: {"verdict":"equivalent|partial|different|contradicts","topic":"availability|pricing|amenities|checkin_checkout|directions_access|policy_rules|booking_change|thanks_closing|other","reason":"<=12 words why it wasn't equivalent, or 'ok'"}.
verdict: equivalent=same key info/decision; partial=on-topic but misses/adds material; different=answers wrong thing or too generic; contradicts=conflicts with rep (wrong info/policy).

GUEST: ${p.guest || "(no text / attachment)"}
REP: ${p.rep}
AI: ${p.ai}`;
    try {
        const r = await client.chat.completions.create({
            model: process.env.AI_MODEL || "gpt-4.1",
            messages: [{ role: "user", content: prompt }],
            temperature: 0, response_format: { type: "json_object" },
        });
        const j = JSON.parse(r.choices[0].message.content || "{}");
        return { verdict: j.verdict || "different", topic: j.topic || "other", reason: j.reason || "" };
    } catch (e: any) { return { verdict: "error", topic: "other", reason: (e.message || "err").slice(0, 40) }; }
}

async function main() {
    await appDatabase.initialize();
    const rows: Pair[] = await appDatabase.query(
        `SELECT s.id, s.listingId, m.body AS guest, s.suggestedReply AS ai, s.actualReplyText AS rep, s.confidence AS conf
         FROM ai_message_suggestions s LEFT JOIN inbox_messages m ON m.externalId=s.messageId
         WHERE s.actualReplyText IS NOT NULL AND s.suggestedReply IS NOT NULL AND CHAR_LENGTH(s.actualReplyText)>3
         ORDER BY s.generatedAt DESC LIMIT ?`, [LIMIT]);
    console.log(`Linked pairs: ${rows.length}`);
    const emb = new EmbeddingService();
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    for (const p of rows) {
        try { const [a, b] = await emb.embedMany([p.ai.slice(0, 2000), p.rep.slice(0, 2000)]); p.sem = EmbeddingService.cosine(a, b); } catch { p.sem = 0; }
        const v = await judge(client, p); p.verdict = v.verdict; p.topic = v.topic; p.reason = v.reason;
    }
    const n = rows.length || 1;
    const avgSem = rows.reduce((s, p) => s + (p.sem || 0), 0) / n;
    const vc = (v: string) => rows.filter((p) => p.verdict === v).length;
    console.log(`\n===== OVERALL (n=${n}) =====`);
    console.log(`avg semantic sim: ${(avgSem * 100).toFixed(1)}`);
    for (const v of ["equivalent", "partial", "different", "contradicts", "error"]) { const c = vc(v); if (c) console.log(`  ${v.padEnd(12)}: ${c} (${((c / n) * 100).toFixed(0)}%)`); }
    console.log(`  usable(eq+partial): ${(((vc("equivalent") + vc("partial")) / n) * 100).toFixed(0)}%`);

    const hi = rows.filter((p) => Number(p.conf) >= 80), lo = rows.filter((p) => Number(p.conf) < 80);
    const eqr = (a: Pair[]) => a.length ? (a.filter((p) => p.verdict === "equivalent").length / a.length * 100) : 0;
    console.log(`\ncalibration: conf>=80 -> ${eqr(hi).toFixed(0)}% eq (n=${hi.length}); conf<80 -> ${eqr(lo).toFixed(0)}% eq (n=${lo.length})`);

    console.log(`\n===== BY TOPIC (equivalence / usable / contradicts) =====`);
    const topics = Array.from(new Set(rows.map((p) => p.topic)));
    const stat = topics.map((t) => {
        const g = rows.filter((p) => p.topic === t);
        return { t, n: g.length, eq: g.filter((p) => p.verdict === "equivalent").length, use: g.filter((p) => p.verdict === "equivalent" || p.verdict === "partial").length, bad: g.filter((p) => p.verdict === "contradicts" || p.verdict === "different").length };
    }).sort((a, b) => b.bad - a.bad || b.n - a.n);
    for (const s of stat) console.log(`  ${(s.t || "other").padEnd(18)} n=${String(s.n).padStart(3)}  eq=${s.eq}  usable=${s.use}  BAD=${s.bad}`);

    console.log(`\n===== FAILURE REASONS (different+contradicts) =====`);
    const fails = rows.filter((p) => p.verdict === "different" || p.verdict === "contradicts");
    fails.sort((a, b) => (a.sem || 0) - (b.sem || 0));
    for (const p of fails) console.log(`  [${p.verdict === "contradicts" ? "CONTRA" : "diff"}] (${p.topic}) sem=${((p.sem || 0) * 100).toFixed(0)} conf=${p.conf} #${p.id}: ${p.reason}`);

    console.log(`\n===== WORST 6 (full text) =====`);
    fails.slice(0, 6).forEach((p) => {
        console.log(`\n [#${p.id} ${p.topic} ${p.verdict} sem=${((p.sem || 0) * 100).toFixed(0)} conf=${p.conf}]`);
        console.log(`  GUEST: ${(p.guest || "(none)").replace(/\s+/g, " ").slice(0, 150)}`);
        console.log(`  REP  : ${p.rep.replace(/\s+/g, " ").slice(0, 190)}`);
        console.log(`  AI   : ${p.ai.replace(/\s+/g, " ").slice(0, 190)}`);
    });
    await appDatabase.destroy();
    console.log("\nDONE");
}
main().catch((e) => { console.error("ERR:", e); process.exit(1); });
