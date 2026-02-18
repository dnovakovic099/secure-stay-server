import { format } from "date-fns";
import { convert } from 'html-to-text';
import { slackInteractivityEventNames } from "../constant";
import { ActionItems } from "../entity/ActionItems";
import { ClientTicket } from "../entity/ClientTicket";
import { ClientTicketUpdates } from "../entity/ClientTicketUpdates";
import { Issue } from "../entity/Issue";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { actionItemsStatusEmoji, capitalizeFirstLetter, claimStatusEmoji, formatCurrency, getStarRating, issueCategoryEmoji, issueStatusEmoji } from "../helpers/helpers";
import { ActionItemsUpdates } from "../entity/ActionItemsUpdates";
import { IssueUpdates } from "../entity/IsssueUpdates";
import { Claim } from "../entity/Claim";
import { ReviewEntity } from "../entity/Review";
import { ExpenseEntity, ExpenseStatus } from "../entity/Expense";
import { ClientEntity } from "../entity/Client";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { ZapierTriggerEvent } from "../entity/ZapierTriggerEvent";
import { CleanerRequest } from "../entity/CleanerRequest";
import { PhotographerRequest } from "../entity/PhotographerRequest";

const REFUND_REQUEST_CHANNEL = "#bookkeeping";
const ISSUE_NOTIFICATION_CHANNEL = "#issue-resolution";
const CLIENT_RELATIONS = "#client-relations";
const GUEST_RELATIONS = "#guest-relations";
const CLAIMS = "#claims";
const EXPENSE_CHANNEL = "#payment-requests";
const ONBOARDING_CHANNEL = "#onboarding";
const UNRESPONDED_MESSAGES_CHANNEL = "#unresponded-messages";
const CLEANING_AND_MAINTENANCE = "#cleaning-and-maintenance";
const INTERNAL_PHOTOGRAPHY = "#internal-photography";

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

export const buildClientTicketSlackMessage = (ticket: ClientTicket, user: string, listingName: string, slackUserIds?: string[]) => {
    const mentions =slackUserIds && slackUserIds.map(id => `<@${id}>`).join(', ');
    const block = {
        channel: CLIENT_RELATIONS,
        text: `New Client Ticket has been created for 🏠 ${listingName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*New Client Ticket: 🏠 ${listingName}* *<https://securestay.ai/client/client-tickets?id=${ticket.id}|View>*`
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
    if (slackUserIds && slackUserIds.length > 0) {
        block.blocks.unshift({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `${mentions}`
            }
        });
    }
    return block;
}

export const buildClientTicketSlackMessageUpdate = (
    diff: Record<string, { old: any; new: any; }>,
    user: string,
    listingName: string,
) => {
    const blocks: any[] = [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*Client Ticket details have been updated* - 🏠 ${listingName}`,
            },
        },
        { type: "divider" },
    ];

    // Build one sentence per field change
    const changes: string[] = Object.entries(diff).map(([field, { old, new: newValue }]) => {
        return `• *${formatFieldName(field)}* was changed from \`${formatValue(old)}\` → \`${formatValue(newValue)}\``;
    });

    // Add the changes summary
    if (changes.length > 0) {
        blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: changes.join("\n"),
            },
        });
    }

    // Add who made the update
    blocks.push({
        type: "context",
        elements: [
            {
                type: "mrkdwn",
                text: `*Updated By:* ${user}`,
            },
        ],
    });

    return {
        channel: CLIENT_RELATIONS,
        text: `Client Ticket updated for 🏠 ${listingName}`,
        blocks,
    };
};

// ---- Helper functions ----

// Make sure values look clean in Slack
const formatValue = (value: any) => {
    if (value === null || value === undefined) return "none";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
};

// Prettify field names like “updatedAt” → “Updated At”
const formatFieldName = (name: string) => {
    return name
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (s) => s.toUpperCase())
        .trim();
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


export const buildClaimSlackMessage = (
    claim: Claim,
    createdBy: string,
    updatedBy?: string
) => {
    return {
        channel: CLAIMS,
        text: `New 💰Claim: 🏠 ${claim.listing_name}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*New 💰Claim: 🏠 ${claim.listing_name} | 👤 ${claim.guest_name}* *<https://securestay.ai/claims?id=${claim.id}|View>*`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Claim Type:* ${claim.claim_type}` },
                    { type: "mrkdwn", text: `*Status:* ${claimStatusEmoji(claim.status)}${capitalizeFirstLetter(claim.status) || '-'}` }
                ]
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*📝Description:*\n${claim.description.length > 1000 ? claim.description.slice(0, 1000) + '...' : claim.description}`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*💲Client Requested Amount:* ${claim?.client_requested_amount ? formatCurrency(claim.client_requested_amount) : "-"}` },
                    { type: "mrkdwn", text: `*💲Airbnb Filing Amount:* ${claim?.airbnb_filing_amount ? formatCurrency(claim.airbnb_filing_amount) : "-"}` },
                    { type: "mrkdwn", text: `*Airbnb Resolution:* ${claim?.airbnb_resolution || "-"}` },
                    { type: "mrkdwn", text: `*🏆Airbnb Resolution Won Amount:* ${claim?.airbnb_resolution_won_amount ? formatCurrency(claim.airbnb_resolution_won_amount) : "-"}` },
                    { type: "mrkdwn", text: `*📅Due Date:* ${claim.due_date || "-"}` },
                ]
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*💲Client Payout Amount:* ${claim?.client_paid_amount ? formatCurrency(claim.client_paid_amount) : "-"}` },
                    { type: "mrkdwn", text: `*Payment Status:* ${claim?.payment_status ? formatCurrency(claim.airbnb_filing_amount) : "-"}` },
                    ...(claim.payment_information ? [{ type: "mrkdwn", text: `*ℹ️Payment info:* ${claim?.payment_information || "-"}` }] : [])
                ]
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `* Created By:*\n ${createdBy} on ${format(claim.created_at, "MMM dd hh:mm a")}` },
                    ...(updatedBy ? [{ type: "mrkdwn", text: `* Updated By:*\n ${updatedBy} on ${format(claim.updated_at, "MMM dd hh:mm a")}` }] : [])
                ]
            },
        ]
    };
};

export const buildClaimUpdateSlackMessage = (
    claim: Claim,
    createdBy: string,
    updatedBy?: string
) => {
    return {
        channel: CLAIMS,
        text: `New 💰Claim: 🏠 ${claim.listing_name}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*New 💰Claim: 🏠 ${claim.listing_name} | 👤 ${claim.guest_name}* *<https://securestay.ai/claims?id=${claim.id}|View>*`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Claim Type:* ${claim.claim_type}` },
                    { type: "mrkdwn", text: `*Status:* ${claimStatusEmoji(claim.status)}${capitalizeFirstLetter(claim.status) || '-'}` }
                ]
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*ℹ️ Description:*\n${claim.description.length > 1000 ? claim.description.slice(0, 1000) + '...' : claim.description}`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*💲Client Requested Amount:* ${claim?.client_requested_amount ? formatCurrency(claim.client_requested_amount) : "-"}` },
                    { type: "mrkdwn", text: `*💲Airbnb Filing Amount:* ${claim?.airbnb_filing_amount ? formatCurrency(claim.airbnb_filing_amount) : "-"}` },
                    { type: "mrkdwn", text: `*Airbnb Resolution:* ${claim?.airbnb_resolution || "-"}` },
                    { type: "mrkdwn", text: `*🏆Airbnb Resolution Won Amount:* ${claim?.airbnb_resolution_won_amount ? formatCurrency(claim.airbnb_resolution_won_amount) : "-"}` },
                    { type: "mrkdwn", text: `*📅Due Date:* ${claim.due_date || "-"}` },
                ]
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*💲Client Payout Amount:* ${claim?.client_paid_amount ? formatCurrency(claim.client_paid_amount) : "-"}` },
                    { type: "mrkdwn", text: `*Payment Status:* ${claim?.payment_status ? formatCurrency(claim.airbnb_filing_amount) : "-"}` },
                    ...(claim.payment_information ? [{ type: "mrkdwn", text: `*ℹ️Payment info:* ${claim?.payment_information || "-"}` }] : [])
                ]
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `* Created By:* ${createdBy} on ${format(claim.created_at, "MMM dd hh:mm a")}` },
                    ...(updatedBy ? [{ type: "mrkdwn", text: `* Updated By:* ${updatedBy} on ${format(claim.updated_at, "MMM dd hh:mm a")}` }] : [])
                ]
            },
        ]
    };
};

export const buildClaimSlackMessageDelete = (claim: Claim, user: string,) => {
    const slackMessage = {
        channel: CLAIMS,
        text: ` ${user} deleted the claim of 🏠 ${claim.listing_name} | 👤 ${claim.guest_name}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ ${user} deleted the claim of 🏠 ${claim.listing_name} for 👤 ${claim.guest_name}`
                }
            },
        ]
    };

    return slackMessage;
};

export const buildClaimStatusUpdateMessage = (claim: Claim, user: string) => {
    const slackMessage = {
        channel: CLAIMS,
        text: `${user} updated the status to ${claim.status.toUpperCase()}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `${claimStatusEmoji(claim.status)}${claim.status.toUpperCase()} by ${user}`
                }
            },
        ]
    };

    return slackMessage;
};

export const buildClaimReminderMessage = (
    claim: Claim,
    dueType: "today" | "tomorrow" | "in7days"
) => {
    const dueLabelMap = {
        today: "📌 *Due Today*",
        tomorrow: "⏳ *Due Tomorrow*",
        in7days: "🗓️ *Due in 7 Days*"
    };

    const slackMessage = {
        channel: CLAIMS,
        text: `Reminder: Claim for ${claim.listing_name} is ${dueType}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `${dueLabelMap[dueType]}\n *Claim for guest 👤${claim.guest_name} is currently marked as ${claimStatusEmoji(claim.status)}${claim.status.toUpperCase()}* and is due *${dueType === 'today' ? 'today' : dueType === 'tomorrow' ? 'tomorrow' : 'in 7 days'}*. Please review and take necessary action. *<https://securestay.ai/claims?id=${claim.id}|View>*`
                }
            },
            {
                type: "section",
                fields: [
                    {
                        type: "mrkdwn",
                        text: `🏘️ *Listing:* ${claim.listing_name}`
                    }
                ]
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `🧾 *Description:* ${claim.description || "—"}`
                },
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*💲Client Requested Amount:* ${claim?.client_requested_amount ? formatCurrency(claim.client_requested_amount) : "-"}` },
                    { type: "mrkdwn", text: `*💲Airbnb Filing Amount:* ${claim?.airbnb_filing_amount ? formatCurrency(claim.airbnb_filing_amount) : "-"}` },
                    { type: "mrkdwn", text: `*Airbnb Resolution:* ${claim?.airbnb_resolution || "-"}` },
                    { type: "mrkdwn", text: `*🏆Airbnb Resolution Won Amount:* ${claim?.airbnb_resolution_won_amount ? formatCurrency(claim.airbnb_resolution_won_amount) : "-"}` },
                    { type: "mrkdwn", text: `*📅Due Date:* ${claim.due_date || "-"}` },
                ]
            },
        ]
    };

    return slackMessage;
};

export const buildClaimReviewReceivedMessage = (claim: Claim, review: ReviewEntity) => {
    const slackMessage = {
        channel: CLAIMS,
        text: `Review received for active claim from guest 👤${review.reviewerName}`,
        blocks: [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: `📬 Review received from guest 👤${review.reviewerName}`,
                    emoji: true
                }
            },
            {
                type: "section",
                fields: [
                    {
                        type: "mrkdwn",
                        text: `*Claim Status:*\n${claimStatusEmoji(claim.status)} ${claim.status}`
                    },
                    {
                        type: "mrkdwn",
                        text: `*Listing:*\n${claim.listing_name || "N/A"}`
                    }
                ]
            },
            {
                type: "section",
                fields: [
                    {
                        type: "mrkdwn",
                        text: `*Review:* ${review.publicReview}`
                    },
                    {
                        type: "mrkdwn",
                        text: `*Rating:* ${review.rating ? getStarRating(review.rating) : "Not Specified"}`
                    }
                ]
            },
            {
                type: "context",
                elements: [
                    {
                        type: "mrkdwn",
                        text: `🕒 Review received on ${review.submittedAt && format(review.submittedAt, "MMM dd hh:mm a")}`
                    }
                ]
            }
        ]
    };

    return slackMessage;
};

// Expense Status Emoji Helper
const expenseStatusEmoji = (status: ExpenseStatus): string => {
    switch (status) {
        case ExpenseStatus.PENDING:
            return "⏳ ";
        case ExpenseStatus.APPROVED:
            return "✅ ";
        case ExpenseStatus.OVERDUE:
            return "⚠️ ";
        case ExpenseStatus.PAID:
            return "💰 ";
        default:
            return "📋 ";
    }
};

// Expense Slack Message Builders
export const buildExpenseSlackMessage = (
    expense: ExpenseEntity,
    createdBy: string,
    listingName?: string,
    updatedBy?: string,
    categoryNames?: string
) => {
    const typeLabel = expense.amount > 0 ? "Extra" : "Expense";
    return {
        channel: EXPENSE_CHANNEL,
        text: `New ${typeLabel}: 🏠 ${listingName || 'Unknown Property'}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*New ${typeLabel}: 🏠 ${listingName || 'Unknown Property'}* *<https://securestay.ai/accounting/transactions/expense?expenseId=${expense.id}|View>*`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Amount:* ${formatCurrency(Math.abs(expense.amount))}` },
                    { type: "mrkdwn", text: `*Status:* ${expenseStatusEmoji(expense.status)}${capitalizeFirstLetter(expense.status)}` }
                ]
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Description:*\n${expense.concept || 'No description provided'}`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Contractor:* ${expense.contractorName || '-'}` },
                    { type: "mrkdwn", text: `*Payment Method:* ${expense.paymentMethod || '-'}` },
                    { type: "mrkdwn", text: `*Categories:* ${categoryNames || '-'}` },
                    { type: "mrkdwn", text: `*Expense Date:* ${expense.expenseDate || '-'}` },
                    { type: "mrkdwn", text: `*Date of Work:* ${expense.dateOfWork || '-'}` },
                    { type: "mrkdwn", text: `*Created By:* ${createdBy}` },
                    ...(updatedBy ? [{ type: "mrkdwn", text: `*Updated By:* ${updatedBy}` }] : []),
                    ...(expense.llCover ? [{ type: "mrkdwn", text: `*Covered by Luxury Lodging*` }] : [])
                ]
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "*Update Status:*"
                },
                accessory: {
                    type: "static_select",
                    placeholder: {
                        type: "plain_text",
                        text: "Select status..."
                    },
                    action_id: slackInteractivityEventNames.UPDATE_EXPENSE_STATUS,
                    options: [
                        {
                            text: {
                                type: "plain_text",
                                text: "Pending Approval"
                            },
                            value: JSON.stringify({ id: expense.id, status: ExpenseStatus.PENDING })
                        },
                        {
                            text: {
                                type: "plain_text",
                                text: "Approved"
                            },
                            value: JSON.stringify({ id: expense.id, status: ExpenseStatus.APPROVED })
                        },
                        {
                            text: {
                                type: "plain_text",
                                text: "Paid"
                            },
                            value: JSON.stringify({ id: expense.id, status: ExpenseStatus.PAID })
                        },
                        {
                            text: {
                                type: "plain_text",
                                text: "Overdue"
                            },
                            value: JSON.stringify({ id: expense.id, status: ExpenseStatus.OVERDUE })
                        }
                    ]
                }
            }
        ]
    };
};

export const buildExpenseSlackMessageUpdate = (
    expense: ExpenseEntity,
    updatedBy: string,
    listingName?: string,
    categoryNames?: string
) => {
    const typeLabel = expense.amount > 0 ? "Extra" : "Expense";
    return {
        channel: EXPENSE_CHANNEL,
        text: `${typeLabel} Updated: 🏠 ${listingName || 'Unknown Property'}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${typeLabel} Updated: 🏠 ${listingName || 'Unknown Property'}* *<https://securestay.ai/accounting/transactions/expense?expenseId=${expense.id}|View>*`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Amount:* ${formatCurrency(Math.abs(expense.amount))}` },
                    { type: "mrkdwn", text: `*Status:* ${expenseStatusEmoji(expense.status)}${capitalizeFirstLetter(expense.status)}` }
                ]
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Description:*\n${expense.concept || 'No description provided'}`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Contractor:* ${expense.contractorName || '-'}` },
                    { type: "mrkdwn", text: `*Payment Method:* ${expense.paymentMethod || '-'}` },
                    { type: "mrkdwn", text: `*Categories:* ${categoryNames || '-'}` },
                    { type: "mrkdwn", text: `*Updated By:* ${updatedBy}` },
                    ...(expense.llCover ? [{ type: "mrkdwn", text: `*Covered by Luxury Lodging*` }] : [])
                ]
            }
        ]
    };
};

export const buildExpenseSlackMessageDelete = (
    expense: ExpenseEntity,
    deletedBy: string,
    listingName?: string,
    categoryNames?: string
) => {
    const typeLabel = expense.amount > 0 ? "Extra" : "Expense";
    return {
        channel: EXPENSE_CHANNEL,
        text: `${typeLabel} Deleted: 🏠 ${listingName || 'Unknown Property'}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${typeLabel} Deleted: 🏠 ${listingName || 'Unknown Property'}*`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Amount:* ${formatCurrency(Math.abs(expense.amount))}` },
                    { type: "mrkdwn", text: `*Description:* ${expense.concept || 'No description provided'}` },
                    { type: "mrkdwn", text: `*Categories:* ${categoryNames || '-'}` },
                    { type: "mrkdwn", text: `*Deleted By:* ${deletedBy}` }
                ]
            }
        ]
    };
};

export const buildExpenseStatusUpdateMessage = (
    expense: ExpenseEntity,
    updatedBy: string
) => {
    const typeLabel = expense.amount > 0 ? "Extra" : "Expense";
    const slackMessage = {
        channel: EXPENSE_CHANNEL,
        text: `${typeLabel} Status Updated`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${typeLabel} Status Updated* *<https://securestay.ai/accounting/transactions/expense?expenseId=${expense.id}|View>*`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*New Status:* ${expenseStatusEmoji(expense.status)}${capitalizeFirstLetter(expense.status)}` },
                    { type: "mrkdwn", text: `*Updated By:* ${updatedBy}` }
                ]
            }
        ]
    };

    return slackMessage;
};

export const buildOnboardingSlackMessage = (
    type: "new_client" | "listing_info" | "management_info" | "financials_info" | "new_property",
    client: ClientEntity,
    property?: ClientPropertyEntity,
    updatedBy?: string,
    threadTs?: string
) => {
    let title = "";
    let emoji = "";

    // Get property display name: prefer internal listing name, fall back to address
    const getPropertyDisplayName = () => {
        if (property?.propertyInfo?.internalListingName) {
            return property.propertyInfo.internalListingName;
        }
        return property?.address || "Unknown Property";
    };

    const propertyName = getPropertyDisplayName();

    switch (type) {
        case "new_client":
            title = "New Client Onboarding Initiated";
            emoji = "🏢";
            break;
        case "listing_info":
            title = `Listing Profile Updated: ${propertyName}`;
            emoji = "📝";
            break;
        case "management_info":
            title = `Management Requirements Updated: ${propertyName}`;
            emoji = "📋";
            break;
        case "financials_info":
            title = `Financial Configuration Updated: ${propertyName}`;
            emoji = "💰";
            break;
        case "new_property":
            title = `New Property Added: ${propertyName}`;
            emoji = "🏠";
            break;
    }

    const blocks: any[] = [
        {
            type: "header",
            text: {
                type: "plain_text",
                text: `${emoji} ${title}`,
                emoji: true
            }
        }
    ];

    // Add default mentions for team members
    blocks.push({
        type: "context",
        elements: [
            {
                type: "mrkdwn",
                text: `cc: ${process.env.ONBOARDING_MENTIONS || '<@U07MVJYQ1EW> <@U08QJBLNG6A> <@U07B3DPM56E>'}`
            }
        ]
    });

    // Only include client info for the root message (new_client)
    if (type === "new_client") {
        blocks.push({
            type: "section",
            fields: [
                { type: "mrkdwn", text: `*Client Name:*\n${client.firstName} ${client.lastName}` },
                { type: "mrkdwn", text: `*Client Email:*\n${client.email || "N/A"}` }
            ]
        });
    }

    // For reply messages, show property details
    if (property && type !== "new_client") {
        blocks.push({
            type: "section",
            fields: [
                { type: "mrkdwn", text: `*Property Address:*\n${property.address}` },
                { type: "mrkdwn", text: `*Current Status:*\n${capitalizeFirstLetter(property.status || 'Draft')}` }
            ]
        });
    }

    if (updatedBy) {
        blocks.push({
            type: "context",
            elements: [
                { type: "mrkdwn", text: `*Action initiated by:* ${updatedBy}` },
                { type: "mrkdwn", text: `*Timestamp:* ${format(new Date(), "PPpp")}` }
            ]
        });
    }

    return {
        channel: ONBOARDING_CHANNEL,
        text: `${emoji} Onboarding Update: ${title} for ${client.firstName} ${client.lastName}`,
        blocks,
        thread_ts: threadTs
    };
};

export const buildZapierEventSlackMessage = (event: ZapierTriggerEvent) => {
    const statusEmoji = event.status === 'New' ? '🔵' : event.status === 'In Progress' ? '🟡' : '🟢';

    const blocks: any[] = [];

    // Add Title if available
    if (event.title) {
        blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*${event.title}*`
            }
        });
    }

    // Add Message
    blocks.push({
        type: "section",
        text: {
            type: "mrkdwn",
            text: event.message
        }
    });

    // Add Status info
    blocks.push({
        type: "section",
        text: {
            type: "mrkdwn",
            text: `*Status:* ${statusEmoji} ${event.status}`
        }
    });

    // Add Dropdown for status update
    blocks.push({
        type: "actions",
        elements: [
            {
                type: "static_select",
                action_id: slackInteractivityEventNames.UPDATE_ZAPIER_EVENT_STATUS,
                placeholder: {
                    type: "plain_text",
                    text: "Update Status",
                    emoji: true
                },
                options: [
                    {
                        text: { type: "plain_text", text: "New", emoji: true },
                        value: JSON.stringify({ id: event.id, status: "New" })
                    },
                    {
                        text: { type: "plain_text", text: "In Progress", emoji: true },
                        value: JSON.stringify({ id: event.id, status: "In Progress" })
                    },
                    {
                        text: { type: "plain_text", text: "Completed", emoji: true },
                        value: JSON.stringify({ id: event.id, status: "Completed" })
                    }
                ]
            }
        ]
    });

    // Add View link on separate line
    blocks.push({
        type: "section",
        text: {
            type: "mrkdwn",
            text: `<http://localhost:3000/messages/gr-tasks?eventId=${event.id}|View in Secure Stay>`
        }
    });

    return {
        channel: event.slackChannel,
        text: `${event.botName || 'Zapier Event'}: ${event.title || event.message.slice(0, 50)}`,
        bot_name: event.botName,
        bot_icon: event.botIcon,
        blocks
    };
};

export const buildZapierEventStatusUpdateMessage = (event: ZapierTriggerEvent, user: string) => {
    const statusEmoji = event.status === 'New' ? '🔵' : event.status === 'In Progress' ? '🟡' : '🟢';

    const blocks: any[] = [];

    if (event.title) {
        blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `*${event.title}*` }
        });
    }

    blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: event.message }
    });

    blocks.push({
        type: "section",
        text: {
            type: "mrkdwn",
            text: `*Status:* ${statusEmoji} ${event.status} (Updated by ${user})`
        }
    });

    // Add Dropdown for status update (to allow further updates)
    blocks.push({
        type: "actions",
        elements: [
            {
                type: "static_select",
                action_id: slackInteractivityEventNames.UPDATE_ZAPIER_EVENT_STATUS,
                placeholder: {
                    type: "plain_text",
                    text: "Update Status",
                    emoji: true
                },
                options: [
                    {
                        text: { type: "plain_text", text: "New", emoji: true },
                        value: JSON.stringify({ id: event.id, status: "New" })
                    },
                    {
                        text: { type: "plain_text", text: "In Progress", emoji: true },
                        value: JSON.stringify({ id: event.id, status: "In Progress" })
                    },
                    {
                        text: { type: "plain_text", text: "Completed", emoji: true },
                        value: JSON.stringify({ id: event.id, status: "Completed" })
                    }
                ]
            }
        ]
    });

    // Add View link on separate line
    blocks.push({
        type: "section",
        text: {
            type: "mrkdwn",
            text: `<http://localhost:3000/messages/gr-tasks?eventId=${event.id}|View in Secure Stay>`
        }
    });

    return {
        text: `Status updated to ${event.status} by ${user}`,
        bot_name: event.botName,
        bot_icon: event.botIcon,
        blocks
    };
};

export const buildZapierStatusChangeThreadMessage = (event: ZapierTriggerEvent, user: string) => {
    const statusEmoji = event.status === 'New' ? '🔵' : event.status === 'In Progress' ? '🟡' : '🟢';
    return {
        text: `*${statusEmoji} Status changed to ${event.status} by ${user}*`,
        bot_name: event.botName,
        bot_icon: event.botIcon
    };
};



export const buildUnansweredMessageAlert = (
    guestMessage: string,
    reservationId: number,
    receivedAt: Date,
    guestName?: string,
    propertyName?: string
) => {
    // Convert HTML to readable plain text if message contains HTML tags
    const isHtml = /<[a-z][\s\S]*>/i.test(guestMessage);
    const displayMessage = isHtml
        ? convert(guestMessage, { wordwrap: false, selectors: [{ selector: 'table', format: 'dataTable' }] })
        : guestMessage;

    const formattedTime = format(receivedAt, "MMM dd, yyyy 'at' hh:mm a");
    const truncatedMessage = displayMessage.length > 500 ? displayMessage.slice(0, 500) + '...' : displayMessage;
    const hostifyLink = `https://us.hostify.com/reservations/view/${reservationId}`;

    // Build title with property name in brackets if available
    const titleProperty = propertyName ? ` (🏠 ${propertyName})` : '';
    const title = `*⚠️ Unanswered Guest Message Alert${titleProperty}*`;

    const fields: any[] = [];

    // Guest Name with Hostify link
    if (guestName) {
        fields.push({ type: "mrkdwn", text: `*👤 Guest:*\n<${hostifyLink}|${guestName}>` });
    } else {
        fields.push({ type: "mrkdwn", text: `*🔗 Reservation:*\n<${hostifyLink}|View in Hostify>` });
    }

    // Property Name with icon
    if (propertyName) {
        fields.push({ type: "mrkdwn", text: `*🏠 Property:*\n${propertyName}` });
    }

    // Received time
    fields.push({ type: "mrkdwn", text: `*🕐 Received At:*\n${formattedTime}` });

    return {
        channel: UNRESPONDED_MESSAGES_CHANNEL,
        text: `⚠️ Unanswered Guest Message Alert${propertyName ? ` - ${propertyName}` : ''}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: title
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*💬 Message:*\n>${truncatedMessage.replace(/\n/g, '\n>')}`
                }
            },
            {
                type: "section",
                fields
            }
        ]
    };
};


export const buildCleanerRequestSlackMessage = (request: CleanerRequest, formLink: string) => {
    const statusEmoji = request.status === 'new' ? '🔵' : request.status === 'in_progress' ? '🟡' : '🟢';
    const statusLabel = request.status === 'new' ? 'New' : request.status === 'in_progress' ? 'In Progress' : 'Completed';

    return {
        channel: CLEANING_AND_MAINTENANCE,
        text: `New Cleaner Request for ${request.fullAddress}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Full Address:*\n${request.fullAddress || '-'}\n\n` +
                        `*Special Arrangement Preference:*\n${request.specialArrangementPreference || '-'}\n\n` +
                        `*Is Property Ready Cleaned:*\n${request.isPropertyReadyCleaned || '-'}\n\n` +
                        `*Schedule Initial Clean:*\n${request.scheduleInitialClean || '-'}\n\n` +
                        `*Property Access Information:*\n${request.propertyAccessInformation || '-'}\n\n` +
                        `*Cleaning Closet Code/Location:*\n${request.cleaningClosetCodeLocation || '-'}\n\n` +
                        `*Trash Schedule/Instructions:*\n${request.trashScheduleInstructions || '-'}\n\n` +
                        `*Supplies to Restock:*\n${request.suppliesToRestock || '-'}\n\n` +
                        `*Status:* ${statusEmoji} ${statusLabel}\n\n` +
                        `*Form Link:* ${formLink}`
                }
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "static_select",
                        action_id: slackInteractivityEventNames.UPDATE_CLEANER_REQUEST_STATUS,
                        placeholder: {
                            type: "plain_text",
                            text: "Update Status",
                            emoji: true
                        },
                        options: [
                            {
                                text: { type: "plain_text", text: "🔵 New", emoji: true },
                                value: JSON.stringify({ id: request.id, status: "new" })
                            },
                            {
                                text: { type: "plain_text", text: "🟡 In Progress", emoji: true },
                                value: JSON.stringify({ id: request.id, status: "in_progress" })
                            },
                            {
                                text: { type: "plain_text", text: "🟢 Completed", emoji: true },
                                value: JSON.stringify({ id: request.id, status: "completed" })
                            }
                        ]
                    }
                ]
            }
        ],
        bot_name: "Cleaner Request",
        bot_icon: "https://img.icons8.com/ios-filled/50/housekeeper-female.png"
    };
};

export const buildCleanerRequestUpdateSlackMessage = (diff: Record<string, { old: any; new: any; }>, request: CleanerRequest) => {
    const changes = Object.entries(diff).map(([field, { old, new: newValue }]) => {
        return `• *${formatFieldName(field)}* was changed from \`${formatValue(old)}\` → \`${formatValue(newValue)}\``;
    }).join("\n");

    return {
        channel: CLEANING_AND_MAINTENANCE,
        text: `Cleaner Request updated for ${request.fullAddress}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Cleaner Request details have been updated:*\n${changes}`
                }
            }
        ],
        bot_name: "Cleaner Request",
        bot_icon: "https://img.icons8.com/ios-filled/50/housekeeper-female.png"
    };
};

export const buildPhotographerRequestSlackMessage = (request: PhotographerRequest, formLink: string) => {
    const statusEmoji = request.status === 'new' ? '🔵' : request.status === 'in_progress' ? '🟡' : '🟢';
    const statusLabel = request.status === 'new' ? 'New' : request.status === 'in_progress' ? 'In Progress' : 'Completed';

    return {
        channel: INTERNAL_PHOTOGRAPHY,
        text: `New Photographer Request for ${request.completeAddress}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Owner Name - Property Internal Name:*\n${request.ownerNamePropertyInternalName || '-'}\n\n` +
                        `*Service Type:*\n${request.serviceType || '-'}\n\n` +
                        `*Complete Address:*\n${request.completeAddress || '-'}\n\n` +
                        `*Number of Bedrooms:*\n${request.numberOfBedrooms || '-'}\n\n` +
                        `*Number of Bathrooms:*\n${request.numberOfBathrooms || '-'}\n\n` +
                        `*Sqft of House:*\n${request.sqftOfHouse || '-'}\n\n` +
                        `*Availability:*\n${request.availability || '-'}\n\n` +
                        `*Onboarding Rep:*\n${request.onboardingRep || '-'}\n\n` +
                        `*Status:* ${statusEmoji} ${statusLabel}\n\n` +
                        `*Form Link:* ${formLink}`
                }
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "static_select",
                        action_id: slackInteractivityEventNames.UPDATE_PHOTOGRAPHER_REQUEST_STATUS,
                        placeholder: {
                            type: "plain_text",
                            text: "Update Status",
                            emoji: true
                        },
                        options: [
                            {
                                text: { type: "plain_text", text: "🔵 New", emoji: true },
                                value: JSON.stringify({ id: request.id, status: "new" })
                            },
                            {
                                text: { type: "plain_text", text: "🟡 In Progress", emoji: true },
                                value: JSON.stringify({ id: request.id, status: "in_progress" })
                            },
                            {
                                text: { type: "plain_text", text: "🟢 Completed", emoji: true },
                                value: JSON.stringify({ id: request.id, status: "completed" })
                            }
                        ]
                    }
                ]
            }
        ],
        bot_name: "Photographer Request",
        bot_icon: "https://img.icons8.com/external-ddara-lineal-ddara/64/external-photographer-professions-ddara-lineal-ddara.png"
    };
};

export const buildPhotographerRequestUpdateSlackMessage = (diff: Record<string, { old: any; new: any; }>, request: PhotographerRequest) => {
    const changes = Object.entries(diff).map(([field, { old, new: newValue }]) => {
        return `• *${formatFieldName(field)}* was changed from \`${formatValue(old)}\` → \`${formatValue(newValue)}\``;
    }).join("\n");

    return {
        channel: INTERNAL_PHOTOGRAPHY,
        text: `Photographer Request updated for ${request.completeAddress}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Photographer Request details have been updated:*\n${changes}`
                }
            }
        ],
        bot_name: "Photographer Request",
        bot_icon: "https://img.icons8.com/external-ddara-lineal-ddara/64/external-photographer-professions-ddara-lineal-ddara.png"
    };
};

