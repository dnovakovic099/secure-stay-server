import logger from '../utils/logger.utils';
import { appDatabase } from '../utils/database.util';
import { ThreadMessageEntity, ThreadMessageSource } from '../entity/ThreadMessage';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import { ZapierTriggerEvent } from '../entity/ZapierTriggerEvent';
import axios from 'axios';
import sendSlackMessage from '../utils/sendSlackMsg';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

interface SlackMessage {
    ts: string;
    user?: string;
    text: string;
    thread_ts?: string;
    bot_id?: string;
}

interface SlackUser {
    id: string;
    name: string;
    real_name?: string;
    profile?: {
        image_48?: string;
        display_name?: string;
    };
}

export interface ThreadMessageDTO {
    id: string;
    source: ThreadMessageSource;
    userName: string;
    userAvatar?: string;
    content: string;
    timestamp: string;
    createdAt: string;
}

export class ThreadService {
    private threadMessageRepo = appDatabase.getRepository(ThreadMessageEntity);
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private zapierEventRepo = appDatabase.getRepository(ZapierTriggerEvent);
    private userCache: Map<string, SlackUser> = new Map();

    /**
     * Get all thread messages for a GR Task (Slack + SecureStay)
     */
    async getThreadMessages(grTaskId: number): Promise<ThreadMessageDTO[]> {
        const messages: ThreadMessageDTO[] = [];

        try {
            // Get task to find Slack info
            const task = await this.zapierEventRepo.findOne({ where: { id: grTaskId } });
            
            // Get Slack message tracking info
            const slackMsgInfo = await this.slackMessageRepo.findOne({
                where: { entityType: 'zapier_trigger_event', entityId: grTaskId }
            });

            // Fetch Slack thread replies if we have the info
            if (slackMsgInfo?.channel && slackMsgInfo?.messageTs) {
                const slackMessages = await this.getSlackThreadReplies(slackMsgInfo.channel, slackMsgInfo.messageTs);
                
                for (const msg of slackMessages) {
                    // Skip bot messages
                    if (msg.bot_id) continue;
                    
                    const user = msg.user ? await this.getSlackUserCached(msg.user) : null;
                    messages.push({
                        id: `slack_${msg.ts}`,
                        source: 'slack',
                        userName: user?.real_name || user?.profile?.display_name || user?.name || 'Slack User',
                        userAvatar: user?.profile?.image_48,
                        content: msg.text,
                        timestamp: this.slackTsToISOString(msg.ts),
                        createdAt: this.slackTsToISOString(msg.ts)
                    });
                }
            }

            // Get SecureStay messages from database
            const securestayMessages = await this.threadMessageRepo.find({
                where: { grTaskId },
                order: { messageTimestamp: 'ASC' }
            });

            for (const msg of securestayMessages) {
                messages.push({
                    id: `securestay_${msg.id}`,
                    source: 'securestay',
                    userName: msg.userName,
                    userAvatar: msg.userAvatar || undefined,
                    content: msg.content,
                    timestamp: msg.messageTimestamp.toISOString(),
                    createdAt: msg.createdAt.toISOString()
                });
            }

            // Sort by timestamp
            messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        } catch (error) {
            logger.error(`[ThreadService][getThreadMessages] Error: ${error}`);
        }

        return messages;
    }

    /**
     * Post a message from SecureStay (saves to DB + posts to Slack)
     */
    async postMessage(
        grTaskId: number,
        content: string,
        userName: string,
        userAvatar?: string
    ): Promise<ThreadMessageDTO> {
        const now = new Date();
        let slackMessageTs: string | null = null;

        // Get Slack info for posting
        const slackMsgInfo = await this.slackMessageRepo.findOne({
            where: { entityType: 'zapier_trigger_event', entityId: grTaskId }
        });

        // Post to Slack if we have thread info
        if (slackMsgInfo?.channel && slackMsgInfo?.messageTs) {
            try {
                const result = await sendSlackMessage({
                    channel: slackMsgInfo.channel,
                    text: `[SecureStay - ${userName}]: ${content}`,
                }, slackMsgInfo.messageTs);

                if (result?.ts) {
                    slackMessageTs = result.ts;
                }
            } catch (error) {
                logger.error(`[ThreadService][postMessage] Slack post failed: ${error}`);
            }
        }

        // Save to database
        const threadMessage = new ThreadMessageEntity();
        threadMessage.grTaskId = grTaskId;
        threadMessage.source = 'securestay';
        threadMessage.userName = userName;
        threadMessage.userAvatar = userAvatar || null;
        threadMessage.content = content;
        threadMessage.slackMessageTs = slackMessageTs;
        threadMessage.messageTimestamp = now;

        const saved = await this.threadMessageRepo.save(threadMessage);

        return {
            id: `securestay_${saved.id}`,
            source: 'securestay',
            userName: saved.userName,
            userAvatar: saved.userAvatar || undefined,
            content: saved.content,
            timestamp: saved.messageTimestamp.toISOString(),
            createdAt: saved.createdAt.toISOString()
        };
    }

    /**
     * Get thread replies from Slack API
     */
    private async getSlackThreadReplies(channelId: string, threadTs: string): Promise<SlackMessage[]> {
        try {
            const response = await axios.get('https://slack.com/api/conversations.replies', {
                headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
                params: { channel: channelId, ts: threadTs, limit: 100 }
            });

            if (!response.data.ok) {
                logger.error(`[ThreadService] Slack API error: ${response.data.error}`);
                return [];
            }

            // Return all messages except the parent (first one)
            return response.data.messages?.slice(1) || [];
        } catch (error) {
            logger.error(`[ThreadService][getSlackThreadReplies] Error: ${error}`);
            return [];
        }
    }

    /**
     * Get Slack user info (cached)
     */
    private async getSlackUserCached(userId: string): Promise<SlackUser | null> {
        if (this.userCache.has(userId)) {
            return this.userCache.get(userId)!;
        }

        try {
            const response = await axios.get('https://slack.com/api/users.info', {
                headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
                params: { user: userId }
            });

            if (response.data.ok && response.data.user) {
                this.userCache.set(userId, response.data.user);
                return response.data.user;
            }
        } catch (error) {
            logger.error(`[ThreadService][getSlackUserCached] Error: ${error}`);
        }

        return null;
    }

    /**
     * Convert Slack timestamp to ISO string
     */
    private slackTsToISOString(ts: string): string {
        const unixSeconds = parseFloat(ts);
        return new Date(unixSeconds * 1000).toISOString();
    }
}
