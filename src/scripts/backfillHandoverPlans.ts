/**
 * Backfill AI handover plans for existing Urgent + AI Needs Team threads.
 *
 * Dry-run (default):
 *   npx ts-node --transpile-only src/scripts/backfillHandoverPlans.ts
 *
 * Apply:
 *   NODE_ENV=development npx ts-node --transpile-only src/scripts/backfillHandoverPlans.ts --apply --limit=300
 *
 * Rebuild smarter escalation/maintenance/refund plans:
 *   NODE_ENV=development npx ts-node --transpile-only src/scripts/backfillHandoverPlans.ts --apply --rebuild-escalations --limit=400
 *
 * Specific threads:
 *   NODE_ENV=development npx ts-node --transpile-only src/scripts/backfillHandoverPlans.ts --apply --threadId=123,456
 */
import "dotenv/config";
import { initDatabase, appDatabase } from "../utils/database.util";
import { AIProposedActionService } from "../services/AIProposedActionService";

function parseArgs() {
    const out: {
        apply: boolean;
        limit: number;
        threadIds: number[];
        rebuildEscalations: boolean;
    } = {
        apply: false,
        limit: 300,
        threadIds: [],
        rebuildEscalations: false,
    };
    for (const arg of process.argv.slice(2)) {
        if (arg === "--apply") out.apply = true;
        if (arg === "--rebuild-escalations") out.rebuildEscalations = true;
        if (arg.startsWith("--limit=")) {
            const n = Number(arg.slice("--limit=".length));
            if (Number.isFinite(n) && n > 0) out.limit = n;
        }
        if (arg.startsWith("--threadId=")) {
            out.threadIds = arg
                .slice("--threadId=".length)
                .split(",")
                .map((v) => Number(v.trim()))
                .filter((n) => Number.isFinite(n) && n > 0);
        }
    }
    return out;
}

async function main() {
    const args = parseArgs();
    await initDatabase();
    const service = new AIProposedActionService();

    console.log(
        `[backfillHandoverPlans] mode=${args.apply ? "APPLY" : "DRY-RUN"} limit=${args.limit}` +
            (args.threadIds.length ? ` threadIds=${args.threadIds.join(",")}` : "") +
            (args.rebuildEscalations ? " rebuildEscalations" : "")
    );

    if (args.apply && args.rebuildEscalations) {
        // Drop generic escalation cards so ensure can recreate smarter maintenance/refund/fact plans,
        // and remove escalation duplicates sitting beside specialty Urgent plans.
        const del = await appDatabase.query(
            `UPDATE ai_proposed_actions
             SET status = 'dismissed', resultNote = 'rebuilt by backfillHandoverPlans', executedAt = NOW()
             WHERE status = 'proposed'
               AND actionType IN ('escalation', 'maintenance', 'refund')`
        );
        console.log(`[rebuild] dismissed prior escalation/maintenance/refund rows`, del);
    }

    const result = await service.backfillHandoverPlans({
        limit: args.limit,
        threadIds: args.threadIds.length ? args.threadIds : undefined,
        dryRun: !args.apply,
    });

    console.log(`scanned=${result.scanned} created=${result.created}`);
    for (const s of result.samples) {
        console.log(`  thread=${s.threadId} type=${s.actionType} :: ${s.title}`);
    }

    // Spot-check: print a few full payloads for human nonsense review.
    if (args.apply && result.samples.length) {
        const ids = [...new Set(result.samples.map((s) => s.threadId))].slice(0, 8);
        for (const threadId of ids) {
            const plans = await service.listForThread(threadId);
            console.log(`\n--- REVIEW thread ${threadId} (${plans.length} open plan(s)) ---`);
            for (const p of plans) {
                let payload: any = {};
                try {
                    payload = p.payload ? JSON.parse(p.payload) : {};
                } catch {
                    payload = {};
                }
                console.log(`actionType=${p.actionType}`);
                console.log(`title=${p.title}`);
                console.log(`executionEnabled=${payload.executionEnabled}`);
                console.log(`planSummary=${payload.planSummary || "(none)"}`);
                const steps = Array.isArray(payload.recommendedSteps) ? payload.recommendedSteps : [];
                steps.forEach((st: any, i: number) => {
                    console.log(`  ${i + 1}. ${st.label}${st.detail ? ` — ${st.detail}` : ""}`);
                });
                if (p.proposedReply) {
                    console.log(`holdReply=${String(p.proposedReply).slice(0, 180)}`);
                }
            }
        }
    }

    await appDatabase.destroy().catch(() => undefined);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
