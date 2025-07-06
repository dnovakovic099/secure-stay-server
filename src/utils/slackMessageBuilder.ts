import { slackInteractivityEventNames } from "../constant";
import { ActionItems } from "../entity/ActionItems";
import { ClientTicket } from "../entity/ClientTicket";
import { Issue } from "../entity/Issue";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { formatCurrency } from "../helpers/helpers";

const REFUND_REQUEST_CHANNEL = "#bookkeeping";
const ISSUE_NOTIFICATION_CHANNEL = "#issue-resolution";
const GUEST_RELATIONS = "#guest-relations";

export const buildRefundRequestMessage = (refundRequest: RefundRequestEntity) => {
    const slackMessage = {
        channel: REFUND_REQUEST_CHANNEL,
        text: `New Refund Request for ${refundRequest.guestName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*You have a new refund request:* *<https://securestay.ai/issues?id=${JSON.parse(refundRequest.issueId).join(",")}|View Issue>*`
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
                            amount: refundRequest.refundAmount,
                            issueId: refundRequest.issueId
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
                            amount: refundRequest.refundAmount,
                            issueId: refundRequest.issueId
                        })
                            }`
                    }
                ]
            }
        ]
    };

    return slackMessage;
};

export const buildRefundRequestReminderMessage = (refundRequest: RefundRequestEntity[]) => {
    const slackMessage = {
        channel: REFUND_REQUEST_CHANNEL,
        text: `You have ${refundRequest.length} pending refund requests`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "*You have pending refund requests:*"
                }
            },
            ...refundRequest.flatMap((request) => [
                {
                    type: "section",
                    fields: [
                        { type: "mrkdwn", text: `*Reservation:*\n${request.guestName}` },
                        { type: "mrkdwn", text: `*Listing:*\n${request.listingName}` },
                        { type: "mrkdwn", text: `*Amount:*\n${formatCurrency(request.refundAmount)}` },
                        { type: "mrkdwn", text: `*Explanation:*\n${request.explaination}` },
                        { type: "mrkdwn", text: `*<https://securestay.ai/issues?id=${JSON.parse(request.issueId).join(",")}|View Issue>*` }
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
                            value: JSON.stringify({
                                id: request.id,
                                guestName: request.guestName,
                                listingName: request.listingName,
                                amount: request.refundAmount
                            })
                        },
                        {
                            type: "button",
                            text: { type: "plain_text", text: "Deny", emoji: true },
                            style: "danger",
                            action_id: slackInteractivityEventNames.DENY_REFUND_REQUEST,
                            value: JSON.stringify({
                                id: request.id,
                                guestName: request.guestName,
                                listingName: request.listingName,
                                amount: request.refundAmount
                            })
                        }
                    ]
                }
            ])
        ]
    };

    return slackMessage;
};


export const buildUpdatedRefundRequestMessage = (refundRequest: RefundRequestEntity, user: string) => {
    const slackMessage = {
        channel: REFUND_REQUEST_CHANNEL,
        text: `*${user}* updated the refund request for *${refundRequest.guestName}* recently`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${user}* updated the refund request for *${refundRequest.guestName}* recently. *<https://securestay.ai/issues?id=${JSON.parse(refundRequest.issueId).join(",")}|View Issue>*`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Reservation:*\n${refundRequest.guestName}` },
                    { type: "mrkdwn", text: `*Listing:*\n${refundRequest.listingName}` },
                    { type: "mrkdwn", text: `*Amount:*\n${formatCurrency(refundRequest.refundAmount)}` },
                    { type: "mrkdwn", text: `*Explanation:*\n${refundRequest.explaination}` },
                    { type: "mrkdwn", text: `*Status:*\n${refundRequest.status}` }
                ]
            }
        ]
    };

    return slackMessage;
};

export const buildUpdatedStatusRefundRequestMessage = (refundRequest: RefundRequestEntity, user: string) => {
    const slackMessage = {
        channel: REFUND_REQUEST_CHANNEL,
        text: `${user} updated the status of refund request for ${refundRequest.guestName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `${refundRequest.status.toLowerCase() == "approved" ? "✅" : refundRequest.status.toLowerCase() == "denied" ? "❌" : "⏳"} <@${user}> ${refundRequest.status.toLowerCase()} *${formatCurrency(refundRequest.refundAmount)}* refund request for *${refundRequest.guestName}*.  *<https://securestay.ai/issues?id=${JSON.parse(refundRequest.issueId).join(",")}|View Issue>*`
                }
            },
        ]
    };

    return slackMessage;
};


export const buildIssueSlackMessage = (issue: Issue) => {
    return {
        channel: ISSUE_NOTIFICATION_CHANNEL,
        text: `New Issue reported for ${issue.listing_name} by ${issue?.guest_name}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*New Issue reported for 🏠 ${issue.listing_name} by 🙍 ${issue?.guest_name}* *<https://securestay.ai/issues?id=${issue.id}|View Issue>*`
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Issue Description:*\n${issue.issue_description || 'No details provided'}`
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Created By:* ${issue.creator || 'Uncategorized'}`
                },
            }
        ]
    };
};

export const buildActionItemsSlackMessage = (
    actionItems: ActionItems,
    user: string,
    listingName: string,
    reservationInfo: ReservationInfoEntity
) => {
    return {
        channel: GUEST_RELATIONS,
        text: `New Action Item: 🏠 ${listingName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*New Action Item: 🏠 ${listingName} | 👤 ${actionItems.guestName}*`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Category:* ${actionItems.category}` },
                ]
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Description:*\n${actionItems.item.length > 1000 ? actionItems.item.slice(0, 1000) + '...' : actionItems.item}`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Reservation Status:* ${reservationInfo?.status || "-"}` },
                    { type: "mrkdwn", text: `*Channel:* ${reservationInfo?.channelName || "-"}` },
                ]
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Check In:* ${reservationInfo?.arrivalDate || "-"}` },
                    { type: "mrkdwn", text: `*Check Out:* ${reservationInfo?.departureDate || "-"}` },
                ]
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Created By:* ${user}` }
                ]
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "static_select",
                        action_id: slackInteractivityEventNames.UPDATE_ACTION_ITEM_STATUS,
                        placeholder: {
                            type: "plain_text",
                            text: "Update Status",
                            emoji: true
                        },
                        options: [
                            {
                                text: {
                                    type: "plain_text",
                                    text: "In Progress",
                                    emoji: true
                                },
                                value: JSON.stringify({
                                    id: actionItems.id,
                                    status: "in progress"
                                })
                            },
                            {
                                text: {
                                    type: "plain_text",
                                    text: "Incomplete",
                                    emoji: true
                                },
                                value: JSON.stringify({
                                    id: actionItems.id,
                                    status: "incomplete"
                                })
                            },
                            {
                                text: {
                                    type: "plain_text",
                                    text: "Completed",
                                    emoji: true
                                },
                                value: JSON.stringify({
                                    id: actionItems.id,
                                    status: "completed"
                                })
                            },
                            {
                                text: {
                                    type: "plain_text",
                                    text: "Expired",
                                    emoji: true
                                },
                                value: JSON.stringify({
                                    id: actionItems.id,
                                    status: "expired"
                                })
                            }
                        ]
                    }
                ]
            }
        ]
    };
};


export const buildActionItemStatusUpdateMessage = (actionItem: ActionItems, user: string) => {
    const slackMessage = {
        channel: GUEST_RELATIONS,
        text: `${user} updated the status to ${actionItem.status.toUpperCase()}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `${user} updated the status to ${actionItem.status.toUpperCase()}`
                }
            },
        ]
    };

    return slackMessage;
};

