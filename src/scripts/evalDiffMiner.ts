/**
 * Regression check for the draft-vs-sent diff miner (AIDiffMiner).
 *
 *   npx ts-node src/scripts/evalDiffMiner.ts
 *
 * The risk this pins down is teaching the bot something stay-specific — a door
 * code, one guest's dates — as though it were a general property fact. Those
 * cases must be rejected even though they look like perfect lessons on overlap
 * score alone. No database and no network.
 */
import { classifyPair, deriveTopic, minePairs, ReplyPair } from "../services/AIDiffMiner";

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

const pair = (over: Partial<ReplyPair>): ReplyPair => ({
    suggestionId: 1,
    listingId: 100,
    guestQuestion: "Where do we park?",
    aiDraft: "Parking is on the street out front.",
    teamReply: "Parking is in the underground garage on level two, and the gate code is on the lockbox card.",
    similarity: 12,
    ...over,
});

const verdict = (over: Partial<ReplyPair>): string => {
    const v = classifyPair(pair(over));
    return v.teachable ? "teachable" : v.reason || "unknown";
};

console.log("Diff miner — what counts as a lesson\n");

check(
    "a substantive general answer is teachable",
    verdict({ teamReply: "Parking is in the underground garage on level two, entrance on Wells Street." }),
    "teachable"
);
check("a draft that already matched is skipped", verdict({ similarity: 85 }), "draft_already_close");
check("a pleasantry teaches nothing", verdict({ teamReply: "You're welcome! Thank you!" }), "team_reply_is_pleasantry");
check("a short reply teaches nothing", verdict({ teamReply: "Yes, level two." }), "team_reply_too_short");
check(
    "a deferral teaches nothing",
    verdict({ teamReply: "Let me check with the team on that and I will get back to you shortly." }),
    "team_reply_defers"
);
check(
    "a guest statement with no question cannot form a fact",
    verdict({ guestQuestion: "Thanks, we just arrived." }),
    "guest_turn_not_a_question"
);

console.log("\nDiff miner — refusing to generalise one stay\n");

check(
    "an access code is never taught as a general fact",
    verdict({ teamReply: "The door code for the unit is 4821 and the garage gate is the same." }),
    "answer_not_generalizable"
);
check(
    "an ISO date is never taught as a general fact",
    verdict({ teamReply: "Your cleaning is scheduled for 2026-07-30 between noon and two in the afternoon." }),
    "answer_not_generalizable"
);
check(
    "a slash date is never taught as a general fact",
    verdict({ teamReply: "We have you down for a late checkout on 7/19, so take your time that morning." }),
    "answer_not_generalizable"
);
check(
    "a reply about this guest's own booking is never generalised",
    verdict({ teamReply: "Your reservation includes the parking spot, so you are all set for the week." }),
    "answer_not_generalizable"
);

console.log("\nDiff miner — topics and deduplication\n");

check("topic comes from the question's content words", deriveTopic("What time is check-in?"), "time-check");
check("a question with only stop words falls back", deriveTopic("is it?"), "general");

check(
    "a pleasantry is contentless even when it is long enough to pass the length bar",
    verdict({ teamReply: "You're welcome! Thank you! Thanks so much! My pleasure! Sounds good!" }),
    "team_reply_is_pleasantry"
);

const batch: ReplyPair[] = [
    pair({ suggestionId: 1, teamReply: "Parking is in the garage on level two of the building." }),
    pair({ suggestionId: 2, teamReply: "Parking is in the underground garage on level two, entrance on Wells." }),
    pair({ suggestionId: 3, guestQuestion: "Is there a pool?", teamReply: "There is a rooftop pool open from May through September each year." }),
    pair({ suggestionId: 4, teamReply: "Thanks!" }),
    pair({ suggestionId: 5, teamReply: "The code is 9931 for the garage gate entrance on the north side." }),
];
const mined = minePairs(batch);

check("repeat lessons collapse to one candidate", mined.candidates.length, 2);
check("the most-repeated candidate leads", mined.candidates[0].occurrences, 2);
check(
    "dedup keeps the fuller answer",
    mined.candidates[0].answer,
    "Parking is in the underground garage on level two, entrance on Wells."
);
check(
    "rejections are tallied by reason",
    mined.rejected,
    { team_reply_is_pleasantry: 1, answer_not_generalizable: 1 }
);

console.log(`\n${failed === 0 ? "all checks pass" : `${failed} check(s) FAILED`}`);
process.exit(failed ? 1 : 0);
