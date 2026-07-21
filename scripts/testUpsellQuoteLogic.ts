/**
 * Offline unit checks for UpsellQuoteService fee + SDTO logic.
 * Run: npx ts-node scripts/testUpsellQuoteLogic.ts
 */
import {
    normalizeSdto,
    nightCountFromStay,
    calculateGuestFee,
    UpsellQuoteService,
} from "../src/services/UpsellQuoteService";

let failed = 0;
function assert(cond: boolean, msg: string) {
    if (!cond) {
        failed += 1;
        console.error(`FAIL: ${msg}`);
    } else {
        console.log(`OK:   ${msg}`);
    }
}

// --- SDTO ---
assert(normalizeSdto(null) === "allowed", "blank SDTO → allowed");
assert(normalizeSdto("") === "allowed", "empty SDTO → allowed");
assert(normalizeSdto("Allowed") === "allowed", "Allowed → allowed");
assert(normalizeSdto("Not Allowed") === "not_allowed", "Not Allowed → not_allowed");
assert(normalizeSdto("Need Confirmation") === "needs_confirmation", "Need Confirmation");
assert(normalizeSdto("Needs Confirmation") === "needs_confirmation", "Needs Confirmation");
assert(normalizeSdto("from HF") === "allowed", "custom text → allowed");

// --- nights ---
assert(nightCountFromStay("2026-07-01", "2026-07-04") === 3, "3-night stay");
assert(nightCountFromStay(null, null, 5) === 5, "nights hint");

// --- Fixed Per Stay with stored guest fee (screenshot: $257.50) ---
{
    const calc = calculateGuestFee(
        {
            rateConfiguration: "Fixed Rate",
            chargeType: "Per Stay",
            listingFee: 257.5,
            actualFee: 200,
            pmFee: 10,
            processingFee: 3,
            taxable: 0,
        },
        3
    );
    assert(calc.guestFee === 257.5, `fixed listed fee = 257.50 (got ${calc.guestFee})`);
    assert(!calc.needsUnits, "fixed listed fee needs no units");
}

// --- Fixed Per Hour without hours: fall back to listed fee ---
{
    const calc = calculateGuestFee(
        {
            rateConfiguration: "Fixed Rate",
            chargeType: "Per Hour",
            listingFee: 28.33,
            actualFee: 20,
            pmFee: 10,
            processingFee: 3,
            taxable: 0,
        },
        2
    );
    assert(calc.guestFee === 28.33, `hourly listed fee fallback = 28.33 (got ${calc.guestFee})`);
}

// --- LOS Per Night with default rules: 3 nights → $60/night ---
{
    const calc = calculateGuestFee(
        {
            rateConfiguration: "Length of Stay",
            chargeType: "Per Night",
            pricingRules: JSON.stringify({
                rules: [
                    { id: "1", start: "1", end: "2", rate: "70" },
                    { id: "2", start: "3", end: "5", rate: "60" },
                    { id: "3", start: "6", end: "10", rate: "50" },
                    { id: "4", start: "11", end: "", rate: "40" },
                ],
            }),
            pmFee: 0,
            processingFee: 0,
            taxable: 0,
        },
        3
    );
    // 3 * 60 = 180 actual; with 0% PM/processing → guest 180
    assert(calc.guestFee === 180, `LOS 3 nights @60 = 180 (got ${calc.guestFee})`);
    assert(!calc.needsUnits, "LOS with nights should not need units");
}

// --- LOS without nights → escalate path ---
{
    const calc = calculateGuestFee(
        {
            rateConfiguration: "Length of Stay",
            chargeType: "Per Night",
            pmFee: 0,
            processingFee: 0,
        },
        0
    );
    assert(calc.guestFee == null && calc.needsUnits, "LOS without nights needs units");
}

// --- Prompt formatting respects SDTO ---
{
    const svc = new UpsellQuoteService();
    const { text } = svc.formatForPrompt([
        {
            upSellId: 1,
            title: "Early Check-In",
            sdtoRaw: "Not Allowed",
            sdto: "not_allowed",
            chargeType: "Per Stay",
            rateConfiguration: "Fixed Rate",
            guestFee: 100,
            unitLabel: "per stay",
            breakdown: [],
            autoRespond: "deny",
            description: null,
            isEarlyCheckin: true,
            isLateCheckout: false,
        },
        {
            upSellId: 2,
            title: "Late Check-Out",
            sdtoRaw: "Need Confirmation",
            sdto: "needs_confirmation",
            chargeType: "Per Stay",
            rateConfiguration: "Fixed Rate",
            guestFee: 100,
            unitLabel: "per stay",
            breakdown: [],
            autoRespond: "escalate",
            description: null,
            isEarlyCheckin: false,
            isLateCheckout: true,
        },
        {
            upSellId: 3,
            title: "Pool Heating",
            sdtoRaw: null,
            sdto: "allowed",
            chargeType: "Per Night",
            rateConfiguration: "Length of Stay",
            guestFee: 180,
            unitLabel: "3 nights",
            breakdown: ["3 × $60.00/night"],
            autoRespond: "quote",
            description: null,
            isEarlyCheckin: false,
            isLateCheckout: false,
        },
    ]);
    assert(!!text && text.includes("NOT ALLOWED"), "prompt includes NOT ALLOWED");
    assert(!!text && text.includes("NEEDS HUMAN CONFIRMATION"), "prompt includes needs confirmation");
    assert(!!text && text.includes("ALLOWED — guest fee $180.00"), "prompt includes allowed quote");
    assert(!!text && !/Pool Heating: NEEDS HUMAN/.test(text), "blank SDTO pool heating is quoteable");
}

if (failed) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("\nAll upsell quote logic checks passed.");
