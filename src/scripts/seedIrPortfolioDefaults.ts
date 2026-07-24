/**
 * Seed Chicago + Tampa-area portfolio cleaner/handyman defaults into ir_vendor_memory.
 *
 * Usage (from secure-stay-server):
 *   npx ts-node src/scripts/seedIrPortfolioDefaults.ts
 *   # or against compiled dist in prod:
 *   node dist/out-tsc/scripts/seedIrPortfolioDefaults.js
 */
import "dotenv/config";
import { appDatabase } from "../utils/database.util";
import { IssueAIService } from "../services/IssueAIService";

async function main() {
    await appDatabase.initialize();
    const svc = new IssueAIService();
    const cities = [
        "Chicago",
        "Elmwood Park",
        "Lombard",
        "Tampa",
        "Bradenton",
        "St. Petersburg",
        "Largo",
        "Clearwater",
        "Madeira Beach",
    ];
    let total = 0;
    for (const city of cities) {
        const n = await svc.ensurePortfolioCityDefaults(city);
        total += n;
        console.log(`${city}: seeded/updated ${n}`);
    }
    console.log(`Done. Total upserts: ${total}`);
    await appDatabase.destroy();
}

main().catch(async (err) => {
    console.error(err);
    try {
        await appDatabase.destroy();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
