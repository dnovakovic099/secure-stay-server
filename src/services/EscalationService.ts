import logger from '../utils/logger.utils';
import { appDatabase } from '../utils/database.util';
import { ZapierTriggerEvent } from '../entity/ZapierTriggerEvent';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import { Employee, EmployeeDepartment } from '../entity/Employee';
import { UsersEntity } from '../entity/Users';
import sendSlackMessage from '../utils/sendSlackMsg';
import { LessThan } from 'typeorm';
import OpenAI from 'openai';
import axios from 'axios';

// Guest Relations user group ID for Slack mentions
const GR_USERGROUP_ID = 'S09AUHMA6HE';
// Special channel that should only tag Kaz when on shift
const ALL_CHANNEL_SUPPORT = 'all-channel-support-messages';
const OVERDUE_THRESHOLD_HOURS = 4;
const REMINDER_INTERVAL_HOURS = 1;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

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

    /**
     * Get the appropriate Slack mention based on channel and shift status.
     * For "all-channel-support-messages" channel:
     *   - If Kaz is on shift → tag only Kaz
     *   - Otherwise → tag the whole GR group
     * For other channels → always tag the whole GR group
     */
    private async getMentionForChannel(slackChannel: string | null): Promise<string> {
        // Normalize channel name (remove # prefix if present, lowercase for comparison)
        const channelName = (slackChannel || '').replace(/^#/, '').toLowerCase();
        
        // Check if this is the special channel
        if (channelName === ALL_CHANNEL_SUPPORT.toLowerCase()) {
            try {
                const kazOnShift = await this.isKazOnShift();
                if (kazOnShift) {
                    const kazSlackId = await this.getKazSlackId();
                    if (kazSlackId) {
                        logger.info(`[EscalationService] Channel is ${ALL_CHANNEL_SUPPORT} and Kaz is on shift - tagging only Kaz`);
                        return `<@${kazSlackId}>`;
                    }
                }
                logger.info(`[EscalationService] Channel is ${ALL_CHANNEL_SUPPORT} but Kaz is NOT on shift - tagging GR group`);
            } catch (error) {
                logger.warn(`[EscalationService] Error checking Kaz shift status: ${error} - falling back to GR group`);
            }
        }

        // Default: tag the whole GR usergroup
        return `<!subteam^${GR_USERGROUP_ID}>`;
    }

    /**
     * Check if Kaz is currently on shift based on Employee schedule data.
     * Schedule format expected: "Mon-Fri, 9am-5pm" or comma-separated days "Mon,Tue,Wed"
     */
    private async isKazOnShift(): Promise<boolean> {
        try {
            // Find Kaz by name in the Guest Relations department
            const kaz = await this.employeeRepo
                .createQueryBuilder('emp')
                .leftJoinAndSelect('emp.user', 'user')
                .where('emp.department = :dept', { dept: EmployeeDepartment.GUEST_RELATIONS })
                .andWhere('emp.isActive = :active', { active: true })
                .andWhere('LOWER(user.full_name) LIKE :name', { name: '%kaz%' })
                .getOne();

            if (!kaz) {
                logger.warn('[EscalationService] Kaz not found in Employee table');
                return false;
            }

            if (!kaz.schedule) {
                logger.warn('[EscalationService] Kaz has no schedule defined');
                return false;
            }

            // Parse and check the schedule
            return this.isCurrentTimeInSchedule(kaz.schedule);
        } catch (error) {
            logger.error(`[EscalationService] Error checking if Kaz is on shift: ${error}`);
            return false;
        }
    }

    /**
     * Get Kaz's Slack user ID from the Employee table
     */
    private async getKazSlackId(): Promise<string | null> {
        try {
            const kaz = await this.employeeRepo
                .createQueryBuilder('emp')
                .leftJoinAndSelect('emp.user', 'user')
                .where('emp.department = :dept', { dept: EmployeeDepartment.GUEST_RELATIONS })
                .andWhere('emp.isActive = :active', { active: true })
                .andWhere('LOWER(user.full_name) LIKE :name', { name: '%kaz%' })
                .getOne();

            return kaz?.slackUserId || kaz?.slackId || null;
        } catch (error) {
            logger.error(`[EscalationService] Error getting Kaz Slack ID: ${error}`);
            return null;
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
     * 1. Find newly-overdue tasks (New for 4+ hours, not yet flagged)
     *    → Post first overdue alert, set is_overdue = true
     * 
     * 2. Find already-overdue tasks needing hourly reminders
     *    → Generate AI context summary, post reminder to Slack thread
     */
    async processOverdueTasks(): Promise<void> {
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
        const slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);

        const overdueThreshold = new Date(Date.now() - OVERDUE_THRESHOLD_HOURS * 60 * 60 * 1000);
        const reminderThreshold = new Date(Date.now() - REMINDER_INTERVAL_HOURS * 60 * 60 * 1000);

        // ── Step 1: Flag newly overdue tasks ──
        try {
            const newlyOverdue = await eventRepo
                .createQueryBuilder('event')
                .where('event.status = :status', { status: 'New' })
                .andWhere('event.is_overdue = :isOverdue', { isOverdue: false })
                .andWhere('event.created_at < :threshold', { threshold: overdueThreshold })
                .getMany();

            if (newlyOverdue.length > 0) {
                logger.info(`[EscalationService] Found ${newlyOverdue.length} newly overdue tasks`);
            }

            for (const event of newlyOverdue) {
                try {
                    // Get Slack message info
                    const slackMsg = await slackMessageRepo.findOne({
                        where: { entityType: 'zapier_trigger_event', entityId: event.id }
                    });

                    if (slackMsg) {
                        const hoursSinceCreation = Math.floor(
                            (Date.now() - new Date(event.createdAt).getTime()) / (1000 * 60 * 60)
                        );

                        // Get appropriate mention based on channel and shift status
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

                        const sent = await this.sendThreadReply(slackMsg.channel, alertText, slackMsg.messageTs, event.id);
                        if (!sent) continue;

                        // Update escalation state only after successfully sending the Slack message
                        event.isOverdue = true;
                        event.escalationLevel = 1;
                        event.lastReminderAt = new Date();
                        event.reminderCount = 1;
                        await eventRepo.save(event);
                    } else {
                        logger.warn(`[EscalationService] No Slack message record found for overdue event ${event.id} — skipping escalation, will retry next cycle`);
                    }

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
                .andWhere('event.last_reminder_at < :threshold', { threshold: reminderThreshold })
                .getMany();

            if (needsReminder.length > 0) {
                logger.info(`[EscalationService] Found ${needsReminder.length} overdue tasks needing hourly reminder`);
            }

            for (const event of needsReminder) {
                try {
                    const slackMsg = await slackMessageRepo.findOne({
                        where: { entityType: 'zapier_trigger_event', entityId: event.id }
                    });

                    if (slackMsg) {
                        // Generate AI context summary from thread
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
     * Posts a reminder to the Slack thread for every task in "In Progress" status,
     * tagging the GR user group.
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

            logger.info(`[EscalationService] Sending daily reminders for ${inProgressTasks.length} In Progress tasks`);

            for (const event of inProgressTasks) {
                try {
                    const slackMsg = await slackMessageRepo.findOne({
                        where: { entityType: 'zapier_trigger_event', entityId: event.id }
                    });

                    if (slackMsg) {
                        const daysSinceCreation = Math.floor(
                            (Date.now() - new Date(event.createdAt).getTime()) / (1000 * 60 * 60 * 24)
                        );

                        // Get appropriate mention based on channel and shift status
                        const mention = await this.getMentionForChannel(event.slackChannel);

                        const reminderText = [
                            `${mention} 📋 *Daily Check-in* — Task is *In Progress* (day ${daysSinceCreation + 1})`,
                            ``,
                            `*Event:* ${event.event}`,
                            event.title ? `*Title:* ${event.title}` : null,
                            ``,
                            `If this is resolved, please mark it as *Completed*. Otherwise, let the team know the current status.`,
                        ].filter(Boolean).join('\n');

                        const sent = await this.sendThreadReply(slackMsg.channel, reminderText, slackMsg.messageTs, event.id);
                        if (!sent) continue;

                        // Update last reminder timestamp
                        event.lastReminderAt = new Date();
                        await eventRepo.save(event);

                        logger.info(`[EscalationService] Sent daily reminder for In Progress event ${event.id}`);
                    } else {
                        logger.warn(`[EscalationService] No Slack message record found for In Progress event ${event.id} — skipping daily reminder`);
                    }
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
