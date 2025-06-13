import axios from "axios";
import logger from "./logger.utils";

const updateSlackMessage = async (message: any, messageTs: string, channel: string) => {
    try {
        const payload = {
            ...message,
            channel: channel,
            ts: messageTs
        };

        const response = await axios.post('https://slack.com/api/chat.update', payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
            }
        });

        logger.info(JSON.stringify(response.data));
        logger.info(`Message updated to Slack: ${JSON.stringify(payload)}`);

        return response.data;
    } catch (err) {
        logger.error("Error updated message to Slack:", err);
    }
};

export default updateSlackMessage;