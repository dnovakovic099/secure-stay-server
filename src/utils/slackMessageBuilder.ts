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
import { MaintenanceFormRequest } from "../entity/MaintenanceFormRequest";
import { ItemSupplyRequest } from "../entity/ItemSupplyRequest";

const REFUND_REQUEST_CHANNEL = "#resolutions-team";
const ISSUE_NOTIFICATION_CHANNEL = "#issue-resolution";
const CLIENT_RELATIONS = "#client-relations";
const GUEST_RELATIONS = "#guest-relations";
const CLAIMS = "#claims";
const EXPENSE_CHANNEL = "#payment-requests";
const ONBOARDING_CHANNEL = "#onboarding";
const UNRESPONDED_MESSAGES_CHANNEL = "#unresponded-messages";
const CLEANING_AND_MAINTENANCE = "#cleaning-and-maintenance";
const INTERNAL_PHOTOGRAPHY = "#internal-photography";

const ISSUE_STATUS_OPTIONS = [
    "New",
    "In Progress",
    "Scheduled",
    "Need Help",
    "Overdue",
    "Completed",
];

const getIssueStatusLabelWithEmoji = (status: string) => {
    const emoji = issueStatusEmoji(status);
    return `${emoji ? `${emoji} ` : ''}${status}`;
};

const ISSUE_LISTING_EMOJIS: Array<{ key: string; emoji: string }> = [
    { key: "own", emoji: "🟥" },
    { key: "arb", emoji: "🟪" },
    { key: "pro", emoji: "🟦" },
    { key: "full", emoji: "🟧" },
    { key: "launch", emoji: "🟫" },
];

const normalizeSlackField = (value?: unknown, fallback = "—") => {
    const normalized = String(value || "").trim();
    return normalized || fallback;
};

const normalizeRefundChargeToClient = (value?: unknown) => {
    return value === true || value === 1 || value === "1" || value === "true" ? "Yes" : "No";
};

const formatRefundDate = (value?: unknown) => {
    if (!value) return "—";
    const date = new Date(value as any);
    if (Number.isNaN(date.getTime())) return normalizeSlackField(value);
    return format(date, "MMM d, yyyy");
};

const formatRefundStayDates = (refundRequest: RefundRequestEntity) => {
    const checkInDate = refundRequest.checkIn ? new Date(refundRequest.checkIn as any) : null;
    const checkOutDate = refundRequest.checkOut ? new Date(refundRequest.checkOut as any) : null;
    const hasValidCheckIn = checkInDate && !Number.isNaN(checkInDate.getTime());
    const hasValidCheckOut = checkOutDate && !Number.isNaN(checkOutDate.getTime());

    if (!hasValidCheckIn && !hasValidCheckOut) return "—";
    if (!hasValidCheckIn) return formatRefundDate(refundRequest.checkOut);
    if (!hasValidCheckOut) return formatRefundDate(refundRequest.checkIn);

    const sameMonth = checkInDate.getFullYear() === checkOutDate.getFullYear()
        && checkInDate.getMonth() === checkOutDate.getMonth();
    const checkoutDay = format(checkOutDate, "dd");
    return sameMonth
        ? `${format(checkInDate, "MMM d")} → ${checkoutDay}`
        : `${format(checkInDate, "MMM d")} → ${format(checkOutDate, "MMM dd")}`;
};

const buildRefundRequestDetailBlocks = (refundRequest: RefundRequestEntity) => {
    const channelName = (refundRequest as any).channelName || (refundRequest as any).source;
    const leftColumn = [
        `*Listing:* ${normalizeSlackField(refundRequest.listingName)}`,
        `*Channel:* ${normalizeSlackField(channelName)}`,
        `*Guest Name:* ${normalizeSlackField(refundRequest.guestName)}`,
        `*Stay Dates:* ${formatRefundStayDates(refundRequest)}`,
    ].join("\n");
    const rightColumn = [
        `*Amount:* ${formatCurrency(refundRequest.refundAmount)}`,
        `*Charge to Client:* ${normalizeRefundChargeToClient(refundRequest.chargeToClient)}`,
        `*Payment Method:* ${normalizeSlackField(refundRequest.paymentMethod)}`,
        `*Payment Details:* ${normalizeSlackField(refundRequest.paymentDetails)}`,
    ].join("\n");

    return [
        {
            type: "section",
            fields: [
                { type: "mrkdwn", text: leftColumn },
                { type: "mrkdwn", text: rightColumn },
            ]
        },
        {
            type: "section",
            text: { type: "mrkdwn", text: `*Explanation:*\n${normalizeSlackField(refundRequest.explaination)}` }
        },
        {
            type: "section",
            text: { type: "mrkdwn", text: `*Notes:*\n${normalizeSlackField(refundRequest.notes)}` }
        }
    ];
};

const buildRefundRequestSubmissionHeader = (
    refundRequest: RefundRequestEntity,
    options: {
        anjMention: string;
        assigneeMention?: string | null;
        submittedByMention?: string | null;
    }
) => {
    const normalizedStatus = String(refundRequest.status || "Pending").trim().toLowerCase();
    if (normalizedStatus === "paid") {
        const mentions = [
            options.anjMention,
            options.assigneeMention,
            options.submittedByMention && options.submittedByMention !== options.assigneeMention
                ? options.submittedByMention
                : null,
        ].filter(Boolean);
        return `${Array.from(new Set(mentions)).join(" ")} Payment has been processed`;
    }

    if (normalizedStatus === "for processing") {
        return `${options.anjMention} please process`;
    }

    return `${options.anjMention} please review`;
};

const parseRefundIssueIds = (issueId?: string | null): string[] => {
    if (!issueId) return [];
    try {
        const parsed = JSON.parse(issueId);
        return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
        return [];
    }
};

const buildRefundIssueLink = (refundRequest: RefundRequestEntity) => {
    const issueIds = parseRefundIssueIds(refundRequest.issueId);
    return issueIds.length
        ? `*<https://securestay.ai/issues?id=${issueIds.join(",")}|View Issue>*`
        : "";
};

const REFUND_REQUEST_STATUS_OPTIONS = ["Pending", "Approved", "For Processing", "Paid", "Denied", "Cancelled"];

const getRefundStatusLabelWithEmoji = (status?: string | null) => {
    const normalized = status || "Pending";
    const statusKey = normalized.trim().toLowerCase();
    const emoji = statusKey === "pending" ? "🟡"
        : statusKey === "approved" ? "🔵"
        : statusKey === "for processing" ? "🟢"
        : statusKey === "paid" ? "✅"
        : statusKey === "denied" ? "🚫"
        : statusKey === "cancelled" ? "🔴"
        : "🟡";
    return `${emoji} ${normalized}`;
};

const buildRefundStatusOption = (refundRequest: RefundRequestEntity, status: string) => ({
    text: {
        type: "plain_text",
        text: getRefundStatusLabelWithEmoji(status),
        emoji: true
    },
    value: JSON.stringify({
        id: refundRequest.id,
        status,
        guestName: refundRequest.guestName,
        listingName: refundRequest.listingName,
        amount: refundRequest.refundAmount
    })
});

const escapeSlackLinkText = (value: string) =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\|/g, " ");

const getIssueListingEmoji = (issue: Issue) => {
    const tags = String(
        (issue as any).listingTags ||
        (issue as any).listing_tags ||
        (issue as any).listing?.tags ||
        ""
    )
        .toLowerCase()
        .split(",")
        .map((tag) => tag.trim().replace(/\s+/g, ""));

    const matched = ISSUE_LISTING_EMOJIS.find(({ key }) => tags.includes(key));
    return matched?.emoji || "⬜";
};

const formatIssueStayDate = (value?: unknown) => {
    if (!value) return "";
    const rawValue = String(value).trim();
    const dateOnlyMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const date = dateOnlyMatch
        ? new Date(
            Number(dateOnlyMatch[1]),
            Number(dateOnlyMatch[2]) - 1,
            Number(dateOnlyMatch[3])
        )
        : value instanceof Date
            ? value
            : new Date(rawValue);
    if (Number.isNaN(date.getTime())) return "";
    return format(date, "MMM dd");
};

const buildIssueSlackHeader = (issue: Issue) => {
    const reservationInfo = (issue as any).reservationInfo || {};
    const listingName = normalizeSlackField(
        issue.listing_name ||
        (issue as any).listingName ||
        (issue as any).listing?.internalListingName ||
        reservationInfo.listingName
    );
    const guestName = normalizeSlackField(issue.guest_name || reservationInfo.guestName);
    const reservationId = issue.reservation_id && issue.reservation_id !== "NA"
        ? issue.reservation_id
        : reservationInfo.id;
    const hostifyReservationUrl = reservationId
        ? `https://us.hostify.com/reservations/view/${reservationId}`
        : "";
    const guestNameText = hostifyReservationUrl
        ? `<${hostifyReservationUrl}|${escapeSlackLinkText(guestName)}>`
        : guestName;
    const channelName = normalizeSlackField(issue.channel || reservationInfo.channelName);
    const checkIn = formatIssueStayDate(issue.check_in_date || reservationInfo.arrivalDate);
    const checkOut = formatIssueStayDate((issue as any).check_out_date || reservationInfo.departureDate);
    const stayDates = checkIn && checkOut ? `${checkIn} → ${checkOut}` : checkIn || checkOut || "—";

    return `${getIssueListingEmoji(issue)} ${listingName} | ${guestNameText} | ${channelName} | ${stayDates}`;
};

const buildIssueStatusDropdown = (issue: Issue, statusField: "ir" | "gr", label: string) => {
    const currentStatus = statusField === "gr" ? ((issue as any).gr_status || "New") : (issue.status || "New");
    return {
    type: "actions",
    elements: [
        {
            type: "static_select",
            action_id: slackInteractivityEventNames.UPDATE_ISSUE_STATUS,
            placeholder: {
                type: "plain_text",
                text: `Update ${label}`,
                emoji: true
            },
            initial_option: {
                text: {
                    type: "plain_text",
                    text: getIssueStatusLabelWithEmoji(currentStatus),
                    emoji: true
                },
                value: JSON.stringify({
                    id: issue.id,
                    status: currentStatus,
                    statusField
                })
            },
            options: ISSUE_STATUS_OPTIONS.map((status) => ({
                text: {
                    type: "plain_text",
                    text: getIssueStatusLabelWithEmoji(status),
                    emoji: true
                },
                value: JSON.stringify({
                    id: issue.id,
                    status,
                    statusField
                })
            }))
        }
    ]
    };
};

export const formatSecureStayMarkdownForSlack = (value?: unknown) => {
    return String(value || "")
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, url) => {
            const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
            return `<${normalizedUrl}|${label}>`;
        });
};

export const buildRefundRequestMessage = (refundRequest: RefundRequestEntity, slackTagIds?: string[]) => {
    const tagMention = slackTagIds && slackTagIds.length > 0
        ? slackTagIds.map(id => `<@${id}>`).join(' ') + ' — New refund request requires your approval.'
        : null;

    const slackMessage = {
        channel: REFUND_REQUEST_CHANNEL,
        text: `New Refund Request for ${refundRequest.guestName}`,
        blocks: [
            ...(tagMention ? [{
                type: "section",
                text: { type: "mrkdwn", text: tagMention }
            }] : []),
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*You have a new refund request:* ${buildRefundIssueLink(refundRequest)}`
                }
            },
            ...buildRefundRequestDetailBlocks(refundRequest),
            {
                type: "actions",
                elements: [
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Approve", emoji: true },
                        action_id: slackInteractivityEventNames.APPROVE_REFUND_REQUEST,
                        value: JSON.stringify({
                            id: refundRequest.id,
                            guestName: refundRequest.guestName,
                            listingName: refundRequest.listingName,
                            amount: refundRequest.refundAmount,
                            issueId: refundRequest.issueId
                        })
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Deny", emoji: true },
                        style: "danger",
                        action_id: slackInteractivityEventNames.DENY_REFUND_REQUEST,
                        value: JSON.stringify({
                            id: refundRequest.id,
                            guestName: refundRequest.guestName,
                            listingName: refundRequest.listingName,
                            amount: refundRequest.refundAmount,
                            issueId: refundRequest.issueId
                        })
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Paid", emoji: true },
                        style: "primary",
                        action_id: slackInteractivityEventNames.PAID_REFUND_REQUEST,
                        value: JSON.stringify({
                            id: refundRequest.id,
                            guestName: refundRequest.guestName,
                            listingName: refundRequest.listingName,
                            amount: refundRequest.refundAmount,
                            issueId: refundRequest.issueId
                        })
                    }
                ]
            }
        ]
    };

    return slackMessage;
};

/**
 * Rebuilds the original refund request message with action buttons appropriate
 * for the current status. Used to update (chat.update) the original message
 * after a status change so the buttons always reflect the current state.
 */
export const buildRefundRequestOriginalMessageForStatus = (refundRequest: RefundRequestEntity) => {
    const actionValue = JSON.stringify({
        id: refundRequest.id,
        guestName: refundRequest.guestName,
        listingName: refundRequest.listingName,
        amount: refundRequest.refundAmount,
        issueId: refundRequest.issueId
    });

    const statusEmoji = refundRequest.status.toLowerCase() === "approved" ? "✅"
        : refundRequest.status.toLowerCase() === "for processing" ? "🔄"
        : refundRequest.status.toLowerCase() === "denied" ? "❌"
        : refundRequest.status.toLowerCase() === "paid" ? "💰"
        : refundRequest.status.toLowerCase() === "cancelled" ? "🚫"
        : "⏳";

    const statusLabel = `${statusEmoji} *Status: ${refundRequest.status}*`;

    // Build the action elements based on current status
    let actionElements: any[] = [];
    if (refundRequest.status === "Pending") {
        actionElements = [
            {
                type: "button",
                text: { type: "plain_text", text: "Approve", emoji: true },
                action_id: slackInteractivityEventNames.APPROVE_REFUND_REQUEST,
                value: actionValue
            },
            {
                type: "button",
                text: { type: "plain_text", text: "Deny", emoji: true },
                style: "danger",
                action_id: slackInteractivityEventNames.DENY_REFUND_REQUEST,
                value: actionValue
            },
            {
                type: "button",
                text: { type: "plain_text", text: "Paid", emoji: true },
                style: "primary",
                action_id: slackInteractivityEventNames.PAID_REFUND_REQUEST,
                value: actionValue
            }
        ];
    } else if (refundRequest.status === "Approved" || refundRequest.status === "For Processing") {
        actionElements = [
            {
                type: "button",
                text: { type: "plain_text", text: "Mark as Paid", emoji: true },
                style: "primary",
                action_id: slackInteractivityEventNames.PAID_REFUND_REQUEST,
                value: actionValue
            }
        ];
    }
    // Paid / Denied / Cancelled have no action buttons.

    const blocks: any[] = [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*Refund request:* ${buildRefundIssueLink(refundRequest)}`
            }
        },
        ...buildRefundRequestDetailBlocks(refundRequest),
        {
            type: "section",
            text: { type: "mrkdwn", text: statusLabel }
        },
        ...(actionElements.length > 0 ? [{ type: "actions", elements: actionElements }] : [])
    ];

    return {
        channel: REFUND_REQUEST_CHANNEL,
        text: `Refund Request for ${refundRequest.guestName} — ${refundRequest.status}`,
        blocks
    };
};

export const buildMitigationRefundRequestMessage = (
    refundRequest: RefundRequestEntity,
    options: {
        anjSlackId?: string | null;
        submittedBy?: string | null;
        assigneeMention?: string | null;
        submittedByMention?: string | null;
    }
) => {
    const currentStatus = REFUND_REQUEST_STATUS_OPTIONS.includes(refundRequest.status)
        ? refundRequest.status
        : "Pending";
    const refundUrl = `https://securestay.ai/luxury-lodging/refund-requests?id=${refundRequest.id}`;
    const mitigationUrl = `https://securestay.ai/mitigation?reservationId=${refundRequest.reservationId}`;
    const anjMention = options.anjSlackId ? `<@${options.anjSlackId}>` : "Anj";
    const submittedBy = normalizeSlackField(options.submittedBy, "SecureStay User");
    const headerMessage = buildRefundRequestSubmissionHeader(refundRequest, {
        anjMention,
        assigneeMention: options.assigneeMention,
        submittedByMention: options.submittedByMention,
    });

    return {
        text: `💸 Refund Request — ${formatCurrency(refundRequest.refundAmount)} | ${headerMessage}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `💸 *Refund Request* | ${headerMessage}`
                }
            },
            ...buildRefundRequestDetailBlocks(refundRequest),
            {
                type: "actions",
                elements: [
                    {
                        type: "static_select",
                        action_id: slackInteractivityEventNames.UPDATE_REFUND_REQUEST_STATUS,
                        placeholder: {
                            type: "plain_text",
                            text: "Update Status",
                            emoji: true
                        },
                        initial_option: buildRefundStatusOption(refundRequest, currentStatus),
                        options: REFUND_REQUEST_STATUS_OPTIONS.map((status) => buildRefundStatusOption(refundRequest, status))
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "View Refund Request", emoji: true },
                        url: refundUrl,
                        value: JSON.stringify({ id: refundRequest.id })
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "View Mitigation Detail", emoji: true },
                        url: mitigationUrl,
                        value: JSON.stringify({ reservationId: refundRequest.reservationId })
                    }
                ]
            },
            {
                type: "context",
                elements: [{ type: "mrkdwn", text: `Submitted By: ${submittedBy}` }]
            }
        ],
        unfurl_links: false,
        unfurl_media: false,
    };
};

export const buildMitigationRefundRequestUpdateMessage = (
    refundRequest: RefundRequestEntity,
    options: {
        description: string;
        updatedBy?: string | null;
        assigneeMention?: string | null;
        anjSlackId?: string | null;
        oldStatus?: string | null;
        newStatus?: string | null;
    }
) => {
    const normalizedNewStatus = String(options.newStatus || refundRequest.status || "").trim();
    const isStatusUpdate = Boolean(options.oldStatus || options.newStatus);
    const processingMention = normalizedNewStatus.toLowerCase() === "for processing"
        ? ` <@${options.anjSlackId || "U08END0JTBM"}> please process`
        : "";
    const rawDescription = isStatusUpdate
        ? `Refund request status updated from *${options.oldStatus || "—"}* → *${getRefundStatusLabelWithEmoji(normalizedNewStatus)}*${processingMention}`
        : options.description.trim();
    const description = rawDescription.startsWith("💸") ? rawDescription : `💸 ${rawDescription}`;
    const assigneeLabel = normalizeSlackField(options.assigneeMention, "Unassigned");
    const updatedBy = normalizeSlackField(options.updatedBy, "SecureStay User");

    return {
        text: description,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `${description}\n*Refund Request:* <https://securestay.ai/luxury-lodging/refund-requests?id=${refundRequest.id}|${normalizeSlackField(refundRequest.guestName)} — ${formatCurrency(refundRequest.refundAmount)}>`
                }
            },
            {
                type: "context",
                elements: [
                    { type: "mrkdwn", text: `cc: ${assigneeLabel}` },
                    { type: "mrkdwn", text: `Updated By: ${updatedBy}` }
                ]
            }
        ],
        unfurl_links: false,
        unfurl_media: false,
    };
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
                        ...(buildRefundIssueLink(request) ? [{ type: "mrkdwn", text: buildRefundIssueLink(request) }] : [])
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
    const issueLink = buildRefundIssueLink(refundRequest);
    const slackMessage = {
        channel: REFUND_REQUEST_CHANNEL,
        text: `*${user}* updated the refund request for *${refundRequest.guestName}* recently`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${user}* updated the refund request for *${refundRequest.guestName}* recently.${issueLink ? ` ${issueLink}` : ""}`
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
    const issueLink = buildRefundIssueLink(refundRequest);
    const slackMessage = {
        channel: REFUND_REQUEST_CHANNEL,
        text: `${user} updated the status of refund request for ${refundRequest.guestName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `${refundRequest.status.toLowerCase() == "approved" ? "✅" : refundRequest.status.toLowerCase() == "for processing" ? "🔄" : refundRequest.status.toLowerCase() == "denied" ? "❌" : refundRequest.status.toLowerCase() == "cancelled" ? "🚫" : refundRequest.status.toLowerCase() == "paid" ? "💰" : "⏳"} *${user}* ${refundRequest.status.toLowerCase()} *${formatCurrency(refundRequest.refundAmount)}* refund request for *${refundRequest.guestName}*.${issueLink ? ` ${issueLink}` : ""}`
                }
            },
        ]
    };

    return slackMessage;
};


export const buildIssueSlackMessage = (issue: Issue, updatedBy?: string) => {
    const headerText = buildIssueSlackHeader(issue);
    return {
        channel: ISSUE_NOTIFICATION_CHANNEL,
        text: headerText,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${headerText}* *<https://securestay.ai/issues?id=${issue.id}|View Issue>*`
                }
            },
            buildIssueStatusDropdown(issue, "ir", "IR Status"),
            buildIssueStatusDropdown(issue, "gr", "GR Status"),
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


export const buildClientTicketSlackMessageDelete = (_ticket: ClientTicket, user: string, listingName: string) => {
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

export const buildActionItemsUpdateMessage = (updates: ActionItemsUpdates, _listingName: string, user: string) => {
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
    const formattedUpdate = formatSecureStayMarkdownForSlack(updates.updates);
    return {
        channel: ISSUE_NOTIFICATION_CHANNEL,
        text: `New update for 🏠 ${listingName}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `📢 *Update:* ${formattedUpdate}`
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
                    text: `*IR Status:* ${capitalizeFirstLetter(issue.status)}\n*GR Status:* ${capitalizeFirstLetter((issue as any).gr_status || "New")}`
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


export const buildIssueStatusUpdateMessage = (issue: Issue, user: string, statusLabel = "IR Status") => {
    const statusValue = statusLabel === "GR Status" ? ((issue as any).gr_status || "New") : (issue.status || "New");
    const slackMessage = {
        channel: ISSUE_NOTIFICATION_CHANNEL,
        text: `${user} updated the ${statusLabel} to ${issueStatusEmoji(statusValue)}${statusValue.toUpperCase()}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${statusLabel}:* ${issueStatusEmoji(statusValue)}${statusValue.toUpperCase()} by ${user} `
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

const formatExpenseSlackAmount = (amount: number): string => {
    const amountPrefix = amount < 0 ? "-" : "";
    return `${amountPrefix}${formatCurrency(Math.abs(amount))}`;
};

// Expense Slack Message Builders
export const buildExpenseSlackMessage = (
    expense: ExpenseEntity,
    createdBy: string,
    listingName?: string,
    updatedBy?: string,
    categoryNames?: string,
    options?: { isDeleted?: boolean }
) => {
    const typeLabel = expense.amount > 0 ? "Extra" : "Expense";
    const title = options?.isDeleted
        ? `❌ ${typeLabel} Deleted`
        : `New ${typeLabel}: 🏠 ${listingName || 'Unknown Property'}`;
    return {
        channel: EXPENSE_CHANNEL,
        text: title,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${title}* *<https://securestay.ai/accounting/transactions/expense?expenseId=${expense.id}|View>*`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Amount:* ${formatExpenseSlackAmount(expense.amount)}` },
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
            ...(expense.paymentDetails ? [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Payment Details:*\n${expense.paymentDetails}`
                }
            }] : []),
            ...(expense.slackNotes ? [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Slack Notes:*\n${expense.slackNotes}`
                }
            }] : []),
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
    _categoryNames?: string,
    changeRows?: string[]
) => {
    const typeLabel = expense.amount > 0 ? "Extra" : "Expense";
    const changesText = changeRows && changeRows.length > 0
        ? changeRows.join('\n')
        : "No displayable field changes were detected.";
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
                text: {
                    type: "mrkdwn",
                    text: `*Updated By:* ${updatedBy || 'SecureStay User'}\n*Changes:*\n${changesText}`
                }
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
                    { type: "mrkdwn", text: `*Amount:* ${formatExpenseSlackAmount(expense.amount)}` },
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
    updatedBy: string,
    changeRows?: string[]
) => {
    const typeLabel = expense.amount > 0 ? "Extra" : "Expense";
    const statusChangeRow = changeRows?.find(row => row.startsWith("*Status:*"));
    const statusMatch = statusChangeRow?.match(/\*Status:\*\s+~(.+?)~\s+→\s+(.+)$/);
    const statusText = statusMatch
        ? `~${statusMatch[1]}~ → ${expenseStatusEmoji(expense.status)}${statusMatch[2]}`
        : `${expenseStatusEmoji(expense.status)}${capitalizeFirstLetter(expense.status)}`;
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
                    { type: "mrkdwn", text: `*Status:* ${statusText}` },
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
                text: `cc: ${process.env.ONBOARDING_MENTIONS || '<@U07B3DPM56E> <@U098WQ9GNM8>'}`
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

export const buildMaintenanceFormRequestSlackMessage = (request: MaintenanceFormRequest, formLink: string) => {
    const statusEmoji = request.status === 'new' ? '🔵' : request.status === 'in_progress' ? '🟡' : '🟢';
    const statusLabel = request.status === 'new' ? 'New' : request.status === 'in_progress' ? 'In Progress' : 'Completed';

    return {
        channel: CLEANING_AND_MAINTENANCE,
        text: `New Maintenance Request - Property #${request.propertyId}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Property Name:*\n${(request as any).propertyName || '-'}\n\n` +
                        `*Budget:*\n${request.budget || '-'}\n\n` +
                        `*Email:*\n${request.email || '-'}\n\n` +
                        `*Scope of Work:*\n${request.scopeOfWork || '-'}\n\n` +
                        `*Property Access Information:*\n${request.propertyAccessInformation || '-'}\n\n` +
                        `*Expected Timeframe:*\n${request.expectedTimeframe || '-'}\n\n` +
                        `*Status:* ${statusEmoji} ${statusLabel}\n\n` +
                        `*Form Link:* ${formLink}`
                }
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "static_select",
                        action_id: slackInteractivityEventNames.UPDATE_MAINTENANCE_FORM_REQUEST_STATUS,
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
        bot_name: "Maintenance Request",
        bot_icon: "https://img.icons8.com/ios-filled/50/maintenance.png"
    };
};

export const buildMaintenanceFormRequestUpdateSlackMessage = (diff: Record<string, { old: any; new: any; }>, request: MaintenanceFormRequest) => {
    const changes = Object.entries(diff).map(([field, { old, new: newValue }]) => {
        return `• *${formatFieldName(field)}* was changed from \`${formatValue(old)}\` → \`${formatValue(newValue)}\``;
    }).join("\n");

    return {
        channel: CLEANING_AND_MAINTENANCE,
        text: `Maintenance Request updated - Property #${request.propertyId}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Maintenance Request details have been updated:*\n${changes}`
                }
            }
        ],
        bot_name: "Maintenance Request",
        bot_icon: "https://img.icons8.com/ios-filled/50/maintenance.png"
    };
};

export const buildItemSupplyRequestSlackMessage = (request: ItemSupplyRequest, formLink: string) => {
    const statusEmoji = request.status === 'new' ? '🔵' : request.status === 'in_progress' ? '🟡' : '🟢';
    const statusLabel = request.status === 'new' ? 'New' : request.status === 'in_progress' ? 'In Progress' : 'Completed';

    return {
        channel: CLEANING_AND_MAINTENANCE,
        text: `New Item/Supply Request - Property #${request.propertyId}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Property Name:*\n${(request as any).propertyName || '-'}\n\n` +
                        `*Items to Restock:*\n${request.itemsToRestock || '-'}\n\n` +
                        `*Is Urgent:*\n${request.isUrgent || '-'}\n\n` +
                        `*Approved by Client:*\n${request.approvedByClient || '-'}\n\n` +
                        `*Send to Address:*\n${request.sendToAddress || '-'}\n\n` +
                        `*Requested By:*\n${request.requestedBy || '-'}\n\n` +
                        `*Status:* ${statusEmoji} ${statusLabel}\n\n` +
                        `*Form Link:* ${formLink}`
                }
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "static_select",
                        action_id: slackInteractivityEventNames.UPDATE_ITEM_SUPPLY_REQUEST_STATUS,
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
        bot_name: "Item/Supply Request",
        bot_icon: "https://img.icons8.com/ios-filled/50/shopping-cart.png"
    };
};

export const buildItemSupplyRequestUpdateSlackMessage = (diff: Record<string, { old: any; new: any; }>, request: ItemSupplyRequest) => {
    const changes = Object.entries(diff).map(([field, { old, new: newValue }]) => {
        return `• *${formatFieldName(field)}* was changed from \`${formatValue(old)}\` → \`${formatValue(newValue)}\``;
    }).join("\n");

    return {
        channel: CLEANING_AND_MAINTENANCE,
        text: `Item/Supply Request updated - Property #${request.propertyId}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Item/Supply Request details have been updated:*\n${changes}`
                }
            }
        ],
        bot_name: "Item/Supply Request",
        bot_icon: "https://img.icons8.com/ios-filled/50/shopping-cart.png"
    };
};

// ─── Resolutions Team (#resolutions-team) ──────────────────────────────────

export const RESOLUTIONS_TEAM_CHANNEL = "#resolutions-team";
export const RESOLUTIONS_TEAM_ICON_URL = "https://securestay.ai/assets/Resolutions_Team.png?v=20260422c";
const SLACK_SELECT_OPTION_LIMIT = 100;

const RESOLUTIONS_STATUS_EMOJIS: Record<string, string> = {
    New: "🔵",
    "In Progress": "🟡",
    Negotiating: "🟠",
    Completed: "🟢",
};

const formatResolutionsStatusLabel = (status?: string | null) => {
    const normalizedStatus = String(status || "").trim();
    if (!normalizedStatus) return "—";
    const emoji = RESOLUTIONS_STATUS_EMOJIS[normalizedStatus];
    return emoji ? `${emoji} ${normalizedStatus}` : normalizedStatus;
};

const limitSlackSelectOptions = <T>(options: T[], currentOption?: T | null, isSameOption?: (left: T, right: T) => boolean) => {
    const limited = options.slice(0, SLACK_SELECT_OPTION_LIMIT);
    if (!currentOption || !isSameOption || limited.some((option) => isSameOption(option, currentOption))) {
        return limited;
    }
    return [...limited.slice(0, SLACK_SELECT_OPTION_LIMIT - 1), currentOption];
};

const truncateSlackOptionText = (value: string) => {
    const normalized = String(value || "—").trim() || "—";
    const truncated = normalized.length > 75 ? `${normalized.slice(0, 72)}...` : normalized;
    return truncated.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

const toSlackOptionValue = (prefix: string, value: string) => {
    const normalized = String(value || "").trim();
    return `${prefix}:${normalized}`.slice(0, 75);
};

export interface ResolutionsCheckoutMessageData {
    emoji: string;
    listingName: string;
    guestName: string;
    hostifyUrl: string;
    channelName: string;
    integrationName?: string;
    checkIn: string;
    checkOut: string;
    totalPaid: string;
    ownerRevenue: string;
    status: string;
    assignee: string;
    visibility?: string | null;
    ssUrl: string;
    reviewCheckoutId: number;
    statusOptions: string[];
    assigneeOptions: { label: string; value: string; department?: string }[];
    tagOptions?: { label: string; value: string }[];
    selectedTags?: string[];
    isCancelled?: boolean;
}

type ResolutionsAssigneeSlackOption = {
    text: { type: 'plain_text'; text: string };
    value: string;
    department?: string;
};

export const buildResolutionsCheckoutMessage = (data: ResolutionsCheckoutMessageData) => {
    const {
        emoji, listingName, guestName, hostifyUrl, channelName, integrationName,
        checkIn, checkOut, totalPaid, ownerRevenue, status, assignee, ssUrl,
        visibility,
        reviewCheckoutId, statusOptions, assigneeOptions, tagOptions = [], selectedTags = [],
        isCancelled = false,
    } = data;

    const guestLabel = `${isCancelled ? '❌ ' : ''}${guestName}`;
    // escapeSlackLinkText handles &, <, >, | — apply it to all plain-text fields that land in mrkdwn
    const guestText = hostifyUrl
        ? `<${hostifyUrl}|${escapeSlackLinkText(guestLabel)}>`
        : escapeSlackLinkText(guestLabel);
    const normalizedChannelName = normalizeSlackField(channelName, "");
    const normalizedIntegrationName = normalizeSlackField(integrationName, "");
    const channelLabel = normalizedChannelName.toLowerCase() === "airbnb" && normalizedIntegrationName
        ? `${normalizedChannelName} - ${normalizedIntegrationName}`
        : normalizedChannelName;
    const headerText = `*${escapeSlackLinkText(listingName)}* ${emoji} | ${guestText} | ${escapeSlackLinkText(channelLabel)} | ${checkIn} → ${checkOut} | ${totalPaid} | ${ownerRevenue}`;

    // Slack static_select requires at least 1 option — fall back to defaults if caller passed nothing
    const effectiveStatusOptions = statusOptions.length
        ? statusOptions
        : ['New', 'In Progress', 'Completed'];
    const visibilityOptions = ['Awaiting Review', 'Submitted', 'Visible', 'No Review', 'Remove/Keep?', 'Keep', 'To be Removed', 'Removed', 'Unable to Remove', 'Remove Failed', 'Archived'];
    const allStatusSelectOptions = effectiveStatusOptions.map((s) => ({
        text: { type: 'plain_text' as const, text: truncateSlackOptionText(formatResolutionsStatusLabel(s)) },
        value: toSlackOptionValue('status', s),
    }));
    const unassignedAssigneeOption: ResolutionsAssigneeSlackOption = { text: { type: 'plain_text' as const, text: 'Unassigned' }, value: 'assignee:' };
    const allAssigneeSelectOptions: ResolutionsAssigneeSlackOption[] = [
        unassignedAssigneeOption,
        ...assigneeOptions.map((a) => ({
            text: { type: 'plain_text' as const, text: truncateSlackOptionText(a.label) },
            value: toSlackOptionValue('assignee', a.value),
            department: a.department || 'Other Departments',
        })),
    ];
    const allVisibilitySelectOptions = visibilityOptions.map((v) => ({
        text: { type: 'plain_text' as const, text: truncateSlackOptionText(v) },
        value: toSlackOptionValue('visibility', v),
    }));

    const currentStatusOption = allStatusSelectOptions.find((o) => o.value === toSlackOptionValue('status', status)) || allStatusSelectOptions[0];
    const currentAssigneeOption = allAssigneeSelectOptions.find((o) => o.value === toSlackOptionValue('assignee', assignee || '')) || allAssigneeSelectOptions[0];
    const currentVisibilityOption = allVisibilitySelectOptions.find((o) => o.value === toSlackOptionValue('visibility', visibility || '')) || allVisibilitySelectOptions[0];
    const currentAssigneeSlackOption = currentAssigneeOption
        ? (({ department: _department, ...option }) => option)(currentAssigneeOption)
        : undefined;
    const statusSelectOptions = limitSlackSelectOptions(
        allStatusSelectOptions,
        currentStatusOption,
        (left, right) => left.value === right.value
    );
    const assigneeGroupsByDepartment = new Map<string, typeof allAssigneeSelectOptions>();
    for (const option of allAssigneeSelectOptions) {
        const department = option.value === 'assignee:' ? 'Resolutions' : option.department || 'Other Departments';
        if (!assigneeGroupsByDepartment.has(department)) assigneeGroupsByDepartment.set(department, []);
        assigneeGroupsByDepartment.get(department)!.push(option);
    }
    const assigneeSelectOptionGroups = Array.from(assigneeGroupsByDepartment.entries())
        .filter(([, options]) => options.length > 0)
        .map(([department, options]) => ({
            label: { type: 'plain_text' as const, text: truncateSlackOptionText(department) },
            options: options.slice(0, 100).map(({ department: _department, ...option }) => option),
        }))
        .slice(0, 100);
    const visibilitySelectOptions = limitSlackSelectOptions(
        allVisibilitySelectOptions,
        currentVisibilityOption,
        (left, right) => left.value === right.value
    );
    const normalizedSelectedTags = new Set(selectedTags.map((tag) => tag.toLowerCase()));
    const encodeTagValue = (v: string) =>
        v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const decodeTagValue = (v: string) =>
        v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const tagSelectOptions = tagOptions.slice(0, 100).map((tag) => ({
        text: { type: 'plain_text' as const, text: truncateSlackOptionText(tag.label) },
        value: toSlackOptionValue('tag', encodeTagValue(tag.value)),
    }));
    const currentTagOptions = tagSelectOptions.filter((option) => {
        const rawValue = option.value.startsWith('tag:') ? option.value.slice(4) : option.value;
        return normalizedSelectedTags.has(decodeTagValue(rawValue).toLowerCase());
    });

    const formatSelectedTag = (tag: string) => `\`${escapeSlackLinkText(tag).replace(/`/g, "'")}\``;
    const tagsText = selectedTags.length > 0
        ? `*Tags:* ${selectedTags.map(formatSelectedTag).join(' · ')}`
        : '*Tags*';

    return {
        channel: RESOLUTIONS_TEAM_CHANNEL,
        text: headerText,
        blocks: [
            {
                type: 'section',
                text: { type: 'mrkdwn', text: headerText },
            },
            {
                type: 'actions',
                block_id: `review_checkout_actions:${reviewCheckoutId}`,
                elements: [
                    {
                        type: 'static_select',
                        action_id: 'update_review_checkout_status',
                        placeholder: { type: 'plain_text', text: 'Status' },
                        ...(currentStatusOption ? { initial_option: currentStatusOption } : {}),
                        options: statusSelectOptions,
                    },
                    {
                        type: 'static_select',
                        action_id: 'update_review_checkout_assignee',
                        placeholder: { type: 'plain_text', text: 'Assignee' },
                        ...(currentAssigneeSlackOption ? { initial_option: currentAssigneeSlackOption } : {}),
                        option_groups: assigneeSelectOptionGroups,
                    },
                    {
                        type: 'static_select',
                        action_id: 'update_review_checkout_visibility',
                        placeholder: { type: 'plain_text', text: 'Visibility' },
                        ...(currentVisibilityOption ? { initial_option: currentVisibilityOption } : {}),
                        options: visibilitySelectOptions,
                    },
                    {
                        type: 'button',
                        action_id: 'view_in_securestay',
                        text: { type: 'plain_text', text: 'View in SecureStay' },
                        url: ssUrl,
                    },
                ],
            },
            ...(tagSelectOptions.length ? [{
                type: 'section',
                block_id: `review_checkout_tags:${reviewCheckoutId}`,
                text: { type: 'mrkdwn', text: tagsText },
                accessory: {
                    type: 'multi_static_select',
                    action_id: 'update_review_checkout_tags',
                    placeholder: { type: 'plain_text', text: 'Edit tags' },
                    ...(currentTagOptions.length ? { initial_options: currentTagOptions } : {}),
                    options: tagSelectOptions,
                },
            }] : []),
        ],
        bot_name: 'Resolutions Team',
        bot_icon: RESOLUTIONS_TEAM_ICON_URL,
        unfurl_links: false,
        unfurl_media: false,
    };
};

export type ResolutionsActivityType = 'status' | 'assignee' | 'visibility' | 'resolution_notes' | 'resolution_tag' | 'comment' | 'refund_request' | 'ai_analysis' | 'review_posted' | 'reservation_cancelled' | 'reservation_altered';

export interface ResolutionsActivityData {
    type: ResolutionsActivityType;
    actor?: string;
    actorIconUrl?: string | null;
    details?: string;
    oldValue?: string | null;
    newValue?: string | null;
    anjSlackId?: string;
    notificationMentions?: string[];
    rating?: number | null;
    reviewSentiment?: string | null;
    reviewSentimentReason?: string | null;
}

export const buildResolutionsActivityMessage = (data: ResolutionsActivityData) => {
    const { type, actor, actorIconUrl, details, oldValue, newValue, anjSlackId, notificationMentions = [], rating, reviewSentiment, reviewSentimentReason } = data;
    const actorLabel = actor || 'SecureStay';
    const getReviewSentimentPrefix = (value?: string | null) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'negative') return '🔴 ';
        if (normalized === 'neutral' || normalized === 'mixed') return '⭕️ ';
        return '';
    };

    let text = '';
    let blocks: any[] = [];
    let botName = 'Resolutions Team';
    let botIcon = RESOLUTIONS_TEAM_ICON_URL;

    switch (type) {
        case 'status':
            text = `🔄 *${actorLabel}* changed status from *${oldValue || '—'}* → *${formatResolutionsStatusLabel(newValue || details)}*`;
            break;
        case 'assignee':
            text = `👤 *${actorLabel}* changed assignee from *${oldValue || 'Unassigned'}* → *${newValue || details || 'Unassigned'}*`;
            break;
        case 'review_posted': {
            const safeRating = Math.max(1, Math.min(5, Math.round(Number(rating || 0) > 5 ? Number(rating || 0) / 2 : Number(rating || 0))));
            const stars = '⭐️'.repeat(safeRating || 1);
            const reviewText = String(details || '').trim() || 'No review text provided.';
            const sentimentLabel = String(reviewSentiment || '').trim();
            const sentimentLine = sentimentLabel
                ? `${getReviewSentimentPrefix(sentimentLabel)}${sentimentLabel}${sentimentLabel.toLowerCase() !== 'positive' && notificationMentions.length ? ` ${notificationMentions.join(' ')}` : ''}`
                : '';
            text = `${stars}\n_${reviewText}_${sentimentLine ? `\n${sentimentLine}` : ''}`;
            break;
        }
        case 'reservation_cancelled':
            text = `❌ ${details || 'Reservation was cancelled after check-in time.'}`;
            break;
        case 'reservation_altered':
            text = `⏩️ ${details || 'Reservation was altered.'}`;
            break;
        case 'visibility':
            text = `🌟 *${actorLabel}* changed visibility from *${oldValue || '—'}* → *${newValue || details || '—'}*`;
            break;
        case 'resolution_notes': {
            const previousNote = String(oldValue || '').trim() || '—';
            const nextNote = String(newValue || details || '').trim() || '—';
            text = oldValue
                ? `Resolution Notes Edited By: ${actorLabel}\n📝 ${nextNote}\n~▸ ${previousNote}~\n──────────`
                : `Resolution Notes Added By: ${actorLabel}\n📝 ${nextNote}\n──────────`;
            break;
        }
        case 'resolution_tag': {
            const previousTag = String(oldValue || '').trim();
            const nextTag = String(newValue || details || '').trim();
            const action = previousTag && nextTag ? 'Edited' : previousTag ? 'Removed' : 'Added';
            const shownTag = nextTag || previousTag || '—';
            const tagDisplay = action === 'Removed' && shownTag !== '—' ? `~${shownTag}~` : shownTag;
            text = previousTag && nextTag
                ? `Resolution Tag ${action} By: ${actorLabel}\n🏷️ ${shownTag}\n~▸ ${previousTag}~\n──────────`
                : action === 'Added'
                    ? `🏷️ ${actorLabel} added Resolution Tag → \`${shownTag}\``
                    : `Resolution Tag ${action} By: ${actorLabel}\n🏷️ ${tagDisplay}\n──────────`;
            break;
        }
        case 'comment':
            text = oldValue
                ? `Notes Edited By: ${actorLabel}\n💬 ${newValue || details || '—'}`
                : `Notes Added By: ${actorLabel}\n💬 ${details || '—'}\n──────────`;
            break;
        case 'refund_request':
            text = `💸 *Refund Request* — ${details || '—'}${anjSlackId ? ` | <@${anjSlackId}> please review` : ''}`;
            break;
        case 'ai_analysis':
            text = `🤖 *AI Analysis*\n${details || '—'}`;
            break;
        default:
            text = `ℹ️ *${actorLabel}*: ${details || '—'}`;
    }

    if (type === 'comment') {
        const previousNote = String(oldValue || '').trim() || '—';
        const nextNote = String(newValue || details || '').trim() || '—';
        if (actorIconUrl) {
            botName = actorLabel;
            botIcon = actorIconUrl;
            blocks = oldValue
                ? [
                    { type: 'context', elements: [{ type: 'mrkdwn', text: `Notes Edited By: ${actorLabel}` }] },
                    { type: 'section', text: { type: 'mrkdwn', text: `💬 ${nextNote}` } },
                    { type: 'context', elements: [{ type: 'mrkdwn', text: `~▸ ${previousNote}~` }] },
                    { type: 'divider' },
                ]
                : [
                    { type: 'context', elements: [{ type: 'mrkdwn', text: `Notes Added By: ${actorLabel}` }] },
                    { type: 'section', text: { type: 'mrkdwn', text: `💬 ${nextNote}` } },
                    { type: 'divider' },
                ];
        } else {
            blocks = oldValue
                ? [
                    { type: 'context', elements: [{ type: 'mrkdwn', text: `Notes Edited By: ${actorLabel}` }] },
                    { type: 'section', text: { type: 'mrkdwn', text: `💬 ${nextNote}` } },
                    { type: 'context', elements: [{ type: 'mrkdwn', text: `~▸ ${previousNote}~` }] },
                    { type: 'divider' },
                ]
                : [
                    { type: 'context', elements: [{ type: 'mrkdwn', text: `Notes Added By: ${actorLabel}` }] },
                    { type: 'section', text: { type: 'mrkdwn', text: `💬 ${nextNote}` } },
                    { type: 'divider' },
                ];
        }
    } else {
        if (actorIconUrl) {
            botName = actorLabel;
            botIcon = actorIconUrl;
        }
        if (type === 'resolution_notes') {
            const previousNote = String(oldValue || '').trim() || '—';
            const nextNote = String(newValue || details || '').trim() || '—';

            blocks = oldValue
                ? [
                    { type: 'context', elements: [{ type: 'mrkdwn', text: `Resolution Notes Edited By: ${actorLabel}` }] },
                    { type: 'section', text: { type: 'mrkdwn', text: `📝 ${nextNote}` } },
                    { type: 'context', elements: [{ type: 'mrkdwn', text: `~▸ ${previousNote}~` }] },
                    { type: 'divider' },
                ]
                : [
                    { type: 'context', elements: [{ type: 'mrkdwn', text: `Resolution Notes Added By: ${actorLabel}` }] },
                    { type: 'section', text: { type: 'mrkdwn', text: `📝 ${nextNote}` } },
                    { type: 'divider' },
                ];
        } else if (type === 'resolution_tag') {
            const previousTag = String(oldValue || '').trim();
            const nextTag = String(newValue || details || '').trim();
            const action = previousTag && nextTag ? 'Edited' : previousTag ? 'Removed' : 'Added';
            const shownTag = nextTag || previousTag || '—';
            const tagDisplay = action === 'Removed' && shownTag !== '—' ? `~${shownTag}~` : shownTag;

            blocks = previousTag && nextTag
                ? [
                    { type: 'context', elements: [{ type: 'mrkdwn', text: `Resolution Tag ${action} By: ${actorLabel}` }] },
                    { type: 'section', text: { type: 'mrkdwn', text: `🏷️ ${shownTag}` } },
                    { type: 'context', elements: [{ type: 'mrkdwn', text: `~▸ ${previousTag}~` }] },
                    { type: 'divider' },
                ]
                : action === 'Added'
                    ? [
                        { type: 'section', text: { type: 'mrkdwn', text: `🏷️ ${actorLabel} added Resolution Tag → \`${shownTag}\`` } },
                    ]
                    : [
                    { type: 'context', elements: [{ type: 'mrkdwn', text: `Resolution Tag ${action} By: ${actorLabel}` }] },
                    { type: 'section', text: { type: 'mrkdwn', text: `🏷️ ${tagDisplay}` } },
                    { type: 'divider' },
                ];
        } else if (type === 'review_posted') {
            const safeRating = Math.max(1, Math.min(5, Math.round(Number(rating || 0) > 5 ? Number(rating || 0) / 2 : Number(rating || 0))));
            const stars = '⭐️'.repeat(safeRating || 1);
            const reviewText = String(details || '').trim() || 'No review text provided.';
            const sentimentLabel = String(reviewSentiment || '').trim();
            const sentimentLine = sentimentLabel
                ? `${getReviewSentimentPrefix(sentimentLabel)}*${sentimentLabel}*${sentimentLabel.toLowerCase() !== 'positive' && notificationMentions.length ? ` ${notificationMentions.join(' ')}` : ''}`
                : '';
            const sentimentHelpText = String(reviewSentimentReason || '').trim();
            blocks = [
                { type: 'section', text: { type: 'mrkdwn', text: `${stars}\n_${reviewText}_` } },
                ...(sentimentLine
                    ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: sentimentHelpText ? `${sentimentLine} — ${sentimentHelpText}` : sentimentLine }] }]
                    : []),
            ];
        } else {
            blocks = [
                { type: 'section', text: { type: 'mrkdwn', text } },
                ...(type === 'refund_request' || type === 'ai_analysis'
                    ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `Updated By: ${actorLabel}` }] }]
                    : []),
            ];
        }
    }

    return {
        channel: RESOLUTIONS_TEAM_CHANNEL,
        text,
        blocks,
        bot_name: botName,
        bot_icon: botIcon,
        unfurl_links: false,
        unfurl_media: false,
    };
};
