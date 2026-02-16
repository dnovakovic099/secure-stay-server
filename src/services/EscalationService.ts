/**
 * EscalationService - DISABLED until DB migration
 * 
 * This service handles overdue task escalation and reminders.
 * Currently disabled because the required database columns don't exist yet.
 * 
 * To enable:
 * 1. Run the migration SQL in ZapierTriggerEvent.ts comments
 * 2. Uncomment the columns in ZapierTriggerEvent.ts
 * 3. Uncomment this service code
 * 4. Uncomment the scheduler jobs in scheduler.util.ts
 */

import logger from '../utils/logger.utils';

// Guest Relations user group ID for Slack mentions
const GR_USERGROUP_ID = 'S09AUHMA6HE';

export class EscalationService {
    /**
     * Process overdue tasks - DISABLED
     */
    async processOverdueTasks(): Promise<void> {
        logger.info('[EscalationService] Disabled - waiting for DB migration');
    }

    /**
     * Process daily reminders - DISABLED
     */
    async processDailyReminders(): Promise<void> {
        logger.info('[EscalationService] Disabled - waiting for DB migration');
    }
}

/*
 * ORIGINAL CODE - Uncomment after DB migration:
 * 
 * import { appDatabase } from '../utils/database.util';
 * import { ZapierTriggerEvent } from '../entity/ZapierTriggerEvent';
 * import { SlackMessageEntity } from '../entity/SlackMessageInfo';
 * import sendSlackMessage from '../utils/sendSlackMsg';
 * import { LessThan, IsNull, Not } from 'typeorm';
 * 
 * ... (full implementation was here)
 */
