import "dotenv/config";
import { IsNull } from "typeorm";
import { appDatabase, initDatabase } from "../utils/database.util";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { ReservationInfoService } from "../services/ReservationInfoService";
import logger from "../utils/logger.utils";

/**
 * Backfills the Hostify per-reservation fee breakdown (accommodationFee, resortFee,
 * cleaningFeeAmount, managementCommission, insuranceFee) for rows that were synced
 * before the fees=1 & fees_costs=1 params were added to the Hostify client. The
 * accounting Claims Fee Funds card sums reservation_info.resortFee, so any row with
 * NULL there contributes 0.
 *
 * The list endpoint (/reservations) is not guaranteed to return the `fees` array
 * even with the fees params — the sample response we have is from the detail
 * endpoint. This script therefore re-fetches each reservation via
 * syncReservationById() (which hits /reservations/{id}) to populate the columns.
 *
 * Usage:
 *   npx ts-node-dev src/scripts/backfillReservationFees.ts [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 *
 * With no flags, every reservation where resortFee IS NULL is backfilled.
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: { from?: string; to?: string } = {};
  for (const arg of args) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "from") opts.from = value;
    if (key === "to") opts.to = value;
  }
  return opts;
}

async function main() {
  const { from, to } = parseArgs();
  await initDatabase();

  const repo = appDatabase.getRepository(ReservationInfoEntity);
  const qb = repo
    .createQueryBuilder("r")
    .select(["r.id"])
    .where("r.resortFee IS NULL");
  if (from) qb.andWhere("r.arrivalDate >= :from", { from });
  if (to) qb.andWhere("r.arrivalDate <= :to", { to });
  qb.orderBy("r.arrivalDate", "DESC");

  const rows = await qb.getMany();
  logger.info(`[backfillReservationFees] ${rows.length} reservations to backfill${from || to ? ` (from=${from ?? "-"} to=${to ?? "-"})` : ""}`);

  const service = new ReservationInfoService();
  let ok = 0;
  let failed = 0;
  for (const [index, row] of rows.entries()) {
    try {
      await service.syncReservationById(row.id);
      ok += 1;
    } catch (error: any) {
      failed += 1;
      logger.warn(`[backfillReservationFees] Failed for reservation ${row.id}: ${error?.message}`);
    }
    if ((index + 1) % 25 === 0) {
      logger.info(`[backfillReservationFees] Progress ${index + 1}/${rows.length} (ok=${ok} failed=${failed})`);
    }
  }
  logger.info(`[backfillReservationFees] Done. ok=${ok} failed=${failed} total=${rows.length}`);
  process.exit(0);
}

main().catch((error) => {
  logger.error("[backfillReservationFees] Fatal:", error);
  process.exit(1);
});
