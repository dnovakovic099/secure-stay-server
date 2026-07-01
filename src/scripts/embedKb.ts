import "reflect-metadata";
import "dotenv/config";
import { appDatabase } from "../utils/database.util";
import { RetrievalService } from "../services/RetrievalService";

async function main() {
    await appDatabase.initialize();
    console.log("Embedding Knowledge Base into RAG store...");
    const t0 = Date.now();
    const n = await new RetrievalService().embedKnowledge();
    console.log(`Done: ${n} new KB vectors in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    const rows = await appDatabase.query(
        "SELECT kind, COUNT(*) n, COUNT(DISTINCT groupId) groups FROM ai_embeddings GROUP BY kind ORDER BY n DESC"
    );
    console.log("ai_embeddings now:", rows);
    await appDatabase.destroy();
    console.log("DONE");
}
main().catch((e) => { console.error("ERR:", e); process.exit(1); });
