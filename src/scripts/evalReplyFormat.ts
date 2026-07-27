/**
 * Regression check for guest-reply formatting (InboxAIReplyFormat).
 *
 *   npx ts-node src/scripts/evalReplyFormat.ts
 *
 * House style strips dashes from replies. The cases below pin the boundary:
 * prose loses its dashes, but anything a guest has to copy, tap, or type —
 * links, addresses, door codes, wifi passwords, dates — must survive intact.
 *
 * No database and no network.
 */
import { stripDashes } from "../services/InboxAIReplyFormat";

const CASES: { name: string; input: string; expect: string }[] = [
    {
        name: "url with hyphens survives",
        input: "Your guide is at https://secure-stay.com/check-in/abc-123",
        expect: "Your guide is at https://secure-stay.com/check-in/abc-123",
    },
    {
        name: "email survives",
        input: "Email us at front-desk@secure-stay.com anytime.",
        expect: "Email us at front-desk@secure-stay.com anytime.",
    },
    {
        name: "door code survives",
        input: "The door code is 4821-9930#",
        expect: "The door code is 4821-9930#",
    },
    {
        name: "wifi password survives",
        input: "Wi-Fi password: sunny-beach-2024",
        expect: "Wi Fi password: sunny-beach-2024",
    },
    {
        name: "iso date survives",
        input: "We have you booked 2026-07-24 to 2026-07-28.",
        expect: "We have you booked 2026-07-24 to 2026-07-28.",
    },
    {
        name: "ordinary compounds still lose the hyphen",
        input: "Check-in is at 4 PM and check-out is at 10 AM.",
        expect: "Check in is at 4 PM and check out is at 10 AM.",
    },
    {
        name: "spaced hyphen becomes a comma",
        input: "There is a kayak out back - feel free to use it.",
        expect: "There is a kayak out back, feel free to use it.",
    },
    {
        name: "em dash becomes a comma",
        input: "That works — I'll let the team know.",
        expect: "That works, I'll let the team know.",
    },
    {
        name: "numeric en dash range becomes 'to'",
        input: "Housekeeping comes 9\u201311 on Fridays.",
        expect: "Housekeeping comes 9 to 11 on Fridays.",
    },
    {
        name: "url mid-sentence keeps trailing punctuation outside",
        input: "Details are at https://secure-stay.com/faq-page. Let me know!",
        expect: "Details are at https://secure-stay.com/faq-page. Let me know!",
    },
];

let failed = 0;
console.log("Reply formatting — fixtures\n");
for (const c of CASES) {
    const got = stripDashes(c.input);
    const ok = got === c.expect;
    if (!ok) failed++;
    console.log(`  ${ok ? "pass" : "FAIL"}  ${c.name}`);
    if (!ok) {
        console.log(`        in:     ${JSON.stringify(c.input)}`);
        console.log(`        expect: ${JSON.stringify(c.expect)}`);
        console.log(`        got:    ${JSON.stringify(got)}`);
    }
}
console.log(`\n${CASES.length - failed}/${CASES.length} fixtures pass`);
process.exit(failed ? 1 : 0);
