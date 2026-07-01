import "reflect-metadata";
import "dotenv/config";
import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import { EmbeddingService } from "../services/EmbeddingService";

const LIMIT = Number(process.argv[2] || 60);

type Pair = {
    id: number;
    listingId: number | null;
    guest: string;
    ai: string;
    rep: string;
    conf: number | null;
    lex: number | null;
    sem?: number;
    verdict?: string; // equivalent | partial | different | contradicts
    note?: string;
};

async function judge(client: OpenAI, p: Pair): Promise<{ verdict: string; note: string }> {
    const prompt = `You compare a property manager's ACTUAL reply to a guest with the AI's SUGGESTED reply.
Return strict JSON: {"verdict":"equivalent|partial|different|contradicts","note":"<=12 words"}.
- equivalent: AI conveys the same key info/decision the rep did (wording may differ).
- partial: AI is on-topic and partly right but misses or adds something material.
- different: AI answers a different thing or is too generic to be useful.
- contradicts: AI states something that conflicts with the rep (wrong info/policy).

GUEST: ${p.guest || "(no text / attachment)"}
REP REPLY: ${p.rep}
AI SUGGESTION: ${p.ai}`;
    try {
        const r = await client.chat.completions.create({
            model: process.env.AI_MODEL || "gpt-4.1",
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            response_format: { type: "json_object" },
        });
        const j = JSON.parse(r.choices[0].message.content || "{}");
        return { verdict: j.verdict || "different", note: j.note || "" };
    } catch (e: any) {
        return { verdict: "error", note: e.message?.slice(0, 40) || "err" };
    }
}

async function main() {
    await appDatabase.initialize();
    const rows: Pair[] = await appDatabase.query(
        `SELECT s.id, s.listingId, m.body AS guest, s.suggestedReply AS ai, s.actualReplyText AS rep,
                s.confidence AS conf, s.replySimilarity AS lex
         FROM ai_message_suggestions s
         LEFT JOIN inbox_messages m ON m.externalId = s.messageId
         WHERE s.actualReplyText IS NOT NULL AND s.suggestedReply IS NOT NULL
           AND CHAR_LENGTH(s.actualReplyText) > 3
         ORDER BY s.generatedAt DESC LIMIT ?`,
        [LIMIT]
    );
    console.log(`Linked pairs pulled: ${rows.length}`);

    const emb = new EmbeddingService();
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    for (const p of rows) {
        try {
            const [a, b] = await emb.embedMany([p.ai.slice(0, 2000), p.rep.slice(0, 2000)]);
            p.sem = EmbeddingService.cosine(a, b);
        } catch {
            p.sem = 0;
        }
        const v = await judge(client, p);
        p.verdict = v.verdict;
        p.note = v.note;
    }

    const n = rows.length || 1;
    const avgSem = rows.reduce((s, p) => s + (p.sem || 0), 0) / n;
    const avgLex = rows.reduce((s, p) => s + (Number(p.lex) || 0), 0) / n;
    const avgConf = rows.reduce((s, p) => s + (Number(p.conf) || 0), 0) / n;
    const bucket = (lo: number, hi: number) => rows.filter((p) => (p.sem || 0) >= lo && (p.sem || 0) < hi).length;
    const vcount = (v: string) => rows.filter((p) => p.verdict === v).length;

    console.log("\n================ SUGGESTION QUALITY AUDIT ================");
    console.log(`avg semantic sim: ${(avgSem * 100).toFixed(1)} / 100   (lexical avg: ${avgLex.toFixed(1)}, model confidence avg: ${avgConf.toFixed(1)})`);
    console.log(`\nSemantic similarity buckets:`);
    console.log(`  >=85 (near-identical): ${bucket(0.85, 1.01)}`);
    console.log(`  70-85 (close):         ${bucket(0.7, 0.85)}`);
    console.log(`  55-70 (partial):       ${bucket(0.55, 0.7)}`);
    console.log(`  <55 (off):             ${bucket(0, 0.55)}`);
    console.log(`\nLLM equivalence verdict (does AI match what the rep did?):`);
    for (const v of ["equivalent", "partial", "different", "contradicts", "error"]) {
        const c = vcount(v);
        if (c) console.log(`  ${v.padEnd(12)}: ${c}  (${((c / n) * 100).toFixed(0)}%)`);
    }
    const goodRate = (vcount("equivalent") + vcount("partial")) / n;
    console.log(`\nUsable (equivalent+partial): ${(goodRate * 100).toFixed(0)}%`);

    // Confidence calibration: is high confidence actually better?
    const hi = rows.filter((p) => Number(p.conf) >= 80);
    const lo = rows.filter((p) => Number(p.conf) < 80);
    const eq = (arr: Pair[]) => (arr.length ? (arr.filter((p) => p.verdict === "equivalent").length / arr.length) * 100 : 0);
    console.log(`\nCalibration: conf>=80 -> ${eq(hi).toFixed(0)}% equivalent (n=${hi.length}); conf<80 -> ${eq(lo).toFixed(0)}% equivalent (n=${lo.length})`);

    const show = (p: Pair) => {
        console.log(`\n  [#${p.id} listing ${p.listingId}] sem=${((p.sem || 0) * 100).toFixed(0)} conf=${p.conf} verdict=${p.verdict} (${p.note})`);
        console.log(`   GUEST: ${(p.guest || "(no text)").replace(/\s+/g, " ").slice(0, 160)}`);
        console.log(`   REP  : ${p.rep.replace(/\s+/g, " ").slice(0, 200)}`);
        console.log(`   AI   : ${p.ai.replace(/\s+/g, " ").slice(0, 200)}`);
    };

    console.log("\n---------------- WORST (contradicts / different) ----------------");
    rows.filter((p) => p.verdict === "contradicts" || p.verdict === "different")
        .sort((a, b) => (a.sem || 0) - (b.sem || 0))
        .slice(0, 6)
        .forEach(show);

    console.log("\n---------------- BEST (equivalent, high sem) ----------------");
    rows.filter((p) => p.verdict === "equivalent")
        .sort((a, b) => (b.sem || 0) - (a.sem || 0))
        .slice(0, 3)
        .forEach(show);

    await appDatabase.destroy();
    console.log("\nDONE");
}

main().catch((e) => {
    console.error("AUDIT ERROR:", e);
    process.exit(1);
});
