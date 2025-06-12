import { appDatabase } from "../utils/database.util";
import { CategoryEntity } from "../entity/Category";
import { Request } from "express";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";

interface SlackMessageInfo {
    channel: string;
    messageTs: string;
    threadTs: string;
    entityType: string;
    entityId: number;
    originalMessage: string;
}

export class SlackMessageService {
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);

    async saveSlackMessageInfo(body: SlackMessageInfo) {
        const newMessage = new SlackMessageEntity();
        newMessage.channel = body.channel;
        newMessage.messageTs = body.messageTs;
        newMessage.threadTs = body.threadTs;
        newMessage.entityType = body.entityType;
        newMessage.entityId = body.entityId;
        newMessage.originalMessage = body.originalMessage;

        const savedMessage = await this.slackMessageRepo.save(newMessage);
        return savedMessage;
    }

}
