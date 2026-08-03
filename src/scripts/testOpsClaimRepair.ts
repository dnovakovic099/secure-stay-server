/**
 * One-off smoke test for the ops-claim repair pass (Aug 2026 audit fix).
 * Runs the deterministic gate + the exact repair prompt from
 * InboxAIService.repairUnsupportedOpsClaims against real failure cases from
 * the audit, then re-runs the gate on the rewrite.
 *
 *   OPENAI_API_KEY=... npx ts-node src/scripts/testOpsClaimRepair.ts
 */
import OpenAI from "openai";
import { guestMakesNewRequest, unsupportedOpsClaims } from "../services/InboxAIOpsEvidence";

const CASES = [
    {
        name: "Locked-out guest (audit thread 300017826)",
        guest: "The door code is not working, we can't get in. Can you help?",
        reply:
            "For security, the backup code and full access instructions are sent on your check in day. " +
            "If you're having trouble with the doors, the team is already working on it and will update you as soon as possible.",
    },
    {
        name: "Re-clean claimed arranged (audit id 20379)",
        guest: "Can you make sure the place gets a proper clean before our new stay?",
        reply:
            "Absolutely, the re-clean is already arranged for your new stay, so everything will be fresh when you arrive. " +
            "Let us know if there's anything else you need!",
    },
    {
        name: "Parking spot claimed reserved (audit id 20214)",
        guest: "Could we get the garage parking spot for our stay?",
        reply:
            "Great news! Your garage parking spot will be reserved for your stay. " +
            "Check-in is at 4 PM and we look forward to hosting you.",
    },
];

async function main() {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let failures = 0;

    for (const c of CASES) {
        console.log(`\n=== ${c.name}`);
        console.log(`guestMakesNewRequest: ${guestMakesNewRequest(c.guest)}`);
        const evidence = { hasCompleted: false, hasOpenWork: false };
        const claims = unsupportedOpsClaims({ reply: c.reply, guestText: c.guest, evidence });
        console.log(`gate on original: ${claims.length} claim(s):`);
        for (const cl of claims) console.log(`  - "${cl.text}" (${cl.kind})`);
        if (!claims.length) {
            console.log("FAIL: gate did not flag the original draft");
            failures++;
            continue;
        }

        // Exact prompt from InboxAIService.repairUnsupportedOpsClaims.
        const completion = await client.chat.completions.create({
            model: process.env.AI_MESSAGING_MODEL || "gpt-4.1",
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content:
                        "You repair drafted replies to guests of a short-term-rental company. " +
                        "The draft falsely states that operational work is finished, under way, approved, or scheduled — no such work has been logged. " +
                        'Rewrite ONLY the offending phrases into honest commitments, e.g. "The team is already working on it" becomes "I\'m getting this to the team right away and we\'ll follow up". ' +
                        "Keep every other sentence exactly as written: same language, tone, greeting, and facts. " +
                        "Do not add new facts, prices, codes, clock times, ETAs, or promises of specific outcomes. " +
                        'Return STRICT JSON: {"reply": "<the full repaired reply>"}',
                },
                {
                    role: "user",
                    content: [
                        `Guest's message:\n${c.guest}`,
                        `Drafted reply to repair:\n${c.reply}`,
                        `Unsupported claims to rephrase as commitments:\n${claims
                            .map((cl) => `- "${cl.text}" (${cl.kind})`)
                            .join("\n")}`,
                    ].join("\n\n"),
                },
            ],
        });
        const repaired = String(
            JSON.parse(completion.choices[0]?.message?.content?.trim() || "{}").reply || ""
        ).trim();
        console.log(`repaired: ${repaired}`);
        const remaining = unsupportedOpsClaims({ reply: repaired, guestText: c.guest, evidence });
        if (!repaired || remaining.length) {
            console.log(
                `FAIL: repair did not clear the gate (${remaining.length} remaining): ${remaining
                    .map((r) => `"${r.text}"`)
                    .join("; ")}`
            );
            failures++;
        } else {
            console.log("PASS: repaired reply clears the gate");
        }
    }

    console.log(`\n${failures ? `${failures} case(s) FAILED` : "All cases passed"}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
