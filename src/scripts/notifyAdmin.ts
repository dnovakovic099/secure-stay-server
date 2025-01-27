// This script will notify admin for unanswered guest messages for more than 15 minuts

import { MessagingService } from "../services/MessagingServices";
import logger from "../utils/logger.utils";

export async function checkUnasweredMessages() {
    logger.info("Checking unanswered guest messages...");
    const messagingServices = new MessagingService();
    await messagingServices.processUnanweredMessages();
    logger.info("Checking unanswered guest messages completed");
}