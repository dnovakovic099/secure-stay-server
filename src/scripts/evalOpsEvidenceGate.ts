/**
 * Regression check for the ops-evidence gate (InboxAIOpsEvidence).
 *
 *   npx ts-node src/scripts/evalOpsEvidenceGate.ts
 *   npx ts-node src/scripts/evalOpsEvidenceGate.ts tmp/wrong-info-replay-....json
 *
 * The inline fixtures are the failure modes the July audit found, plus the
 * phrasings that must stay unflagged — promising to look into something is what
 * the team actually writes and must never be blocked. Pass a replay artifact to
 * additionally score recall and false positives across a full run.
 *
 * No database and no network: this is a pure text-policy check.
 */
import * as fs from "fs";
import { unsupportedOpsClaims } from "../services/InboxAIOpsEvidence";

const NO_EVIDENCE = { hasCompleted: false, hasOpenWork: false };
const DONE = { hasCompleted: true, hasOpenWork: false };
const OPEN = { hasCompleted: false, hasOpenWork: true };

type Fixture = {
    name: string;
    guestText: string;
    reply: string;
    evidence?: { hasCompleted: boolean; hasOpenWork: boolean };
    approvalOnRecord?: boolean;
    shouldFlag: boolean;
};

const FIXTURES: Fixture[] = [
    // --- must flag: state claims with nothing in the ledger ---
    {
        name: "ops progress claimed on a brand-new request",
        guestText: "Can you bring two blow up beds to the unit?",
        reply: "The team is already arranging two blow up beds for you and they will be delivered between 6 and 8 PM.",
        shouldFlag: true,
    },
    {
        name: "completion claimed on a brand-new request",
        guestText: "Could you have someone restock the coffee pods?",
        reply: "The team has already arranged for more coffee pods to be dropped off.",
        shouldFlag: true,
    },
    {
        name: "decision claimed on a brand-new request",
        guestText: "Can we have a few extra people over on Saturday?",
        reply: "Our team has reviewed your request, and due to the house rules only registered overnight guests are permitted.",
        shouldFlag: true,
    },
    {
        name: "logging framed as action",
        guestText: "Please make sure housekeeping skips Tuesday.",
        reply: "I've made a note of that, so you're all set.",
        shouldFlag: true,
    },
    {
        name: "discretionary approval granted by the bot",
        guestText: "Is late check out possible on the 24th?",
        reply: "Yes, late check out on the 24th is possible if the schedule allows.",
        shouldFlag: true,
    },
    {
        name: "policy exception granted by the bot",
        guestText: "We'd like to bring one more child, is that ok?",
        reply: "No extra charge for a child, your group fits perfectly here.",
        shouldFlag: true,
    },
    {
        name: "PM thread: calendar action claimed as done",
        guestText: "Can you block off 7/19 for me?",
        reply: "I've blocked off 7/19 on the calendar.",
        shouldFlag: true,
    },
    {
        name: "completion claimed on follow-up with only open work",
        guestText: "Any update on the air mattresses?",
        reply: "They have been delivered to the unit already.",
        evidence: OPEN,
        shouldFlag: true,
    },

    // --- must not flag: commitments, and claims the ledger actually supports ---
    {
        name: "promise to look into it",
        guestText: "Can you bring two blow up beds to the unit?",
        reply: "Our team is checking on blow up beds now and I'll update you as soon as I hear back.",
        shouldFlag: false,
    },
    {
        name: "getting it to the team",
        guestText: "The kitchen sink is clogged.",
        reply: "Sorry about that. I'm getting this to our maintenance team right away and will follow up with you shortly.",
        shouldFlag: false,
    },
    {
        name: "open work reported as open work",
        guestText: "Any update on the vacuum bags?",
        reply: "Our team is still working on that one and I'll let you know the moment it's sorted.",
        evidence: OPEN,
        shouldFlag: false,
    },
    {
        name: "completion backed by a DONE line",
        guestText: "Did the air mattresses get dropped off?",
        reply: "Yes, they have been delivered to the unit.",
        evidence: DONE,
        shouldFlag: false,
    },
    {
        name: "approval backed by a paid upsell order",
        guestText: "Is my late checkout confirmed?",
        reply: "Yes, your late checkout is confirmed for 12 PM.",
        evidence: DONE,
        approvalOnRecord: true,
        shouldFlag: false,
    },
    {
        name: "quoting a documented upsell fee",
        guestText: "Can we get an early check in?",
        reply: "We can offer an 11:00 AM early check in for a $100 fee, subject to the schedule that morning.",
        shouldFlag: false,
    },
    {
        name: "standard check-in time is not an ETA promise",
        guestText: "What time can we get in?",
        reply: "Check in is after 4:00 PM and checkout is at 10:00 AM.",
        shouldFlag: false,
    },
    {
        name: "descriptive passive is not a completion claim",
        guestText: "Why is there a warning on my booking?",
        reply: "The flag you're seeing is set by Airbnb's system, not by us.",
        shouldFlag: false,
    },
];

let failed = 0;
console.log("Ops-evidence gate — fixtures\n");
for (const f of FIXTURES) {
    const claims = unsupportedOpsClaims({
        reply: f.reply,
        guestText: f.guestText,
        evidence: f.evidence || NO_EVIDENCE,
        approvalOnRecord: f.approvalOnRecord,
    });
    const flagged = claims.length > 0;
    const ok = flagged === f.shouldFlag;
    if (!ok) failed++;
    console.log(`  ${ok ? "pass" : "FAIL"}  ${f.shouldFlag ? "flag  " : "allow "} ${f.name}`);
    if (!ok) {
        console.log(`        reply:  ${JSON.stringify(f.reply)}`);
        console.log(`        got:    ${claims.map((c) => `${c.kind}:${JSON.stringify(c.text)}`).join(", ") || "no claims"}`);
    }
}
console.log(`\n${FIXTURES.length - failed}/${FIXTURES.length} fixtures pass`);

// Optional: score against a wrong-info replay artifact.
const artifact = process.argv[2];
if (artifact && fs.existsSync(artifact)) {
    const reports = JSON.parse(fs.readFileSync(artifact, "utf8")).reports || [];
    const flags = (r: any) =>
        unsupportedOpsClaims({ reply: r.baseline?.reply || "", guestText: r.guestAsk || "", evidence: NO_EVIDENCE });
    const wrong = reports.filter((r: any) => r.baseline?.outcome === "still_wrong");
    const good = reports.filter((r: any) => ["fixed", "deferred_safe"].includes(r.baseline?.outcome));
    console.log(`\nReplay ${artifact}`);
    console.log(`  still-wrong flagged   ${wrong.filter((r: any) => flags(r).length).length}/${wrong.length}`);
    console.log(`  judge-accepted held   ${good.filter((r: any) => flags(r).length).length}/${good.length}`);
}

process.exit(failed ? 1 : 0);
