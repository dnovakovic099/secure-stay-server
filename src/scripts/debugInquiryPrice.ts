import "reflect-metadata";
import "dotenv/config";
import { appDatabase } from "../utils/database.util";
import { Hostify } from "../client/Hostify";

/**
 * Debug why an inquiry shows empty Quoted/Payout in inbox-v2.
 *   NODE_ENV=production node dist/out-tsc/scripts/debugInquiryPrice.js 300771649
 */
async function main() {
    const threadId = Number(process.argv[2] || 0);
    if (!threadId) throw new Error("usage: debugInquiryPrice <threadId>");

    await appDatabase.initialize();
    const rows = await appDatabase.query(
        `SELECT c.id, c.threadId, c.reservationId, c.listingId, c.guestName,
                c.price, c.currency, c.reservationStatus, c.checkin, c.checkout,
                r.totalPrice, r.payoutPrice, r.owner_revenue, r.base_price, r.status AS rStatus,
                r.cleaningFee, r.taxAmount, r.nights
         FROM inbox_conversations c
         LEFT JOIN reservation_info r ON r.id = c.reservationId
         WHERE c.id = ? OR c.threadId = ?
         LIMIT 5`,
        [threadId, threadId]
    );
    console.log("local rows:", JSON.stringify(rows, null, 2));

    const reservationId = rows[0]?.reservationId;
    if (!reservationId) {
        console.log("No reservationId on conversation");
        await appDatabase.destroy();
        return;
    }

    const hostify = new Hostify();
    const apiKey = process.env.HOSTIFY_API_KEY as string;
    const live = await hostify.getReservationInfo(apiKey, Number(reservationId));
    const r = live?.reservation || live?.data || live || {};
    const moneyKeys = Object.keys(r).filter((k) =>
        /price|payout|revenue|paid|fee|tax|subtotal|total|amount|cost|night/i.test(k)
    );
    const pick: Record<string, any> = {};
    for (const k of moneyKeys) pick[k] = r[k];
    console.log("live status", r.status, r.status_description);
    console.log("live money:", JSON.stringify(pick, null, 2));
    if (r.fees) console.log("fees:", JSON.stringify(r.fees).slice(0, 1200));

    await appDatabase.destroy();
}

main().catch((e) => {
    console.error("ERR:", e);
    process.exit(1);
});
