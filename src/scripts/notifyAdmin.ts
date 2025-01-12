// This script will notify admin for unanswered guest messages for more than 15 minuts

import { MessagingService } from "../services/MessagingServices";

export async function checkUnasweredMessages() {
    console.log("Checking unanswered guest messages...");
    const messagingServices = new MessagingService();
    await messagingServices.processUnanweredMessages();
    console.log("Checking unanswered guest messages completed");
}