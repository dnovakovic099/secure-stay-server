import dotenv from "dotenv";
dotenv.config();
import { ExpenseService } from "../services/ExpenseService";
import logger from "../utils/logger.utils";
import connection from "../utils/redisConnection";
import { Worker } from "bullmq";
import { appDatabase } from "../utils/database.util";

(async () => {
    if (!appDatabase.isInitialized) {
        await appDatabase.initialize();
    }

    const worker = new Worker('ha-expense-queue', async job => {
        try {
            const { payload, userId, expenseId } = job.data;
            const expenseService = new ExpenseService();
            const result = await expenseService.updateHostawayExpense(payload, userId, expenseId);
            if (!result) {
                logger.error(`Hostaway sync failed for expenseId ${expenseId}`);
                throw new Error('Hostaway sync failed');
            }
            logger.info(`Hostaway sync successful for expenseId ${expenseId}`);
        } catch (error) {
            logger.error(`Error processing job ${job.id}:`, error);
            throw error; // Re-throw to mark the job as failed
        }
    }, {
        connection
    });

    worker.on('completed', job => {
        logger.info(`✅ Job ${job.id} completed for expenseId ${job.data.expenseId}`);
    });

    worker.on('failed', (job, err) => {
        logger.error(`❌ Job ${job.id} failed for expenseId ${job.data.expenseId}: ${err.message}`);
    });
})();
