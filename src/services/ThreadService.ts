import { appDatabase } from "../utils/database.util";
import { ThreadMessageEntity, ThreadMessageSource } from "../entity/ThreadMessage";
import { SlackService, SlackMessage } from "./SlackService";

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
    private threadMessageRepository = appDatabase.getRepository(ThreadMessageEntity);
    private slackService = new SlackService();

    /**
     * Get all thread messages for a GR Task (Slack + SecureStay)
     */
    async getThreadMessages(
        grTaskId: number,
        slackChannelId: string | null,
        slackThreadTs: string | null
    ): Promise<ThreadMessageDTO[]> {
        const messages: ThreadMessageDTO[] = [];

        // Get Slack messages if thread info is available
        if (slackChannelId && slackThreadTs) {
            const slackMessages = await this.slackService.getThreadReplies(slackChannelId, slackThreadTs);
            
            for (const msg of slackMessages) {
                const user = await this.slackService.getUserInfoCached(msg.user);
                messages.push({
                    id: `slack_${msg.ts}`,
                    source: 'slack',
                    userName: user?.real_name || user?.profile?.display_name || user?.name || 'Unknown',
                    userAvatar: user?.profile?.image_48,
                    content: msg.text,
                    timestamp: SlackService.slackTsToDate(msg.ts).toISOString(),
                    createdAt: SlackService.slackTsToDate(msg.ts).toISOString()
                });
            }
        }

        // Get SecureStay messages from database
        const securestayMessages = await this.threadMessageRepository.find({
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

        return messages;
    }

    /**
     * Post a message from SecureStay (saves to DB + posts to Slack)
     */
    async postMessage(
        grTaskId: number,
        slackChannelId: string | null,
        slackThreadTs: string | null,
        content: string,
        userName: string,
        userAvatar?: string
    ): Promise<ThreadMessageDTO> {
        const now = new Date();
        let slackMessageTs: string | null = null;

        // Post to Slack if thread info is available
        if (slackChannelId && slackThreadTs) {
            const slackMessage = await this.slackService.postThreadReply(
                slackChannelId,
                slackThreadTs,
                `[SecureStay - ${userName}]: ${content}`
            );
            slackMessageTs = slackMessage?.ts || null;
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

        const saved = await this.threadMessageRepository.save(threadMessage);

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
}
