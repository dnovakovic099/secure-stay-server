import axios from "axios";
import logger from "./logger.utils";

const sendSlackMessage = async (message: any) => {
    try {
        const response=await axios.post('https://slack.com/api/chat.postMessage', message, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
            }
        });
        logger.info(JSON.stringify(response.data))
        logger.info(`Message sent to slack: ${JSON.stringify(message)}`);
    } catch (err) {
        logger.error("Error sending message to Slack:", err);
    }
};

export default sendSlackMessage;