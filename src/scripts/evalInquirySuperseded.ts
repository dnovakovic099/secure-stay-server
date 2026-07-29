/**
 * Fixture checks for inquiry-vs-accepted stay + NRN note helpers.
 * Run: npx ts-node src/scripts/evalInquirySuperseded.ts
 */
import {
    isAcceptedStayStatus,
    isInquiryLikeStatus,
    normalizeGuestName,
} from "../services/InboxInquirySuperseded";
import { isNoResponseNeededNoteText } from "../services/InboxNoResponseNeeded";

let pass = 0;
let fail = 0;

function check(name: string, got: any, want: any) {
    if (got === want) {
        pass += 1;
        console.log(`  pass  ${name}`);
    } else {
        fail += 1;
        console.log(`  FAIL  ${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
    }
}

console.log("inquiry-like statuses");
check("inquiry", isInquiryLikeStatus("inquiry"), true);
check("inquirypreapproved", isInquiryLikeStatus("inquirypreapproved"), true);
check("preapproved", isInquiryLikeStatus("preapproved"), true);
check("offer", isInquiryLikeStatus("offer"), true);
check("pending", isInquiryLikeStatus("pending"), true);
check("accepted is not inquiry", isInquiryLikeStatus("accepted"), false);
check("empty", isInquiryLikeStatus(""), false);

console.log("accepted stay statuses");
check("accepted", isAcceptedStayStatus("accepted"), true);
check("confirmed", isAcceptedStayStatus("confirmed"), true);
check("checked_in", isAcceptedStayStatus("checked_in"), true);
check("inquiry is not accepted", isAcceptedStayStatus("inquiry"), false);

console.log("guest name normalize (same-name match)");
check("casefold", normalizeGuestName("Stephanie Stephanie"), "stephanie stephanie");
check("trim spaces", normalizeGuestName("  DON AND JEN  "), "don and jen");
check("collapse ws", normalizeGuestName("Stephanie   Stephanie"), "stephanie stephanie");
check("empty", normalizeGuestName("   "), "");
check("same name equals", normalizeGuestName("Stephanie") === normalizeGuestName("stephanie"), true);
check("different names", normalizeGuestName("Stephanie") === normalizeGuestName("Elizabeth"), false);

console.log("no-response-needed notes");
check("exact", isNoResponseNeededNoteText("No response needed"), true);
check("upper", isNoResponseNeededNoteText("NO RESPONSE NEEDED"), true);
check("reply synonym", isNoResponseNeededNoteText("no reply needed - already booked elsewhere"), true);
check("nrn abbrev", isNoResponseNeededNoteText("NRN"), true);
check("unrelated note", isNoResponseNeededNoteText("Pre-approval sent"), false);
check("empty note", isNoResponseNeededNoteText(""), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
