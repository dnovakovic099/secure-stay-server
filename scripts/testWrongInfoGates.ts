/**
 * Offline checks for wrong-info speech-act gates.
 * Run: npx ts-node scripts/testWrongInfoGates.ts
 */
import {
    detectUnsafeSpeechActs,
    isSevereWrongInfoAssert,
    wrongInfoHoldingReply,
} from "../src/services/InboxAIAssertPolicy";
import { tokenize } from "../src/services/ListingKnowledgeService";

let failed = 0;
function assert(cond: boolean, msg: string) {
    if (!cond) {
        failed += 1;
        console.error(`FAIL: ${msg}`);
    } else console.log(`OK:   ${msg}`);
}

const base = {
    codesAllowed: false,
    agreementAsk: false,
    hasExplicitOpsConfirmation: false,
    bookingConfirmed: true,
    guestText: "",
    contextHaystack: "listing details bedrooms: 8. amenities: kitchen, wifi.",
    paymentState: "unknown" as const,
};

{
    const hits = detectUnsafeSpeechActs(
        "I can process a refund for you right away.",
        { ...base, guestText: "Can I get a refund?" }
    );
    assert(hits.includes("refund_or_rebook_promise"), `refund promise → ${hits.join(",")}`);
    assert(hits.some(isSevereWrongInfoAssert), "refund is severe");
}

{
    const hits = detectUnsafeSpeechActs(
        "Great news — your date change is approved for those nights.",
        { ...base, guestText: "Can we change our dates?" }
    );
    assert(hits.includes("schedule_change_approval"), `schedule approval → ${hits.join(",")}`);
}

{
    const hits = detectUnsafeSpeechActs("There is no deposit on this reservation.", {
        ...base,
        guestText: "Was a deposit collected?",
        contextHaystack: "reservation billing payment_state: paid",
    });
    assert(hits.includes("deposit_claim_without_billing"), `deposit invent → ${hits.join(",")}`);
}

{
    const hits = detectUnsafeSpeechActs("Sorry, we don't have a grill at the property.", {
        ...base,
        guestText: "Is there a grill?",
        contextHaystack: "listing details bedrooms: 3. amenities: kitchen, wifi.",
    });
    assert(hits.includes("invented_amenity_or_feature"), `grill invent → ${hits.join(",")}`);
}

{
    const hits = detectUnsafeSpeechActs("We have a grill on the back deck.", {
        ...base,
        guestText: "Is there a grill?",
        contextHaystack: "listing details. grill on the patio. EXTERNAL KB.",
    });
    assert(!hits.includes("invented_amenity_or_feature"), `grounded grill OK → ${hits.join(",")}`);
}

assert(tokenize("how many tvs in bedrooms").includes("tvs"), "tokenize keeps tvs");
assert(tokenize("is there a tv").includes("tv"), "tokenize keeps tv");
assert(/refund|team/i.test(wrongInfoHoldingReply("Can I get a refund?")), "holding reply mentions team/refund");

if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
}
console.log("\nAll wrong-info gate checks passed.");
