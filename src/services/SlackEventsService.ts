import { appDatabase } from "../utils/database.util";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { ClientTicket } from "../entity/ClientTicket";
import { ClientTicketUpdates } from "../entity/ClientTicketUpdates";
import { ThreadMessageEntity } from "../entity/ThreadMessage";
import { ZapierTriggerEvent } from "../entity/ZapierTriggerEvent";
import { AIEscalationManagerService } from "./AIEscalationManagerService";
import { ResolutionsTeamSlackService } from "./ResolutionsTeamSlackService";
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
                logger.debug('[SlackEventsService] Skipping: Not a thread reply');
                return;
            }

            // Skip if it's the same as the root message (thread_ts === ts for root messages)
            if (event.thread_ts === event.ts) {
                logger.debug('[SlackEventsService] Skipping: Root message, not a reply');
                return;
            }

            // Skip bot messages (including our own bot) to prevent infinite loops
            if (event.bot_id || event.subtype === 'bot_message') {
                logger.debug(`[SlackEventsService] Skipping: Bot message — channel=${event.channel} ts=${event.ts}`);
                return;
            }

            // Find the slack message record by thread_ts
            const slackMessageRecord = await this.slackMessageRepo.findOne({
                where: {
                    messageTs: event.thread_ts,
                }
            });

            if (!slackMessageRecord) {
                logger.debug(`[SlackEventsService] No tracking record found for thread_ts=${event.thread_ts} channel=${event.channel} — not a tracked entity`);
                return;
            }

            logger.info(`[SlackEventsService] Thread reply received — entityType=${slackMessageRecord.entityType} entityId=${slackMessageRecord.entityId} channel=${event.channel} ts=${event.ts}`);

            // ----- Route according to entityType -----

            if (slackMessageRecord.entityType === 'zapier_trigger_event') {
                return await this.handleZapierEventMessage(event, slackMessageRecord.entityId);
            }

            if (slackMessageRecord.entityType === 'review_checkout') {
                const resolutionsService = new ResolutionsTeamSlackService();
                const slackUsers = await getSlackUsers();
                const processedText = replaceSlackIdsWithMentions(event.text, slackUsers);
                await resolutionsService.syncSlackReplyToSS(
                    slackMessageRecord.entityId,
                    event.user,
                    processedText,
                    event.ts
                );
                return;
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
        const threadTs = event.thread_ts || event.ts;

        try {
            logger.info(`[SlackEventsService] App mention received — channel=${event.channel} user=${event.user} thread=${threadTs} ts=${event.ts}`);

            // Extract the actual message (remove the bot mention)
            const botMentionRegex = /<@[A-Z0-9]+>/g;
            const userMessage = event.text.replace(botMentionRegex, '').trim();

            if (!userMessage) {
                logger.info(`[SlackEventsService] Mention with no message body — sending help response. channel=${event.channel} thread=${threadTs}`);
                await sendSlackMessage({
                    channel: event.channel,
                    text: "👋 Hi! I'm the GR Tasks AI Manager. You can ask me about task status, request extensions, or provide updates. How can I help?"
                }, threadTs);
                return;
            }

            logger.info(`[SlackEventsService] Generating AI response for mention — channel=${event.channel} thread=${threadTs} msgLength=${userMessage.length}`);

            // Look up the entity (GR task or review_checkout) linked to this thread
            const slackMsgRecord = await this.slackMessageRepo
                .createQueryBuilder('sm')
                .where('sm.messageTs = :threadTs', { threadTs })
                .andWhere('sm.entityType IN (:...types)', { types: ['zapier_trigger_event', 'review_checkout'] })
                .getOne()
                .catch((lookupErr) => {
                    logger.error(`[SlackEventsService] Thread lookup DB error — channel=${event.channel} thread=${threadTs}: ${lookupErr}`);
                    return null;
                });

            if (!slackMsgRecord) {
                logger.warn(`[SlackEventsService] No tracked entity found for mention — channel=${event.channel} thread=${threadTs}. Mention will not be answered by AI.`);
                return;
            }

            // If this is a review_checkout thread, trigger AI guest analysis instead
            if (slackMsgRecord.entityType === 'review_checkout') {
                const resolutionsService = new ResolutionsTeamSlackService();
                const { ReviewCheckout } = await import('../entity/ReviewCheckout');
                const rcRepo = appDatabase.getRepository(ReviewCheckout);
                const rc = await rcRepo.findOne({
                    where: { id: slackMsgRecord.entityId },
                    relations: ['reservationInfo'],
                });
                if (rc?.reservationInfo?.id) {
                    await resolutionsService.triggerAIAnalysisFromSlack(
                        rc.reservationInfo.id,
                        event.channel,
                        threadTs
                    );
                } else {
                    await sendSlackMessage({ channel: event.channel, text: "❌ Could not find the reservation for this thread." }, threadTs);
                }
                return;
            }

            logger.info(`[SlackEventsService] Found GR task ${slackMsgRecord.entityId} for mention — channel=${event.channel} thread=${threadTs}`);

            // Use AI Manager to generate a response
            let response: string | null = null;
            try {
                const aiManager = new AIEscalationManagerService();
                response = await aiManager.handleMention(event.channel, threadTs, userMessage, event.user);
                logger.info(`[SlackEventsService] AI response generated — channel=${event.channel} thread=${threadTs} responseLength=${response?.length ?? 0}`);
            } catch (aiError) {
                logger.error(`[SlackEventsService] AI response generation failed — channel=${event.channel} thread=${threadTs}: ${aiError}`);
                response = null;
            }

            if (response) {
                try {
                    await sendSlackMessage({ channel: event.channel, text: response }, threadTs);
                    logger.info(`[SlackEventsService] AI reply posted — channel=${event.channel} thread=${threadTs}`);
                } catch (postError) {
                    logger.error(`[SlackEventsService] Failed to post AI reply — channel=${event.channel} thread=${threadTs}: ${postError}`);
                }
            } else {
                logger.warn(`[SlackEventsService] AI mention produced no response — channel=${event.channel} thread=${threadTs} taskId=${slackMsgRecord.entityId}`);
            }

        } catch (error) {
            logger.error(`[SlackEventsService] Unhandled error in handleAppMention — channel=${event.channel} thread=${threadTs}: ${error}`);

            // Send a user-facing error message so the rep knows something went wrong
            try {
                await sendSlackMessage({
                    channel: event.channel,
                    text: "I encountered an error processing your message. Please try again or check the AI logs for details."
                }, threadTs);
            } catch (sendError) {
                logger.error(`[SlackEventsService] Failed to send error fallback message — channel=${event.channel} thread=${threadTs}: ${sendError}`);
            }
        }
    }
}
