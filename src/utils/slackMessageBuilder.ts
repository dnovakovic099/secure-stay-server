import { format } from "date-fns";
import { slackInteractivityEventNames } from "../constant";
import { ActionItems } from "../entity/ActionItems";
import { ClientTicket } from "../entity/ClientTicket";
import { ClientTicketUpdates } from "../entity/ClientTicketUpdates";
import { Issue } from "../entity/Issue";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { actionItemsStatusEmoji, capitalizeFirstLetter, formatCurrency, issueCategoryEmoji, issueStatusEmoji } from "../helpers/helpers";
import { ActionItemsUpdates } from "../entity/ActionItemsUpdates";
import { IssueUpdates } from "../entity/IsssueUpdates";

const REFUND_REQUEST_CHANNEL = "#bookkeeping";
const ISSUE_NOTIFICATION_CHANNEL = "#issue-resolution";
const CLIENT_RELATIONS = "#client-relations";
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


export const buildIssueSlackMessage = (issue: Issue, updatedBy?: string) => {
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
                    text: `*Status:* ${issueStatusEmoji(issue.status)}${capitalizeFirstLetter(issue.status)}`
                },
            },
            {
                type: "section",
                text: { type: "mrkdwn", text: `*Issue Category:* ${issueCategoryEmoji(issue.category)} ${issue.category || '-'}` }
            },
            {
                type: "section",
                text: { type: "mrkdwn", text: `*Issue Description:*\n${issue.issue_description || 'No details provided'}` },    
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Created By:* ${issue.creator || 'Uncategorized'}` },
                    ...(updatedBy ? [{ type: "mrkdwn", text: `*Updated By:* ${updatedBy}` }] : [])
                ],

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
                    text: `*New Client Ticket: 🏠 ${listingName}* *<https://securestay.ai/client-tickets?id=${ticket.id}|View>*`
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

export const buildClientTicketSlackMessageUpdate = (ticket: ClientTicket, user: string, listingName: string) => {
    const blocks: any[] = [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*Client Ticket details has been updated* - 🏠 ${listingName}`
            }
        },
        {
            type: "section",
            fields: [
                { type: "mrkdwn", text: `*Description:*\n${ticket.description}` }
            ]
        }
    ];

    if (ticket.resolution) {
        blocks.push({
            type: "section",
            fields: [
                { type: "mrkdwn", text: `*Resolution:*\n${ticket.resolution}` }
            ]
        });
    }

    blocks.push({
        type: "section",
        fields: [
            { type: "mrkdwn", text: `*Categories:* ${JSON.parse(ticket.category).join(', ')}` },
            { type: "mrkdwn", text: `*Updated By:* ${user}` }
        ]
    });

    return {
        channel: CLIENT_RELATIONS,
        text: `Client Ticket details has been updated for 🏠 ${listingName}`,
        blocks
    };
};

export const buildClientTicketSlackMessageDelete = (ticket: ClientTicket, user: string, listingName: string) => {
    const slackMessage = {
        channel: CLIENT_RELATIONS,
        text: ` ${user} deleted the client ticket of 🏠 ${listingName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ ${user} deleted the client ticket of 🏠 ${listingName}`
                }
            },
        ]
    };

    return slackMessage;
};


export const buildActionItemsSlackMessage = (
    actionItems: ActionItems,
    createdBy: string,
    reservationInfo: ReservationInfoEntity,
    updatedBy?: string
) => {
    return {
        channel: GUEST_RELATIONS,
        text: `New Action Item: 🏠 ${actionItems.listingName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*New Action Item: 🏠 ${actionItems.listingName} | 👤 ${actionItems.guestName}* *<https://securestay.ai/messages/action-items?id=${actionItems.id}|View>*`
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
                    { type: "mrkdwn", text: `*Check In:* ${reservationInfo?.arrivalDate || "-"}` },
                    { type: "mrkdwn", text: `*Channel:* ${reservationInfo?.channelName || "-"}` },
                    { type: "mrkdwn", text: `*Check Out:* ${reservationInfo?.departureDate || "-"}` },
                    { type: "mrkdwn", text: `*Created By:* ${createdBy}` },
                    ...(updatedBy ? [{ type: "mrkdwn", text: `*Updated By:* ${updatedBy}` }] : [])
                ]
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Status:* ${actionItemsStatusEmoji(actionItems.status)}${capitalizeFirstLetter(actionItems.status) || '-'}`
                }
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

export const buildActionItemsSlackMessageUpdate = (
    actionItems: ActionItems,
    user: string,
    reservationInfo: ReservationInfoEntity
) => {
    return {
        channel: GUEST_RELATIONS,
        text: `New Action Item: 🏠 ${actionItems.listingName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Action Item detail has been updated:* 🏠 ${actionItems.listingName} | 👤 ${actionItems.guestName}`
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
                    { type: "mrkdwn", text: `*Check In:* ${reservationInfo?.arrivalDate || "-"}` },
                    { type: "mrkdwn", text: `*Channel:* ${reservationInfo?.channelName || "-"}` },
                    { type: "mrkdwn", text: `*Check Out:* ${reservationInfo?.departureDate || "-"}` },
                    { type: "mrkdwn", text: `*Updated By:* ${user}` }
                ]
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Status:* ${capitalizeFirstLetter(actionItems.status) || '-'}`
                }
            },
        ]
    };
};

export const buildActionItemsSlackMessageDelete = (actionItem: ActionItems, user: string,) => {
    const slackMessage = {
        channel: GUEST_RELATIONS,
        text: ` ${user} deleted the client ticket of 🏠 ${actionItem.listingName} | 👤 ${actionItem.guestName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ ${user} deleted the action item of 🏠 ${actionItem.listingName} for 👤 ${actionItem.guestName}`
                }
            },
        ]
    };

    return slackMessage;
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
                    text: `${actionItemsStatusEmoji(actionItem.status)}${actionItem.status.toUpperCase()} by ${user}`
                }
            },
        ]
    };

    return slackMessage;
};


export const buildClientTicketUpdateMessage = (updates: ClientTicketUpdates, listingName: string, user: string) => {
    return {
        channel: CLIENT_RELATIONS,
        text: `New update for 🏠 ${listingName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `📢 *Update:* ${updates.updates}`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Added by:* 👨‍💼 ${user}` },
                ]
            },
        ]
    };
};

export const buildActionItemsUpdateMessage = (updates: ActionItemsUpdates, listingName: string, user: string) => {
    return {
        channel: GUEST_RELATIONS,
        text: `New update for 🏠 ${updates.actionItems.listingName} - 👤 ${updates.actionItems.guestName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `📢 *Update:* ${updates.updates}`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Added by:* 👨‍💼 ${user}` },
                ]
            },
        ]
    };
};


export const buildIssueUpdateMessage = (updates: IssueUpdates, listingName: string, user: string) => {
    return {
        channel: ISSUE_NOTIFICATION_CHANNEL,
        text: `New update for 🏠 ${listingName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `📢 *Update:* ${updates.updates}`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Added by:* 👨‍💼 ${user}` },
                ]
            },
        ]
    };
};

export const buildIssueMessageDelete = (issue: Issue, user: string,) => {
    const slackMessage = {
        channel: ISSUE_NOTIFICATION_CHANNEL,
        text: ` ${user} deleted the issue of 🏠 ${issue.listing_name} | 👤 ${issue.guest_name}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ ${user} deleted the issue of 🏠 ${issue.listing_name} for 👤 ${issue.guest_name}`
                }
            },
        ]
    };

    return slackMessage;
};

export const buildIssuesSlackMessageUpdate = (
    issue: Issue,
    user: string,
) => {
    return {
        channel: ISSUE_NOTIFICATION_CHANNEL,
        text: `New Issue reported for ${issue.listing_name} by ${issue?.guest_name}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Issue detail has been updated:* 🏠 ${issue.listing_name} | 👤 ${issue.guest_name}`
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Status:* ${capitalizeFirstLetter(issue.status)}`
                },
            },
            {
                type: "section",
                text: { type: "mrkdwn", text: `*Issue Category:* ${issueCategoryEmoji(issue.category)} ${issue.category || '-'}` }
            },
            {
                type: "section",
                text: { type: "mrkdwn", text: `*Issue Description:*\n${issue.issue_description || 'No details provided'}` },
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Updated By:* ${user || 'Unknown user'}`
                },
            }
        ]
    };
};


export const buildIssueStatusUpdateMessage = (issue: Issue, user: string) => {
    const slackMessage = {
        channel: ISSUE_NOTIFICATION_CHANNEL,
        text: `${user} updated the status to ${issueStatusEmoji(issue.status)}${issue.status.toUpperCase()}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `${issueStatusEmoji(issue.status)}${issue.status.toUpperCase()} by ${user} `
                }
            },
        ]
    };

    return slackMessage;
};
