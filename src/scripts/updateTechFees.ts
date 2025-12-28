import "dotenv/config";
import { appDatabase, initDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";

/**
 * Script to update tech fee settings for listings based on CSV data
 * Usage: npx ts-node src/scripts/updateTechFees.ts
 */

// Extracted data from techFeeInfo.csv - listings with IDs and tech fees
const techFeeData: { listingId: number; techFeeAmount: number; }[] = [
    // Yes- $50 entries
    { listingId: 300019981, techFeeAmount: 50 }, // Casa 33 - Jose
    { listingId: 300019982, techFeeAmount: 50 }, // Casa 31 - Jose
    { listingId: 300019983, techFeeAmount: 50 }, // Casa 24 - Jose
    { listingId: 300019984, techFeeAmount: 50 }, // Casa 36 - Jose
    { listingId: 300017682, techFeeAmount: 50 }, // Via de Las Olas - Juan
    { listingId: 300018906, techFeeAmount: 50 }, // Penn Forest Trail - Benjamin
    { listingId: 300018767, techFeeAmount: 50 }, // Bowers (Floor 2) - Shravan
    { listingId: 300017708, techFeeAmount: 50 }, // Lower Honoapiilani Rd. - Julieta
    { listingId: 300017674, techFeeAmount: 50 }, // Ashford Ave. Puerto Rico - Josem

    // Yes ($100 - default) entries
    { listingId: 300022360, techFeeAmount: 100 }, // E Main St. - Mike & Julia
    { listingId: 300017924, techFeeAmount: 100 }, // Leidel Dr. - David
    { listingId: 300019803, techFeeAmount: 100 }, // Carlos Padillo - NE 162nd St.
    { listingId: 300020861, techFeeAmount: 100 }, // Veredas del Mar - Elsie (Marisol)
    { listingId: 300022285, techFeeAmount: 100 }, // Camp Nine Rd. - Audrea
    { listingId: 300022280, techFeeAmount: 100 }, // Hwy 95 - Audrea
    { listingId: 300021359, techFeeAmount: 100 }, // E 3rd St. - Martha
    { listingId: 300022036, techFeeAmount: 100 }, // Old Erie Rd. - Casey
    { listingId: 300020819, techFeeAmount: 100 }, // Lazy Days Rd (Unit #X10) - Jeff
    { listingId: 300020610, techFeeAmount: 100 }, // Avenida Amaralina (Unit #201) - David
    { listingId: 300021357, techFeeAmount: 100 }, // Evans Ave. (3BR - Main Floor) - Laurell
    { listingId: 300020120, techFeeAmount: 100 }, // Pagewood Ln - Henry
    { listingId: 300021184, techFeeAmount: 100 }, // Orlando CIR - Lleana
    { listingId: 300022332, techFeeAmount: 100 }, // S Parker St. - Edward
    { listingId: 300022512, techFeeAmount: 100 }, // SW 3rd Terrace - Mauricio
];

async function main() {
    console.log("🚀 Starting tech fee update script...");

    try {
        // Initialize database connection
        console.log("📌 Connecting to database...");
        await initDatabase();
        console.log("✅ Database connected");

        let updated = 0;
        let created = 0;
        let failed = 0;

        for (const { listingId, techFeeAmount } of techFeeData) {
            try {
                // Check if listing detail exists using raw query
                const existingRecords = await appDatabase.query(
                    `SELECT id FROM listing_details WHERE listingId = ?`,
                    [listingId]
                );

                if (existingRecords.length > 0) {
                    // Update existing record
                    await appDatabase.query(
                        `UPDATE listing_details SET tech_fee = true, tech_fee_amount = ? WHERE listingId = ?`,
                        [techFeeAmount, listingId]
                    );
                    console.log(`✅ Updated listingId ${listingId}: techFee=true, techFeeAmount=$${techFeeAmount}`);
                    updated++;
                } else {
                    // Create new record with minimal required fields
                    await appDatabase.query(
                        `INSERT INTO listing_details (listingId, propertyOwnershipType, tech_fee, tech_fee_amount, createdBy, createdAt, updatedAt) 
                         VALUES (?, 'Property Management', true, ?, 'system', NOW(), NOW())`,
                        [listingId, techFeeAmount]
                    );
                    console.log(`✅ Created listingId ${listingId}: techFee=true, techFeeAmount=$${techFeeAmount}`);
                    created++;
                }
            } catch (error) {
                console.error(`❌ Failed to update listingId ${listingId}:`, error.message);
                failed++;
            }
        }

        console.log("\n📊 Summary:");
        console.log(`   - Updated: ${updated}`);
        console.log(`   - Created: ${created}`);
        console.log(`   - Failed: ${failed}`);
        console.log(`   - Total processed: ${techFeeData.length}`);
        console.log("✨ Tech fee update completed successfully");

        process.exit(0);
    } catch (error) {
        console.error("❌ Script failed:", error);
        logger.error("❌ Tech fee update script failed:", error);
        process.exit(1);
    }
}

main();
