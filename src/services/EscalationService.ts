import logger from '../utils/logger.utils';
import { appDatabase } from '../utils/database.util';
import { ZapierTriggerEvent } from '../entity/ZapierTriggerEvent';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import { Employee, EmployeeDepartment } from '../entity/Employee';
import { UsersEntity } from '../entity/Users';
import { EscalationSettingsService } from './EscalationSettingsService';
import { AIEscalationManagerService } from './AIEscalationManagerService';
import sendSlackMessage from '../utils/sendSlackMsg';
import { LessThan } from 'typeorm';
import OpenAI from 'openai';
import axios from 'axios';

// Default values (used as fallback if settings not found)
const DEFAULT_GR_USERGROUP_ID = 'S09AUHMA6HE';
const DEFAULT_OVERDUE_THRESHOLD_HOURS = 4;
const DEFAULT_REMINDER_INTERVAL_HOURS = 1;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// Enable AI-powered escalation (can be controlled via env var)
const AI_ESCALATION_ENABLED = process.env.AI_ESCALATION_ENABLED !== 'false';

interface SlackThreadMessage {
    ts: string;
    user?: string;
    text: string;
    bot_id?: string;
}

export class EscalationService {
    private openai: OpenAI | null = null;
    private employeeRepo = appDatabase.getRepository(Employee);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private settingsService = new EscalationSettingsService();
    private aiManager = new AIEscalationManagerService();
    private schemaReady = false;

    private async ensureSchema(): Promise<void> {
        if (this.schemaReady) return;

        const taskColumns = [
            'ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMP NULL',
            'ADD COLUMN IF NOT EXISTS ignored_prompt_count INT NOT NULL DEFAULT 0',
            'ADD COLUMN IF NOT EXISTS vague_reply_count INT NOT NULL DEFAULT 0',
            'ADD COLUMN IF NOT EXISTS completion_quality_score FLOAT NULL',
            'ADD COLUMN IF NOT EXISTS last_ai_review_summary TEXT NULL',
            'ADD COLUMN IF NOT EXISTS last_ai_review_payload MEDIUMTEXT NULL',
            'ADD COLUMN IF NOT EXISTS last_ai_review_at TIMESTAMP NULL',
            'ADD COLUMN IF NOT EXISTS assigned_rep_name VARCHAR(255) NULL',
            'ADD COLUMN IF NOT EXISTS assigned_rep_slack_id VARCHAR(100) NULL'
        ];

        const settingsColumns = [
            'ADD COLUMN IF NOT EXISTS overdue_alert_enabled BOOLEAN NOT NULL DEFAULT true',
            'ADD COLUMN IF NOT EXISTS follow_up_reminders_enabled BOOLEAN NOT NULL DEFAULT true',
            'ADD COLUMN IF NOT EXISTS daily_check_in_enabled BOOLEAN NOT NULL DEFAULT true',
        ];

        for (const sql of taskColumns) {
            try {
                await appDatabase.query(`ALTER TABLE zapier_trigger_events ${sql}`);
            } catch (error: any) {
                if (!error.message?.includes('already exists') && !error.message?.includes('duplicate column')) {
                    logger.warn('[EscalationService] Failed to ensure zapier_trigger_events column:', error.message);
                }
            }
        }

        for (const sql of settingsColumns) {
            try {
                await appDatabase.query(`ALTER TABLE escalation_settings ${sql}`);
            } catch (error: any) {
                if (!error.message?.includes('already exists') && !error.message?.includes('duplicate column')) {
                    logger.warn('[EscalationService] Failed to ensure escalation_settings column:', error.message);
                }
            }
        }

        this.schemaReady = true;
    }

    /**
     * Get the appropriate Slack mention based on channel settings and shift status.
     * Uses settings from escalation_settings table:
     *   - If channel has primaryEmployeeId set and checkShiftSchedule is true:
     *     - Check if employee is on shift → tag only that employee
     *     - Otherwise → tag the fallback group
     *   - If no settings for channel → use default settings
     */
    private async getMentionForChannel(slackChannel: string | null): Promise<string> {
        // Normalize channel name (remove # prefix if present, lowercase for comparison)
        const channelName = (slackChannel || '').replace(/^#/, '').toLowerCase();
        
        try {
            // Try to get channel-specific settings, falls back to 'default'
            const settings = await this.settingsService.getSettingsByKey(channelName);
            
            if (settings && settings.primaryEmployeeId) {
                // Check if we should verify shift schedule
                if (settings.checkShiftSchedule) {
                    const isOnShift = await this.isEmployeeOnShift(settings.primaryEmployeeId);
                    if (isOnShift && settings.primaryEmployee?.slackUserId) {
                        logger.info(`[EscalationService] Channel "${channelName}": Primary employee ${settings.primaryEmployee.name} is on shift - tagging them`);
                        return `<@${settings.primaryEmployee.slackUserId}>`;
                    }
                    logger.info(`[EscalationService] Channel "${channelName}": Primary employee NOT on shift - tagging fallback group`);
                } else {
                    // Don't check schedule, just tag the primary employee
                    if (settings.primaryEmployee?.slackUserId) {
                        logger.info(`[EscalationService] Channel "${channelName}": Tagging primary employee ${settings.primaryEmployee.name} (no shift check)`);
                        return `<@${settings.primaryEmployee.slackUserId}>`;
                    }
                }
            }

            // Use fallback group from settings, or default
            const fallbackGroupId = settings?.fallbackSlackGroupId || DEFAULT_GR_USERGROUP_ID;
            return `<!subteam^${fallbackGroupId}>`;
        } catch (error) {
            logger.warn(`[EscalationService] Error getting settings for channel "${channelName}": ${error} - using default group`);
            return `<!subteam^${DEFAULT_GR_USERGROUP_ID}>`;
        }
    }

    /**
     * Get settings for determining overdue threshold, reminder interval, and alert toggles.
     */
    private async getEscalationSettings(slackChannel: string | null): Promise<{
        overdueThresholdHours: number;
        reminderIntervalHours: number;
        overdueAlertEnabled: boolean;
        followUpRemindersEnabled: boolean;
        dailyCheckInEnabled: boolean;
    }> {
        const channelName = (slackChannel || '').replace(/^#/, '').toLowerCase();

        try {
            const settings = await this.settingsService.getSettingsByKey(channelName);
            return {
                overdueThresholdHours: settings?.overdueThresholdHours || DEFAULT_OVERDUE_THRESHOLD_HOURS,
                reminderIntervalHours: settings?.reminderIntervalHours || DEFAULT_REMINDER_INTERVAL_HOURS,
                overdueAlertEnabled: settings?.overdueAlertEnabled ?? true,
                followUpRemindersEnabled: settings?.followUpRemindersEnabled ?? true,
                dailyCheckInEnabled: settings?.dailyCheckInEnabled ?? true,
            };
        } catch (error) {
            return {
                overdueThresholdHours: DEFAULT_OVERDUE_THRESHOLD_HOURS,
                reminderIntervalHours: DEFAULT_REMINDER_INTERVAL_HOURS,
                overdueAlertEnabled: true,
                followUpRemindersEnabled: true,
                dailyCheckInEnabled: true,
            };
        }
    }

    private async isEscalationActiveForEvent(event: Pick<ZapierTriggerEvent, 'slackChannel' | 'event' | 'id'>): Promise<boolean> {
        try {
            const settings = await this.settingsService.resolveSettingsForEvent(event);
            if (settings?.isActive === false) {
                // logger.info(`[EscalationService] Escalation setting inactive for event ${event.id} (${settings.settingKey})`);
                return false;
            }
        } catch (error) {
            logger.warn(`[EscalationService] Failed to resolve escalation settings for event ${event.id}: ${error}`);
        }

        return true;
    }

    /**
     * Check if a specific employee is on shift
     */
    private async isEmployeeOnShift(employeeId: number): Promise<boolean> {
        try {
            const employee = await this.employeeRepo.findOne({
                where: { id: employeeId, isActive: true }
            });

            if (!employee) {
                logger.warn(`[EscalationService] Employee ${employeeId} not found or inactive`);
                return false;
            }

            if (!employee.schedule) {
                logger.warn(`[EscalationService] Employee ${employeeId} has no schedule defined`);
                return false;
            }

            return this.isCurrentTimeInSchedule(employee.schedule);
        } catch (error) {
            logger.error(`[EscalationService] Error checking if employee ${employeeId} is on shift: ${error}`);
            return false;
        }
    }

    /**
     * Check if current time falls within a schedule string.
     * Supports formats like:
     *   - "Mon-Fri, 9am-5pm ET"
     *   - "Mon,Tue,Wed,Thu,Fri 9:00-17:00"
     *   - "Mon-Fri"
     */
    private isCurrentTimeInSchedule(schedule: string): boolean {
        try {
            // Get current time in ET (Eastern Time)
            const now = new Date();
            const etOptions: Intl.DateTimeFormatOptions = { 
                timeZone: 'America/New_York', 
                weekday: 'short', 
                hour: 'numeric', 
                minute: 'numeric',
                hour12: false 
            };
            const etNow = new Intl.DateTimeFormat('en-US', etOptions).formatToParts(now);
            
            const dayMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
            const currentDay = etNow.find(p => p.type === 'weekday')?.value || '';
            const currentDayNum = dayMap[currentDay] ?? new Date().getDay();
            const currentHour = parseInt(etNow.find(p => p.type === 'hour')?.value || '0', 10);
            const currentMinute = parseInt(etNow.find(p => p.type === 'minute')?.value || '0', 10);
            const currentTimeMinutes = currentHour * 60 + currentMinute;

            const scheduleLower = schedule.toLowerCase();

            // Parse day range (e.g., "mon-fri" or "mon,tue,wed")
            let scheduledDays: number[] = [];
            const dayRangeMatch = scheduleLower.match(/(sun|mon|tue|wed|thu|fri|sat)[\s-]*(sun|mon|tue|wed|thu|fri|sat)?/g);
            
            if (dayRangeMatch) {
                for (const match of dayRangeMatch) {
                    if (match.includes('-')) {
                        // Range like mon-fri
                        const [startDay, endDay] = match.split('-').map(d => d.trim());
                        const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                        const startIdx = dayNames.indexOf(startDay.substring(0, 3));
                        const endIdx = dayNames.indexOf(endDay.substring(0, 3));
                        if (startIdx !== -1 && endIdx !== -1) {
                            for (let i = startIdx; i <= endIdx; i++) {
                                scheduledDays.push(i);
                            }
                        }
                    } else {
                        // Single day
                        const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                        const idx = dayNames.indexOf(match.trim().substring(0, 3));
                        if (idx !== -1) scheduledDays.push(idx);
                    }
                }
            }

            // Also check for comma-separated days
            const commaDays = scheduleLower.match(/(sun|mon|tue|wed|thu|fri|sat)/g);
            if (commaDays) {
                const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                commaDays.forEach(d => {
                    const idx = dayNames.indexOf(d);
                    if (idx !== -1 && !scheduledDays.includes(idx)) {
                        scheduledDays.push(idx);
                    }
                });
            }

            // Check if current day is in scheduled days
            if (scheduledDays.length > 0 && !scheduledDays.includes(currentDayNum)) {
                logger.debug(`[EscalationService] Current day ${currentDay} (${currentDayNum}) not in scheduled days: ${scheduledDays}`);
                return false;
            }

            // Parse time range (e.g., "9am-5pm" or "09:00-17:00")
            const timeMatch = scheduleLower.match(/(\d{1,2})(:\d{2})?\s*(am|pm)?\s*-\s*(\d{1,2})(:\d{2})?\s*(am|pm)?/);
            
            if (timeMatch) {
                let startHour = parseInt(timeMatch[1], 10);
                const startMin = timeMatch[2] ? parseInt(timeMatch[2].slice(1), 10) : 0;
                const startAmPm = timeMatch[3];
                
                let endHour = parseInt(timeMatch[4], 10);
                const endMin = timeMatch[5] ? parseInt(timeMatch[5].slice(1), 10) : 0;
                const endAmPm = timeMatch[6];

                // Convert to 24-hour if AM/PM specified
                if (startAmPm === 'pm' && startHour < 12) startHour += 12;
                if (startAmPm === 'am' && startHour === 12) startHour = 0;
                if (endAmPm === 'pm' && endHour < 12) endHour += 12;
                if (endAmPm === 'am' && endHour === 12) endHour = 0;

                const startMinutes = startHour * 60 + startMin;
                const endMinutes = endHour * 60 + endMin;

                // Check if current time is within range
                if (currentTimeMinutes < startMinutes || currentTimeMinutes > endMinutes) {
                    logger.debug(`[EscalationService] Current time ${currentHour}:${currentMinute} not in scheduled hours ${startHour}:${startMin}-${endHour}:${endMin}`);
                    return false;
                }
            }

            // If we got here, both day and time (if specified) match
            return true;
        } catch (error) {
            logger.error(`[EscalationService] Error parsing schedule "${schedule}": ${error}`);
            return false;
        }
    }

    private getOpenAI(): OpenAI {
        if (!this.openai) {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                throw new Error('OPENAI_API_KEY is not set in environment variables');
            }
            this.openai = new OpenAI({ apiKey });
        }
        return this.openai;
    }

    /**
     * Send a message as a thread reply and validate the Slack API response.
     * Returns true if the message was successfully posted as a thread reply.
     * If the thread no longer exists or the message was posted as a new message,
     * it cleans up (deletes the orphaned message) and returns false.
     */
    private async sendThreadReply(
        channel: string,
        text: string,
        threadTs: string,
        eventId: number
    ): Promise<boolean> {
        const result = await sendSlackMessage({ channel, text }, threadTs);

        // Slack API returned an error (e.g., thread_not_found, channel_not_found)
        if (!result?.ok) {
            logger.warn(`[EscalationService] Thread reply failed for event ${eventId}: ${result?.error || 'unknown error'} — skipping`);
            return false;
        }

        // Message was posted, but verify it is actually a thread reply
        if (!result.message?.thread_ts) {
            // Slack ignored the thread_ts and posted as a new standalone message — delete it
            logger.warn(`[EscalationService] Message for event ${eventId} posted as new message instead of thread reply (thread may have been deleted) — deleting and skipping`);
            try {
                await axios.post('https://slack.com/api/chat.delete', {
                    channel,
                    ts: result.ts
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
                    }
                });
            } catch (deleteErr) {
                logger.error(`[EscalationService] Failed to delete orphaned message for event ${eventId}: ${deleteErr}`);
            }
            return false;
        }

        return true;
    }

    /**
     * Process overdue tasks (runs every 5 minutes)
     *
     * 1. Find newly-overdue tasks (New for threshold+ hours, not yet flagged)
     *    → Route through AI for first alert, set is_overdue = true
     *    → Per-channel overdue threshold is checked per task (defaults to 4h)
     *
     * 2. Find already-overdue tasks whose next_follow_up_at is due
     *    → Route through AI for follow-up decision
     */
    async processOverdueTasks(): Promise<void> {
        await this.ensureSchema();

        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
        const slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);

        // Use the minimum possible threshold as the query window (conservative 1h)
        // Per-task validation happens inside the loop using channel-specific settings
        const queryThreshold = new Date(Date.now() - 1 * 60 * 60 * 1000);
        const reminderThreshold = new Date(Date.now() - DEFAULT_REMINDER_INTERVAL_HOURS * 60 * 60 * 1000);

        // ── Step 1: Flag newly overdue tasks ──
        try {
            const newlyOverdueCandidates = await eventRepo
                .createQueryBuilder('event')
                .where('event.status = :status', { status: 'New' })
                .andWhere('event.is_overdue = :isOverdue', { isOverdue: false })
                .andWhere('event.created_at < :threshold', { threshold: queryThreshold })
                .getMany();

            if (newlyOverdueCandidates.length > 0) {
                logger.info(`[EscalationService] Found ${newlyOverdueCandidates.length} newly overdue candidates to evaluate`);
            }

            for (const event of newlyOverdueCandidates) {
                try {
                    // Check per-channel settings (threshold + alert toggle)
                    const channelSettings = await this.getEscalationSettings(event.slackChannel);

                    if (!channelSettings.overdueAlertEnabled) {
                        logger.debug(`[EscalationService] Overdue alert disabled for event ${event.id} (channel: ${event.slackChannel}) — skipping`);
                        continue;
                    }

                    const thresholdHours = channelSettings.overdueThresholdHours || DEFAULT_OVERDUE_THRESHOLD_HOURS;
                    const taskAgeHours = (Date.now() - new Date(event.createdAt).getTime()) / (1000 * 60 * 60);
                    if (taskAgeHours < thresholdHours) {
                        // Not yet overdue per this channel's settings
                        continue;
                    }

                    const isActive = await this.isEscalationActiveForEvent(event);
                    if (!isActive) {
                        continue;
                    }

                    const slackMsg = await slackMessageRepo.findOne({
                        where: { entityType: 'zapier_trigger_event', entityId: event.id }
                    });

                    if (!slackMsg) {
                        logger.warn(`[EscalationService] No Slack message record found for overdue event ${event.id} — skipping, will retry`);
                        continue;
                    }

                    // Mark overdue now so even if AI fails, it won't re-trigger this path
                    event.isOverdue = true;
                    event.escalationLevel = 1;
                    event.lastReminderAt = new Date();
                    event.reminderCount = 1;
                    event.nextFollowUpAt = new Date(Date.now() + channelSettings.reminderIntervalHours * 60 * 60 * 1000);
                    await eventRepo.save(event);

                    // ── AI-POWERED FIRST ALERT ──
                    if (AI_ESCALATION_ENABLED) {
                        try {
                            const decision = await this.aiManager.analyzeAndDecide(event.id);
                            const isFallback = decision.action === 'REMIND' && decision.message === 'FALLBACK_TO_STANDARD';

                            if (!isFallback) {
                                await this.aiManager.executeDecision(event.id, decision, slackMsg.channel, slackMsg.messageTs);
                                logger.info(`[EscalationService] AI first alert for newly overdue event ${event.id}: ${decision.action}`);
                                continue;
                            }
                            logger.info(`[EscalationService] AI disabled for event ${event.id}, using fallback first alert`);
                        } catch (aiError) {
                            logger.warn(`[EscalationService] AI first alert failed for event ${event.id}, using fallback: ${aiError}`);
                        }
                    }

                    // ── FALLBACK FIRST ALERT (AI disabled or failed) ──
                    const hoursSinceCreation = Math.floor(taskAgeHours);
                    const mention = await this.getMentionForChannel(event.slackChannel);
                    const alertText = [
                        `${mention} 🚨 *OVERDUE TASK*`,
                        ``,
                        `This task has been in *New* status for *${hoursSinceCreation} hours* without being picked up.`,
                        ``,
                        `*Event:* ${event.event}`,
                        event.title ? `*Title:* ${event.title}` : null,
                        ``,
                        `Please pick this up and move to *In Progress*, or mark *Completed* if already resolved.`,
                    ].filter(Boolean).join('\n');

                    await this.sendThreadReply(slackMsg.channel, alertText, slackMsg.messageTs, event.id);

                } catch (error) {
                    logger.error(`[EscalationService] Failed to process newly overdue event ${event.id}: ${error}`);
                }
            }
        } catch (error) {
            logger.error(`[EscalationService] Error querying newly overdue tasks: ${error}`);
        }

        // ── Step 2: Send hourly reminders for already-overdue tasks ──
        try {
            const needsReminder = await eventRepo
                .createQueryBuilder('event')
                .where('event.status = :status', { status: 'New' })
                .andWhere('event.is_overdue = :isOverdue', { isOverdue: true })
                .andWhere('(event.next_follow_up_at IS NOT NULL AND event.next_follow_up_at <= :now) OR (event.next_follow_up_at IS NULL AND event.last_reminder_at < :threshold)', {
                    now: new Date(),
                    threshold: reminderThreshold
                })
                .getMany();

            if (needsReminder.length > 0) {
                logger.info(`[EscalationService] Found ${needsReminder.length} overdue tasks needing hourly reminder`);
            }

            for (const event of needsReminder) {
                try {
                    const isActive = await this.isEscalationActiveForEvent(event);
                    if (!isActive) continue;

                    // Check if follow-up reminders are enabled for this channel
                    const reminderSettings = await this.getEscalationSettings(event.slackChannel);
                    if (!reminderSettings.followUpRemindersEnabled) {
                        logger.debug(`[EscalationService] Follow-up reminders disabled for event ${event.id} (channel: ${event.slackChannel}) — skipping`);
                        continue;
                    }

                    const slackMsg = await slackMessageRepo.findOne({
                        where: { entityType: 'zapier_trigger_event', entityId: event.id }
                    });

                    if (slackMsg) {
                        // ── AI-POWERED DECISION MAKING ──
                        if (AI_ESCALATION_ENABLED) {
                            try {
                                // Let AI analyze the task and decide what to do
                                const decision = await this.aiManager.analyzeAndDecide(event.id);
                                
                                // Check if AI is disabled for this task (returns FALLBACK signal)
                                const isFallback = decision.action === 'REMIND' && 
                                    'message' in decision && 
                                    decision.message === 'FALLBACK_TO_STANDARD';
                                
                                if (!isFallback) {
                                    // Execute the AI's decision
                                    const executed = await this.aiManager.executeDecision(
                                        event.id, 
                                        decision, 
                                        slackMsg.channel, 
                                        slackMsg.messageTs
                                    );

                                    if (executed) {
                                        logger.info(`[EscalationService] AI decision for event ${event.id}: ${decision.action}`);
                                    }
                                    continue; // AI handled it, move to next task
                                }
                                // If fallback, continue to standard reminder below
                                logger.info(`[EscalationService] AI disabled for event ${event.id}, using standard reminder`);
                            } catch (aiError) {
                                logger.warn(`[EscalationService] AI escalation failed for event ${event.id}, falling back to standard reminder: ${aiError}`);
                                // Fall through to standard reminder
                            }
                        }

                        // ── STANDARD REMINDER (fallback or when AI disabled) ──
                        let contextSummary = '';
                        try {
                            contextSummary = await this.generateContextSummary(slackMsg.channel, slackMsg.messageTs, event);
                        } catch (aiError) {
                            logger.warn(`[EscalationService] AI summary failed for event ${event.id}, using fallback: ${aiError}`);
                        }

                        const hoursSinceCreation = Math.floor(
                            (Date.now() - new Date(event.createdAt).getTime()) / (1000 * 60 * 60)
                        );

                        // Get appropriate mention based on channel and shift status
                        const mention = await this.getMentionForChannel(event.slackChannel);

                        const reminderParts = [
                            `${mention} ⏰ *Reminder #${event.reminderCount + 1}* — Task still overdue (*${hoursSinceCreation}h*)`,
                            ``,
                        ];

                        if (contextSummary) {
                            reminderParts.push(`💡 *Context:* ${contextSummary}`);
                            reminderParts.push(``);
                        }

                        reminderParts.push(`Please update the status to *In Progress* if someone is working on this.`);

                        const sent = await this.sendThreadReply(slackMsg.channel, reminderParts.join('\n'), slackMsg.messageTs, event.id);
                        if (!sent) continue;

                        logger.info(`[EscalationService] Sent hourly reminder #${event.reminderCount + 1} for event ${event.id}`);

                        // Update escalation state only after successfully sending the Slack message
                        event.reminderCount += 1;
                        event.escalationLevel += 1;
                        event.lastReminderAt = new Date();
                        const settings = await this.getEscalationSettings(event.slackChannel);
                        event.nextFollowUpAt = new Date(Date.now() + settings.reminderIntervalHours * 60 * 60 * 1000);
                        await eventRepo.save(event);
                    } else {
                        logger.warn(`[EscalationService] No Slack message record found for overdue event ${event.id} — skipping reminder, will retry next cycle`);
                    }

                } catch (error) {
                    logger.error(`[EscalationService] Failed to send hourly reminder for event ${event.id}: ${error}`);
                }
            }
        } catch (error) {
            logger.error(`[EscalationService] Error querying tasks needing reminders: ${error}`);
        }
    }

    /**
     * Process daily reminders for In Progress tasks (runs daily at 10 AM)
     *
     * Routes each In Progress task through AI to decide if a check-in is useful.
     * Falls back to a standard daily reminder if AI is disabled or fails.
     */
    async processDailyReminders(): Promise<void> {
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
        const slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);

        try {
            const inProgressTasks = await eventRepo.find({
                where: { status: 'In Progress' }
            });

            if (inProgressTasks.length === 0) {
                logger.info('[EscalationService] No In Progress tasks for daily reminder');
                return;
            }

            logger.info(`[EscalationService] Processing daily check-in for ${inProgressTasks.length} In Progress tasks`);

            for (const event of inProgressTasks) {
                try {
                    const isActive = await this.isEscalationActiveForEvent(event);
                    if (!isActive) continue;

                    // Check if daily check-ins are enabled for this channel
                    const checkInSettings = await this.getEscalationSettings(event.slackChannel);
                    if (!checkInSettings.dailyCheckInEnabled) {
                        logger.debug(`[EscalationService] Daily check-in disabled for event ${event.id} (channel: ${event.slackChannel}) — skipping`);
                        continue;
                    }

                    const slackMsg = await slackMessageRepo.findOne({
                        where: { entityType: 'zapier_trigger_event', entityId: event.id }
                    });

                    if (!slackMsg) {
                        logger.warn(`[EscalationService] No Slack message record for In Progress event ${event.id} — skipping daily reminder`);
                        continue;
                    }

                    // ── AI-POWERED DAILY CHECK-IN ──
                    if (AI_ESCALATION_ENABLED) {
                        try {
                            const decision = await this.aiManager.analyzeAndDecide(event.id);
                            const isFallback = decision.action === 'REMIND' && decision.message === 'FALLBACK_TO_STANDARD';

                            if (!isFallback) {
                                // AI decided to SKIP → no message needed today for this task
                                if (decision.action === 'SKIP') {
                                    logger.info(`[EscalationService] AI skipped daily check-in for event ${event.id} (no useful message)`);
                                    continue;
                                }

                                const executed = await this.aiManager.executeDecision(
                                    event.id,
                                    decision,
                                    slackMsg.channel,
                                    slackMsg.messageTs
                                );

                                if (executed) {
                                    event.lastReminderAt = new Date();
                                    await eventRepo.save(event);
                                    logger.info(`[EscalationService] AI daily check-in for event ${event.id}: ${decision.action}`);
                                }
                                continue;
                            }
                            logger.info(`[EscalationService] AI disabled for event ${event.id}, using fallback daily reminder`);
                        } catch (aiError) {
                            logger.warn(`[EscalationService] AI daily check-in failed for event ${event.id}, using fallback: ${aiError}`);
                        }
                    }

                    // ── FALLBACK DAILY REMINDER (AI disabled or failed) ──
                    const daysSinceCreation = Math.floor(
                        (Date.now() - new Date(event.createdAt).getTime()) / (1000 * 60 * 60 * 24)
                    );
                    const mention = await this.getMentionForChannel(event.slackChannel);

                    const reminderText = [
                        `${mention} 📋 *Daily Check-in* — Task is *In Progress* (day ${daysSinceCreation + 1})`,
                        ``,
                        `*Event:* ${event.event}`,
                        event.title ? `*Title:* ${event.title}` : null,
                        ``,
                        `If this is resolved, please mark it as *Completed*. Otherwise, please share the current status.`,
                    ].filter(Boolean).join('\n');

                    const sent = await this.sendThreadReply(slackMsg.channel, reminderText, slackMsg.messageTs, event.id);
                    if (!sent) continue;

                    event.lastReminderAt = new Date();
                    await eventRepo.save(event);

                    logger.info(`[EscalationService] Sent fallback daily reminder for In Progress event ${event.id}`);
                } catch (error) {
                    logger.error(`[EscalationService] Failed to send daily reminder for event ${event.id}: ${error}`);
                }
            }
        } catch (error) {
            logger.error(`[EscalationService] Error processing daily reminders: ${error}`);
        }
    }

    /**
     * Generate AI context summary from Slack thread replies
     * 
     * Fetches the latest thread messages and uses OpenAI to produce
     * a 1-2 sentence summary with a suggested next action.
     */
    private async generateContextSummary(
        channelId: string,
        threadTs: string,
        event: ZapierTriggerEvent
    ): Promise<string> {
        // Fetch thread replies from Slack
        const threadMessages = await this.getSlackThreadReplies(channelId, threadTs);

        // If no thread messages, return a simple fallback
        if (threadMessages.length === 0) {
            return 'No thread activity yet — this task needs attention.';
        }

        // Take the last 15 messages for context (to avoid token limits)
        const recentMessages = threadMessages.slice(-15);
        const threadText = recentMessages
            .map(msg => `[${new Date(parseFloat(msg.ts) * 1000).toLocaleString()}] ${msg.text}`)
            .join('\n');

        const openai = this.getOpenAI();

        const response = await openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: [
                {
                    role: 'system',
                    content: `You are an assistant for a vacation rental management company's Guest Relations team. 
Summarize the Slack thread activity for an overdue task. Be concise (1-2 sentences max). 
Include what has happened so far and suggest a clear next action.
Output ONLY the summary text, no labels or prefixes.`
                },
                {
                    role: 'user',
                    content: `Task type: ${event.event}
${event.title ? `Title: ${event.title}` : ''}
Original message: ${event.message?.substring(0, 500)}

Thread activity:
${threadText}`
                }
            ],
            temperature: 0.3,
            max_tokens: 150,
        });

        const summary = response.choices[0]?.message?.content?.trim();
        if (!summary) {
            return 'Thread has activity but summary could not be generated.';
        }

        return summary;
    }

    /**
     * Get thread replies from Slack API
     */
    private async getSlackThreadReplies(channelId: string, threadTs: string): Promise<SlackThreadMessage[]> {
        try {
            const response = await axios.get('https://slack.com/api/conversations.replies', {
                headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
                params: { channel: channelId, ts: threadTs, limit: 100 }
            });

            if (!response.data.ok) {
                logger.error(`[EscalationService] Slack API error: ${response.data.error}`);
                return [];
            }

            // Return all messages except the parent (first one)
            return response.data.messages?.slice(1) || [];
        } catch (error) {
            logger.error(`[EscalationService][getSlackThreadReplies] Error: ${error}`);
            return [];
        }
    }
}
