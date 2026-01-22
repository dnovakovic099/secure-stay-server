// This script will notify admin for unanswered guest messages for more than 15 minuts

import { MessagingService } from "../services/MessagingServices";
import { RefundRequestService } from "../services/RefundRequestService";
import { ReviewDetailService } from "../services/ReviewDetailService";
import { ReviewService } from "../services/ReviewService";
import logger from "../utils/logger.utils";

export async function checkUnasweredMessages() {
    // logger.info("Checking unanswered guest messages...");
    const messagingServices = new MessagingService();
    await messagingServices.processUnanweredMessages();
    // logger.info("Checking unanswered guest messages completed");
}

export async function checkUnasweredMessagesHostify() {
    logger.info("Checking unanswered guest messages (Hostify)...");
    const messagingServices = new MessagingService();
    await messagingServices.processUnansweredMessagesHostify();
    logger.info("Checking unanswered guest messages (Hostify) completed");
}

export async function checkForUnresolvedReviews() {
    logger.info("Checking unresolved reviews...");
    const reviewService = new ReviewService();
    await reviewService.checkForUnresolvedReviews();
    logger.info("Checking unresolved reviews completed");
}

export async function checkUpdatedReviews() {
    logger.info("Checking updated reviews...");
    const reviewDetailService = new ReviewDetailService();
    await reviewDetailService.checkUpdatedReviews();
    logger.info("Checking updated reviews completed");
}

export async function checkForPendingRefundRequest(){
    logger.info("Checking pending refund requested reviews...");
    const reviewService = new RefundRequestService();
    await reviewService.checkForPendingRefundRequest();
    logger.info("Checking pending refund requested reviews completed");
}