import axios from 'axios';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || 'xoxb-6872717987008-10390993134212-87PKK5bFPbvLBMPtWgbjwX9b';
const SLACK_API_BASE = 'https://slack.com/api';

export interface SlackMessage {
    ts: string;
    user: string;
    text: string;
    thread_ts?: string;
}

export interface SlackUser {
    id: string;
    name: string;
    real_name: string;
    profile: {
        image_48: string;
        display_name: string;
    };
}

export class SlackService {
    private headers = {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json'
    };

    /**
     * Get thread replies from a Slack channel
     */
    async getThreadReplies(channelId: string, threadTs: string): Promise<SlackMessage[]> {
        try {
            const response = await axios.get(`${SLACK_API_BASE}/conversations.replies`, {
                headers: this.headers,
                params: {
                    channel: channelId,
                    ts: threadTs,
                    limit: 100
                }
            });

            if (!response.data.ok) {
                console.error('Slack API error:', response.data.error);
                return [];
            }

            // Return all messages except the parent (first one)
            return response.data.messages?.slice(1) || [];
        } catch (error) {
            console.error('Error fetching Slack thread replies:', error);
            return [];
        }
    }

    /**
     * Post a message to a Slack thread
     */
    async postThreadReply(channelId: string, threadTs: string, text: string): Promise<SlackMessage | null> {
        try {
            const response = await axios.post(`${SLACK_API_BASE}/chat.postMessage`, {
                channel: channelId,
                thread_ts: threadTs,
                text: text
            }, { headers: this.headers });

            if (!response.data.ok) {
                console.error('Slack API error:', response.data.error);
                return null;
            }

            return response.data.message;
        } catch (error) {
            console.error('Error posting to Slack thread:', error);
            return null;
        }
    }

    /**
     * Get user info from Slack
     */
    async getUserInfo(userId: string): Promise<SlackUser | null> {
        try {
            const response = await axios.get(`${SLACK_API_BASE}/users.info`, {
                headers: this.headers,
                params: { user: userId }
            });

            if (!response.data.ok) {
                console.error('Slack API error:', response.data.error);
                return null;
            }

            return response.data.user;
        } catch (error) {
            console.error('Error fetching Slack user info:', error);
            return null;
        }
    }

    /**
     * Cache for user info to avoid repeated API calls
     */
    private userCache: Map<string, SlackUser> = new Map();

    async getUserInfoCached(userId: string): Promise<SlackUser | null> {
        if (this.userCache.has(userId)) {
            return this.userCache.get(userId)!;
        }

        const user = await this.getUserInfo(userId);
        if (user) {
            this.userCache.set(userId, user);
        }
        return user;
    }

    /**
     * Convert Slack timestamp to Date
     */
    static slackTsToDate(ts: string): Date {
        const unixSeconds = parseFloat(ts);
        return new Date(unixSeconds * 1000);
    }
}
