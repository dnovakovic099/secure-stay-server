/**
 * Turn the draft-vs-sent gap into review candidates.
 *
 *   npx ts-node src/scripts/mineReplyDiffs.ts                  # report only
 *   npx ts-node src/scripts/mineReplyDiffs.ts --days 30
 *   npx ts-node src/scripts/mineReplyDiffs.ts --max-similarity 30
 *   npx ts-node src/scripts/mineReplyDiffs.ts --write           # insert as pending
 *
 * Every reply the team sends is already paired with the AI's draft and scored
 * (`linkActualReply`), and until now nothing read those pairs. This walks the
 * low-overlap ones, keeps the pairs that carry a durable general fact, and
 * proposes them as learned facts.
 *
 * DRY RUN BY DEFAULT. With `--write`, candidates are inserted with
 * status='pending' so a human still approves before anything reaches a guest.
 */
import { IsNull } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AILearnedFactEntity } from "../entity/AILearnedFact";
import { minePairs, ReplyPair } from "../services/AIDiffMiner";

function arg(name: string, fallback: number): number {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const n = Number(process.argv[i + 1]);
    return Number.isFinite(n) ? n : fallback;
}

async function main() {
    const days = arg("days", 30);
    const maxSimilarity = arg("max-similarity", 40);
    const limit = arg("limit", 2000);
    const write = process.argv.includes("--write");

    await appDatabase.initialize();
    try {
        // The guest turn is the inbound message the suggestion was generated for;
        // actualReplyText is what a human actually sent afterwards.
        //
        // Restricted to Hostify rows and joined on BOTH threadId and externalId:
        // for Quo suggestions `messageId` refers to quo_messages.id, so joining on
        // externalId alone would silently pair a draft with a stranger's message.
        const rows: any[] = await appDatabase.query(
            `SELECT s.id                AS suggestionId,
                    s.listingId         AS listingId,
                    s.suggestedReply    AS aiDraft,
                    s.actualReplyText   AS teamReply,
                    s.replySimilarity   AS similarity,
                    m.body              AS guestQuestion
             FROM ai_message_suggestions s
             JOIN inbox_messages m
               ON m.threadId = s.threadId AND m.externalId = s.messageId
             WHERE s.source = 'hostify'
               AND s.messageId IS NOT NULL
               AND s.actualReplyText IS NOT NULL AND s.actualReplyText <> ''
               AND s.createdAt >= (NOW() - INTERVAL ? DAY)
               AND (s.replySimilarity IS NULL OR s.replySimilarity <= ?)
             ORDER BY s.replySimilarity ASC, s.createdAt DESC
             LIMIT ?`,
            [days, maxSimilarity, limit]
        );

        const pairs: ReplyPair[] = rows.map((r) => ({
            suggestionId: Number(r.suggestionId),
            listingId: r.listingId != null ? Number(r.listingId) : null,
            guestQuestion: String(r.guestQuestion || ""),
            aiDraft: String(r.aiDraft || ""),
            teamReply: String(r.teamReply || ""),
            similarity: r.similarity != null ? Number(r.similarity) : null,
        }));

        const { candidates, rejected } = minePairs(pairs, { maxSimilarity });

        console.log(`\nMined ${pairs.length} low-overlap pairs from the last ${days} days`);
        console.log(`  teachable candidates (deduped): ${candidates.length}`);
        console.log("  dropped:");
        for (const [reason, n] of Object.entries(rejected).sort((a, b) => b[1] - a[1])) {
            console.log(`    ${String(n).padStart(5)}  ${reason}`);
        }

        console.log(`\nTop candidates:`);
        for (const c of candidates.slice(0, 25)) {
            console.log(`\n  [${c.occurrences}x] listing ${c.listingId ?? "portfolio"} · topic ${c.topic}`);
            console.log(`    guest asked : ${c.question.slice(0, 160)}`);
            console.log(`    team replied: ${c.answer.slice(0, 200)}`);
        }

        if (!write) {
            console.log(`\nDry run. Re-run with --write to insert ${candidates.length} candidates as pending facts.`);
            return;
        }

        const repo = appDatabase.getRepository(AILearnedFactEntity);
        let inserted = 0;
        let skipped = 0;
        for (const c of candidates) {
            // Never create a second pending row for something already known.
            // IsNull() rather than a bare null: TypeORM does not reliably turn a
            // literal null in a where object into `IS NULL`, so portfolio-scoped
            // candidates would never match and would be re-inserted every run.
            const existing = await repo.findOne({
                where: {
                    topic: c.topic,
                    listingId: c.listingId == null ? IsNull() : (c.listingId as any),
                    memoryType: "permanent_fact",
                },
            });
            if (existing) {
                skipped++;
                continue;
            }
            await repo.save(
                repo.create({
                    scope: c.listingId != null ? "property" : "portfolio",
                    listingId: c.listingId,
                    topic: c.topic,
                    factType: "qa",
                    memoryType: "permanent_fact",
                    subjectType: "property",
                    subjectId: c.listingId != null ? String(c.listingId) : null,
                    visibility: "external",
                    question: c.question,
                    answer: c.answer,
                    status: "pending",
                    source: "nightly_audit",
                    frequency: c.occurrences,
                    sampleThreadId: null,
                    lastSeenAt: new Date(),
                })
            );
            inserted++;
        }
        console.log(`\nInserted ${inserted} pending facts (${skipped} already covered). Review them in the Learned tab.`);
    } finally {
        await appDatabase.destroy().catch(() => undefined);
    }
}

main().catch((err) => {
    logger.error(`[mineReplyDiffs] ${err?.message}`);
    console.error(err);
    process.exit(1);
});
