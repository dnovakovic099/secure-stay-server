import "reflect-metadata";
import "dotenv/config";
import { appDatabase } from "../utils/database.util";
import { InboxAIService } from "../services/InboxAIService";

// Previously-failing suggestion IDs (with real guest text) from the audit.
const IDS = [11, 81, 10, 159, 169, 147, 95];

async function main() {
    await appDatabase.initialize();
    const rows: any[] = await appDatabase.query(
        `SELECT s.id, s.listingId, m.body AS guest, s.suggestedReply AS oldAi, s.actualReplyText AS rep
         FROM ai_message_suggestions s LEFT JOIN inbox_messages m ON m.externalId=s.messageId
         WHERE s.id IN (${IDS.join(",")}) AND m.body IS NOT NULL AND CHAR_LENGTH(m.body)>3`
    );
    const svc = new InboxAIService();
    for (const r of rows) {
        let res: any = null;
        try { res = await svc.previewSuggestion(Number(r.listingId), String(r.guest), { grounded: true }); } catch (e: any) { res = { output: { suggested_reply: "ERR: " + e.message }, context: "" }; }
        const ctx = res.context || "";
        const has = (h: string) => (ctx.includes(h) ? "Y" : "-");
        console.log(`\n========== #${r.id} (listing ${r.listingId}) ==========`);
        console.log(`GUEST : ${String(r.guest).replace(/\s+/g, " ").slice(0, 160)}`);
        console.log(`REP   : ${String(r.rep).replace(/\s+/g, " ").slice(0, 200)}`);
        console.log(`OLD AI: ${String(r.oldAi).replace(/\s+/g, " ").slice(0, 200)}`);
        console.log(`NEW AI: ${String(res.output.suggested_reply).replace(/\s+/g, " ").slice(0, 260)}`);
        console.log(`ctx has -> KB:${has("Knowledge Base")} internalKB:${has("Internal knowledge")} proven:${has("proven replies")} docs:${has("Listing documents")} availability:${has("Live availability")}  conf=${res.output.confidence}`);
    }
    await appDatabase.destroy();
    console.log("\nDONE");
}
main().catch((e) => { console.error("ERR:", e); process.exit(1); });
