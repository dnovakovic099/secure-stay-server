import { appDatabase } from "../utils/database.util";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { ClientTicket } from "../entity/ClientTicket";
import { ClientTicketUpdates } from "../entity/ClientTicketUpdates";
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

export class SlackEventsService {
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private clientTicketRepo = appDatabase.getRepository(ClientTicket);
    private clientTicketUpdateRepo = appDatabase.getRepository(ClientTicketUpdates);

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
                    entityType: 'client_ticket'
                }
            });

            if (!slackMessageRecord) {
                logger.info(`[SlackEventsService] No client ticket found for thread_ts: ${event.thread_ts}`);
                return;
            }

            // Check for duplicate (already synced this message)
            const existingUpdate = await this.clientTicketUpdateRepo.findOne({
                where: { slackMessageTs: event.ts }
            });

            if (existingUpdate) {
                logger.info(`[SlackEventsService] Duplicate detected, skipping: ${event.ts}`);
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
}
