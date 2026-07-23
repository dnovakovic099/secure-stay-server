/**
 * Offline sanity checks for scheduled-message AI directive wiring.
 * Run: npx ts-node scripts/testScheduledMessageDirective.ts
 */
import * as fs from "fs";
import * as path from "path";

let failed = 0;
function assert(cond: boolean, msg: string) {
    if (!cond) {
        failed += 1;
        console.error(`FAIL: ${msg}`);
    } else {
        console.log(`OK:   ${msg}`);
    }
}

const root = path.join(__dirname, "..");
const entity = fs.readFileSync(path.join(root, "src/entity/AutoMessageRule.ts"), "utf8");
const service = fs.readFileSync(path.join(root, "src/services/AutoMessageService.ts"), "utf8");
const migration = fs.readFileSync(
    path.join(root, "src/migrations/20260723_auto_message_ai_directive.sql"),
    "utf8"
);
const notif = fs.readFileSync(path.join(root, "src/services/UserNotificationService.ts"), "utf8");

assert(entity.includes("aiDirective"), "entity has aiDirective");
assert(entity.includes("aiSkipIfInappropriate"), "entity has aiSkipIfInappropriate");
assert(migration.includes("aiDirective"), "migration adds aiDirective");
assert(migration.includes("aiSkipIfInappropriate"), "migration adds aiSkipIfInappropriate");
assert(service.includes("adaptMessageAtSendTime"), "service adapts at send time");
assert(service.includes("recordScheduleSkipInThread"), "service writes thread system error");
assert(service.includes('type: "scheduled_message"'), "service emits scheduled_message notification");
assert(service.includes('status = "skipped"'), "service marks log skipped");
assert(notif.includes("scheduled_message"), "notification union includes scheduled_message");

// Ensure create/update persist the new fields
assert(service.includes("aiDirective: input.aiDirective"), "create maps aiDirective");
assert(service.includes("aiSkipIfInappropriate: input.aiSkipIfInappropriate"), "create maps skip flag");
assert(service.includes("if (patch.aiDirective !== undefined)"), "update patches aiDirective");

if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
}
console.log("\nAll scheduled-message directive checks passed.");
