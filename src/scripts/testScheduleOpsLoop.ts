/**
 * Smoke tests for ScheduleActionOpsLoopService classify + phone normalize.
 * Run: npx ts-node src/scripts/testScheduleOpsLoop.ts
 */
import { ScheduleActionOpsLoopService } from "../services/ScheduleActionOpsLoopService";

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

function main() {
    const cases: Array<{ text: string; expect: "accept" | "deny" | "unclear" }> = [
        { text: "Yes, ready by 2", expect: "accept" },
        { text: "Yep all set", expect: "accept" },
        { text: "No, not ready", expect: "deny" },
        { text: "Can't do early today", expect: "deny" },
        { text: "Yes but only after 4pm", expect: "unclear" },
        { text: "Maybe, call me", expect: "unclear" },
        { text: "", expect: "unclear" },
    ];

    for (const c of cases) {
        const got = ScheduleActionOpsLoopService.classifyCleanerReply(c.text);
        assert(got === c.expect, `classify("${c.text}") => ${got}, expected ${c.expect}`);
        console.log(`ok classify "${c.text}" => ${got}`);
    }

    assert(
        ScheduleActionOpsLoopService.normalizePhoneDigits("(773) 592-5234") === "7735925234",
        "normalize chicago cleaner"
    );
    assert(
        ScheduleActionOpsLoopService.normalizePhoneDigits("+17735925234") === "7735925234",
        "normalize e164"
    );
    assert(
        ScheduleActionOpsLoopService.normalizePhoneDigits("7735925234") === "7735925234",
        "normalize bare"
    );
    console.log("ok phone normalize");

    console.log("\nAll ScheduleActionOpsLoop smoke checks passed.");
}

main();
