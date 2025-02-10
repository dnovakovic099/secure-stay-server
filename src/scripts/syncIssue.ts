import { IssuesService } from "../services/IssuesService";
import logger from "../utils/logger.utils";

export async function syncIssue() {
    logger.info("Syncing issues...");
    const issuesService = new IssuesService();
    await issuesService.checkUnresolvedIssues();
    logger.info("Issue synchronization completed successfully.");
}