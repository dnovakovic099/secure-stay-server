import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
} from 'typeorm';
import { getDiff } from '../helpers/helpers';
import logger from '../utils/logger.utils';
import { buildClaimSlackMessage, buildClaimSlackMessageDelete, buildClaimStatusUpdateMessage, buildClientTicketSlackMessageDelete, buildClientTicketSlackMessageUpdate, buildIssueSlackMessage } from '../utils/slackMessageBuilder';
import sendSlackMessage from '../utils/sendSlackMsg';
import { SlackMessageService } from '../services/SlackMessageService';
import { ClientTicket } from '../entity/ClientTicket';
import { appDatabase } from '../utils/database.util';
import { UsersEntity } from '../entity/Users';
import { Listing } from '../entity/Listing';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import { Claim } from '../entity/Claim';
import updateSlackMessage from '../utils/updateSlackMsg';
import { uploadFileToSlack } from '../utils/uploadFileToSlack';
import { getCachedUserMap } from '../utils/usersCache.util';

@EventSubscriber()
export class ClientTicketSubscriber
    implements EntitySubscriberInterface<Claim> {

    listenTo() {
        return Claim;
    }

    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private slackMessageInfo = appDatabase.getRepository(SlackMessageEntity);

    private getClaimAttachmentGroups(claim: Claim) {
        const groups = {
            photos: [] as string[],
            invoices: [] as string[],
        };
        const add = (target: "photos" | "invoices", fileName?: string | null) => {
            if (fileName && !groups[target].includes(fileName)) {
                groups[target].push(fileName);
            }
        };

        try {
            const workspace = JSON.parse(claim.workspace_data || "{}");
            const claimRequest = workspace?.claimRequest || {};
            (claimRequest.sharedPhotos || []).forEach((asset: any) => add("photos", asset?.fileName));
            add("invoices", claimRequest.sharedInvoice?.fileName);
            (claimRequest.entries || []).forEach((entry: any) => {
                (entry?.photos || []).forEach((asset: any) => add("photos", asset?.fileName));
                add("invoices", entry?.invoice?.fileName);
            });
        } catch (error) {
            logger.warn(`Unable to parse claim workspace attachments for claim ${claim.id}`, error);
        }

        try {
            const fileNames = JSON.parse(claim.fileNames || "[]");
            if (Array.isArray(fileNames)) {
                fileNames.forEach((fileName: string) => {
                    if (!groups.photos.includes(fileName) && !groups.invoices.includes(fileName)) {
                        add("photos", fileName);
                    }
                });
            }
        } catch {
            // File names are best-effort fallback only.
        }

        return groups;
    }

    private async uploadClaimAttachmentsToSlackThread(claim: Claim, channelId: string, threadTs?: string) {
        if (!channelId || !threadTs) return;
        const moduleFolder = "claims";
        const groups = this.getClaimAttachmentGroups(claim);

        if (groups.photos.length > 0) {
            await uploadFileToSlack(channelId, groups.photos, moduleFolder, threadTs, "Photo(s) Attached");
        }
        if (groups.invoices.length > 0) {
            await uploadFileToSlack(channelId, groups.invoices, moduleFolder, threadTs, "Invoice(s) Attached");
        }
    }

    async afterInsert(event: InsertEvent<Claim>) {
        const { entity, manager } = event;
        await this.sendSlackMessage(entity, entity.created_by).then((slackResponse) => {
            if (!slackResponse) {
                logger.error("Slack response is undefined, cannot upload files.");
                return;
            }

            const channelId = slackResponse.channel || "";
            const threadTs = slackResponse.ts || "";
            if (!channelId || !threadTs) {
                logger.error("Slack channel or thread timestamp is missing from the claim Slack response.");
                return;
            }
            this.uploadClaimAttachmentsToSlackThread(entity, channelId, threadTs)
                .then(() => {
                    logger.info("Claim attachments uploaded to Slack thread successfully.");
                })
                .catch((error) => {
                    logger.error("Error uploading claim attachments to Slack thread:", error);
                });
        });
    }

    private async sendSlackMessage(claim: Claim, userId: string) {
        try {
            const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
            const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";

            const slackMessageService = new SlackMessageService();
            const slackMessage = buildClaimSlackMessage(claim, user);
            console.log("Slack Message:", slackMessage);
            const slackResponse = await sendSlackMessage(slackMessage);

            await slackMessageService.saveSlackMessageInfo({
                channel: slackResponse.channel,
                messageTs: slackResponse.ts,
                threadTs: slackResponse.ts,
                entityType: "claim",
                entityId: claim.id,
                originalMessage: JSON.stringify(slackMessage)
            });

            return slackResponse;
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    private async updateSlackMessage(claim: any, userId: string, eventType: string) {
        try {
            const userMap = await getCachedUserMap();

            let slackMessage = buildClaimSlackMessage(claim, userMap.get(userId));
            const slackMessageInfo = await this.slackMessageInfo.findOne({
                where: {
                    entityType: "claim",
                    entityId: claim.id
                }
            });
            if (eventType == "delete") {
                slackMessage = buildClaimSlackMessageDelete(claim, userMap.get(userId));
                await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
            } else if (eventType == "statusUpdate") {
                slackMessage = buildClaimStatusUpdateMessage(claim, userMap.get(userId) || userId);
                await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
            }

            const mainMessage = buildClaimSlackMessage(claim, userMap.get(claim.created_by), userMap.get(userId));
            const { channel, ...messageWithoutChannel } = mainMessage;
            await updateSlackMessage(messageWithoutChannel, slackMessageInfo.messageTs, slackMessageInfo.channel);

        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    async afterUpdate(event: UpdateEvent<Claim>) {
        const { databaseEntity, entity, manager } = event;
        if (!databaseEntity || !entity) return;

        const oldData = { ...databaseEntity };
        const newData = { ...entity };
        const diff = getDiff(oldData, newData);

        // nothing changed?
        if (Object.keys(diff).length === 0) return;
        let eventType = "update";
        if ((entity.status != databaseEntity.status)) {
            eventType = "statusUpdate";
        } else if (entity.deleted_at) {
            eventType = "delete";
        }

        await this.updateSlackMessage(entity, entity.updated_by, eventType)

    }

    async afterRemove(event: RemoveEvent<Claim>) {
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };
    }
}
