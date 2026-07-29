import "dotenv/config";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { PropertyFactsService } from "../services/PropertyFactsService";

/**
 * Prefill the Verified Property Facts sheet from data we already hold.
 *
 * Everything lands as UNVERIFIED (never overwriting an existing value): the
 * point is to give the team something to confirm with one click instead of a
 * blank form. Sources:
 *   - listing_info: check-in/out hours, cleaning fee, extra-guest fee,
 *     capacity, pet fee
 *   - upsell_property_config + upsell_info: early check-in / late checkout /
 *     parking-or-garage fees WITH their charge type (per-night vs flat — the
 *     distinction behind most wrong fee quotes in the July audit)
 *
 * Idempotent; run any time: npx ts-node src/scripts/prefillPropertyFacts.ts
 */

const hourLabel = (h: unknown): string | null => {
    const n = Number(h);
    if (!Number.isFinite(n) || n < 0 || n > 23) return null;
    const ampm = n >= 12 ? "PM" : "AM";
    const display = n % 12 === 0 ? 12 : n % 12;
    return `${display}:00 ${ampm}`;
};

const money = (v: unknown): string | null => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
};

async function main() {
    await appDatabase.initialize();
    const pf = new PropertyFactsService();
    let written = 0;

    const put = async (listingId: number, fieldKey: string, value: string | null, source: string) => {
        if (!value) return;
        try {
            const before = written;
            await pf.upsert({ listingId, fieldKey, value, source, verified: false, onlyIfEmpty: true });
            written = before + 1;
        } catch (err: any) {
            logger.warn(`[prefill] ${listingId}/${fieldKey}: ${err.message}`);
        }
    };

    // ── listing_info basics ─────────────────────────────────────────────
    const listings: any[] = await appDatabase.query(
        `SELECT id, checkInTimeStart, checkOutTime, cleaningFee, priceForExtraPerson,
                personCapacity, airbnbPetFeeAmount
         FROM listing_info`
    );
    logger.info(`[prefill] ${listings.length} listings from listing_info`);
    for (const l of listings) {
        const id = Number(l.id);
        if (!id) continue;
        await put(id, "check_in_time", hourLabel(l.checkInTimeStart), "hostify");
        await put(id, "check_out_time", hourLabel(l.checkOutTime), "hostify");
        await put(id, "cleaning_fee", money(l.cleaningFee), "hostify");
        const extra = money(l.priceForExtraPerson);
        await put(id, "extra_guest_fee", extra ? `${extra} per extra person per night` : null, "hostify");
        const cap = Number(l.personCapacity);
        await put(id, "max_guests", Number.isFinite(cap) && cap > 0 ? String(cap) : null, "hostify");
        const pet = money(l.airbnbPetFeeAmount);
        await put(id, "pet_fee", pet ? `${pet} (Airbnb pet fee)` : null, "hostify");
    }

    // ── Upsell fees with charge type ────────────────────────────────────
    const upsells: any[] = await appDatabase.query(
        `SELECT c.listingId, u.title, c.upsellFee, c.actualFee, c.chargeType, u.timePeriod
         FROM upsell_property_config c
         JOIN upsell_info u ON u.upsell_id = c.upSellId
         WHERE c.listingId IS NOT NULL AND (u.isActive IS NULL OR u.isActive = 1)`
    ).catch(() => []);
    logger.info(`[prefill] ${upsells.length} upsell configs`);
    for (const u of upsells) {
        const id = Number(u.listingId);
        if (!id) continue;
        const title = String(u.title || "").toLowerCase();
        const fee = money(u.upsellFee) || money(u.actualFee);
        if (!fee) continue;
        const charge = [u.chargeType, u.timePeriod].filter(Boolean).join(", ");
        const desc = `${fee}${charge ? ` (${charge})` : ""} — from Upsells, confirm structure (per-night vs flat)`;
        if (title.includes("early check")) await put(id, "early_check_in", desc, "upsells");
        else if (title.includes("late check")) await put(id, "late_checkout", desc, "upsells");
        else if (title.includes("garage")) await put(id, "garage", desc, "upsells");
        else if (title.includes("parking")) await put(id, "parking_fee", desc, "upsells");
    }

    logger.info(`[prefill] done — ${written} field values written (unverified, existing values untouched)`);
    await appDatabase.destroy();
}

main().catch((err) => {
    logger.error(`[prefill] failed: ${err.message}`);
    process.exit(1);
});
