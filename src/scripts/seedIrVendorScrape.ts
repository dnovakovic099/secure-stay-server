/**
 * Seed high-trust rows from the 90d Quo+ticket vendor scrape into ir_vendor_memory.
 * Uses mysql2 directly (no TypeORM/subscribers/Redis) so deploy seeds stay fast.
 *
 * Usage:
 *   npx ts-node src/scripts/seedIrVendorScrape.ts
 *   npx ts-node src/scripts/seedIrVendorScrape.ts --dry-run
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import mysql from "mysql2/promise";

type ScrapePerson = {
    name?: string;
    phone?: string;
    role?: string;
    trust?: string;
    cities?: string[];
    category?: string;
};

const BOGUS_NPAS = new Set([
    "000", "111", "222", "333", "444", "555", "666", "777", "778", "779", "888", "999",
]);

function normalizeName(name: string): string {
    return String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function sanitizePhone(phone: string | undefined): string | null {
    let d = String(phone || "").replace(/\D/g, "");
    if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    if (d.length !== 10) return null;
    if (BOGUS_NPAS.has(d.slice(0, 3))) return null;
    if (/^(\d)\1{9}$/.test(d)) return null;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function roleToCategory(role: string | undefined): string {
    const r = String(role || "").toLowerCase();
    if (/clean/.test(r)) return "CLEANLINESS";
    if (/pest/.test(r)) return "PEST CONTROL";
    if (/pool|spa/.test(r)) return "POOL AND SPA";
    if (/lock|access/.test(r)) return "PROPERTY ACCESS";
    if (/hvac|ac\b|heat/.test(r)) return "HVAC";
    if (/landscap|lawn/.test(r)) return "LANDSCAPING";
    if (/suppl/.test(r)) return "SUPPLIES";
    return "MAINTENANCE";
}

async function main() {
    const dryRun = process.argv.includes("--dry-run");
    const candidates = [
        path.join(process.cwd(), "src/data/vendor-list-90d-2026-07-24.json"),
        path.join(__dirname, "../data/vendor-list-90d-2026-07-24.json"),
        path.join(process.cwd(), "tmp/vendor-list-90d-2026-07-24.json"),
    ];
    const jsonPath = candidates.find((p) => fs.existsSync(p));
    if (!jsonPath) throw new Error(`Missing scrape file. Tried: ${candidates.join(", ")}`);
    console.log(`Using scrape file: ${jsonPath}`);

    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const byCity: Record<string, ScrapePerson[]> = data.byCity || {};

    const rows: Array<{
        vendorName: string;
        normalizedName: string;
        phone: string;
        category: string;
        city: string;
        role: string | null;
        notes: string;
    }> = [];

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
            const vendorName = String(person.name || "").trim();
            const phone = sanitizePhone(person.phone);
            const normalizedName = normalizeName(vendorName);
            if (!vendorName || !phone || !normalizedName) {
                skipped += 1;
                continue;
            }
            rows.push({
                vendorName,
                normalizedName,
                phone,
                category: roleToCategory(person.role || person.category),
                city,
                role: person.role || null,
                notes: `seeded from vendor-list-90d trust=${person.trust || "n/a"}`,
            });
        }
    }

    console.log(`Prepared ${rows.length} rows (skipped ${skipped})`);
    if (dryRun) {
        for (const r of rows.slice(0, 20)) {
            console.log(`[dry-run] ${r.city} · ${r.vendorName} · ${r.phone} · ${r.category}`);
        }
        if (rows.length > 20) console.log(`…and ${rows.length - 20} more`);
        process.exit(0);
    }

    const conn = await mysql.createConnection({
        host: process.env.DATABASE_URL,
        port: Number(process.env.DATABASE_PORT || 3306),
        user: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME,
        charset: "utf8mb4",
    });

    let upserts = 0;
    const chunkSize = 40;
    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const values: any[] = [];
        const placeholders = chunk
            .map((r) => {
                values.push(
                    r.vendorName,
                    r.normalizedName,
                    r.phone,
                    r.category,
                    r.city,
                    r.role,
                    "scrape_90d",
                    r.notes
                );
                return "(?, ?, ?, NULL, ?, ?, ?, 1, NOW(), ?, NULL, ?, NOW(), NOW())";
            })
            .join(",");

        await conn.query(
            `INSERT INTO ir_vendor_memory
              (vendorName, normalizedName, phone, email, category, city, role, useCount, lastUsedAt, source, sourceIssueId, notes, createdAt, updatedAt)
             VALUES ${placeholders}
             ON DUPLICATE KEY UPDATE
               phone = IF(VALUES(phone) IS NOT NULL AND VALUES(phone) <> '', VALUES(phone), phone),
               role = COALESCE(VALUES(role), role),
               source = VALUES(source),
               notes = VALUES(notes),
               useCount = useCount + 1,
               lastUsedAt = NOW(),
               updatedAt = NOW()`,
            values
        );
        upserts += chunk.length;
        console.log(`Upserted ${Math.min(i + chunkSize, rows.length)}/${rows.length}`);
    }

    await conn.end();
    console.log(`Done. upserts=${upserts} skipped=${skipped}`);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
