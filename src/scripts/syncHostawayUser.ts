import { HostawayUserService } from "../services/HostawayUserService";
import logger from "../utils/logger.utils";

export async function syncHostawayUser() {
    logger.info("Syncing hostaway user...");
    const hostawayUserService = new HostawayUserService();
    await hostawayUserService.syncHostawayUser();
    logger.info("Hostaway user synchronization completed successfully.");
}