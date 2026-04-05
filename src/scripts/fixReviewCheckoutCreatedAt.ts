import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";

/**
 * Fixes review_checkout rows whose createdAt date doesn't match the
 * associated reservation's departureDate.
 *
 * Accepts an optional date range (startDate / endDate in 'yyyy-MM-dd' format)
 * to limit the scope. When omitted, all rows are examined.
 */
export const fixReviewCheckoutCreatedAt = async (
    startDate?: string,
    endDate?: string,
): Promise<{ updated: number; skipped: number; errors: number }> => {
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    const dataSource = appDatabase;

    // Build the query to find mismatched rows.
    // We join review_checkout → reservation_info and compare
    // DATE(review_checkout.createdAt) vs reservation_info.departureDate.
    let sql = `
        SELECT
            rc.id                          AS reviewCheckoutId,
            ri.departureDate               AS departureDate,
            rc.createdAt                   AS createdAt
        FROM review_checkout rc
        INNER JOIN reservation_info ri ON ri.id = rc.reservationInfoId
        WHERE rc.deletedAt IS NULL
          AND DATE(rc.createdAt) != DATE(ri.departureDate)
    `;

    const params: any[] = [];

    if (startDate && endDate) {
        sql += ` AND DATE(ri.departureDate) BETWEEN ? AND ?`;
        params.push(startDate, endDate);
    } else if (startDate) {
        sql += ` AND DATE(ri.departureDate) >= ?`;
        params.push(startDate);
    } else if (endDate) {
        sql += ` AND DATE(ri.departureDate) <= ?`;
        params.push(endDate);
    }

    const rows: Array<{
        reviewCheckoutId: number;
        departureDate: string;
        createdAt: Date;
    }> = await dataSource.query(sql, params);

    logger.info(`[fixReviewCheckoutCreatedAt] Found ${rows.length} mismatched rows${startDate || endDate ? ` (range: ${startDate ?? '*'} → ${endDate ?? '*'})` : ''}`);

    for (const row of rows) {
        try {
            // Set time to midnight of the departure date to keep it clean.
            const departureDateStr = typeof row.departureDate === 'string'
                ? row.departureDate
                : new Date(row.departureDate).toISOString().slice(0, 10);

            await dataSource.query(
                `UPDATE review_checkout SET createdAt = ? WHERE id = ?`,
                [`${departureDateStr} 00:00:00`, row.reviewCheckoutId],
            );

            updated++;
            logger.info(`[fixReviewCheckoutCreatedAt] Updated id=${row.reviewCheckoutId}: createdAt ${row.createdAt} → ${departureDateStr}`);
        } catch (err) {
            logger.error(`[fixReviewCheckoutCreatedAt] Error updating id=${row.reviewCheckoutId}:`, err);
            errors++;
        }
    }

    logger.info(`[fixReviewCheckoutCreatedAt] Done — updated: ${updated}, skipped: ${skipped}, errors: ${errors}`);
    return { updated, skipped, errors };
};
