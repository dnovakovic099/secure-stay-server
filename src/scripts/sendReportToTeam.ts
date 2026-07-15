import "dotenv/config";
import * as fs from "fs";
import { DailySalesReportService } from "../services/DailySalesReportService";
import { RealEstateApiService } from "../services/RealEstateApiService";

/**
 * One-off DB-free delivery: generate the full Daily Growth Leads report against
 * live APIs (no local DB needed) and DM the Slack blocks to Louis + Darko.
 * Also writes a plain-text summary to /tmp/atlas_sales_summary.txt for the
 * Atlas iMessage group send.
 *
 * Usage: npx ts-node-dev --transpile-only src/scripts/sendReportToTeam.ts
 */

const SLACK_DMS = [
  { name: "Darko", channel: "D0BHP7C2Y9E" },
  { name: "Louis", channel: "D0B4CECJUF4" },
];

const MARKETS = [
  { city: "Chicago", state: "IL" },
  { city: "East Brunswick", state: "NJ" },
  { city: "St. Petersburg", state: "FL" },
];

const MAX_SKIP_TRACES = Number(process.env.SALES_REPORT_MAX_SKIP_TRACES || 15);
const LEADS_PER_SECTION = Number(process.env.SALES_REPORT_LEADS_PER_SECTION || 5);

type Candidate = {
  category: string;
  market: string;
  property: any;
  hook: string;
  pitch: string;
  score: number;
  isCompany?: boolean;
};

async function enrichSection(
  realEstateApi: RealEstateApiService,
  candidates: Candidate[],
  budget: { remaining: number },
  seenContacts: { phones: Set<string>; propertyIds: Set<string> },
  nextId: { value: number }
): Promise<any[]> {
  // Mirrors DailySalesReportService.enrichWithContacts, minus DB persistence.
  const personOwned = candidates.filter((c) => !c.isCompany);
  const companyOwned = candidates.filter((c) => c.isCompany);
  const leads: any[] = [];
  const peopleTarget = Math.max(1, LEADS_PER_SECTION - 1);

  for (const candidate of personOwned) {
    if (leads.length >= peopleTarget) break;
    if (budget.remaining <= 0) break;

    const p = candidate.property;
    if (p.id && seenContacts.propertyIds.has(p.id)) continue;

    const lastName = RealEstateApiService.cleanName(p.owner1LastName);
    const firstName = RealEstateApiService.cleanName(p.owner1FirstName);
    if (!lastName) continue;

    budget.remaining -= 1;
    const preferMail = Boolean(p.absenteeOwner || p.outOfStateAbsenteeOwner || !p.ownerOccupied);
    const maxAttempts = budget.remaining >= 1 ? 2 : 1;

    const { result: trace, attempts } = await realEstateApi.skipTraceOwner({
      firstName,
      lastName,
      coOwnerLastName: RealEstateApiService.cleanName(p.owner2LastName),
      property: {
        street: p.address.street,
        city: p.address.city,
        state: p.address.state,
        zip: p.address.zip,
      },
      mail: p.mailAddress,
      preferMail,
      maxAttempts,
    });
    if (attempts > 1) budget.remaining = Math.max(0, budget.remaining - (attempts - 1));

    const bestPhone =
      trace?.phones?.find((ph: any) => !seenContacts.phones.has(ph.phone)) ||
      trace?.phones?.[0] ||
      null;
    const bestEmail = trace?.emails?.[0] || null;
    if (!bestPhone && !bestEmail) continue;
    if (bestPhone && seenContacts.phones.has(bestPhone.phone) && !bestEmail) continue;

    const ownerName =
      trace?.fullName || [firstName, lastName].filter(Boolean).join(" ") || "Unknown";

    if (p.id) seenContacts.propertyIds.add(p.id);
    if (bestPhone?.phone) seenContacts.phones.add(bestPhone.phone);

    leads.push({
      id: nextId.value++,
      category: candidate.category,
      market: candidate.market,
      ownerName,
      phone: bestPhone?.phoneDisplay || null,
      phoneType: bestPhone?.phoneType || null,
      phoneDnc: Boolean(bestPhone?.doNotCall),
      email: bestEmail,
      propertyAddress: p.address.address,
      city: p.address.city,
      state: p.address.state,
      zip: p.address.zip,
      hook: candidate.hook,
      pitch: candidate.pitch,
      score: candidate.score,
      status: "new",
    });
  }

  // One entity whale slot, mail-reachable only.
  for (const candidate of companyOwned) {
    if (leads.length >= LEADS_PER_SECTION) break;
    const p = candidate.property;
    if (p.id && seenContacts.propertyIds.has(p.id)) continue;
    const mailAddress = p.mailAddress?.address
      ? `${p.mailAddress.address}${
          p.mailAddress.city
            ? `, ${p.mailAddress.city}, ${p.mailAddress.state} ${p.mailAddress.zip || ""}`
            : ""
        }`.trim()
      : null;
    if (!mailAddress) continue;

    const ownerName =
      [p.owner1FirstName, p.owner1LastName].filter(Boolean).join(" ") || "Unknown entity";
    if (p.id) seenContacts.propertyIds.add(p.id);
    leads.push({
      id: nextId.value++,
      category: candidate.category,
      market: candidate.market,
      ownerName,
      phone: null,
      phoneType: null,
      phoneDnc: false,
      email: null,
      propertyAddress: p.address.address,
      city: p.address.city,
      state: p.address.state,
      zip: p.address.zip,
      hook: `${candidate.hook} Entity owner — mail to ${mailAddress}, or pull the registered agent from the state business registry.`,
      pitch: candidate.pitch,
      score: candidate.score,
      status: "new",
    });
    break;
  }

  return leads;
}

async function postSlack(
  channel: string,
  text: string,
  blocks: any[]
): Promise<{ ok: boolean; ts?: string; permalink?: string }> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel, text, blocks }),
  });
  const j: any = await res.json();
  if (!j.ok) {
    console.error(`Slack post to ${channel} failed:`, j.error);
    return { ok: false };
  }
  let permalink: string | undefined;
  try {
    const pl = await fetch(
      `https://slack.com/api/chat.getPermalink?channel=${channel}&message_ts=${j.ts}`,
      { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } }
    );
    const pj: any = await pl.json();
    if (pj.ok) permalink = pj.permalink;
  } catch {}
  return { ok: true, ts: j.ts, permalink };
}

async function main() {
  const service: any = new DailySalesReportService();
  const realEstateApi: RealEstateApiService = service.realEstateApi;

  const sections: Array<{ category: string; finder: (m: any) => Promise<Candidate[]> }> = [
    { category: "arbitrage", finder: (m) => service.findArbitrageWhales(m) },
    { category: "acquisition", finder: (m) => service.findMotivatedSellers(m) },
    { category: "property_management", finder: (m) => service.findPmProspects(m) },
  ];

  const seenContacts = { phones: new Set<string>(), propertyIds: new Set<string>() };
  const nextId = { value: 1 };
  const leadsByCategory = new Map<string, any[]>();
  const baseBudget = Math.floor(MAX_SKIP_TRACES / sections.length);
  let carry = MAX_SKIP_TRACES % sections.length;

  for (const section of sections) {
    let candidates: Candidate[] = [];
    for (const market of MARKETS) {
      try {
        candidates = candidates.concat(await section.finder(market));
      } catch (err: any) {
        console.error(`${section.category} finder failed for ${market.city}: ${err.message}`);
      }
    }
    candidates.sort((a, b) => {
      if (Boolean(a.isCompany) !== Boolean(b.isCompany)) return a.isCompany ? 1 : -1;
      return b.score - a.score;
    });
    // In-run dedupe by address (no DB for the 90-day window here).
    const seenAddr = new Set<string>();
    candidates = candidates.filter((c) => {
      const key = String(c.property?.address?.address || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      if (key.length < 8 || seenAddr.has(key)) return false;
      seenAddr.add(key);
      return true;
    });

    const budget = { remaining: baseBudget + carry };
    const leads = await enrichSection(realEstateApi, candidates, budget, seenContacts, nextId);
    carry = budget.remaining;
    leadsByCategory.set(section.category, leads);
    console.log(`${section.category}: ${candidates.length} candidates -> ${leads.length} leads`);
  }

  const blocks = service.buildSlackBlocks(leadsByCategory, [], MARKETS, realEstateApi.errors);

  // Persist the full run so results are auditable after the fact.
  const allLeads = Array.from(leadsByCategory.entries()).flatMap(([cat, leads]) =>
    leads.map((l) => ({ ...l, category: cat }))
  );
  fs.writeFileSync(
    "/tmp/atlas_sales_leads.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), leads: allLeads, blocks }, null, 2)
  );

  const withPhone = allLeads.filter((l) => l.phone);
  const dnc = withPhone.filter((l) => l.phoneDnc);
  console.log(
    `\nDNC audit: ${allLeads.length} leads, ${withPhone.length} with phone, ${dnc.length} DNC-flagged, ${withPhone.length - dnc.length} clear to dial`
  );

  const totalLeads = allLeads.length;
  const text = `Daily Growth Leads — ${totalLeads} new leads with contact info`;

  for (const dm of SLACK_DMS) {
    const r = await postSlack(dm.channel, text, blocks);
    console.log(`Slack DM to ${dm.name}: ${r.ok ? "sent" : "FAILED"} ${r.permalink || ""}`);
  }

  // Plain-text summary for the Atlas iMessage group.
  const dialable = Array.from(leadsByCategory.values())
    .flat()
    .filter((l) => l.phone && !l.phoneDnc);
  const top = [...dialable].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3);
  const counts = ["arbitrage", "acquisition", "property_management"]
    .map((c) => `${(leadsByCategory.get(c) || []).length} ${c.replace("property_management", "PM").replace("acquisition", "acq").replace("arbitrage", "arb")}`)
    .join(", ");
  const lines = [
    `Atlas — Daily Growth Leads (${MARKETS.map((m) => m.city).join(", ")})`,
    `${totalLeads} new leads today: ${counts}. ${dialable.length} dialable now.`,
    ...top.map(
      (l, i) =>
        `${i + 1}) ${l.ownerName} ${l.phone} — ${String(l.hook).split(".")[0]}.`
    ),
    `Full report is in your Slack DMs.`,
  ];
  fs.writeFileSync("/tmp/atlas_sales_summary.txt", lines.join("\n"));
  console.log("\n--- SMS summary ---\n" + lines.join("\n"));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
