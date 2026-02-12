import logger from "./logger.utils";

/**
 * Runs an async function without blocking, and logs any errors.
 * @param task - The promise to execute
 * @param label - A short label to identify the task in logs
 */
export function runAsync(task: Promise<any>, label: string) {
    const start = Date.now();
    task.then(() => {
        const duration = Date.now() - start;
        // logger.info(`[${label}] Completed in ${duration}ms`);
    }).catch(err => {
        const duration = Date.now() - start;
        logger.error(`[${label}] Error after ${duration}ms: ${err?.message}`);
        if (err?.stack) {
            logger.error(err.stack);
        }
    });
}
