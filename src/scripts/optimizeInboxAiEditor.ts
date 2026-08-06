/**
 * Manual / one-off: distill yesterday's (or --day=YYYY-MM-DD) AI misses into
 * Editor lessons.
 *
 *   npx ts-node src/scripts/optimizeInboxAiEditor.ts
 *   npx ts-node src/scripts/optimizeInboxAiEditor.ts --day=2026-08-05
 *   npx ts-node src/scripts/optimizeInboxAiEditor.ts --no-slack
 */
import "reflect-metadata";
import "dotenv/config";
import { appDatabase } from "../utils/database.util";
import { InboxAIEditorOptimizeService } from "../services/InboxAIEditorOptimizeService";

async function main() {
    const args = process.argv.slice(2);
    const dayArg = args.find((a) => a.startsWith("--day="));
    const dayEt = dayArg ? dayArg.slice("--day=".length) : undefined;
    const notifySlack = !args.includes("--no-slack");

    await appDatabase.initialize();
    const result = await new InboxAIEditorOptimizeService().runDailyOptimize({
        dayEt,
        notifySlack,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
