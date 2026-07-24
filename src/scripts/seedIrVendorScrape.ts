/**
 * Seed high-trust rows from the 90d Quo+ticket vendor scrape into ir_vendor_memory.
 *
 * Usage (from secure-stay-server):
 *   npx ts-node src/scripts/seedIrVendorScrape.ts
 *   npx ts-node src/scripts/seedIrVendorScrape.ts --dry-run
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { appDatabase } from "../utils/database.util";
import { IssueAIService } from "../services/IssueAIService";

type ScrapePerson = {
    name?: string;
    phone?: string;
    role?: string;
    trust?: string;
    cities?: string[];
    category?: string;
};

function roleToCategory(role: string | undefined): string {
    const r = String(role || "").toLowerCase();
    if (/clean/.test(r)) return "CLEANLINESS";
    if (/pest/.test(r)) return "PEST CONTROL";
    if (/pool|spa/.test(r)) return "POOL AND SPA";
    if (/lock|access/.test(r)) return "PROPERTY ACCESS";
    if (/plumb/.test(r)) return "MAINTENANCE";
    if (/hvac|ac\b|heat/.test(r)) return "HVAC";
    if (/landscap|lawn/.test(r)) return "LANDSCAPING";
    if (/suppl/.test(r)) return "SUPPLIES";
    if (/maint|handy|repair|vendor/.test(r)) return "MAINTENANCE";
    return "MAINTENANCE";
}

async function main() {
    const dryRun = process.argv.includes("--dry-run");
    const jsonPath = path.join(__dirname, "../../tmp/vendor-list-90d-2026-07-24.json");
    if (!fs.existsSync(jsonPath)) {
        throw new Error(`Missing scrape file: ${jsonPath}`);
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const byCity: Record<string, ScrapePerson[]> = data.byCity || {};

    await appDatabase.initialize();
    const svc = new IssueAIService();

    let upserts = 0;
    let skipped = 0;
    for (const [city, people] of Object.entries(byCity)) {
        if (!city || city === "(unknown city)") {
            skipped += (people || []).length;
            continue;
        }
        for (const person of people || []) {
            const trust = String(person.trust || "").toLowerCase();
            if (trust && trust !== "high" && trust !== "medium") {
                skipped += 1;
                continue;
            }
            const name = String(person.name || "").trim();
            const phone = String(person.phone || "").trim();
            if (!name || !phone) {
                skipped += 1;
                continue;
            }
            const category = roleToCategory(person.role || person.category);
            if (dryRun) {
                console.log(`[dry-run] ${city} · ${name} · ${phone} · ${category} · ${person.role || ""}`);
                upserts += 1;
                continue;
            }
            const row = await svc.upsertVendorMemory({
                vendorName: name,
                phone,
                category,
                city,
                role: person.role || null,
                source: "scrape_90d",
                notes: `seeded from vendor-list-90d trust=${person.trust || "n/a"}`,
            });
            if (row) upserts += 1;
            else skipped += 1;
        }
    }

    console.log(`Done. upserts=${upserts} skipped=${skipped} dryRun=${dryRun}`);
    await appDatabase.destroy();
}

main().catch(async (err) => {
    console.error(err);
    try {
        await appDatabase.destroy();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
