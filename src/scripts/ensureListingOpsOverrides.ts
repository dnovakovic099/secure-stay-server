/**
 * Ensure listing_ops_overrides exists. Optionally seed known quarantines.
 *
 *   npx ts-node --transpile-only src/scripts/ensureListingOpsOverrides.ts
 */
import "reflect-metadata";
import "dotenv/config";

async function main() {
    process.env.NODE_ENV = "development";
    const { ListingOpsOverrideService } = await import("../services/ListingOpsOverrideService");
    const { appDatabase } = await import("../utils/database.util");
    await appDatabase.initialize();
    const svc = new ListingOpsOverrideService();
    await svc.ensureTable();

    // Leeds Manor: Hostify/SS say 10am checkout; team told guest 11am.
    // Quarantine until staff sets an active override value.
    const existing: any[] = await appDatabase.query(
        `SELECT id FROM listing_ops_overrides WHERE listingId = 300017864 AND field = 'checkout_time' LIMIT 1`
    );
    if (!existing?.length) {
        await appDatabase.query(
            `INSERT INTO listing_ops_overrides (listingId, field, value, status, note)
             VALUES (300017864, 'checkout_time', NULL, 'quarantined',
                     'PMS/listing_info say 10am; ops has told guests 11am — do not assert until staff sets active value')`
        );
        console.log("Seeded quarantine: Leeds Manor (300017864) checkout_time");
    } else {
        console.log("Leeds Manor checkout override already present");
    }

    const rows = await appDatabase.query(`SELECT id, listingId, field, value, status, note FROM listing_ops_overrides`);
    console.log("listing_ops_overrides:", rows);
    await appDatabase.destroy();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
