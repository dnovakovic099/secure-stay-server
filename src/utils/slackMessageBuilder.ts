import { slackInteractivityEventNames } from "../constant";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { formatCurrency } from "../helpers/helpers";

export const buildRefundRequestMessage = (refundRequest: RefundRequestEntity) => {
    const channelName = "#bookkeeping";
    const slackMessage = {
        channel: channelName,
        text: `New Refund Request for ${refundRequest.guestName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "*You have a new refund request:*"
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Reservation:*\n${refundRequest.guestName}` },
                    { type: "mrkdwn", text: `*Listing:*\n${refundRequest.listingName}` },
                    { type: "mrkdwn", text: `*Amount:*\n${formatCurrency(refundRequest.refundAmount)}` },
                    { type: "mrkdwn", text: `*Explaination:*\n${refundRequest.explaination}` }
                ]
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Approve", emoji: true },
                        style: "primary",
                        action_id: slackInteractivityEventNames.APPROVE_REFUND_REQUEST,
                        value: `${JSON.stringify({
                            id: refundRequest.id,
                            guestName: refundRequest.guestName,
                            listingName: refundRequest.listingName,
                            amount: refundRequest.refundAmount
                        })
                            }`
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Deny", emoji: true },
                        style: "danger",
                        action_id: slackInteractivityEventNames.DENY_REFUND_REQUEST,
                        value: `${JSON.stringify({
                            id: refundRequest.id,
                            guestName: refundRequest.guestName,
                            listingName: refundRequest.listingName,
                            amount: refundRequest.refundAmount
                        })
                            }`
                    }
                ]
            }
        ]
    };

    return slackMessage;
};
