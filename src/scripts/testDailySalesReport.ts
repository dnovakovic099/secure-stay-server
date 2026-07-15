import "dotenv/config";
import { initDatabase, appDatabase } from "../utils/database.util";
import { DailySalesReportService } from "../services/DailySalesReportService";

// Smoke test: one market, small skip-trace budget, prints saved leads.
// Usage: npx ts-node-dev --transpile-only src/scripts/testDailySalesReport.ts
async function main() {
  process.env.SALES_REPORT_MARKETS = process.env.SALES_REPORT_MARKETS || "Tampa,FL";
  process.env.SALES_REPORT_MAX_SKIP_TRACES = process.env.SALES_REPORT_MAX_SKIP_TRACES || "6";

  await initDatabase();
  const service = new DailySalesReportService();
  const result = await service.runDailyReport();
  console.log("\n=== RUN RESULT ===");
  console.log(JSON.stringify(result, null, 2));

  const leads = await appDatabase.query(
    `SELECT category, ownerName, phone, phoneType, phoneDnc, email, propertyAddress, hook
     FROM sales_leads WHERE reportDate = CURDATE() AND status != 'no_contact'
     ORDER BY category, score DESC`
  );
  console.log("\n=== TODAY'S LEADS ===");
  for (const lead of leads) {
    console.log(
      `\n[${lead.category}] ${lead.ownerName} — ${lead.phone} (${lead.phoneType})${lead.phoneDnc ? " [DNC]" : ""}${lead.email ? " — " + lead.email : ""}`
    );
    console.log(`  ${lead.propertyAddress}`);
    console.log(`  ${lead.hook}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
