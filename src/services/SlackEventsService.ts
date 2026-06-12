import { appDatabase } from "../utils/database.util";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { ClientTicket } from "../entity/ClientTicket";
import { ClientTicketUpdates } from "../entity/ClientTicketUpdates";
import { ThreadMessageEntity } from "../entity/ThreadMessage";
import { ZapierTriggerEvent } from "../entity/ZapierTriggerEvent";
import { ReviewCheckout } from "../entity/ReviewCheckout";
import { ReviewCheckoutUpdates } from "../entity/ReviewCheckoutUpdates";
import { ReviewDiscussionMessageEntity } from "../entity/ReviewDiscussionMessage";
import { ReviewDiscussionReactionEntity } from "../entity/ReviewDiscussionReaction";
import { Issue } from "../entity/Issue";
import { IssueUpdates } from "../entity/IsssueUpdates";
import { FileInfo } from "../entity/FileInfo";
import { AIEscalationManagerService } from "./AIEscalationManagerService";
import { ResolutionsTeamSlackService } from "./ResolutionsTeamSlackService";
import { ReservationAICopilotService } from "./ReservationAICopilotService";
import { GuestAnalysisService } from "./GuestAnalysisService";
import sendSlackMessage from "../utils/sendSlackMsg";
import updateSlackMessage from "../utils/updateSlackMsg";
import logger from "../utils/logger.utils";
import axios from "axios";
import { getSlackUsers } from "../utils/getSlackUsers";
import { replaceSlackIdsWithMentions } from "../helpers/helpers";
import { formatSecureStayMarkdownForSlack } from "../utils/slackMessageBuilder";

interface SlackMessageFile {
    id: string;
    name?: string;
    title?: string;
    mimetype?: string;
    filetype?: string;
    size?: number;
    url_private?: string;
    url_private_download?: string;
    permalink_public?: string;
    permalink?: string;
    thumb_1024?: string;
    thumb_720?: string;
    thumb_480?: string;
    thumb_360?: string;
}

interface SlackMessageEvent {
    type: string;
    subtype?: string;
    channel: string;
    user?: string;
    text?: string;
    ts: string;
    thread_ts?: string;
    bot_id?: string;
    deleted_ts?: string;
    files?: SlackMessageFile[];
    previous_message?: {
        ts?: string;
        thread_ts?: string;
        user?: string;
        bot_id?: string;
        subtype?: string;
    };
    message?: {
        ts?: string;
        thread_ts?: string;
        user?: string;
        text?: string;
        bot_id?: string;
        subtype?: string;
    };
}

interface SlackAppMentionEvent {
    type: string;
    channel: string;
    user: string;
    text: string;
    ts: string;
    thread_ts?: string;
}

export class SlackEventsService {
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private clientTicketRepo = appDatabase.getRepository(ClientTicket);
    private clientTicketUpdateRepo = appDatabase.getRepository(ClientTicketUpdates);
    private threadMessageRepo = appDatabase.getRepository(ThreadMessageEntity);
    private zapierEventRepo = appDatabase.getRepository(ZapierTriggerEvent);
    private reviewCheckoutRepo = appDatabase.getRepository(ReviewCheckout);
    private reviewCheckoutUpdatesRepo = appDatabase.getRepository(ReviewCheckoutUpdates);
    private reviewDiscussionMessageRepo = appDatabase.getRepository(ReviewDiscussionMessageEntity);
    private reviewDiscussionReactionRepo = appDatabase.getRepository(ReviewDiscussionReactionEntity);
    private issueRepo = appDatabase.getRepository(Issue);
    private issueUpdateRepo = appDatabase.getRepository(IssueUpdates);

    /**
     * Handle incoming message event from Slack Events API
     */
    async handleMessageEvent(event: SlackMessageEvent): Promise<void> {
        try {
            if (event.subtype === 'message_deleted') {
                await this.handleDeletedMessageEvent(event);
                return;
            }

            if (event.subtype === 'message_changed') {
                await this.handleChangedMessageEvent(event);
                return;
            }

            // Skip if not a thread reply (no thread_ts means it's a root message)
            if (!event.thread_ts) {
                logger.debug('[SlackEventsService] Skipping: Not a thread reply');
                return;
            }

            // Skip if it's the same as the root message (thread_ts === ts for root messages)
            if (event.thread_ts === event.ts) {
                logger.debug('[SlackEventsService] Skipping: Root message, not a reply');
                return;
            }

            // Skip bot messages (including our own bot) to prevent infinite loops
            if (event.bot_id || event.subtype === 'bot_message') {
                logger.debug(`[SlackEventsService] Skipping: Bot message — channel=${event.channel} ts=${event.ts}`);
                return;
            }

            // Find the slack message record by thread_ts
            const slackMessageRecord = await this.slackMessageRepo.findOne({
                where: {
                    messageTs: event.thread_ts,
                }
            });

            if (!slackMessageRecord) {
                // Fallback: check if this thread belongs to a ReviewCheckout via slackThreadTs.
                // This covers threads that were posted before the slack_messages tracking record
                // was introduced, or where that record was not saved.
                const rc = await this.reviewCheckoutRepo.findOne({
                    where: { slackThreadTs: event.thread_ts },
                });

                if (!rc) {
                    logger.debug(`[SlackEventsService] No tracking record found for thread_ts=${event.thread_ts} channel=${event.channel} — not a tracked entity`);
                    return;
                }

                logger.info(`[SlackEventsService] Thread reply matched ReviewCheckout ${rc.id} via slackThreadTs fallback — channel=${event.channel} ts=${event.ts}`);
                const resolutionsService = new ResolutionsTeamSlackService();
                const slackUsers = await getSlackUsers();
                const processedText = replaceSlackIdsWithMentions(event.text, slackUsers);
                await resolutionsService.syncSlackReplyToSS(rc.id, event.user, processedText, event.ts, event.files || []);
                return;
            }

            logger.info(`[SlackEventsService] Thread reply received — entityType=${slackMessageRecord.entityType} entityId=${slackMessageRecord.entityId} channel=${event.channel} ts=${event.ts}`);

            // ----- Route according to entityType -----

            if (slackMessageRecord.entityType === 'zapier_trigger_event') {
                return await this.handleZapierEventMessage(event, slackMessageRecord.entityId);
            }

            if (slackMessageRecord.entityType === 'review_checkout') {
                const resolutionsService = new ResolutionsTeamSlackService();
                const slackUsers = await getSlackUsers();
                const processedText = replaceSlackIdsWithMentions(event.text, slackUsers);
                await resolutionsService.syncSlackReplyToSS(
                    slackMessageRecord.entityId,
                    event.user,
                    processedText,
                    event.ts,
                    event.files || []
                );
                return;
            }

            if (slackMessageRecord.entityType === 'issues') {
                const dup = await this.issueUpdateRepo.findOne({
                    where: { slackMessageTs: event.ts }
                });
                if (dup) {
                    logger.info(`[SlackEventsService] Duplicate Slack reply for issue, skipping ts=${event.ts}`);
                    return;
                }

                const issue = await this.issueRepo.findOne({
                    where: { id: slackMessageRecord.entityId }
                });
                if (!issue) {
                    logger.error(`[SlackEventsService] Issue not found: ${slackMessageRecord.entityId}`);
                    return;
                }

                const slackUserName = await this.getSlackUserDisplayName(event.user);
                const slackUsers = await getSlackUsers();
                const processedText = replaceSlackIdsWithMentions(event.text, slackUsers);

                const newUpdate = this.issueUpdateRepo.create({
                    updates: processedText,
                    issue,
                    createdBy: `${slackUserName} (via Slack)`,
                    source: 'slack',
                    slackMessageTs: event.ts,
                });
                await this.issueUpdateRepo.save(newUpdate);

                if (Array.isArray(event.files) && event.files.length > 0) {
                    const fileInfoRepo = appDatabase.getRepository(FileInfo);
                    for (const file of event.files) {
                        const rawUrl =
                            file.url_private_download || file.url_private ||
                            file.permalink_public || file.permalink || null;
                        if (!rawUrl) continue;
                        const previewRawUrl =
                            file.thumb_1024 || file.thumb_720 || file.thumb_480 ||
                            file.thumb_360 || rawUrl;
                        const previewProxyUrl = `/issues/slack-file?url=${encodeURIComponent(previewRawUrl)}`;
                        const downloadProxyUrl = `/issues/slack-file?url=${encodeURIComponent(rawUrl)}`;
                        await fileInfoRepo.save(fileInfoRepo.create({
                            entityType: 'issue-updates',
                            entityId: newUpdate.id,
                            fileName: file.name || `slack_file_${file.id}`,
                            originalName: file.title || file.name || 'Slack file',
                            mimetype: file.mimetype || file.filetype || '',
                            webContentLink: previewProxyUrl,
                            webViewLink: file.permalink_public || file.permalink || rawUrl,
                            localPath: null,
                            status: 'uploaded',
                            createdBy: `${slackUserName} (via Slack)`,
                        }));
                    }
                    logger.info(`[SlackEventsService] Stored ${event.files.length} file(s) for issue update ${newUpdate.id}`);
                }

                logger.info(`[SlackEventsService] Synced Slack reply to issue ${issue.id}`);
                return;
            }

            if (slackMessageRecord.entityType !== 'client_ticket') {
                logger.info(`[SlackEventsService] Unsupported entity type '${slackMessageRecord.entityType}' for thread_ts: ${event.thread_ts}`);
                return;
            }

            // Check for duplicate (already synced this message for client_ticket)
            const existingClientUpdate = await this.clientTicketUpdateRepo.findOne({
                where: { slackMessageTs: event.ts }
            });

            if (existingClientUpdate) {
                logger.info(`[SlackEventsService] Duplicate detected for client ticket, skipping: ${event.ts}`);
                return;
            }

            // Find the client ticket
            const clientTicket = await this.clientTicketRepo.findOne({
                where: { id: slackMessageRecord.entityId }
            });

            if (!clientTicket) {
                logger.error(`[SlackEventsService] Client ticket not found: ${slackMessageRecord.entityId}`);
                return;
            }

            // Get Slack user display name
            const slackUserName = await this.getSlackUserDisplayName(event.user);
            const createdBy = `${slackUserName} (via Slack)`;

            // Process the message text to convert Slack user mentions to readable names
            const slackUsers = await getSlackUsers();
            const processedText = replaceSlackIdsWithMentions(event.text, slackUsers);

            // Create the update with source='slack' to prevent infinite loop
            const newUpdate = this.clientTicketUpdateRepo.create({
                updates: processedText,
                clientTicket: clientTicket,
                createdBy: createdBy,
                source: 'slack',
                slackMessageTs: event.ts
            });

            await this.clientTicketUpdateRepo.save(newUpdate);
            logger.info(`[SlackEventsService] Synced Slack reply to client ticket ${clientTicket.id}`);

        } catch (error) {
            logger.error('[SlackEventsService] Error handling message event:', error);
        }
    }

    /**
     * Keep SecureStay timeline rows current when a tracked Slack reply is edited.
     * Slack nests the edited payload under event.message for message_changed.
     */
    private async handleChangedMessageEvent(event: SlackMessageEvent): Promise<void> {
        const changed = event.message;
        const changedTs = changed?.ts || event.ts;
        if (!changedTs) {
            logger.warn('[SlackEventsService] message_changed event missing message.ts');
            return;
        }

        const issueUpdate = await this.issueUpdateRepo.findOne({
            where: { slackMessageTs: changedTs },
            withDeleted: true,
        });

        const slackUsers = await getSlackUsers();
        const processedText = replaceSlackIdsWithMentions(changed?.text || '', slackUsers);
        const slackUserName = changed?.user ? await this.getSlackUserDisplayName(changed.user) : 'Slack';

        const discussionMessage = await this.findReviewDiscussionMessageBySlackTs(changedTs);
        if (discussionMessage?.sourceType === 'note') {
            discussionMessage.content = processedText;
            discussionMessage.mentions = this.extractSlackMentionTokens(changed?.text || processedText);
            discussionMessage.metadata = {
                ...(discussionMessage.metadata || {}),
                editedAt: new Date().toISOString(),
            };
            await this.reviewDiscussionMessageRepo.save(discussionMessage);

            const reviewCheckoutUpdate = await this.reviewCheckoutUpdatesRepo.findOne({
                where: { slackMessageTs: changedTs },
                withDeleted: true,
            });
            if (reviewCheckoutUpdate && !reviewCheckoutUpdate.deletedAt) {
                reviewCheckoutUpdate.updates = processedText;
                reviewCheckoutUpdate.updatedBy = `${slackUserName} (via Slack)`;
                await this.reviewCheckoutUpdatesRepo.save(reviewCheckoutUpdate);
            }

            logger.info(`[SlackEventsService] Synced Slack edit to review discussion message for ts=${changedTs}`);
            return;
        }

        if (!issueUpdate) {
            logger.debug(`[SlackEventsService] No synced timeline entry found for edited Slack ts=${changedTs}`);
            return;
        }
        if (issueUpdate.deletedAt) {
            logger.debug(`[SlackEventsService] Ignoring edit for deleted issue timeline entry Slack ts=${changedTs}`);
            return;
        }

        issueUpdate.updates = processedText;
        issueUpdate.updatedBy = `${slackUserName} (via Slack)`;
        await this.issueUpdateRepo.save(issueUpdate);

        logger.info(`[SlackEventsService] Synced Slack edit to issue timeline update for ts=${changedTs}`);
    }

    /**
     * Slack sends message_deleted events separately from the original reply event.
     * Match by Slack ts and soft-delete the synced timeline entry so it disappears
     * from SecureStay without touching the issue/client ticket itself.
     */
    private async handleDeletedMessageEvent(event: SlackMessageEvent): Promise<void> {
        const deletedTs = event.deleted_ts || event.previous_message?.ts;
        if (!deletedTs) {
            logger.warn('[SlackEventsService] message_deleted event missing deleted_ts/previous_message.ts');
            return;
        }

        const deletedBy = event.previous_message?.user
            ? `${event.previous_message.user} (via Slack)`
            : 'Slack';

        const issueUpdate = await this.issueUpdateRepo.findOne({
            where: { slackMessageTs: deletedTs },
            withDeleted: true,
        });
        if (issueUpdate) {
            if (!issueUpdate.deletedAt) {
                issueUpdate.deletedAt = new Date();
                issueUpdate.deletedBy = deletedBy;
                await this.issueUpdateRepo.save(issueUpdate);
            }
            logger.info(`[SlackEventsService] Soft-deleted issue timeline update for Slack ts=${deletedTs}`);
            return;
        }

        const clientTicketUpdate = await this.clientTicketUpdateRepo.findOne({
            where: { slackMessageTs: deletedTs },
            withDeleted: true,
        });
        if (clientTicketUpdate) {
            if (!clientTicketUpdate.deletedAt) {
                clientTicketUpdate.deletedAt = new Date();
                clientTicketUpdate.deletedBy = deletedBy;
                await this.clientTicketUpdateRepo.save(clientTicketUpdate);
            }
            logger.info(`[SlackEventsService] Soft-deleted client ticket update for Slack ts=${deletedTs}`);
            return;
        }

        const discussionMessage = await this.findReviewDiscussionMessageBySlackTs(deletedTs);
        if (discussionMessage?.sourceType === 'note') {
            await this.deleteReviewDiscussionMessageCascade(discussionMessage);

            const reviewCheckoutUpdate = await this.reviewCheckoutUpdatesRepo.findOne({
                where: { slackMessageTs: deletedTs },
                withDeleted: true,
            });
            if (reviewCheckoutUpdate && !reviewCheckoutUpdate.deletedAt) {
                reviewCheckoutUpdate.deletedAt = new Date();
                reviewCheckoutUpdate.deletedBy = deletedBy;
                await this.reviewCheckoutUpdatesRepo.save(reviewCheckoutUpdate);
            }

            logger.info(`[SlackEventsService] Deleted review discussion note for Slack ts=${deletedTs}`);
            return;
        }

        logger.debug(`[SlackEventsService] No synced timeline entry found for deleted Slack ts=${deletedTs}`);
    }

    private async findReviewDiscussionMessageBySlackTs(slackMessageTs: string) {
        return this.reviewDiscussionMessageRepo
            .createQueryBuilder("msg")
            .where("JSON_UNQUOTE(JSON_EXTRACT(msg.metadata, '$.slackMessageTs')) = :ts", { ts: slackMessageTs })
            .getOne();
    }

    private async deleteReviewDiscussionMessageCascade(message: ReviewDiscussionMessageEntity) {
        const stack = [message];
        const messagesToDelete: ReviewDiscussionMessageEntity[] = [];

        while (stack.length) {
            const current = stack.pop();
            if (!current) continue;
            messagesToDelete.push(current);
            const replies = await this.reviewDiscussionMessageRepo.find({ where: { parentMessageId: current.id } });
            stack.push(...replies);
        }

        for (const item of messagesToDelete.reverse()) {
            await this.reviewDiscussionReactionRepo.delete({ messageId: item.id });
            await this.reviewDiscussionMessageRepo.delete({ id: item.id });
        }
    }

    private extractSlackMentionTokens(text: string) {
        const slackMatches = Array.from(String(text || '').matchAll(/<@([A-Za-z0-9]+)(?:\|[^>]+)?>/g))
            .map((match) => `<@${match[1]}>`);
        const handleMatches = Array.from(String(text || '').matchAll(/(^|[^<])@([a-zA-Z0-9._-]+)/g))
            .map((match) => `@${match[2]}`);
        return Array.from(new Set([
            ...slackMatches.map((match) => match.toLowerCase()),
            ...handleMatches.map((match) => match.toLowerCase()),
        ]));
    }

    /**
     * Fetch Slack user display name using Slack API
     */
    private async getSlackUserDisplayName(userId: string): Promise<string> {
        try {
            if (!userId) return 'Unknown User';

            const response = await axios.get('https://slack.com/api/users.info', {
                headers: {
                    'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
                },
                params: { user: userId }
            });

            if (response.data.ok && response.data.user) {
                return response.data.user.profile?.display_name ||
                    response.data.user.profile?.real_name ||
                    response.data.user.name ||
                    'Unknown User';
            }

            return 'Unknown User';
        } catch (error) {
            logger.error('[SlackEventsService] Error fetching user info:', error);
            return 'Unknown User';
        }
    }

    /**
     * Handle incoming thread replies for Zapier Trigger Events (GR Tasks)
     */
    private async handleZapierEventMessage(event: SlackMessageEvent, entityId: number): Promise<void> {
        try {
            // Check for duplicate (already synced this message)
            const existingMessage = await this.threadMessageRepo.findOne({
                where: { slackMessageTs: event.ts }
            });

            if (existingMessage) {
                logger.info(`[SlackEventsService] Duplicate Zapier thread message detected, skipping: ${event.ts}`);
                return;
            }

            // Find the GR Task
            const grTask = await this.zapierEventRepo.findOne({
                where: { id: entityId }
            });

            if (!grTask) {
                logger.error(`[SlackEventsService] GR Task (Zapier event) not found: ${entityId}`);
                return;
            }

            // Get Slack user display name
            const slackUserName = await this.getSlackUserDisplayName(event.user);

            // Process the message text to convert Slack user mentions
            const slackUsers = await getSlackUsers();
            const processedText = replaceSlackIdsWithMentions(event.text, slackUsers);

            // Note: Since Slack replies don't have userAvatar readily available in message event,
            // we will fetch it from user profile if possible, else null.
            let userAvatar: string | null = null;
            try {
                if (event.user) {
                    const response = await axios.get('https://slack.com/api/users.info', {
                        headers: { 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}` },
                        params: { user: event.user }
                    });
                    if (response.data.ok && response.data.user?.profile?.image_48) {
                        userAvatar = response.data.user.profile.image_48;
                    }
                }
            } catch (avatarError) {
                logger.warn(`[SlackEventsService] Could not fetch avatar for ${event.user}:`, avatarError);
            }

            // Convert Slack TS to Date
            const unixSeconds = parseFloat(event.ts);
            const messageDate = new Date(unixSeconds * 1000);

            // Save to thread_messages with source='slack'
            const newThreadMessage = this.threadMessageRepo.create({
                grTaskId: entityId,
                source: 'slack',
                userName: slackUserName,
                userAvatar: userAvatar,
                content: processedText,
                slackMessageTs: event.ts,
                messageTimestamp: messageDate
            });

            await this.threadMessageRepo.save(newThreadMessage);
            logger.info(`[SlackEventsService] Synced Slack reply to GR Task ${entityId}`);

        } catch (error) {
            logger.error('[SlackEventsService] Error handling Zapier event message:', error);
        }
    }

    private isGenerateAIAnalysisRequest(message: string): boolean {
        const normalized = message.toLowerCase();
        return (
            /\b(generate|regenerate|refresh|run|create)\b.*\bai\s*analysis\b/.test(normalized) ||
            /\bai\s*analysis\b.*\b(generate|regenerate|refresh|run|create)\b/.test(normalized)
        );
    }

    private isOperationalFlagsRequest(message: string): boolean {
        const normalized = message.toLowerCase();
        return (
            /\b(operational\s+flags?|ops\s+flags?)\b/.test(normalized) ||
            /\b(list|show|send|what are|give me)\b.*\b(red|green)?\s*flags?\b/.test(normalized) ||
            /\b(red|green)\s+flags?\b/.test(normalized)
        );
    }

    private formatOperationalFlagsForSlack(detail: Awaited<ReturnType<GuestAnalysisService["getAnalysisDetailContext"]>>): string {
        const flags = detail?.record?.flags || [];
        if (!flags.length) {
            return "No operational flags were found in the latest saved AI analysis for this reservation.";
        }

        const redFlags = flags.filter((flag: any) => flag?.polarity !== "positive");
        const greenFlags = flags.filter((flag: any) => flag?.polarity === "positive");
        const normalizeText = (value: unknown, fallback = "") => String(value || fallback).replace(/\s+/g, " ").trim();
        const formatPhase = (phase: unknown) => {
            const label = normalizeText(phase).replace(/_/g, " ");
            if (!label) return "";
            return `\`${label.replace(/\b\w/g, (char) => char.toUpperCase())}\``;
        };
        const formatPhases = (flag: any) => {
            const phases = Array.isArray(flag?.phases) ? flag.phases.map(formatPhase).filter(Boolean) : [];
            return phases.length ? phases.join(" ") : "`Unspecified`";
        };
        const formatEvidence = (evidence: string) => {
            const cleaned = normalizeText(evidence);
            if (!cleaned) return "";
            return `\n  • _Evidence:_ _"${cleaned.replace(/"/g, "'")}"_`;
        };
        const formatFlag = (flag: any, index: number) => {
            const title = normalizeText(flag?.flag, "Operational Flag");
            const explanation = normalizeText(flag?.explanation, "No description available.");
            const evidence = normalizeText(flag?.evidence);
            const owner = normalizeText(flag?.owner);
            const ownerText = owner ? `\n  • Owner: *${owner}*` : "";
            return [
                `• *${index + 1}. ${title}*`,
                ownerText,
                `\n  • Phases: ${formatPhases(flag)}`,
                `\n  • Summary: ${explanation}`,
                formatEvidence(evidence),
            ].join("");
        };

        const parts = [
            "*Operational Flags*",
            `*Reservation:* ${detail?.record?.guestName || "Guest"} · ${detail?.record?.listingName || "Property"}`,
            "",
        ];

        if (redFlags.length) {
            parts.push("🚩: *Operational Red Flags*");
            parts.push(redFlags.map(formatFlag).join("\n\n"));
            parts.push("");
        }

        if (greenFlags.length) {
            parts.push("✅: *Operational Green Flags*");
            parts.push(greenFlags.map(formatFlag).join("\n\n"));
        }

        return parts.join("\n").trim();
    }

    private async postSlackLoadingMessage(channel: string, threadTs: string, text: string): Promise<string | null> {
        const loadingMessage = await sendSlackMessage({ channel, text }, threadTs);
        return loadingMessage?.ts || null;
    }

    private async resolveSlackLoadingMessage(
        channel: string,
        threadTs: string,
        loadingMessageTs: string | null,
        text: string
    ): Promise<void> {
        if (loadingMessageTs) {
            await updateSlackMessage({ text }, loadingMessageTs, channel);
            return;
        }

        await sendSlackMessage({ channel, text }, threadTs);
    }

    private async postOperationalFlagsForReviewCheckout(
        reservationId: number,
        channel: string,
        threadTs: string,
        loadingMessageTs: string | null
    ): Promise<void> {
        const analysisService = new GuestAnalysisService();
        let detail = await analysisService.getAnalysisDetailContext(reservationId);

        if (!detail) {
            await this.resolveSlackLoadingMessage(
                channel,
                threadTs,
                loadingMessageTs,
                "🔄 No saved AI analysis found. Generating AI analysis first…"
            );
            await analysisService.analyzeGuestCommunication(reservationId, undefined, "slack");
            detail = await analysisService.getAnalysisDetailContext(reservationId);
        }

        await this.resolveSlackLoadingMessage(channel, threadTs, loadingMessageTs, this.formatOperationalFlagsForSlack(detail));
    }

    private async answerReviewCheckoutCopilot(
        reservationId: number,
        channel: string,
        threadTs: string,
        userMessage: string,
        slackUserId: string,
        loadingMessageTs: string | null
    ): Promise<void> {
        const copilotService = new ReservationAICopilotService();
        const thread = await copilotService.sendMessage({
            reservationId,
            content: userMessage,
            userId: slackUserId,
        });
        const latestAssistantMessage = [...thread.messages].reverse().find((message) => message.role === "assistant");
        const answer = latestAssistantMessage?.content?.trim();
        await this.resolveSlackLoadingMessage(
            channel,
            threadTs,
            loadingMessageTs,
            answer ? formatSecureStayMarkdownForSlack(answer) : "I couldn't generate a grounded copilot answer from the available SecureStay data."
        );
    }

    private async postReviewCheckoutMentionError(
        channel: string,
        threadTs: string,
        loadingMessageTs: string | null,
        text: string
    ): Promise<void> {
        await this.resolveSlackLoadingMessage(channel, threadTs, loadingMessageTs, text);
    }

    private async postReviewCheckoutMentionReply(
        reservationId: number,
        channel: string,
        threadTs: string,
        userMessage: string,
        slackUserId: string
    ): Promise<void> {
        const loadingMessageTs = await this.postSlackLoadingMessage(
            channel,
            threadTs,
            this.isOperationalFlagsRequest(userMessage)
                ? "🔄 Loading operational flags…"
                : "💬 SecureStay Copilot is thinking…"
        );

        try {
            if (this.isOperationalFlagsRequest(userMessage)) {
                await this.postOperationalFlagsForReviewCheckout(reservationId, channel, threadTs, loadingMessageTs);
                return;
            }

            await this.answerReviewCheckoutCopilot(reservationId, channel, threadTs, userMessage, slackUserId, loadingMessageTs);
        } catch (error) {
            logger.error(`[SlackEventsService] ReviewCheckout mention response failed for reservation ${reservationId}:`, error);
            await this.postReviewCheckoutMentionError(
                channel,
                threadTs,
                loadingMessageTs,
                "❌ SecureStay could not generate a response for this reservation. Please check the server logs."
            );
        }
    }

    private async handleReviewCheckoutMention(
        reservationId: number,
        channel: string,
        threadTs: string,
        userMessage: string,
        slackUserId: string,
    ): Promise<void> {
        if (this.isGenerateAIAnalysisRequest(userMessage)) {
            const resolutionsService = new ResolutionsTeamSlackService();
            await resolutionsService.triggerAIAnalysisFromSlack(reservationId, channel, threadTs);
            return;
        }

        await this.postReviewCheckoutMentionReply(reservationId, channel, threadTs, userMessage, slackUserId);
    }

    /**
     * Handle app_mention events (when bot is @mentioned)
     * Routes to AI Escalation Manager for conversational responses
     */
    async handleAppMention(event: SlackAppMentionEvent): Promise<void> {
        const threadTs = event.thread_ts || event.ts;

        try {
            logger.info(`[SlackEventsService] App mention received — channel=${event.channel} user=${event.user} thread=${threadTs} ts=${event.ts}`);

            // Extract the actual message (remove the bot mention)
            const botMentionRegex = /<@[A-Z0-9]+>/g;
            const userMessage = event.text.replace(botMentionRegex, '').trim();

            logger.info(`[SlackEventsService] Generating AI response for mention — channel=${event.channel} thread=${threadTs} msgLength=${userMessage.length}`);

            // Look up the entity (GR task or review_checkout) linked to this thread
            const slackMsgRecord = await this.slackMessageRepo
                .createQueryBuilder('sm')
                .where('sm.messageTs = :threadTs', { threadTs })
                .andWhere('sm.entityType IN (:...types)', { types: ['zapier_trigger_event', 'review_checkout'] })
                .getOne()
                .catch((lookupErr) => {
                    logger.error(`[SlackEventsService] Thread lookup DB error — channel=${event.channel} thread=${threadTs}: ${lookupErr}`);
                    return null;
                });

            let trackedEntity = slackMsgRecord
                ? {
                    entityType: slackMsgRecord.entityType,
                    entityId: slackMsgRecord.entityId,
                }
                : null;

            if (!trackedEntity) {
                const rc = await this.reviewCheckoutRepo.findOne({
                    where: { slackThreadTs: threadTs },
                    select: ["id", "slackThreadTs"],
                });

                if (rc) {
                    trackedEntity = {
                        entityType: "review_checkout",
                        entityId: rc.id,
                    };
                    logger.info(`[SlackEventsService] App mention matched ReviewCheckout ${rc.id} via slackThreadTs fallback — channel=${event.channel} thread=${threadTs}`);
                }
            }

            if (!trackedEntity) {
                logger.warn(`[SlackEventsService] No tracked entity found for mention — channel=${event.channel} thread=${threadTs}. Mention will not be answered by AI.`);
                return;
            }

            if (!userMessage) {
                logger.info(`[SlackEventsService] Mention with no message body — sending help response. channel=${event.channel} thread=${threadTs}`);
                const helpText = trackedEntity.entityType === 'review_checkout'
                    ? "👋 Hi! I'm the Reservation AI Copilot. Ask me about this reservation, or say `generate AI analysis` / `show operational flags`."
                    : "👋 Hi! I'm the GR Tasks AI Manager. You can ask me about task status, request extensions, or provide updates. How can I help?";
                await sendSlackMessage({ channel: event.channel, text: helpText }, threadTs);
                return;
            }

            // Review checkout threads use the reservation copilot, with command shortcuts for AI analysis and operational flags.
            if (trackedEntity.entityType === 'review_checkout') {
                const rc = await this.reviewCheckoutRepo.findOne({
                    where: { id: trackedEntity.entityId },
                    relations: ['reservationInfo'],
                });
                if (rc?.reservationInfo?.id) {
                    await this.handleReviewCheckoutMention(
                        rc.reservationInfo.id,
                        event.channel,
                        threadTs,
                        userMessage,
                        event.user,
                    );
                } else {
                    await sendSlackMessage({ channel: event.channel, text: "❌ Could not find the reservation for this thread." }, threadTs);
                }
                return;
            }

            logger.info(`[SlackEventsService] Found GR task ${trackedEntity.entityId} for mention — channel=${event.channel} thread=${threadTs}`);

            // Use AI Manager to generate a response
            let response: string | null = null;
            try {
                const aiManager = new AIEscalationManagerService();
                response = await aiManager.handleMention(event.channel, threadTs, userMessage, event.user);
                logger.info(`[SlackEventsService] AI response generated — channel=${event.channel} thread=${threadTs} responseLength=${response?.length ?? 0}`);
            } catch (aiError) {
                logger.error(`[SlackEventsService] AI response generation failed — channel=${event.channel} thread=${threadTs}: ${aiError}`);
                response = null;
            }

            if (response) {
                try {
                    await sendSlackMessage({ channel: event.channel, text: response }, threadTs);
                    logger.info(`[SlackEventsService] AI reply posted — channel=${event.channel} thread=${threadTs}`);
                } catch (postError) {
                    logger.error(`[SlackEventsService] Failed to post AI reply — channel=${event.channel} thread=${threadTs}: ${postError}`);
                }
            } else {
                logger.warn(`[SlackEventsService] AI mention produced no response — channel=${event.channel} thread=${threadTs} taskId=${trackedEntity.entityId}`);
            }

        } catch (error) {
            logger.error(`[SlackEventsService] Unhandled error in handleAppMention — channel=${event.channel} thread=${threadTs}: ${error}`);

            // Send a user-facing error message so the rep knows something went wrong
            try {
                await sendSlackMessage({
                    channel: event.channel,
                    text: "I encountered an error processing your message. Please try again or check the AI logs for details."
                }, threadTs);
            } catch (sendError) {
                logger.error(`[SlackEventsService] Failed to send error fallback message — channel=${event.channel} thread=${threadTs}: ${sendError}`);
            }
        }
    }
}
