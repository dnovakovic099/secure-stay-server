/**
 * Regression check for the memory policy layer (AIMemoryPolicy).
 *
 *   npx ts-node src/scripts/evalMemoryPolicy.ts
 *
 * Pins the two behaviours the July audit was missing: memory that expires, and
 * selection that answers the question actually asked rather than whatever was
 * written most recently. No database and no network.
 */
import {
    freshnessFactor,
    isExpired,
    isGuestUsable,
    relevanceScore,
    scoreMemory,
    selectRelevant,
    tokenize,
} from "../services/AIMemoryPolicy";
import { renderPrecedentLines } from "../services/AIMemoryService";

const NOW = new Date("2026-07-27T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

let failed = 0;
const check = (name: string, got: unknown, expect: unknown) => {
    const ok = JSON.stringify(got) === JSON.stringify(expect);
    if (!ok) failed++;
    console.log(`  ${ok ? "pass" : "FAIL"}  ${name}`);
    if (!ok) {
        console.log(`        expect: ${JSON.stringify(expect)}`);
        console.log(`        got:    ${JSON.stringify(got)}`);
    }
};

console.log("Memory policy — expiry\n");

check(
    "temporary state goes stale after 7 days",
    isExpired({ memoryType: "temporary_state", lastSeenAt: daysAgo(8) }, NOW),
    true
);
check(
    "temporary state inside 7 days is still usable",
    isExpired({ memoryType: "temporary_state", lastSeenAt: daysAgo(3) }, NOW),
    false
);
check(
    "a permanent fact never expires on a clock",
    isExpired({ memoryType: "permanent_fact", lastSeenAt: daysAgo(900) }, NOW),
    false
);
check(
    "an explicit validUntil in the past wins over the type default",
    isExpired({ memoryType: "permanent_fact", validUntil: daysAgo(1) }, NOW),
    true
);
check(
    "an explicit validUntil in the future keeps it alive",
    isExpired({ memoryType: "temporary_state", lastSeenAt: daysAgo(30), validUntil: daysAgo(-5) }, NOW),
    false
);
check(
    "superseded memory is never used",
    isExpired({ memoryType: "permanent_fact", supersededByFactId: 42 }, NOW),
    true
);
check(
    "a decision stays on record as precedent",
    isExpired({ memoryType: "decision", lastSeenAt: daysAgo(400) }, NOW),
    false
);

console.log("\nMemory policy — decay\n");

check("a fact confirmed today is undecayed", freshnessFactor({ memoryType: "permanent_fact", lastSeenAt: NOW }, NOW), 1);
const patternFade = freshnessFactor({ memoryType: "learned_pattern", lastSeenAt: daysAgo(120) }, NOW);
check("a pattern unseen for its full horizon bottoms out", patternFade, 0.15);
const factSame = freshnessFactor({ memoryType: "permanent_fact", lastSeenAt: daysAgo(120) }, NOW);
check("a permanent fact decays more slowly than a pattern", factSame > patternFade, true);

console.log("\nMemory policy — relevance\n");

check("stop words are dropped", tokenize("what is the parking situation"), ["parking", "situation"]);
check("full coverage scores 1", relevanceScore(["parking", "garage"], "parking in the garage"), 1);
check("no coverage scores 0", relevanceScore(["parking"], "the wifi password is sunny"), 0);
check(
    "expired memory has no score at all",
    scoreMemory({ memoryType: "temporary_state", lastSeenAt: daysAgo(30) }, ["leak"], "there is a leak", NOW),
    null
);

console.log("\nMemory policy — selection\n");

type Note = { label: string; body: string; seen: Date; type?: string };
const notes: Note[] = [
    // Newest first, as the database would return them.
    { label: "recent-irrelevant-1", body: "guests keep asking about the hot tub temperature", seen: daysAgo(1) },
    { label: "recent-irrelevant-2", body: "remember to mention the welcome basket", seen: daysAgo(2) },
    { label: "recent-irrelevant-3", body: "do not discuss the neighbour dispute", seen: daysAgo(3) },
    { label: "older-relevant", body: "parking is in the garage on level two, not the street", seen: daysAgo(40) },
    { label: "expired-relevant", body: "parking garage closed for resurfacing", seen: daysAgo(30), type: "temporary_state" },
];
const pick = (limit: number, query: string) =>
    selectRelevant(notes, {
        limit,
        query,
        record: (n) => ({ memoryType: n.type || "permanent_fact", lastSeenAt: n.seen }),
        haystack: (n) => n.body,
        now: NOW,
    }).map((n) => n.label);

check(
    "the relevant older note beats three fresher irrelevant ones",
    pick(1, "where do I park the car?"),
    ["older-relevant"]
);
check("expired relevant memory is excluded entirely", pick(5, "where do I park?").includes("expired-relevant"), false);
check(
    "with no question, recency order is preserved",
    pick(2, ""),
    ["recent-irrelevant-1", "recent-irrelevant-2"]
);

console.log("\nMemory policy — guest visibility\n");

check("a permanent external fact may reach a guest", isGuestUsable({ memoryType: "permanent_fact" }), true);
check("an internal fact may not", isGuestUsable({ memoryType: "permanent_fact", visibility: "internal" }), false);
check("an inferred pattern may not be quoted to a guest", isGuestUsable({ memoryType: "learned_pattern" }), false);
check("decision rationale may not be quoted to a guest", isGuestUsable({ memoryType: "decision" }), false);

console.log("\nPrecedent rendering\n");

check(
    "a decision renders with its date and reason",
    renderPrecedentLines([
        {
            topic: "refund",
            answer: "Refunded one night, $154.50",
            decisionRationale: "Heating was out for the first night and maintenance could not attend until morning",
            createdAt: "2026-06-14T09:12:00Z" as any,
        },
    ]),
    [
        "- [2026-06-14] Refunded one night, $154.50 — reason: Heating was out for the first night and maintenance could not attend until morning",
    ]
);
check(
    "a decision with no recorded reason still renders",
    renderPrecedentLines([
        { topic: "late-checkout", answer: "Approved 1pm checkout", decisionRationale: null, createdAt: "2026-07-02" as any },
    ]),
    ["- [2026-07-02] Approved 1pm checkout"]
);
check(
    "an empty decision is skipped rather than rendered blank",
    renderPrecedentLines([{ topic: "", answer: "", decisionRationale: "x", createdAt: "2026-07-02" as any }]),
    []
);

console.log(`\n${failed === 0 ? "all checks pass" : `${failed} check(s) FAILED`}`);
process.exit(failed ? 1 : 0);
