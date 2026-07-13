import axios from "axios";
import { appDatabase } from "../utils/database.util";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import logger from "../utils/logger.utils";
import sendSlackMessage from "../utils/sendSlackMsg";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

type ServiceRequestThreadType = "photographer" | "cleaner" | "maintenance" | "itemSupply";

interface SlackMessage {
    ts: string;
    user?: string;
    text?: string;
    bot_id?: string;
    bot_profile?: {
        name?: string;
        icons?: {
            image_48?: string;
        };
    };
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

interface SlackChannel {
    id: string;
    name?: string;
}

export interface ServiceRequestThreadMessageDTO {
    id: string;
    source: "slack" | "securestay";
    userName: string;
    userAvatar?: string;
    content: string;
    timestamp: string;
    createdAt: string;
}

const ENTITY_TYPE_BY_REQUEST_TYPE: Record<ServiceRequestThreadType, string> = {
    photographer: "PhotographerRequest",
    cleaner: "CleanerRequest",
    maintenance: "MaintenanceFormRequest",
    itemSupply: "ItemSupplyRequest",
};

export class ServiceRequestThreadService {
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private userCache: Map<string, SlackUser> = new Map();
    private channelCache: Map<string, string> = new Map();

    async getThread(requestType: ServiceRequestThreadType, requestId: number) {
        const slackMessage = await this.getSlackMessage(requestType, requestId);
        const channel = slackMessage?.channel ? await this.resolveSlackChannel(slackMessage.channel) : null;
        const slackPermalink = slackMessage && channel ? await this.getSlackPermalink(channel, slackMessage.messageTs) : null;
        const messages = slackMessage && channel ? await this.getSlackThreadMessages(channel, slackMessage.messageTs) : [];

        return {
            slackPermalink,
            messages,
        };
    }

    async postThreadMessage(requestType: ServiceRequestThreadType, requestId: number, content: string, userName: string) {
        const slackMessage = await this.getSlackMessage(requestType, requestId);

        if (!slackMessage?.channel || !slackMessage?.messageTs) {
            throw new Error("Slack thread not linked for this service request");
        }

        const channel = await this.resolveSlackChannel(slackMessage.channel);
        const result = await sendSlackMessage({
            channel,
            text: `[SecureStay - ${userName}]: ${content}`,
        }, slackMessage.messageTs);

        if (!result?.ok || !result?.ts) {
            throw new Error(result?.error || "Failed to post to Slack thread");
        }

        return {
            id: `securestay_${result.ts}`,
            source: "securestay" as const,
            userName,
            content,
            timestamp: this.slackTsToISOString(result.ts),
            createdAt: this.slackTsToISOString(result.ts),
        };
    }

    private async getSlackMessage(requestType: ServiceRequestThreadType, requestId: number) {
        return this.slackMessageRepo.findOne({
            where: { entityType: ENTITY_TYPE_BY_REQUEST_TYPE[requestType], entityId: requestId },
            order: { createdAt: "DESC" },
        });
    }

    private async resolveSlackChannel(channel: string) {
        const trimmedChannel = String(channel || "").trim();
        if (!trimmedChannel) return trimmedChannel;
        if (/^[CGD][A-Z0-9]+$/.test(trimmedChannel)) return trimmedChannel;

        const cacheKey = trimmedChannel.toLowerCase();
        if (this.channelCache.has(cacheKey)) return this.channelCache.get(cacheKey)!;

        const targetName = trimmedChannel.replace(/^#/, "").toLowerCase();

        try {
            let cursor: string | undefined;

            do {
                const response = await axios.get("https://slack.com/api/conversations.list", {
                    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
                    params: {
                        types: "public_channel,private_channel",
                        limit: 1000,
                        cursor,
                    },
                });

                if (!response.data?.ok) {
                    logger.warn(`[ServiceRequestThreadService] Slack channel lookup error: ${response.data?.error}`);
                    break;
                }

                const channels: SlackChannel[] = response.data.channels || [];
                const matchedChannel = channels.find((item) => item.id === trimmedChannel || item.name?.toLowerCase() === targetName);

                if (matchedChannel?.id) {
                    this.channelCache.set(cacheKey, matchedChannel.id);
                    return matchedChannel.id;
                }

                cursor = response.data.response_metadata?.next_cursor || undefined;
            } while (cursor);
        } catch (error) {
            logger.warn(`[ServiceRequestThreadService][resolveSlackChannel] Error: ${error}`);
        }

        return trimmedChannel;
    }

    private async getSlackThreadMessages(channel: string, threadTs: string): Promise<ServiceRequestThreadMessageDTO[]> {
        try {
            const response = await axios.get("https://slack.com/api/conversations.replies", {
                headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
                params: { channel, ts: threadTs, limit: 100 },
            });

            if (!response.data?.ok) {
                logger.warn(`[ServiceRequestThreadService] Slack replies error: ${response.data?.error}`);
                return [];
            }

            const replies: SlackMessage[] = response.data.messages?.slice(1) || [];
            const messages: ServiceRequestThreadMessageDTO[] = [];

            for (const reply of replies) {
                const user = reply.user ? await this.getSlackUserCached(reply.user) : null;
                const isSecureStayPost = Boolean(reply.bot_id && String(reply.text || "").startsWith("[SecureStay - "));

                messages.push({
                    id: `slack_${reply.ts}`,
                    source: isSecureStayPost ? "securestay" : "slack",
                    userName: user?.real_name || user?.profile?.display_name || user?.name || reply.bot_profile?.name || "Slack User",
                    userAvatar: user?.profile?.image_48 || reply.bot_profile?.icons?.image_48,
                    content: reply.text || "",
                    timestamp: this.slackTsToISOString(reply.ts),
                    createdAt: this.slackTsToISOString(reply.ts),
                });
            }

            return messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        } catch (error) {
            logger.error(`[ServiceRequestThreadService][getSlackThreadMessages] Error: ${error}`);
            return [];
        }
    }

    private async getSlackPermalink(channel: string, messageTs: string) {
        try {
            const response = await axios.get("https://slack.com/api/chat.getPermalink", {
                headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
                params: { channel, message_ts: messageTs },
            });

            if (response.data?.ok && response.data?.permalink) {
                return response.data.permalink as string;
            }
        } catch (error) {
            logger.warn(`[ServiceRequestThreadService][getSlackPermalink] Failed to fetch permalink: ${error}`);
        }

        const workspaceUrl = String(process.env.SLACK_WORKSPACE_URL || "").trim();
        if (!workspaceUrl) return null;

        return `${workspaceUrl.replace(/\/?$/, "/")}archives/${channel}/p${messageTs.replace(".", "")}`;
    }

    private async getSlackUserCached(userId: string): Promise<SlackUser | null> {
        if (this.userCache.has(userId)) return this.userCache.get(userId)!;

        try {
            const response = await axios.get("https://slack.com/api/users.info", {
                headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
                params: { user: userId },
            });

            if (response.data?.ok && response.data?.user) {
                this.userCache.set(userId, response.data.user);
                return response.data.user;
            }
        } catch (error) {
            logger.warn(`[ServiceRequestThreadService][getSlackUserCached] Error: ${error}`);
        }

        return null;
    }

    private slackTsToISOString(ts: string) {
        return new Date(parseFloat(ts) * 1000).toISOString();
    }
}
