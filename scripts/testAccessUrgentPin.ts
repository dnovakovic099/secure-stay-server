/**
 * Offline checks for InboxUrgentPinService access detection.
 * Run: npx ts-node scripts/testAccessUrgentPin.ts
 */
import { InboxUrgentPinService } from "../src/services/InboxUrgentPinService";

let failed = 0;
function assert(cond: boolean, msg: string) {
    if (!cond) {
        failed += 1;
        console.error(`FAIL: ${msg}`);
    } else {
        console.log(`OK:   ${msg}`);
    }
}

const dale =
    "I am still in transit but my daughter Laura is there and the code to the back house is not working. The first 3 digits are green lit but the last digit comes up red. Can you help us with that? We paid for 4 bedrooms. Thanks!";

assert(InboxUrgentPinService.detectsAccess(dale), "Dale lockout message → access");
assert(InboxUrgentPinService.detectsAccess("the code is not working"), "code is not working");
assert(InboxUrgentPinService.detectsAccess("can't get in"), "can't get in");
assert(InboxUrgentPinService.detectsAccess("we are locked out"), "locked out");
assert(InboxUrgentPinService.detectsAccess("last digit comes up red"), "keypad red digit");
assert(!InboxUrgentPinService.detectsAccess("how many bedrooms do we have"), "bedrooms ask is not access");
assert(!InboxUrgentPinService.detectsAccess("what's the wifi password"), "wifi ask is not access");

const pin = new InboxUrgentPinService().classify(dale, {
    checkin: "2026-07-21",
    checkout: "2026-07-26",
} as any);
assert(pin?.type === "access", `classify Dale → access (got ${pin?.type})`);

if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
}
console.log("\nAll access urgent-pin checks passed.");
