import "reflect-metadata";
import "dotenv/config";
import { appDatabase } from "../utils/database.util";
import { AILearnedFactsService } from "../services/AILearnedFactsService";
import { ListingKnowledgeSeeder } from "../services/ListingKnowledgeSeeder";
import { RetrievalService } from "../services/RetrievalService";

/**
 * One-shot CLI: promote approved property Q&A learned facts into
 * listing_knowledge_entries (All Listings → Knowledge Base), optionally
 * re-seed Hostify listing facts, then embed for RAG.
 *
 *   npx ts-node src/scripts/promoteLearnedFactsToKb.ts
 *   npx ts-node src/scripts/promoteLearnedFactsToKb.ts --seed
 *   npx ts-node src/scripts/promoteLearnedFactsToKb.ts --no-approve-pending
 */
async function main() {
    const approvePending = !process.argv.includes("--no-approve-pending");
    const seedListings = process.argv.includes("--seed");

    await appDatabase.initialize();
    console.log(`Promoting learned facts → KB (approvePending=${approvePending}, seed=${seedListings})...`);

    const result = await new AILearnedFactsService().backfillKnowledgeFromLearned({ approvePending });
    console.log("Learned → KB:", result);

    if (seedListings) {
        const seeded = await new ListingKnowledgeSeeder().seedAll({ fetchHostify: true });
        console.log("Hostify seed:", seeded);
    }

    try {
        const n = await new RetrievalService().embedKnowledge();
        console.log(`Embedded ${n} new KB vectors`);
    } catch (err: any) {
        console.warn("KB embed failed (non-fatal):", err.message);
    }

    const rows = await appDatabase.query(`
        SELECT
          f.status,
          f.visibility,
          COUNT(*) AS facts,
          SUM(f.knowledgeEntryId IS NOT NULL) AS linked
        FROM ai_learned_facts f
        WHERE f.factType = 'qa' AND f.scope = 'property'
        GROUP BY f.status, f.visibility
        ORDER BY f.status, f.visibility
    `);
    console.log("Property Q&A summary:", rows);

    await appDatabase.destroy();
    console.log("DONE");
}

main().catch((e) => {
    console.error("ERR:", e);
    process.exit(1);
});
