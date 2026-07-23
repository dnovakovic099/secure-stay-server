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
import { GuestCommunicationService } from "../services/GuestCommunicationService";
import { InboxService } from "../services/InboxService";
import { InboxAIService } from "../services/InboxAIService";
import { InboxItemDetectionService } from "../services/InboxItemDetectionService";
import { ZapierWebhookService } from "../services/ZapierWebhookService";
import { buildZapierEventStatusUpdateMessage, buildZapierStatusChangeThreadMessage } from "../utils/slackMessageBuilder";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { appDatabase } from "../utils/database.util";
import sendEmail from "../utils/sendEmai";
import { ReviewService } from "../services/ReviewService";
import { ReviewCheckout } from "../entity/ReviewCheckout";
import { ResolutionService } from "../services/ResolutionService";
import { StripeClient } from "../client/StripeClient";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { format } from "date-fns";
import { ResolutionsTeamSlackService } from "../services/ResolutionsTeamSlackService";

export class UnifiedWebhookController {

    private parseReviewCheckoutActionValue(value: any) {
        const rawValue = String(value || "").trim();
        if (!rawValue) return {};

        if (rawValue.startsWith("{")) {
            try {
                return JSON.parse(rawValue);
            } catch {
                return {};
            }
        }

        const separatorIndex = rawValue.indexOf(":");
        const prefix = separatorIndex >= 0 ? rawValue.slice(0, separatorIndex) : "";
        const actionValue = separatorIndex >= 0 ? rawValue.slice(separatorIndex + 1) : rawValue;

        if (prefix === "status") return { newStatus: actionValue };
        if (prefix === "assignee") return { assignee: actionValue };
        if (prefix === "visibility") return { visibility: actionValue };
        if (prefix === "tag") return { tag: actionValue.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') };
        return {};
    }

    private getReviewCheckoutIdFromAction(action: any, parsedValue?: any) {
        const reviewCheckoutIdFromBlock = String(action.block_id || "").match(/review_checkout_[^:]+:(\d+)/)?.[1];
        return parsedValue?.reviewCheckoutId || reviewCheckoutIdFromBlock || null;
    }

    constructor() {
        this.handleSlackInteractivity = this.handleSlackInteractivity.bind(this);
        this.handleSlackEventsWebhook = this.handleSlackEventsWebhook.bind(this);
        this.handleCreateIssue = this.handleCreateIssue.bind(this);
        this.handleHostBuddyWebhook = this.handleHostBuddyWebhook.bind(this);
        this.handleHostifyWebhook = this.handleHostifyWebhook.bind(this);
        this.handleStripeWebhook = this.handleStripeWebhook.bind(this);
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
            const user = payload?.user?.name || payload?.user?.username || payload?.user?.id || 'Slack User';
            const actionData = action.value && JSON.parse(action.value);
            const responseUrl = payload.response_url;
            let messageText = "";
            // logger.info(JSON.stringify(payload));

            switch (action.action_id) {
                case slackInteractivityEventNames.APPROVE_REFUND_REQUEST: {
                    // Acknowledgment handled by response.send() below; service updates original message + posts thread reply
                    break;
                }
                case slackInteractivityEventNames.DENY_REFUND_REQUEST: {
                    // Acknowledgment handled by response.send() below; service updates original message + posts thread reply
                    break;
                }
                case slackInteractivityEventNames.PAID_REFUND_REQUEST: {
                    // Acknowledgment handled by response.send() below; service updates original message + posts thread reply
                    break;
                }
                case slackInteractivityEventNames.UPDATE_REFUND_REQUEST_STATUS: {
                    logger.info(`Refund request status update request`);
                    break;
                }
                case slackInteractivityEventNames.UPDATE_ISSUE_STATUS: {
                    logger.info(`Issue status update request`);
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
                case slackInteractivityEventNames.UPDATE_MAINTENANCE_FORM_REQUEST_STATUS: {
                    logger.info(`Maintenance Form Request status update request`);
                    break;
                }
                case slackInteractivityEventNames.UPDATE_ITEM_SUPPLY_REQUEST_STATUS: {
                    logger.info(`Item/Supply Request status update request`);
                    break;
                }
                case slackInteractivityEventNames.UPDATE_REVIEW_CHECKOUT_STATUS: {
                    logger.info(`Review checkout status update request`);
                    break;
                }
                case slackInteractivityEventNames.UPDATE_REVIEW_CHECKOUT_ASSIGNEE: {
                    logger.info(`Review checkout assignee update request`);
                    break;
                }
                case slackInteractivityEventNames.UPDATE_REVIEW_CHECKOUT_VISIBILITY: {
                    logger.info(`Review checkout visibility update request`);
                    break;
                }
                case slackInteractivityEventNames.UPDATE_REVIEW_CHECKOUT_TAGS: {
                    logger.info(`Review checkout tags update request`);
                    break;
                }
                default: {
                    if (action.action_id.startsWith(slackInteractivityEventNames.UPDATE_ZAPIER_EVENT_STATUS)) {
                        messageText = `Your request to update Zapier event status is being processed...`;
                        await this.sendResponseInSlack(responseUrl, messageText);
                    } else {
                        logger.warn(`Unhandled Slack interactivity pre-response action: ${action.action_id}`);
                    }
                    break;
                }
            }


            response.send(); 

            switch (action.action_id) {
                case `${slackInteractivityEventNames.APPROVE_REFUND_REQUEST}`: {
                    try {
                        // isRequestFromSlack=false → service handles updateSlackMessage (buttons only) + thread reply
                        const refundRequestService = new RefundRequestService();
                        const refundRequest = await refundRequestService.updateRefundRequestStatus(Number(actionData.id), "Approved", user, false);
                        if (refundRequest) {
                            logger.info(`User ${user} approved refund request ${actionData.guestName} for ${actionData.amount}`);
                        } else {
                            logger.error(`Failed to approve refund request for ${actionData.guestName}`);
                        }
                    } catch (error) {
                        logger.error(`Error approving refund request: ${error}`);
                    }

                    break;
                }
                case `${slackInteractivityEventNames.DENY_REFUND_REQUEST}`: {
                    try {
                        // isRequestFromSlack=false → service handles updateSlackMessage (buttons only) + thread reply
                        const refundRequestService = new RefundRequestService();
                        const refundRequest = await refundRequestService.updateRefundRequestStatus(Number(actionData.id), "Denied", user, false);
                        if (refundRequest) {
                            logger.info(`User ${user} denied refund request ${actionData.guestName} for ${actionData.amount}`);
                        } else {
                            logger.error(`Failed to deny refund request for ${actionData.guestName}`);
                        }
                    } catch (error) {
                        logger.error(`Error denying refund request: ${error}`);
                    }

                    break;
                }
                case `${slackInteractivityEventNames.PAID_REFUND_REQUEST}`: {
                    try {
                        // isRequestFromSlack=false → service handles updateSlackMessage (buttons only) + thread reply
                        const refundRequestService = new RefundRequestService();
                        const refundRequest = await refundRequestService.updateRefundRequestStatus(Number(actionData.id), "Paid", user, false);
                        if (refundRequest) {
                            logger.info(`User ${user} marked refund request ${actionData.guestName} as paid`);
                        } else {
                            logger.error(`Failed to mark refund request as paid for ${actionData.guestName}`);
                        }
                    } catch (error) {
                        logger.error(`Error marking refund request as paid: ${error}`);
                    }

                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_REFUND_REQUEST_STATUS}`: {
                    try {
                        const requestObj = JSON.parse(action.selected_option?.value || action.value);
                        const refundRequestService = new RefundRequestService();
                        const refundRequest = await refundRequestService.updateRefundRequestStatus(Number(requestObj.id), requestObj.status, user, false);
                        if (refundRequest) {
                            logger.info(`User ${user} updated refund request ${requestObj.id} status to ${requestObj.status}`);
                        } else {
                            logger.error(`Failed to update refund request ${requestObj.id} status to ${requestObj.status}`);
                        }
                    } catch (error) {
                        logger.error(`Error updating refund request status: ${error}`);
                    }

                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_REFUND_REQUEST_APPROVED_BY}`: {
                    try {
                        const requestObj = JSON.parse(action.selected_option?.value || action.value);
                        const refundRequestService = new RefundRequestService();
                        const refundRequest = await refundRequestService.updateRefundRequestApprovedBy(Number(requestObj.id), requestObj.approvedBy, user);
                        if (refundRequest) {
                            logger.info(`User ${user} updated refund request ${requestObj.id} approved by to ${requestObj.approvedBy}`);
                        } else {
                            logger.error(`Failed to update refund request ${requestObj.id} approved by to ${requestObj.approvedBy}`);
                        }
                    } catch (error) {
                        logger.error(`Error updating refund request approved by: ${error}`);
                    }

                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_ISSUE_STATUS}`: {
                    try {
                        const requestObj = JSON.parse(action.selected_option.value);
                        const issuesService = new IssuesService();
                        await issuesService.updateStatus(
                            Number(requestObj.id),
                            requestObj.status,
                            user,
                            requestObj.statusField === "gr" ? "gr" : "ir",
                            { activitySource: "slack" }
                        );
                    } catch (error) {
                        logger.error(`Error updating issue status: ${error}`);
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
                case `${slackInteractivityEventNames.UPDATE_MAINTENANCE_FORM_REQUEST_STATUS}`: {
                    try {
                        const requestObj = JSON.parse(action.selected_option.value);
                        const { MaintenanceFormRequestService } = await import('../services/MaintenanceFormRequestService');
                        const maintenanceService = new MaintenanceFormRequestService();
                        await maintenanceService.update(Number(requestObj.id), { status: requestObj.status }, user);

                        const statusEmoji = requestObj.status === 'new' ? '🔵' : requestObj.status === 'in_progress' ? '🟡' : '🟢';
                        const statusLabel = requestObj.status === 'new' ? 'New' : requestObj.status === 'in_progress' ? 'In Progress' : 'Completed';
                        messageText = `${statusEmoji} Status updated to *${statusLabel}* by ${user}`;
                        await this.sendResponseInSlack(responseUrl, messageText);
                        logger.info(`User ${user} updated maintenance form request ${requestObj.id} status to ${requestObj.status}`);
                    } catch (error) {
                        logger.error(`Error updating maintenance form request status: ${error}`);
                        await this.sendResponseInSlack(responseUrl, `❌ Error: ${error.message}`);
                    }
                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_ITEM_SUPPLY_REQUEST_STATUS}`: {
                    try {
                        const requestObj = JSON.parse(action.selected_option.value);
                        const { ItemSupplyRequestService } = await import('../services/ItemSupplyRequestService');
                        const itemSupplyService = new ItemSupplyRequestService();
                        await itemSupplyService.update(Number(requestObj.id), { status: requestObj.status }, user);

                        const statusEmoji = requestObj.status === 'new' ? '🔵' : requestObj.status === 'in_progress' ? '🟡' : '🟢';
                        const statusLabel = requestObj.status === 'new' ? 'New' : requestObj.status === 'in_progress' ? 'In Progress' : 'Completed';
                        messageText = `${statusEmoji} Status updated to *${statusLabel}* by ${user}`;
                        await this.sendResponseInSlack(responseUrl, messageText);
                        logger.info(`User ${user} updated item supply request ${requestObj.id} status to ${requestObj.status}`);
                    } catch (error) {
                        logger.error(`Error updating item supply request status: ${error}`);
                        await this.sendResponseInSlack(responseUrl, `❌ Error: ${error.message}`);
                    }
                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_REVIEW_CHECKOUT_STATUS}`: {
                    try {
                        const requestObj = this.parseReviewCheckoutActionValue(action.selected_option?.value || action.value);
                        const reviewCheckoutId = this.getReviewCheckoutIdFromAction(action, requestObj);
                        const { newStatus } = requestObj;
                        const reviewService = new ReviewService();
                        await reviewService.updateReviewCheckout(Number(reviewCheckoutId), { status: newStatus }, user);
                        logger.info(`${user} updated review checkout ${reviewCheckoutId} status to ${newStatus}`);
                    } catch (error) {
                        logger.error(`Error updating review checkout status: ${error}`);
                    }
                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_REVIEW_CHECKOUT_ASSIGNEE}`: {
                    try {
                        const requestObj = this.parseReviewCheckoutActionValue(action.selected_option?.value || action.value);
                        const reviewCheckoutId = this.getReviewCheckoutIdFromAction(action, requestObj);
                        const { assignee } = requestObj;
                        const reviewService = new ReviewService();
                        await reviewService.updateReviewCheckout(Number(reviewCheckoutId), { assignee: assignee || null }, user);
                        logger.info(`${user} updated review checkout ${reviewCheckoutId} assignee to ${assignee || 'Unassigned'}`);
                    } catch (error) {
                        logger.error(`Error updating review checkout assignee: ${error}`);
                    }
                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_REVIEW_CHECKOUT_VISIBILITY}`: {
                    try {
                        const requestObj = this.parseReviewCheckoutActionValue(action.selected_option?.value || action.value);
                        const reviewCheckoutId = this.getReviewCheckoutIdFromAction(action, requestObj);
                        const { visibility } = requestObj;
                        const reviewService = new ReviewService();
                        await reviewService.updateReviewCheckout(Number(reviewCheckoutId), { visibility }, user);
                        logger.info(`${user} updated review checkout ${reviewCheckoutId} visibility to ${visibility}`);
                    } catch (error) {
                        logger.error(`Error updating review checkout visibility: ${error}`);
                    }
                    break;
                }
                case `${slackInteractivityEventNames.UPDATE_REVIEW_CHECKOUT_TAGS}`: {
                    try {
                        const selectedOptions = action.selected_options || [];
                        const selectedTags = selectedOptions
                            .map((option: any) => this.parseReviewCheckoutActionValue(option.value)?.tag)
                            .filter(Boolean);
                        const firstSelectedValue = selectedOptions.length
                            ? this.parseReviewCheckoutActionValue(selectedOptions[0].value)
                            : this.parseReviewCheckoutActionValue(action.value);
                        const reviewCheckoutId = this.getReviewCheckoutIdFromAction(action, firstSelectedValue);

                        const reviewCheckout = await appDatabase.getRepository(ReviewCheckout).findOne({
                            where: { id: Number(reviewCheckoutId) },
                            relations: ["reservationInfo"],
                        });

                        if (!reviewCheckout?.reservationInfo?.id) {
                            throw new Error(`Review checkout ${reviewCheckoutId} was not found`);
                        }

                        const reservationInfoService = new ReservationInfoService();
                        await reservationInfoService.updateReservationTags(
                            Number(reviewCheckout.reservationInfo.id),
                            selectedTags,
                            user
                        );
                        new ResolutionsTeamSlackService()
                            .syncRootMessageForReviewCheckout(Number(reviewCheckoutId))
                            .catch((error) => logger.error(`Error syncing review checkout tags root message: ${error}`));
                        logger.info(`${user} updated review checkout ${reviewCheckoutId} tags to ${selectedTags.join(", ") || "none"}`);
                    } catch (error) {
                        logger.error(`Error updating review checkout tags: ${error}`);
                    }
                    break;
                }
                default: {
                    logger.warn(`Unhandled Slack interactivity action: ${action.action_id}`);
                    break;
                }
            }
            logger.info(`Slack interactivity handled successfully for action: ${action.action_id}`);
        } catch (error) {
            logger.error(`Error handling Slack interactivity: ${error}`);
            return next(error);
        }
    }

    private async sendResponseInSlack(responseUrl: string, messageText: string, replaceOriginal = true) {
        try {
            const response = await axios.post(responseUrl, {
                text: messageText,
                replace_original: replaceOriginal
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
            logger.info(`[handleHostifyWebhook] Received SNS message: ${JSON.stringify(message)}`);

            // Optional auth verification (Hostify 'auth' query parameter).
            // Accept either env var name — prod currently sets HOSTIFY_WEBHOOK_AUTH_KEY.
            const incomingAuth = request.query.auth as string;
            const expectedAuth = process.env.HOSTIFY_WEBHOOK_SECRET || process.env.HOSTIFY_WEBHOOK_AUTH_KEY;
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
            } else if (message.Type === "UnsubscribeConfirmation") {
                logger.info("🔕 SNS UnsubscribeConfirmation received (ignored)");
            } else {
                // Hostify delivers via Amazon SNS, so live notifications arrive
                // enveloped as { Type: "Notification", Message: "<stringified payload>" }.
                // Unwrap to get the actual Hostify event. (Direct posts without the
                // envelope are still supported as a fallback.)
                let payload: any = message;
                if (message.Type === "Notification" && typeof message.Message === "string") {
                    try {
                        payload = JSON.parse(message.Message);
                    } catch {
                        logger.warn("[handleHostifyWebhook] SNS Notification.Message was not JSON; using raw envelope");
                        payload = message;
                    }
                }
                const action = payload.action;
                switch (action) {
                    case "new_reservation":
                        {
                            logger.info("[handleHostifyWebhook] Processing new_reservation action");
                            const reservationInfoService = new ReservationInfoService();
                            await reservationInfoService.handleHostifyReservationEvent(action, payload.reservation_id);
                            break;
                        }
                    case "update_reservation":
                        {
                            logger.info("[handleHostifyWebhook] Processing update_reservation action");
                            const reservationInfoService = new ReservationInfoService();
                            await reservationInfoService.handleHostifyReservationEvent(action, payload.reservation_id);
                            break;
                        }
                    case "move_reservation":{
                        logger.info("[handleHostifyWebhook] Processing move_reservation action");
                        const reservationInfoService = new ReservationInfoService();
                        await reservationInfoService.handleHostifyReservationEvent(action, payload.reservation_id);
                        break;
                    }
                    case "message_new":
                        {
                            logger.info("[handleHostifyWebhook] Processing message_new action");

                            // v2 inbox: persist EVERY message (incoming + outgoing +
                            // automatic + system) into the local inbox store so it stays
                            // complete and we can drop polling once the webhook is live.
                            if (payload.message_id && payload.thread_id) {
                                try {
                                    const inboxService = new InboxService();
                                    await inboxService.ingestWebhookMessage(payload);
                                } catch (inboxErr: any) {
                                    logger.error(`[handleHostifyWebhook] inbox v2 ingest failed: ${inboxErr.message}`);
                                }

                                // AI response bot: consider auto-replying to inbound guest
                                // messages. maybeAutoRespond self-gates on the DB
                                // auto-respond toggle (AI Copilot Settings) plus the
                                // AI_MESSAGING_AUTOSEND_ENABLED env kill-switch, and
                                // applies strict guardrails; fire-and-forget so we never
                                // delay the webhook ack.
                                if (
                                    InboxAIService.isEnabled() &&
                                    payload.is_incoming === 1 &&
                                    payload.is_automatic === 0
                                ) {
                                    new InboxAIService()
                                        .maybeAutoRespond(Number(payload.thread_id), Number(payload.message_id))
                                        .then((r) => {
                                            if (r.sent) {
                                                logger.info(`[handleHostifyWebhook] AI auto-replied to thread ${payload.thread_id}`);
                                            }
                                        })
                                        .catch((e: any) =>
                                            logger.error(`[handleHostifyWebhook] AI auto-respond error: ${e?.message}`)
                                        );
                                }

                                // Learning loop: when the team replies (outgoing, human),
                                // link it to the pending AI shadow suggestion so we always
                                // have (guest message → AI suggestion → team reply) triples
                                // to measure and improve against. Fire-and-forget.
                                if (
                                    InboxAIService.isEnabled() &&
                                    payload.is_incoming !== 1 &&
                                    payload.is_automatic === 0
                                ) {
                                    new InboxAIService()
                                        .linkActualReply(Number(payload.thread_id), Number(payload.message_id))
                                        .catch((e: any) =>
                                            logger.error(`[handleHostifyWebhook] link team reply error: ${e?.message}`)
                                        );
                                }

                                // Detect our own Action Items / Guest Issues from the guest
                                // message. Env-gated (AI_ITEM_DETECTION_ENABLED) and it only
                                // writes proposals to ai_detected_items. Fire-and-forget.
                                if (
                                    InboxItemDetectionService.isEnabledByEnv() &&
                                    payload.is_incoming === 1 &&
                                    payload.is_automatic === 0
                                ) {
                                    // Debounced: bursts of guest messages produce ONE
                                    // whole-thread scan a few minutes after the burst starts.
                                    InboxItemDetectionService.scheduleDetection(
                                        Number(payload.thread_id),
                                        Number(payload.message_id)
                                    );
                                }
                            }

                            // Legacy `messages` table + guest_communication: keep incoming-only
                            // behaviour so the unanswered-message alert job is unaffected.
                            if (payload.message && payload.type === "message" && payload.reservation_id && payload.is_incoming === 1 && payload.is_automatic === 0) {
                                const messagingService = new MessagingService();
                                await messagingService.saveHostifyGuestMessage(payload);
                                const guestCommunicationService = new GuestCommunicationService();
                                await guestCommunicationService.storeHostifyWebhookMessage(payload);
                                logger.info(`[handleHostifyWebhook] Saved guest message ${payload.message_id}`);
                            } else {
                                logger.info("[handleHostifyWebhook] Skipping legacy incoming-only save (kept v2 ingest)");
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

                // Handle message events
                if (event.type === 'message') {
                    const slackEventsService = new SlackEventsService();
                    runAsync(
                        slackEventsService.handleMessageEvent(event),
                        'handleSlackMessageEvent'
                    );
                }

                // Handle app_mention events (when bot is @mentioned)
                if (event.type === 'app_mention') {
                    const slackEventsService = new SlackEventsService();
                    runAsync(
                        slackEventsService.handleAppMention(event),
                        'handleSlackAppMention'
                    );
                }
            }

        } catch (error: any) {
            logger.error(`[handleSlackEventsWebhook] Error:`, error.message);
            logger.error(error.stack);
            // Don't call next() since we already sent response
        }
    }

    /**
     * Handle Stripe webhooks (Minimalist approach - No verification)
     */
    async handleStripeWebhook(request: Request, response: Response, next: NextFunction) {
        try {
            const event = request.body;

            logger.info(`[STRIPE_DISPUTE] Received event: ${event.type}`);

            if (event.type === 'charge.dispute.closed') {
                const dispute = event.data.object;
                if (dispute.status === 'lost') {
                    await this.handleLostDispute(dispute);
                }
            }

                logger.info(`[STRIPE_DISPUTE] ${event.type} event body: ${JSON.stringify(event)}`);
                await sendEmail(
                    `Stripe ${event.type} Notification`,
                    `<p>A Stripe <b>${event.type}</b> event has occurred.</p>
                     <p><b>Event Body:</b></p>
                     <pre>${JSON.stringify(event)}</pre>`,
                    process.env.EMAIL_FROM,
                    "prasannakb440@gmail.com"
                );

            return response.status(200).send("Ok");
        } catch (error: any) {
            logger.error(`[STRIPE_DISPUTE] Error handling webhook: ${error.message}`);
            return next(error);
        }
    }

    private async handleLostDispute(dispute: any) {
        try {
            const chargeId: string | null = dispute.charge;
            if (!chargeId) {
                logger.warn(`[STRIPE_DISPUTE] Dispute ${dispute.id} has no charge; skipping resolution creation`);
                return;
            }

            const stripeClient = new StripeClient();
            const charge = await stripeClient.getChargeById(chargeId);
            const email = charge.billing_details?.email || charge.receipt_email;
            if (!email) {
                logger.warn(`[STRIPE_DISPUTE] No email on charge ${chargeId} for dispute ${dispute.id}; skipping resolution creation`);
                return;
            }

            const validStatuses = ["new", "accepted", "modified", "ownerStay", "moved"];
            const reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
            const reservation = await reservationRepo
                .createQueryBuilder("reservation")
                .where("reservation.guestEmail = :email", { email })
                .andWhere("reservation.status IN (:...validStatuses)", { validStatuses })
                .orderBy("reservation.arrivalDate", "DESC")
                .getOne();

            if (!reservation) {
                logger.warn(`[STRIPE_DISPUTE] No valid reservation for email ${email} (dispute ${dispute.id}); skipping resolution creation`);
                return;
            }

            const amount = -(dispute.amount / 100);
            const claimDate = format(new Date(), 'yyyy-MM-dd');
            const arrivalDate = reservation.arrivalDate ? format(new Date(reservation.arrivalDate), 'yyyy-MM-dd') : claimDate;
            const departureDate = reservation.departureDate ? format(new Date(reservation.departureDate), 'yyyy-MM-dd') : claimDate;

            const resolutionService = new ResolutionService();
            await resolutionService.createResolution({
                category: 'dispute',
                description: `Lost Stripe dispute (Reason: ${dispute.reason})`,
                listingMapId: reservation.listingMapId,
                reservationId: reservation.id,
                guestName: reservation.guestName,
                claimDate,
                amount,
                arrivalDate,
                departureDate,
                creationSource: 'stripe_webhook',
                type: 'dispute',
            }, 'system');

            logger.info(`[STRIPE_DISPUTE] Resolution created for dispute ${dispute.id}: reservationId=${reservation.id}, email=${email}, amount=${amount}`);
        } catch (error: any) {
            logger.error(`[STRIPE_DISPUTE] Error handling lost dispute ${dispute.id}: ${error.message}`);
            throw error;
        }
    }
}
