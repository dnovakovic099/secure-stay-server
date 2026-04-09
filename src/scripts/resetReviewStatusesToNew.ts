import { appDatabase, initDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";

export const resetReviewStatusesToNew = async (): Promise<number> => {
    await initDatabase();

    const result = await appDatabase.query(
        `
            UPDATE review_checkout
            SET status = ?
            WHERE status IS NULL
               OR TRIM(status) = ''
               OR status <> ?
        `,
        ['New', 'New'],
    );

    const affected = Number(result?.affectedRows || result?.affected || 0);
    logger.info(`[resetReviewStatusesToNew] Updated ${affected} review checkout rows to New.`);
    return affected;
};

if (require.main === module) {
    resetReviewStatusesToNew()
        .then((affected) => {
            logger.info(`[resetReviewStatusesToNew] Complete. Rows updated: ${affected}`);
            process.exit(0);
        })
        .catch((error) => {
            logger.error('[resetReviewStatusesToNew] Failed:', error);
            process.exit(1);
        });
}
