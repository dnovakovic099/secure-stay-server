import axios from "axios";
import logger from "./logger.utils";

const sendSlackMessage = async (message: any, threadTs?: string) => {
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

        // logger.info(JSON.stringify(response.data));
        logger.info(`Message sent to Slack: ${JSON.stringify(payload)}`);

        return response.data;
    } catch (err) {
        logger.error("Error sending message to Slack:", err);
    }
};

export default sendSlackMessage;