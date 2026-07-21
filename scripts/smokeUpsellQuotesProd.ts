/**
 * Live smoke test against the app DB for UpsellQuoteService.
 * Run on EC2 (or locally with .env): npx ts-node scripts/smokeUpsellQuotesProd.ts
 */
import "dotenv/config";
import { appDatabase } from "../src/utils/database.util";
import { UpsellQuoteService, nightCountFromStay } from "../src/services/UpsellQuoteService";

async function main() {
    await appDatabase.initialize();

    // Schema checks for autosend mute migration
    const colsLd = await appDatabase.query(
        "SHOW COLUMNS FROM listing_details LIKE 'aiAutoRespondDisabled'"
    );
    const colsIc = await appDatabase.query(
        "SHOW COLUMNS FROM inbox_conversations LIKE 'aiAutoRespondDisabled'"
    );
    const guestTable = await appDatabase.query("SHOW TABLES LIKE 'ai_guest_autosend_disable'");
    console.log("schema.listing_details.aiAutoRespondDisabled:", colsLd?.length > 0 ? "OK" : "MISSING");
    console.log("schema.inbox_conversations.aiAutoRespondDisabled:", colsIc?.length > 0 ? "OK" : "MISSING");
    console.log("schema.ai_guest_autosend_disable:", guestTable?.length > 0 ? "OK" : "MISSING");

    // Find 101st - Kurush (screenshot property with LOS pool heating)
    const listings: any[] = await appDatabase.query(
        `SELECT id, name, internalListingName FROM listings
         WHERE COALESCE(internalListingName, name) LIKE '%101st%Kurush%'
            OR COALESCE(internalListingName, name) LIKE '%101st%'
         LIMIT 10`
    );
    console.log(
        "candidate listings:",
        listings.map((l) => `${l.id}:${l.internalListingName || l.name}`).join(" | ") || "(none)"
    );

    let listingId = listings[0]?.id ? Number(listings[0].id) : null;
    if (!listingId) {
        // Fallback: any listing with an LOS upsell config
        const los: any[] = await appDatabase.query(
            `SELECT listingId FROM upsell_property_config
             WHERE rateConfiguration LIKE '%Length%' OR rateConfiguration = 'LOS'
             LIMIT 1`
        );
        listingId = los[0]?.listingId != null ? Number(los[0].listingId) : null;
    }
    if (!listingId) {
        console.error("No listing found to smoke-test");
        process.exit(1);
    }

    const svc = new UpsellQuoteService();
    const nights = 3;
    const quotes = await svc.listQuotesForListing({
        listingId,
        nights,
        checkin: "2026-08-01",
        checkout: "2026-08-04",
    });
    console.log(`\nlisting=${listingId} nights=${nightCountFromStay("2026-08-01", "2026-08-04", nights)}`);
    console.log(`quotes=${quotes.length}`);
    for (const q of quotes) {
        console.log(
            ` - ${q.title} | sdto=${q.sdtoRaw || "(blank)"}→${q.sdto} | auto=${q.autoRespond} | fee=${
                q.guestFee != null ? `$${q.guestFee}` : "null"
            } | ${q.chargeType}/${q.rateConfiguration}`
        );
    }

    const { text } = svc.formatForPrompt(quotes);
    console.log("\n--- prompt excerpt ---");
    console.log((text || "(empty)").split("\n").slice(0, 20).join("\n"));

    // Assertions
    let failed = 0;
    const deny = quotes.filter((q) => q.sdto === "not_allowed");
    const confirm = quotes.filter((q) => q.sdto === "needs_confirmation");
    const quoteable = quotes.filter((q) => q.autoRespond === "quote");
    if (deny.some((q) => q.autoRespond !== "deny")) {
        console.error("FAIL: not_allowed must deny");
        failed++;
    } else console.log("OK: not_allowed → deny");
    if (confirm.some((q) => q.autoRespond !== "escalate")) {
        console.error("FAIL: needs_confirmation must escalate");
        failed++;
    } else console.log("OK: needs_confirmation → escalate");
    if (quoteable.some((q) => q.guestFee == null)) {
        console.error("FAIL: quoteable rows must have guestFee");
        failed++;
    } else console.log(`OK: ${quoteable.length} quoteable with fees`);

    const blankAllowed = quotes.filter((q) => !q.sdtoRaw || !String(q.sdtoRaw).trim());
    if (blankAllowed.some((q) => q.sdto !== "allowed")) {
        console.error("FAIL: blank SDTO must normalize to allowed");
        failed++;
    } else console.log(`OK: ${blankAllowed.length} blank SDTO → allowed`);

    await appDatabase.destroy();
    if (failed) process.exit(1);
    console.log("\nProd smoke checks passed.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
