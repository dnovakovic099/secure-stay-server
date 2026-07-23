import { In, IsNull, Like } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { OnboardingUpdate } from "../entity/OnboardingUpdate";
import { UsersEntity } from "../entity/Users";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import CustomErrorHandler from "../middleware/customError.middleware";
import sendSlackMessage from "../utils/sendSlackMsg";
import logger from "../utils/logger.utils";

const SLACK_VISIBLE_SYSTEM_EVENTS = new Set(["phase_changed", "hostify_exported", "email_sent", "sms_sent"]);

export class OnboardingUpdateService {
  private updateRepo = appDatabase.getRepository(OnboardingUpdate);
  private propertyRepo = appDatabase.getRepository(ClientPropertyEntity);
  private userRepo = appDatabase.getRepository(UsersEntity);
  private slackRepo = appDatabase.getRepository(SlackMessageEntity);

  async list(propertyIds: string[]) {
    const ids = Array.from(new Set(propertyIds.filter(Boolean)));
    if (!ids.length) return [];

    const updates = await this.updateRepo.find({
      where: { propertyId: In(ids) },
      order: { createdAt: "DESC" },
    });
    const userIds = Array.from(new Set(updates.map((item) => item.createdBy).filter(Boolean))) as string[];
    const users = userIds.length ? await this.userRepo.find({ where: { uid: In(userIds), deletedAt: IsNull() } }) : [];
    const userMap = new Map(users.map((user) => [user.uid, `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email]));
    return updates.map((item) => ({ ...item, createdByName: item.createdBy ? userMap.get(item.createdBy) || "SecureStay User" : "SecureStay" }));
  }

  async addUserUpdate(propertyId: string, message: string, userId: string) {
    const cleanMessage = String(message || "").trim();
    if (!cleanMessage) throw CustomErrorHandler.validationError("Update message is required");
    const property = await this.propertyRepo.findOne({ where: { id: propertyId, deletedAt: IsNull() }, relations: ["client", "propertyInfo"] });
    if (!property) throw CustomErrorHandler.notFound("Property not found");

    const saved = await this.updateRepo.save(this.updateRepo.create({
      propertyId,
      property,
      message: cleanMessage,
      type: "user",
      eventType: "discussion",
      createdBy: userId,
    }));
    await this.postToSlack(property, cleanMessage, userId);
    return saved;
  }

  async addSystemUpdate(propertyId: string, message: string, eventType: string, userId?: string, metadata?: Record<string, unknown>) {
    const property = await this.propertyRepo.findOne({ where: { id: propertyId, deletedAt: IsNull() }, relations: ["client", "propertyInfo"] });
    if (!property) return null;
    const saved = await this.updateRepo.save(this.updateRepo.create({
      propertyId,
      property,
      message,
      type: "system",
      eventType,
      metadata: metadata || null,
      createdBy: userId || null,
    }));
    if (eventType === "onboarding_form_received") await this.ensureSlackThread(property, userId);
    if (SLACK_VISIBLE_SYSTEM_EVENTS.has(eventType)) await this.postToSlack(property, message, userId, true);
    return saved;
  }

  private async ensureSlackThread(property: ClientPropertyEntity, userId?: string) {
    const client = property.client as any;
    if (!client?.id) return;
    const existing = await this.slackRepo.findOne({
      where: { entityType: "client_onboarding", originalMessage: Like(`%"clientId":"${client.id}"%`) },
      order: { createdAt: "DESC" },
    });
    if (existing?.threadTs) return;
    const user = userId ? await this.userRepo.findOne({ where: { uid: userId } }) : null;
    const author = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "SecureStay";
    const propertyName = (property as any).propertyInfo?.internalListingName || property.address || `Property #${property.id}`;
    const response = await sendSlackMessage({
      channel: "#onboarding",
      text: `📥 *Onboarding form received*\n*Client:* ${client.firstName || ""} ${client.lastName || ""}\n*Property:* ${propertyName}\n_Received by ${author}_`,
    });
    if (response?.ok) {
      await this.slackRepo.save(this.slackRepo.create({
        channel: response.channel,
        messageTs: response.ts,
        threadTs: response.ts,
        entityType: "client_onboarding",
        entityId: null as any,
        originalMessage: JSON.stringify({ clientId: client.id, propertyId: property.id, source: "onboarding_form_received" }),
      }));
    }
  }

  private async postToSlack(property: ClientPropertyEntity, message: string, userId?: string, system = false) {
    try {
      const clientId = (property.client as any)?.id;
      if (!clientId) return;
      const root = await this.slackRepo.findOne({
        where: { entityType: "client_onboarding", originalMessage: Like(`%"clientId":"${clientId}"%`) },
        order: { createdAt: "DESC" },
      });
      if (!root?.threadTs) return;
      const user = userId ? await this.userRepo.findOne({ where: { uid: userId } }) : null;
      const author = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "SecureStay";
      const propertyName = (property as any).propertyInfo?.internalListingName || property.address || `Property #${property.id}`;
      await sendSlackMessage({
        channel: root.channel,
        text: `${system ? "⚙️" : "💬"} *${propertyName}*\n${message}\n_${system ? "System update" : `Posted by ${author}`}_`,
      }, root.threadTs);
    } catch (error) {
      logger.error("Failed to post onboarding update to Slack", error);
    }
  }
}
