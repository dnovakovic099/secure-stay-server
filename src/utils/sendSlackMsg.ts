import axios, { AxiosError } from "axios";
import logger from "./logger.utils";

const sendSlackMessage = async (message: any, threadTs?: string, attempt = 1): Promise<any> => {
    try {
        let payload = threadTs ? { ...message, thread_ts: threadTs } : message;

        // Honor username and icon if provided in the message object
        if (message.bot_name) {
            payload.username = message.bot_name;
            delete payload.bot_name;
        }
        if (message.bot_icon) {
            payload.icon_url = message.bot_icon;
            delete payload.bot_icon;
        }

        // Disable auto-expansion of links
        payload.unfurl_links = false;
        payload.unfurl_media = false;

        const response = await axios.post('https://slack.com/api/chat.postMessage', payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
            }
        });

        return response.data;
    } catch (err) {
        const axiosErr = err as AxiosError;
        if (axiosErr.response?.status === 429 && attempt === 1) {
            const retryAfter = parseInt(axiosErr.response.headers['retry-after'] || '1', 10);
            logger.warn(`Slack rate limited (429). Retrying after ${retryAfter}s`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            return sendSlackMessage(message, threadTs, 2);
        }
        logger.error("Error sending message to Slack:", err);
    }
};

export default sendSlackMessage;