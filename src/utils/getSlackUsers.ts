
import axios from "axios";
import logger from "./logger.utils";

let usersCache: any[] | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

export const getSlackUsers = async () => {
    try {
        const now = Date.now();
        if (usersCache && (now - lastFetchTime < CACHE_DURATION)) {
            return usersCache;
        }

        const response = await axios.get('https://slack.com/api/users.list', {
            headers: {
                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
            }
        });

        if (response.data.ok) {
            // Filter out deleted users and bots if needed, for now just returning all members
            // Mapping to a simpler structure if preferred, but frontend might want avatar etc.
            // Let's keep it simple: id, name, real_name, profile.image_24
            const members = response.data.members
                .filter((member: any) => !member.deleted && !member.is_bot && member.id !== 'USLACKBOT')
                .map((member: any) => ({
                    id: member.id,
                    name: member.name,
                    real_name: member.real_name,
                    display_name: member.profile.display_name || member.real_name,
                    image: member.profile.image_24
                }));

            usersCache = members;
            lastFetchTime = now;
            return members;
        } else {
            logger.error(`Slack users.list failed: ${response.data.error}`);
            return [];
        }
    } catch (error) {
        logger.error("Error fetching Slack users", error);
        return [];
    }
};
