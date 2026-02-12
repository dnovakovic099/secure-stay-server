import { NextFunction, Request, Response } from "express";
import logger from "../utils/logger.utils";
import { ReservationInfoService } from "../services/ReservationInfoService";
import { runAsync } from "../utils/asyncUtils";
import axios from "axios";
import sendSlackMessage from "../utils/sendSlackMsg";
import { slackInteractivityEventNames } from "../constant";
import { formatCurrency } from "../helpers/helpers";
import { RefundRequestService } from "../services/RefundRequestService";
import { IssuesService } from "../services/IssuesService";
import { Issue } from "../entity/Issue";
import { ReservationService } from "../services/ReservationService";
import { ActionItemsService } from "../services/ActionItemsService";
import { ExpenseService } from "../services/ExpenseService";
import { SlackEventsService } from "../services/SlackEventsService";
import { MessagingService } from "../services/MessagingServices";
import { ZapierWebhookService } from "../services/ZapierWebhookService";
import { buildZapierEventStatusUpdateMessage, buildZapierStatusChangeThreadMessage } from "../utils/slackMessageBuilder";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { appDatabase } from "../utils/database.util";

export class UnifiedWebhookController {

    constructor() {
        this.handleSlackInteractivity = this.handleSlackInteractivity.bind(this);
        this.handleSlackEventsWebhook = this.handleSlackEventsWebhook.bind(this);
        this.handleCreateIssue = this.handleCreateIssue.bind(this);
        this.handleHostBuddyWebhook = this.handleHostBuddyWebhook.bind(this);
        this.handleHostifyWebhook = this.handleHostifyWebhook.bind(this);
    }

    async handleWebhookResponse(request: Request, response: Response, next: NextFunction) {
        try {
            const body = request.body;
            logger.info(`Received unified - webhook response for event: ${body.event}`);

            const reservationInfoService = new ReservationInfoService();

            switch (body.event) {
                case "reservation.created":
                    await reservationInfoService.saveReservationInfo(body.data, "webhook");
                    // await reservationInfoService.notifyMobileUser(body.data);
                    break;
                case "reservation.updated":
                    await reservationInfoService.updateReservationInfo(body.data.id, body.data, "webhook");
                    // runAsync(reservationInfoService.handleAirbnbClosedResolution(body.data), "handleAirbnbClosedResolution");
                    break;
                case "message.received":
                    // this.handleReservationCancelled(body);
                    break;
                default:
                    logger.info(`Unhandled webhook event: ${body.event}`);
                    break;
            }
            return response.status(200).send("Ok");
        } catch (error) {
            logger.error(`Error handling webhook response: ${error.message}`);
            return next(error);
        }
    }

    async handleSlackInteractivity(request: Request, response: Response, next: NextFunction) {
        try {
            const payload = request.body.payload && JSON.parse(request.body.payload);
            const action = payload.actions[0];
            const user = payload?.user?.username ? `@${payload.user.username}` : 'user';
            const actionData = action.value && JSON.parse(action.value);
            const responseUrl = payload.response_url;
            let messageText = "";
            // logger.info(JSON.stringify(payload));

            switch (action.action_id) {
                case slackInteractivityEventNames.APPROVE_REFUND_REQUEST: {
                    messageText = `Your request to approve refund request is being processed. You will receive a confirmation message shortly.`;
                    await this.sendResponseInSlack(responseUrl, messageText);
                    break;
                }
                case slackInteractivityEventNames.DENY_REFUND_REQUEST: {
                    messageText = `Your request to deny refund request is being processed. You will receive a confirmation message shortly.`;
                    await this.sendResponseInSlack(responseUrl, messageText);
                    break;
                }
                case slackInteractivityEventNames.UPDATE_ACTION_ITEM_STATUS: {
                    logger.info(`Action Item status update request`);
                    break;
                }
                case slackInteractivityEventNames.UPDATE_EXPENSE_STATUS: {
                    logger.info(`Expense status update request`);
                    break;
                }
                case slackInteractivityEventNames.UPDATE_ZAPIER_EVENT_STATUS: {
                    messageText = `Your request to update Zapier event status is being processed...`;
                    await this.sendResponseInSlack(responseUrl, messageText);
                    break;
                }
                case slackInteractivityEventNames.UPDATE_PHOTOGRAPHER_REQUEST_STATUS: {
                    logger.info(`Photographer Request status update request`);
                    break;
                }
                case slackInteractivityEventNames.UPDATE_CLEANER_REQUEST_STATUS: {
                    logger.info(`Cleaner Request status update request`);
                    break;
                }
                default: {
                    if (action.action_id.startsWith(slackInteractivityEventNames.UPDATE_ZAPIER_EVENT_STATUS)) {
                        messageText = `Your request to update Zapier event status is being processed...`;
                        await this.sendResponseInSlack(responseUrl, messageText);
                    } else {
                        messageText = `Action not recognized.`;
                    }
                    break;
                }
            }


            response.send(); 

            switch (action.action_id) {
                case `${slackInteractivityEventNames.APPROVE_REFUND_REQUEST}`: {
                    try {
                        // update the refund request status to Approved
                        const refundRequestService = new RefundRequestService();
                        const refundRequest = await refundRequestService.updateRefundRequestStatus(Number(actionData.id), "Approved", user, true);
                        if (refundRequest) {
                            logger.info(`User ${user} approved refund request ${actionData.guestName} for ${actionData.amount}`);
                            messageText = `✅ <@${user}> approved *${formatCurrency(actionData.amount)}* refund request for *${actionData.guestName}*. *<https://securestay.ai/issues?id=${JSON.parse(actionData.issueId).join(",")}|View Issue>*`;
                            await this.sendResponseInSlack(responseUrl, messageText);
                        } else {
                            messageText = `Something went wrong. ❌ Failed to approve refund request for *${actionData.guestName}*.`;
                            await this.sendResponseInSlack(responseUrl, messageText);
                        }
                    } catch (error) {
                        logger.error(`Error approving refund request: ${error}`);
                        messageText = `❌ Failed to approve refund request for *${actionData.guestName}*.`;
                        await this.sendResponseInSlack(responseUrl, messageText);
                    }

                    break;
                }
                case `${slackInteractivityEventNames.DENY_REFUND_REQUEST}`: {
                    try {
                        // update the refund request status to denied
                        const refundRequestService = new RefundRequestService();
                        const refundRequest = await refundRequestService.updateRefundRequestStatus(Number(actionData.id), "Denied", user, true);
                        if (refundRequest) {
                            logger.info(`User ${user} denied refund request ${actionData.guestName} for ${actionData.amount}`);
                            messageText = `<@${user}> denied *${formatCurrency(actionData.amount)}* refund request for *${actionData.guestName}*. *<https://securestay.ai/issues?id=${JSON.parse(actionData.issueId).join(",")}|View Issue>*`;
                            await this.sendResponseInSlack(responseUrl, messageText);
                        } else {
                            messageText = `Something went wrong. ❌ Failed to deny refund request for *${actionData.guestName}*.`;
                            await this.sendResponseInSlack(responseUrl, messageText);
                        }
                    } catch (error) {
                        logger.error(`Error denying refund request: ${error}`);
                        messageText = `❌ Failed to deny refund request for *${actionData.guestName}*.`;
                        await this.sendResponseInSlack(responseUrl, messageText);
                    }
                    
                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_ACTION_ITEM_STATUS}`: {
                    try {
                        //update the status of the action item
                        const requestObj = JSON.parse(action.selected_option.value);
                        const actionItemsService = new ActionItemsService();
                         await actionItemsService.updateActionItemStatus(Number(requestObj.id), requestObj.status, user);
                    } catch (error) {
                        logger.error(`Error updating action item status: ${error}`);
                    }
                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_EXPENSE_STATUS}`: {
                    try {
                        //update the status of the expense
                        const requestObj = JSON.parse(action.selected_option.value);
                        const expenseService = new ExpenseService();
                        const mockRequest = {
                            body: {
                                expenseId: [requestObj.id],
                                status: requestObj.status
                            }
                        } as Request;
                        await expenseService.updateExpenseStatus(mockRequest, user);
                        logger.info(`User ${user} updated expense ${requestObj.id} status to ${requestObj.status}`);
                    } catch (error) {
                        logger.error(`Error updating expense status: ${error}`);
                    }
                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_ZAPIER_EVENT_STATUS}`: {
                    try {
                        const requestObj = JSON.parse(action.selected_option.value);
                        const zapierService = new ZapierWebhookService();
                        await zapierService.updateEventStatus(Number(requestObj.id), requestObj.status, user);
                        // The service now handles database update AND Slack notification sync (main msg + thread reply)
                    } catch (error) {
                        logger.error(`Error updating Zapier event status: ${error}`);
                        await this.sendResponseInSlack(responseUrl, `❌ Error: ${error.message}`);
                    }
                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_PHOTOGRAPHER_REQUEST_STATUS}`: {
                    try {
                        const requestObj = JSON.parse(action.selected_option.value);
                        const { PhotographerRequestService } = await import('../services/PhotographerRequestService');
                        const photographerService = new PhotographerRequestService();
                        await photographerService.update(Number(requestObj.id), { status: requestObj.status }, user);

                        const statusEmoji = requestObj.status === 'new' ? '🔵' : requestObj.status === 'in_progress' ? '🟡' : '🟢';
                        const statusLabel = requestObj.status === 'new' ? 'New' : requestObj.status === 'in_progress' ? 'In Progress' : 'Completed';
                        messageText = `${statusEmoji} Status updated to *${statusLabel}* by ${user}`;
                        await this.sendResponseInSlack(responseUrl, messageText);
                        logger.info(`User ${user} updated photographer request ${requestObj.id} status to ${requestObj.status}`);
                    } catch (error) {
                        logger.error(`Error updating photographer request status: ${error}`);
                        await this.sendResponseInSlack(responseUrl, `❌ Error: ${error.message}`);
                    }
                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_CLEANER_REQUEST_STATUS}`: {
                    try {
                        const requestObj = JSON.parse(action.selected_option.value);
                        const { CleanerRequestService } = await import('../services/CleanerRequestService');
                        const cleanerService = new CleanerRequestService();
                        await cleanerService.update(Number(requestObj.id), { status: requestObj.status }, user);

                        const statusEmoji = requestObj.status === 'new' ? '🔵' : requestObj.status === 'in_progress' ? '🟡' : '🟢';
                        const statusLabel = requestObj.status === 'new' ? 'New' : requestObj.status === 'in_progress' ? 'In Progress' : 'Completed';
                        messageText = `${statusEmoji} Status updated to *${statusLabel}* by ${user}`;
                        await this.sendResponseInSlack(responseUrl, messageText);
                        logger.info(`User ${user} updated cleaner request ${requestObj.id} status to ${requestObj.status}`);
                    } catch (error) {
                        logger.error(`Error updating cleaner request status: ${error}`);
                        await this.sendResponseInSlack(responseUrl, `❌ Error: ${error.message}`);
                    }
                    break;
                }
                default: {
                    messageText = `Action not recognized.`;
                    await this.sendResponseInSlack(responseUrl, messageText);
                    break;
                }
            }
            logger.info(`Slack interactivity handled successfully for action: ${action.action_id}`);
        } catch (error) {
            logger.error(`Error handling Slack interactivity: ${error}`);
            return next(error);
        }
    }

    private async sendResponseInSlack(responseUrl: string, messageText: string) {
        try {
            const response = await axios.post(responseUrl, {
                text: messageText,
                replace_original: true
            });
            logger.info('Response sent to Slack:', response.data);
        } catch (error) {
            logger.error('Failed to send response to Slack:', error);
        }
    }

    async handleHostBuddyWebhook(request: Request, response: Response, next: NextFunction) {
        try {
            const body = request.body;

            logger.info('[handleHostBuddyWebhook]Received HostBuddy webhook request');
            // logger.info(`[handleHostBuddyWebhook]HostBuddy webhook request body: ${JSON.stringify(body)}`);
            // Process the HostBuddy webhook here
            if (!body || !body.action_items || !Array.isArray(body.action_items)) {
                logger.error("[handleHostBuddyWebhook]Invalid HostBuddy webhook request body");
                return response.status(400).send("Invalid request body");
            }

            for (let item of body.action_items) {
                logger.info(`[handleHostBuddyWebhook]Processing action item: ${JSON.stringify(item)}`);
                switch (item.category) {
                    case "POOL AND SPA":
                    case "PEST CONTROL":
                    case "LANDSCAPING":
                    case "HVAC":
                    case "MAINTENANCE":
                    case "CLEANLINESS": {
                        logger.info(`[handleHostBuddyWebhook]Creating issue for action item: ${JSON.stringify(item)}`);
                        await this.handleCreateIssue(item);
                        break;
                    }
                    case "RESERVATION CHANGES":
                    case "GUEST REQUESTS":
                    case "KNOWLEDGE BASE SUGGESTIONS":
                    case "PROPERTY ACCESS":
                    case "HB NOT RESPONDING":
                    case "OTHER": {
                        logger.info(`[handleHostBuddyWebhook]Creating action item: ${JSON.stringify(item)}`);
                        const actionItemsService = new ActionItemsService();
                        await actionItemsService.createAtionItemFromHostbuddy(item);
                        break;
                    } 
                    default:
                        break;
                }
            }

            return response.status(200).send("Ok");
        } catch (error) {
            logger.error(`Error handling HostBuddy webhook: ${error?.message}`);
            logger.error(error.stack);
            return next(error);
        }
    }

    private async handleCreateIssue(item: any) {
        const guest_name = item.guest_name;
        const description = item.item;
        const status = item.status;
        
        if (status !== "incomplete") {
            logger.info(`[handleHostBuddyWebhook][handleCreateIssue] Action item status is not 'incomplete', skipping issue creation.`);
            return;
        }

        const reservationInfoService = new ReservationInfoService();
        const reservationInfo = await reservationInfoService.getReservationInfoByGuestName(guest_name);
        if (!reservationInfo) {
            logger.warn(`[handleHostBuddyWebhook][handleCreateIssue] No reservation info found for guest: ${guest_name}`);
            return;
        }

        const reservationService = new ReservationService();
        const channels = await reservationService.getChannelList();
        const channel = channels.find(c => c.channelId === reservationInfo.channelId).channelName;
        const creator = "Hostbuddy";

        const data: Partial<Issue> = {
            channel,
            listing_id: String(reservationInfo.listingMapId),
            check_in_date: reservationInfo.arrivalDate,
            reservation_amount: Number(reservationInfo.totalPrice),
            guest_name: reservationInfo.guestName,
            guest_contact_number: reservationInfo.phone,
            issue_description: description,
            creator,
            status: "New",
            reservation_id: String(reservationInfo.id),
            claim_resolution_status: "N/A",
            estimated_reasonable_price: 0,
            final_price: 0,
            claim_resolution_amount: 0,
            category: item.category
        };
        try {
            const issueService = new IssuesService();
            const issue = await issueService.createIssue(data, creator, []);
            logger.info(`[handleHostBuddyWebhook][handleCreateIssue] Issue created successfully`);
            return issue;
        } catch (error) {
            logger.error(`[handleHostBuddyWebhook][handleCreateIssue] Error creating issue: ${error.message}`);
        }
    }

    async handleHostifyWebhook(request: Request, response: Response, next: NextFunction) {
        let message: any;
        try {
            // Parse the JSON from the text body (bodyParser.text() gives us a string)
            try {
                message = JSON.parse(request.body);
            } catch (err) {
                logger.error("❌ Failed to parse SNS body:", request.body);
                return response.sendStatus(400);
            }

            // logger.info("[handleHostifyWebhook] Received SNS message:", message);
            logger.info(`[handleHostifyWebhook] Received SNS message: ${JSON.stringify(message, null, 2)}`);

            // Optional auth verification (Hostify 'auth' query parameter)
            const incomingAuth = request.query.auth as string;
            const expectedAuth = process.env.HOSTIFY_WEBHOOK_SECRET;
            if (expectedAuth && incomingAuth !== expectedAuth) {
                logger.warn("🚫 Invalid Hostify webhook auth");
                return response.sendStatus(401);
            }

            // Check if this is the SNS confirmation message
            if (message.Type === "SubscriptionConfirmation") {
                logger.info("🔔 SNS SubscriptionConfirmation received");
                try {
                    // Confirm the subscription by making a GET request to SubscribeURL
                    await axios.get(message.SubscribeURL);
                    logger.info("✅ SNS subscription confirmed successfully");
                } catch (err: any) {
                    logger.error("❌ Failed to confirm SNS subscription:", err.message);
                }
            } else {
                const action = message.action;
                switch (action) {
                    case "new_reservation":
                        {
                            logger.info("[handleHostifyWebhook] Processing new_reservation action");
                            const reservationInfoService = new ReservationInfoService();
                            await reservationInfoService.handleHostifyReservationEvent(action, message.reservation_id);
                            break;
                        }
                    case "update_reservation":
                        {
                            logger.info("[handleHostifyWebhook] Processing update_reservation action");
                            const reservationInfoService = new ReservationInfoService();
                            await reservationInfoService.handleHostifyReservationEvent(action, message.reservation_id);
                            break;
                        }
                    case "move_reservation":{
                        logger.info("[handleHostifyWebhook] Processing move_reservation action");
                        const reservationInfoService = new ReservationInfoService();
                        await reservationInfoService.handleHostifyReservationEvent(action, message.reservation_id);
                        break;
                    }
                    case "message_new":
                        {
                            logger.info("[handleHostifyWebhook] Processing message_new action");
                            // Only save incoming guest messages (is_incoming === 1)
                            if (message.message && message.type === "message" && message.reservation_id && message.is_incoming === 1 && message.is_automatic === 0) {
                                const messagingService = new MessagingService();
                                await messagingService.saveHostifyGuestMessage(message);
                                logger.info(`[handleHostifyWebhook] Saved guest message ${message.message_id}`);
                            } else {
                                logger.info("[handleHostifyWebhook] Skipping outgoing/representative message");
                            }
                            break;
                        }
                    default:
                        {
                            logger.info(`[handleHostifyWebhook] Unhandled Hostify action: ${action}`);
                            break;
                        }
                }
            }

            return response.sendStatus(200);
        } catch (error: any) {
            logger.error("❌ Error handling Hostify webhook:", error.message);
            logger.error(error.stack);
            return response.sendStatus(500);
        }
    }

    /**
     * Handle Slack Events API webhook
     * This receives message events when users reply to threads
     */
    async handleSlackEventsWebhook(request: Request, response: Response, next: NextFunction) {
        try {
            const body = request.body;
            // logger.info(`[handleSlackEventsWebhook] Received Slack event: ${JSON.stringify(body)}`);

            // Handle URL verification challenge (Slack sends this when setting up the endpoint)
            if (body.type === 'url_verification') {
                logger.info('[handleSlackEventsWebhook] URL verification challenge received');
                return response.status(200).send(body.challenge);
            }

            // Acknowledge immediately (Slack expects response within 3 seconds)
            response.status(200).send();

            // Process the event asynchronously
            if (body.type === 'event_callback' && body.event) {
                const event = body.event;

                // Only process message events
                if (event.type === 'message') {
                    const slackEventsService = new SlackEventsService();
                    runAsync(
                        slackEventsService.handleMessageEvent(event),
                        'handleSlackMessageEvent'
                    );
                }
            }

        } catch (error: any) {
            logger.error(`[handleSlackEventsWebhook] Error:`, error.message);
            logger.error(error.stack);
            // Don't call next() since we already sent response
        }
    }
}