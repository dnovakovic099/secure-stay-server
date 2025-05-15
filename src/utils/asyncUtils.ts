import logger from "./logger.utils";

/**
 * Runs an async function without blocking, and logs any errors.
 * @param task - The promise to execute
 * @param label - A short label to identify the task in logs
 */
export function runAsync(task: Promise<any>, label: string) {
    task.catch(err => logger.error(`[${label}] Error: ${err?.message}`));
}
