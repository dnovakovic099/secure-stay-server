import { appDatabase } from "../utils/database.util";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { ClientTicket } from "../entity/ClientTicket";
import { ClientTicketUpdates } from "../entity/ClientTicketUpdates";
import { ThreadMessageEntity } from "../entity/ThreadMessage";
import { ZapierTriggerEvent } from "../entity/ZapierTriggerEvent";
import { AIEscalationManagerService } from "./AIEscalationManagerService";
import sendSlackMessage from "../utils/sendSlackMsg";
import logger from "../utils/logger.utils";
import axios from "axios";
import { getSlackUsers } from "../utils/getSlackUsers";
import { replaceSlackIdsWithMentions } from "../helpers/helpers";

interface SlackMessageEvent {
    type: string;
    subtype?: string;
    channel: string;
    user?: string;
    text: string;
    ts: string;
    thread_ts?: string;
    bot_id?: string;
}

interface SlackAppMentionEvent {
    type: string;
    channel: string;
    user: string;
    text: string;
    ts: string;
    thread_ts?: string;
}

export class SlackEventsService {
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private clientTicketRepo = appDatabase.getRepository(ClientTicket);
    private clientTicketUpdateRepo = appDatabase.getRepository(ClientTicketUpdates);
    private threadMessageRepo = appDatabase.getRepository(ThreadMessageEntity);
    private zapierEventRepo = appDatabase.getRepository(ZapierTriggerEvent);

    /**
     * Handle incoming message event from Slack Events API
     */
    async handleMessageEvent(event: SlackMessageEvent): Promise<void> {
        try {
            // Skip if not a thread reply (no thread_ts means it's a root message)
            if (!event.thread_ts) {
                logger.info('[SlackEventsService] Skipping: Not a thread reply');
                return;
            }

            // Skip if it's the same as the root message (thread_ts === ts for root messages)
            if (event.thread_ts === event.ts) {
                logger.info('[SlackEventsService] Skipping: Root message, not a reply');
                return;
            }

            // Skip bot messages (including our own bot) to prevent infinite loops
            if (event.bot_id || event.subtype === 'bot_message') {
                logger.info('[SlackEventsService] Skipping: Bot message');
                return;
            }

            // Find the slack message record by thread_ts
            const slackMessageRecord = await this.slackMessageRepo.findOne({
                where: {
                    messageTs: event.thread_ts,
                }
            });

            if (!slackMessageRecord) {
                logger.info(`[SlackEventsService] No tracking record found for thread_ts: ${event.thread_ts}`);
                return;
            }

            // ----- Route according to entityType -----

            if (slackMessageRecord.entityType === 'zapier_trigger_event') {
                return await this.handleZapierEventMessage(event, slackMessageRecord.entityId);
            }

            if (slackMessageRecord.entityType !== 'client_ticket') {
                logger.info(`[SlackEventsService] Unsupported entity type '${slackMessageRecord.entityType}' for thread_ts: ${event.thread_ts}`);
                return;
            }

            // Check for duplicate (already synced this message for client_ticket)
            const existingClientUpdate = await this.clientTicketUpdateRepo.findOne({
                where: { slackMessageTs: event.ts }
            });

            if (existingClientUpdate) {
                logger.info(`[SlackEventsService] Duplicate detected for client ticket, skipping: ${event.ts}`);
                return;
            }

            // Find the client ticket
            const clientTicket = await this.clientTicketRepo.findOne({
                where: { id: slackMessageRecord.entityId }
            });

            if (!clientTicket) {
                logger.error(`[SlackEventsService] Client ticket not found: ${slackMessageRecord.entityId}`);
                return;
            }

            // Get Slack user display name
            const slackUserName = await this.getSlackUserDisplayName(event.user);
            const createdBy = `${slackUserName} (via Slack)`;

            // Process the message text to convert Slack user mentions to readable names
            const slackUsers = await getSlackUsers();
            const processedText = replaceSlackIdsWithMentions(event.text, slackUsers);

            // Create the update with source='slack' to prevent infinite loop
            const newUpdate = this.clientTicketUpdateRepo.create({
                updates: processedText,
                clientTicket: clientTicket,
                createdBy: createdBy,
                source: 'slack',
                slackMessageTs: event.ts
            });

            await this.clientTicketUpdateRepo.save(newUpdate);
            logger.info(`[SlackEventsService] Synced Slack reply to client ticket ${clientTicket.id}`);

        } catch (error) {
            logger.error('[SlackEventsService] Error handling message event:', error);
        }
    }

    /**
     * Fetch Slack user display name using Slack API
     */
    private async getSlackUserDisplayName(userId: string): Promise<string> {
        try {
            if (!userId) return 'Unknown User';

            const response = await axios.get('https://slack.com/api/users.info', {
                headers: {
                    'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
                },
                params: { user: userId }
            });

            if (response.data.ok && response.data.user) {
                return response.data.user.profile?.display_name ||
                    response.data.user.profile?.real_name ||
                    response.data.user.name ||
                    'Unknown User';
            }

            return 'Unknown User';
        } catch (error) {
            logger.error('[SlackEventsService] Error fetching user info:', error);
            return 'Unknown User';
        }
    }

    /**
     * Handle incoming thread replies for Zapier Trigger Events (GR Tasks)
     */
    private async handleZapierEventMessage(event: SlackMessageEvent, entityId: number): Promise<void> {
        try {
            // Check for duplicate (already synced this message)
            const existingMessage = await this.threadMessageRepo.findOne({
                where: { slackMessageTs: event.ts }
            });

            if (existingMessage) {
                logger.info(`[SlackEventsService] Duplicate Zapier thread message detected, skipping: ${event.ts}`);
                return;
            }

            // Find the GR Task
            const grTask = await this.zapierEventRepo.findOne({
                where: { id: entityId }
            });

            if (!grTask) {
                logger.error(`[SlackEventsService] GR Task (Zapier event) not found: ${entityId}`);
                return;
            }

            // Get Slack user display name
            const slackUserName = await this.getSlackUserDisplayName(event.user);

            // Process the message text to convert Slack user mentions
            const slackUsers = await getSlackUsers();
            const processedText = replaceSlackIdsWithMentions(event.text, slackUsers);

            // Note: Since Slack replies don't have userAvatar readily available in message event,
            // we will fetch it from user profile if possible, else null.
            let userAvatar: string | null = null;
            try {
                if (event.user) {
                    const response = await axios.get('https://slack.com/api/users.info', {
                        headers: { 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}` },
                        params: { user: event.user }
                    });
                    if (response.data.ok && response.data.user?.profile?.image_48) {
                        userAvatar = response.data.user.profile.image_48;
                    }
                }
            } catch (avatarError) {
                logger.warn(`[SlackEventsService] Could not fetch avatar for ${event.user}:`, avatarError);
            }

            // Convert Slack TS to Date
            const unixSeconds = parseFloat(event.ts);
            const messageDate = new Date(unixSeconds * 1000);

            // Save to thread_messages with source='slack'
            const newThreadMessage = this.threadMessageRepo.create({
                grTaskId: entityId,
                source: 'slack',
                userName: slackUserName,
                userAvatar: userAvatar,
                content: processedText,
                slackMessageTs: event.ts,
                messageTimestamp: messageDate
            });

            await this.threadMessageRepo.save(newThreadMessage);
            logger.info(`[SlackEventsService] Synced Slack reply to GR Task ${entityId}`);

        } catch (error) {
            logger.error('[SlackEventsService] Error handling Zapier event message:', error);
        }
    }

    /**
     * Handle app_mention events (when bot is @mentioned)
     * Routes to AI Escalation Manager for conversational responses
     */
    async handleAppMention(event: SlackAppMentionEvent): Promise<void> {
        try {
            logger.info(`[SlackEventsService] App mention received in channel ${event.channel}`);

            // Get the thread_ts (if in a thread) or use ts for root-level mentions
            const threadTs = event.thread_ts || event.ts;

            // Extract the actual message (remove the bot mention)
            const botMentionRegex = /<@[A-Z0-9]+>/g;
            const userMessage = event.text.replace(botMentionRegex, '').trim();

            if (!userMessage) {
                // Just mentioned with no message, send a helpful response
                await sendSlackMessage({
                    channel: event.channel,
                    text: "👋 Hi! I'm the GR Tasks AI Manager. You can ask me about task status, request extensions, or provide updates. How can I help?"
                }, threadTs);
                return;
            }

            // Use AI Manager to generate a response
            const aiManager = new AIEscalationManagerService();
            const response = await aiManager.handleMention(event.channel, threadTs, userMessage, event.user);

            if (response) {
                // Send the AI response as a thread reply
                await sendSlackMessage({
                    channel: event.channel,
                    text: response
                }, threadTs);
                logger.info(`[SlackEventsService] Sent AI response for mention in ${event.channel}`);
            } else {
                logger.warn(`[SlackEventsService] AI mention produced no response for channel=${event.channel} thread=${threadTs}`);
            }

        } catch (error) {
            logger.error('[SlackEventsService] Error handling app mention:', error);
            
            // Send error response
            try {
                const threadTs = event.thread_ts || event.ts;
                await sendSlackMessage({
                    channel: event.channel,
                    text: "I encountered an error processing your message. Please try again or contact support."
                }, threadTs);
            } catch (sendError) {
                logger.error('[SlackEventsService] Failed to send error message:', sendError);
            }
        }
    }
}
