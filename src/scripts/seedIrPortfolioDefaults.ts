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

    // Repair known portfolio phones if older null-phone duplicate rows linger.
    const repairs = [
        { name: "ana", phone: "(773) 592-5234", cities: ["Chicago", "Elmwood Park", "Lombard"] },
        { name: "miguel", phone: "(773) 243-9091", cities: ["Chicago", "Elmwood Park", "Lombard"] },
        { name: "diana", phone: "(813) 830-3287", cities: ["Tampa", "Bradenton", "St. Petersburg", "Largo", "Clearwater", "Madeira Beach"] },
        { name: "rodolfo", phone: "(813) 947-4704", cities: ["Tampa", "Bradenton", "St. Petersburg", "Largo", "Clearwater", "Madeira Beach"] },
    ];
    for (const r of repairs) {
        await conn.query(
            `UPDATE ir_vendor_memory
             SET phone = ?, updatedAt = NOW()
             WHERE normalizedName = ?
               AND LOWER(TRIM(city)) IN (${r.cities.map(() => "?").join(",")})
               AND (phone IS NULL OR TRIM(phone) = '')`,
            [r.phone, r.name, ...r.cities.map((c) => c.toLowerCase())]
        );
    }

    // Purge junk rows that pollute ranking (literal "null" names, empty phones with no email).
    const [purgeBad]: any = await conn.query(
        `DELETE FROM ir_vendor_memory
         WHERE vendorName IS NULL
            OR TRIM(vendorName) = ''
            OR LOWER(TRIM(vendorName)) IN ('null', 'undefined', 'n/a', 'none', 'unknown', '(null)')
            OR normalizedName IN ('null', 'undefined', 'n a', 'none', 'unknown')`
    );
    const [purgeEmpty]: any = await conn.query(
        `DELETE FROM ir_vendor_memory
         WHERE (phone IS NULL OR TRIM(phone) = '')
           AND (email IS NULL OR TRIM(email) = '')
           AND COALESCE(source, '') NOT IN ('teach', 'feedback', 'seed')`
    );
    console.log(
        `Cleanup: bad_name_deleted=${purgeBad?.affectedRows ?? 0} empty_shell_deleted=${purgeEmpty?.affectedRows ?? 0}`
    );

    await conn.end();
    console.log(`Done. Total upserts: ${total}`);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
