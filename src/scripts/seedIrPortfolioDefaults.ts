/**
 * Seed Chicago + Tampa-area portfolio cleaner/handyman defaults into ir_vendor_memory.
 * Uses mysql2 directly (no TypeORM/subscribers/Redis).
 *
 * Usage:
 *   npx ts-node src/scripts/seedIrPortfolioDefaults.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const REGIONS = [
    {
        cities: ["Chicago", "Elmwood Park", "Lombard"],
        defaults: [
            { vendorName: "Ana", phone: "(773) 592-5234", category: "CLEANLINESS", role: "Cleaner" },
            { vendorName: "Miguel", phone: "(773) 243-9091", category: "MAINTENANCE", role: "Handyman" },
        ],
    },
    {
        cities: ["Tampa", "Bradenton", "St. Petersburg", "Largo", "Clearwater", "Madeira Beach"],
        defaults: [
            { vendorName: "Diana", phone: "(813) 830-3287", category: "CLEANLINESS", role: "Cleaner" },
            { vendorName: "Rodolfo", phone: "(813) 947-4704", category: "MAINTENANCE", role: "Handyman" },
        ],
    },
];

function normalizeName(name: string): string {
    return String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DATABASE_URL,
        port: Number(process.env.DATABASE_PORT || 3306),
        user: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME,
        charset: "utf8mb4",
    });

    let total = 0;
    for (const region of REGIONS) {
        for (const city of region.cities) {
            for (const d of region.defaults) {
                const normalizedName = normalizeName(d.vendorName);
                await conn.query(
                    `INSERT INTO ir_vendor_memory
                      (vendorName, normalizedName, phone, email, category, city, role, useCount, lastUsedAt, source, sourceIssueId, notes, createdAt, updatedAt)
                     VALUES (?, ?, ?, NULL, ?, ?, ?, 1, NOW(), 'seed', NULL, ?, NOW(), NOW())
                     ON DUPLICATE KEY UPDATE
                       phone = IF(VALUES(phone) IS NOT NULL AND VALUES(phone) <> '', VALUES(phone), phone),
                       role = COALESCE(VALUES(role), role),
                       source = IF(source = 'seed' OR phone IS NULL OR phone = '', 'seed', source),
                       lastUsedAt = NOW(),
                       updatedAt = NOW()`,
                    [
                        d.vendorName,
                        normalizedName,
                        d.phone,
                        d.category,
                        city,
                        d.role,
                        "portfolio city default",
                    ]
                );
                total += 1;
            }
            console.log(`${city}: upserted ${region.defaults.length}`);
        }
    }

    await conn.end();
    console.log(`Done. Total upserts: ${total}`);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
