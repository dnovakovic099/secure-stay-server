import logger from '../utils/logger.utils';
import { appDatabase } from '../utils/database.util';
import { ZapierTriggerEvent } from '../entity/ZapierTriggerEvent';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import sendSlackMessage from '../utils/sendSlackMsg';
import { LessThan } from 'typeorm';
import OpenAI from 'openai';
import axios from 'axios';

// Guest Relations user group ID for Slack mentions
const GR_USERGROUP_ID = 'S09AUHMA6HE';
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

                        const alertText = [
                            `<!subteam^${GR_USERGROUP_ID}> 🚨 *OVERDUE TASK*`,
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

                        const reminderParts = [
                            `<!subteam^${GR_USERGROUP_ID}> ⏰ *Reminder #${event.reminderCount + 1}* — Task still overdue (*${hoursSinceCreation}h*)`,
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

                        const reminderText = [
                            `<!subteam^${GR_USERGROUP_ID}> 📋 *Daily Check-in* — Task is *In Progress* (day ${daysSinceCreation + 1})`,
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
