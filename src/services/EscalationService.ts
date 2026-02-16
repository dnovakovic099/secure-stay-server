import logger from '../utils/logger.utils';
import { appDatabase } from '../utils/database.util';
import { ZapierTriggerEvent } from '../entity/ZapierTriggerEvent';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import sendSlackMessage from '../utils/sendSlackMsg';
import { LessThan, MoreThan, IsNull, Not } from 'typeorm';

// Guest Relations user group ID for Slack mentions
const GR_USERGROUP_ID = 'S09AUHMA6HE';

export class EscalationService {
    /**
     * Process overdue tasks - run every 5-10 minutes
     * 1. Find New tasks > 4 hours old that haven't been escalated
     * 2. Send initial overdue alert
     * 3. Send hourly reminders for already-escalated tasks
     */
    async processOverdueTasks(): Promise<void> {
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
        const slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);

        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        try {
            // Find tasks that are New, > 4 hours old, and haven't been escalated yet
            const newOverdueTasks = await eventRepo.find({
                where: {
                    status: 'New',
                    createdAt: LessThan(fourHoursAgo),
                    overdueTriggeredAt: IsNull(),
                    remindersActive: true
                }
            });

            logger.info(`[EscalationService] Found ${newOverdueTasks.length} newly overdue tasks`);

            // Send initial overdue alert for each
            for (const task of newOverdueTasks) {
                await this.sendOverdueAlert(task, slackMessageRepo);
                
                // Update task tracking
                task.overdueTriggeredAt = new Date();
                task.lastReminderSentAt = new Date();
                await eventRepo.save(task);
            }

            // Find tasks that are already overdue and need hourly reminder
            const tasksNeedingReminder = await eventRepo.find({
                where: {
                    status: 'New',
                    remindersActive: true,
                    overdueTriggeredAt: Not(IsNull()),
                    lastReminderSentAt: LessThan(oneHourAgo)
                }
            });

            logger.info(`[EscalationService] Found ${tasksNeedingReminder.length} tasks needing hourly reminder`);

            // Send hourly reminder for each
            for (const task of tasksNeedingReminder) {
                await this.sendHourlyReminder(task, slackMessageRepo);
                
                // Update tracking
                task.lastReminderSentAt = new Date();
                await eventRepo.save(task);
            }

        } catch (error) {
            logger.error(`[EscalationService][processOverdueTasks] Error: ${error}`);
        }
    }

    /**
     * Process daily reminders for In Progress tasks - run at 10 AM
     */
    async processDailyReminders(): Promise<void> {
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
        const slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);

        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        try {
            // Find In Progress tasks that haven't had a daily reminder in 24 hours
            const tasks = await eventRepo
                .createQueryBuilder('event')
                .where('event.status = :status', { status: 'In Progress' })
                .andWhere('(event.dailyReminderSentAt IS NULL OR event.dailyReminderSentAt < :cutoff)', { cutoff: twentyFourHoursAgo })
                .getMany();

            logger.info(`[EscalationService] Found ${tasks.length} In Progress tasks for daily reminder`);

            for (const task of tasks) {
                await this.sendDailyReminder(task, slackMessageRepo);
                
                task.dailyReminderSentAt = new Date();
                await eventRepo.save(task);
            }

        } catch (error) {
            logger.error(`[EscalationService][processDailyReminders] Error: ${error}`);
        }
    }

    /**
     * Send initial overdue alert
     */
    private async sendOverdueAlert(task: ZapierTriggerEvent, slackMessageRepo: any): Promise<void> {
        try {
            const slackMsg = await slackMessageRepo.findOne({
                where: { entityType: 'zapier_trigger_event', entityId: task.id }
            });

            if (slackMsg) {
                const alertText = `<!subteam^${GR_USERGROUP_ID}> 🚨 OVERDUE: This GR task has been in *New* for 4+ hours. Please review and update status to *In Progress* or *Completed*.`;
                
                await sendSlackMessage({
                    channel: slackMsg.channel,
                    text: alertText,
                }, slackMsg.messageTs);

                logger.info(`[EscalationService] Sent overdue alert for task ${task.id}`);
            }
        } catch (error) {
            logger.error(`[EscalationService][sendOverdueAlert] Error for task ${task.id}: ${error}`);
        }
    }

    /**
     * Send hourly reminder with context summary
     */
    private async sendHourlyReminder(task: ZapierTriggerEvent, slackMessageRepo: any): Promise<void> {
        try {
            const slackMsg = await slackMessageRepo.findOne({
                where: { entityType: 'zapier_trigger_event', entityId: task.id }
            });

            if (slackMsg) {
                // Calculate hours overdue
                const hoursOverdue = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60));
                
                // Build context-aware reminder
                const contextSummary = this.buildContextSummary(task);
                
                const reminderText = `<!subteam^${GR_USERGROUP_ID}> ⏰ Reminder: This task is still overdue (${hoursOverdue}+ hours). ${contextSummary} Please update status to *In Progress* or *Completed*.`;
                
                await sendSlackMessage({
                    channel: slackMsg.channel,
                    text: reminderText,
                }, slackMsg.messageTs);

                logger.info(`[EscalationService] Sent hourly reminder for task ${task.id}`);
            }
        } catch (error) {
            logger.error(`[EscalationService][sendHourlyReminder] Error for task ${task.id}: ${error}`);
        }
    }

    /**
     * Send daily 10 AM reminder for In Progress tasks
     */
    private async sendDailyReminder(task: ZapierTriggerEvent, slackMessageRepo: any): Promise<void> {
        try {
            const slackMsg = await slackMessageRepo.findOne({
                where: { entityType: 'zapier_trigger_event', entityId: task.id }
            });

            if (slackMsg) {
                const daysSinceCreated = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60 * 24));
                
                const reminderText = `<!subteam^${GR_USERGROUP_ID}> 📋 Daily check-in: This task has been *In Progress* for ${daysSinceCreated} day(s). Please complete and mark as *Completed* when done.`;
                
                await sendSlackMessage({
                    channel: slackMsg.channel,
                    text: reminderText,
                }, slackMsg.messageTs);

                logger.info(`[EscalationService] Sent daily reminder for task ${task.id}`);
            }
        } catch (error) {
            logger.error(`[EscalationService][sendDailyReminder] Error for task ${task.id}: ${error}`);
        }
    }

    /**
     * Build a brief context summary from the task
     */
    private buildContextSummary(task: ZapierTriggerEvent): string {
        const parts: string[] = [];
        
        if (task.event) {
            parts.push(`Event: ${task.event}`);
        }
        
        if (task.message) {
            // Truncate message to first 100 chars
            const preview = task.message.length > 100 
                ? task.message.substring(0, 100) + '...' 
                : task.message;
            parts.push(`Message preview: "${preview}"`);
        }

        return parts.length > 0 ? parts.join(' | ') : 'No additional context available.';
    }
}
