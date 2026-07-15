import "dotenv/config";
import { DailySalesReportService } from "../services/DailySalesReportService";
import { RealEstateApiService } from "../services/RealEstateApiService";

// DB-free dry run against live APIs. No rows saved, no Slack post.
// Usage: npx ts-node-dev --transpile-only src/scripts/testDailySalesReportDryRun.ts
async function main() {
  const market = {
    city: process.env.TEST_MARKET_CITY || "Tampa",
    state: process.env.TEST_MARKET_STATE || "FL",
  };
  const service: any = new DailySalesReportService();
  const realEstateApi = new RealEstateApiService();

  const sections = [
    { name: "ARBITRAGE — LANDLORD WHALES", candidates: await service.findArbitrageWhales(market) },
    { name: "ACQUISITION — MOTIVATED SELLERS", candidates: await service.findMotivatedSellers(market) },
    { name: "PM PROSPECTS — NEW ABSENTEE BUYERS", candidates: await service.findPmProspects(market) },
  ];

  for (const section of sections) {
    const companies = section.candidates.filter((c: any) => c.isCompany).length;
    console.log(
      `\n========== ${section.name} (${section.candidates.length} candidates, ${companies} entity-owned) ==========`
    );
    const people = section.candidates.filter((c: any) => !c.isCompany).slice(0, 2);
    const entities = section.candidates.filter((c: any) => c.isCompany).slice(0, 1);

    for (const candidate of people) {
      const p = candidate.property;
      const preferMail = Boolean(p.absenteeOwner || p.outOfStateAbsenteeOwner || !p.ownerOccupied);
      const { result: trace, attempts } = await realEstateApi.skipTraceOwner({
        firstName: p.owner1FirstName,
        lastName: p.owner1LastName,
        coOwnerLastName: p.owner2LastName,
        property: {
          street: p.address.street,
          city: p.address.city,
          state: p.address.state,
          zip: p.address.zip,
        },
        mail: p.mailAddress,
        preferMail,
        maxAttempts: 2,
      });
      const phone = trace?.phones?.[0];
      const name =
        trace?.fullName || [p.owner1FirstName, p.owner1LastName].filter(Boolean).join(" ");
      console.log(
        `\n  ${name || "Unknown"} — ${
          phone
            ? `${phone.phoneDisplay} (${phone.phoneType})${phone.doNotCall ? " [DNC]" : ""}`
            : "NO PHONE FOUND"
        }${trace?.emails?.[0] ? ` — ${trace.emails[0]}` : ""}  [via ${trace?.matchedVia || "none"}, ${attempts} attempt(s)]`
      );
      console.log(`  ${p.address.address}`);
      console.log(`  ${candidate.hook}`);
      console.log(`  ${candidate.pitch}`);
    }

    for (const candidate of entities) {
      const p = candidate.property;
      const owner =
        [p.owner1FirstName, p.owner1LastName].filter(Boolean).join(" ") || "Unknown entity";
      console.log(
        `\n  [ENTITY] ${owner} — mail: ${p.mailAddress?.address || "n/a"}, ${p.mailAddress?.city || ""} ${p.mailAddress?.state || ""}`
      );
      console.log(`  ${p.address.address}`);
      console.log(`  ${candidate.hook}`);
    }
  }

  // Company-name / trust false-positive sanity check
  const peopleNames = ["John Homes", "Mary Estates", "Bob Co", "Sam Group", "William Trust", "Rudolph Twiggs"];
  const trustNames = ["Colt 2022 5 Trust", "None Citibank Na Trust", "Smith Family Trust"];
  const companyPattern =
    /\b(llc|l\.?\s*l\.?\s*c\.?|inc\.?|corp\.?|corporation|ltd\.?|l\.?\s*p\.?|llp|company|holdings|investments|construction|builders|management|apartments|housing|properties)\b/i;
  const isTrust = (full: string) => {
    if (!/\btrust\b/i.test(full)) return false;
    const parts = full.split(/\s+/);
    const first = parts[0];
    if (!first || /^none$/i.test(first)) return true;
    if (/\d/.test(full)) return true;
    if (/\b(living|revocable|irrevocable|family|testamentary)\b/i.test(full)) return true;
    return false;
  };
  const falsePos = peopleNames.filter((n) => companyPattern.test(n) || isTrust(n));
  const trustHits = trustNames.filter((n) => isTrust(n) || companyPattern.test(n));
  console.log(`\nPeople false positives: ${falsePos.length ? falsePos.join(", ") : "none"}`);
  console.log(`Trust entities detected: ${trustHits.join(", ") || "none"}`);
  console.log(`cleanName("None") =>`, JSON.stringify(RealEstateApiService.cleanName("None")));

  if (realEstateApi.errors.length) {
    console.log(`\nAPI errors: ${realEstateApi.errors.join(" | ")}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
