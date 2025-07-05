import { slackInteractivityEventNames } from "../constant";
import { ClientTicket } from "../entity/ClientTicket";
import { Issue } from "../entity/Issue";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { formatCurrency } from "../helpers/helpers";

const REFUND_REQUEST_CHANNEL = "#bookkeeping";
const ISSUE_NOTIFICATION_CHANNEL = "#issue-resolution";
const CLIENT_RELATIONS = "#client-relations";

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
}


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

export const buildClientTicketSlackMessage = (ticket: ClientTicket, user: string, listingName: string) => {
    return {
        channel: CLIENT_RELATIONS,
        text: `New Client Ticket has been created for 🏠 ${listingName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*New Client Ticket: 🏠 ${listingName}*`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Description:*\n${ticket.description}` },
                ]
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Categories:* ${JSON.parse(ticket.category).join(', ')}` },
                    { type: "mrkdwn", text: `*Created By:* ${user}` }
                ]
            },
        ]
    };
}


