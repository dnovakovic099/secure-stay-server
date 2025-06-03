import { NextFunction, Request, Response } from "express";
import logger from "../utils/logger.utils";
import { ReservationInfoService } from "../services/ReservationInfoService";
import { runAsync } from "../utils/asyncUtils";
import axios from "axios";
import { slackInteractivityEventNames } from "../constant";
import { formatCurrency } from "../helpers/helpers";

export class UnifiedWebhookController {

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
            console.log(JSON.stringify(payload.message.blocks));

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


            // Send updated message to Slack via response_url
            try {
                await axios.post(responseUrl, {
                    text: messageText,
                    replace_original: true
                });
            } catch (error) {
                logger.error('Failed to send response to Slack:', error.response?.data || error.message);
            }

            // Slack needs a 200 response ASAP
            response.send();

            switch (action.action_id) {
                case `${slackInteractivityEventNames.APPROVE_REFUND_REQUEST}`: {
                    logger.info(`User ${user} approved refund request ${actionData.guestName} for ${actionData.amount}`);

                    messageText = `✅ <@${user}> approved *${formatCurrency(actionData.amount)}* refund request for *${actionData.guestName}*.`;
                    try {
                        const res = await axios.post(responseUrl, {
                            text: messageText,
                            replace_original: true
                        });
                        console.log('Response sent to Slack:', res.data);
                    } catch (error) {
                        logger.error('Failed to send response to Slack:', error.response?.data || error.message);
                    }

                    break;
                }
                case `${slackInteractivityEventNames.DENY_REFUND_REQUEST}`: {
                    logger.info(`User ${user} denied refund request ${actionData.guestName} for ${actionData.amount}`);

                    messageText = `❌ <@${user}> denied *${formatCurrency(actionData.amount)}* refund request for *${actionData.guestName}*.`;
                    try {
                        const res = await axios.post(responseUrl, {
                            text: messageText,
                            replace_original: true
                        });
                        console.log('Response sent to Slack:', res.data);
                    } catch (error) {
                        logger.error('Failed to send response to Slack:', error.response?.data || error.message);
                    }

                    break;
                }
                default: {
                    setTimeout(() => {
                        messageText = `Action not recognized.`;
                    }, 10000);
                    break;
                }
            }


        } catch (error) {
            logger.error(`Error handling Slack interactivity: ${error}`);
            return next(error);
        }
    }
}