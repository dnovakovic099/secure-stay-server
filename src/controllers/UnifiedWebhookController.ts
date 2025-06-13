import { NextFunction, Request, Response } from "express";
import logger from "../utils/logger.utils";
import { ReservationInfoService } from "../services/ReservationInfoService";
import { runAsync } from "../utils/asyncUtils";
import axios from "axios";
import { slackInteractivityEventNames } from "../constant";
import { formatCurrency } from "../helpers/helpers";
import { RefundRequestService } from "../services/RefundRequestService";

export class UnifiedWebhookController {

    constructor() {
        this.handleSlackInteractivity = this.handleSlackInteractivity.bind(this);
    }

    async handleWebhookResponse(request: Request, response: Response, next: NextFunction) {
        try {
            const body = request.body;
            logger.info(`Received unified - webhook response for event: ${body.event}`);

            const reservationInfoService = new ReservationInfoService();

            switch (body.event) {
                case "reservation.created":
                    await reservationInfoService.saveReservationInfo(body.data);
                    // await reservationInfoService.notifyMobileUser(body.data);
                    break;
                case "reservation.updated":
                    await reservationInfoService.updateReservationInfo(body.data.id, body.data);
                    runAsync(reservationInfoService.handleAirbnbClosedResolution(body.data), "handleAirbnbClosedResolution");
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
            const payload = JSON.parse(request.body.payload);
            const action = payload.actions[0];
            const user = payload.user.username;
            const actionData = JSON.parse(action.value);
            const responseUrl = payload.response_url;
            let messageText = "";
            console.log(JSON.stringify(payload));

            switch (action.action_id) {
                case slackInteractivityEventNames.APPROVE_REFUND_REQUEST: {
                    messageText = `Your request to approve refund request is being processed. You will receive a confirmation message shortly.`;
                    break;
                }
                case slackInteractivityEventNames.DENY_REFUND_REQUEST: {
                    messageText = `Your request to deny refund request is being processed. You will receive a confirmation message shortly.`;
                    break;
                }
                default: {
                    messageText = `Action not recognized.`;
                    break;
                }
            }

            await this.sendResponseInSlack(responseUrl, messageText);
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
}