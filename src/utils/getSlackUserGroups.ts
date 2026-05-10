import axios from "axios";
import logger from "./logger.utils";

let userGroupsCache: any[] | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 60;

export const getSlackUserGroups = async () => {
    try {
        const now = Date.now();
        if (userGroupsCache && now - lastFetchTime < CACHE_DURATION) {
            return userGroupsCache;
        }

        const response = await axios.get("https://slack.com/api/usergroups.list", {
            headers: {
                Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
            },
            params: {
                include_disabled: false,
                include_users: false,
            },
        });

        if (response.data.ok) {
            const groups = (response.data.usergroups || []).map((group: any) => ({
                id: group.id,
                handle: group.handle,
                name: group.name || group.handle,
                description: group.description || "",
            }));
            userGroupsCache = groups;
            lastFetchTime = now;
            return groups;
        }

        logger.error(`Slack usergroups.list failed: ${response.data.error}`);
        return [];
    } catch (error) {
        logger.error("Error fetching Slack user groups", error);
        return [];
    }
};
