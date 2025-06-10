import axios from "axios";
import logger from "./logger.utils";

const sendSlackMessage = async (message: any, threadTs?: string) => {
    try {
        const payload = threadTs ? { ...message, thread_ts: threadTs } : message;

        const response = await axios.post('https://slack.com/api/chat.postMessage', payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
            }
        });

        logger.info(JSON.stringify(response.data));
        logger.info(`Message sent to Slack: ${JSON.stringify(payload)}`);

        return response.data;
    } catch (err) {
        logger.error("Error sending message to Slack:", err);
    }
};

export default sendSlackMessage;