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
const SNAPSHOT_METADATA_KEY = "trackedState";
const IGNORED_SNAPSHOT_KEYS = new Set([
  "id", "createdAt", "createdBy", "updatedAt", "updatedBy", "deletedAt", "deletedBy",
  "client", "property", "clientProperty", "propertyInfo",
]);
const SENSITIVE_SNAPSHOT_KEY = /(password|access.?code|door.?code|lock.?code|api.?key|secret|token)/i;

type TrackedChange = { field: string; from: unknown; to: unknown };

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
      order: { createdAt: "ASC" },
    });
    const userIds = Array.from(new Set(updates.map((item) => item.createdBy).filter(Boolean))) as string[];
    const users = userIds.length ? await this.userRepo.find({ where: { uid: In(userIds), deletedAt: IsNull() } }) : [];
    const userMap = new Map(users.map((user) => [user.uid, `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email]));
    return updates.map((item) => ({
      ...item,
      metadata: this.publicMetadata(item.metadata),
      createdByName: item.createdBy ? userMap.get(item.createdBy) || "SecureStay User" : "SecureStay",
    }));
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
    const property = await this.propertyRepo.findOne({
      where: { id: propertyId, deletedAt: IsNull() },
      relations: [
        "client",
        "onboarding",
        "serviceInfo",
        "propertyInfo",
        "propertyInfo.propertyBedTypes",
        "propertyInfo.propertyBathroomLocation",
        "propertyInfo.propertyParkingInfo",
        "propertyInfo.propertyUpsells",
        "propertyInfo.vendorManagementInfo",
        "propertyInfo.vendorManagementInfo.vendorInfo",
        "propertyInfo.vendorManagementInfo.suppliesToRestock",
      ],
    });
    if (!property) return null;
    const trackedState = this.buildTrackedState(property);
    const previousUpdate = await this.updateRepo.findOne({
      where: { propertyId, type: "system" },
      order: { createdAt: "DESC" },
    });
    const previousState = previousUpdate?.metadata?.[SNAPSHOT_METADATA_KEY];
    const changes = this.diffTrackedState(
      previousState && typeof previousState === "object" ? previousState as Record<string, unknown> : null,
      trackedState
    );
    const suppliedChanges = this.changesFromMetadata(metadata);
    const saved = await this.updateRepo.save(this.updateRepo.create({
      propertyId,
      property,
      message,
      type: "system",
      eventType,
      metadata: {
        ...(metadata || {}),
        ...(changes.length || suppliedChanges.length ? { changes: changes.length ? changes : suppliedChanges } : {}),
        [SNAPSHOT_METADATA_KEY]: trackedState,
      },
      createdBy: userId || null,
    }));
    if (eventType === "onboarding_form_received") await this.ensureSlackThread(property, userId);
    if (SLACK_VISIBLE_SYSTEM_EVENTS.has(eventType)) await this.postToSlack(property, message, userId, true);
    return saved;
  }

  private publicMetadata(metadata: Record<string, unknown> | null) {
    if (!metadata) return null;
    const { [SNAPSHOT_METADATA_KEY]: _trackedState, ...publicMetadata } = metadata;
    return Object.keys(publicMetadata).length ? publicMetadata : null;
  }

  private buildTrackedState(property: ClientPropertyEntity) {
    const source = {
      client: property.client,
      property: {
        address: property.address,
        streetAddress: property.streetAddress,
        unitNumber: property.unitNumber,
        city: property.city,
        state: property.state,
        country: property.country,
        zipCode: property.zipCode,
        status: property.status,
        onboardingStage: property.onboardingStage,
      },
      onboarding: property.onboarding,
      serviceInfo: property.serviceInfo,
      listingInfo: property.propertyInfo,
    };
    const flattened: Record<string, unknown> = {};
    this.flattenTrackedValue(source, "", flattened);
    return flattened;
  }

  private flattenTrackedValue(value: unknown, path: string, output: Record<string, unknown>) {
    if (value === undefined || typeof value === "function") return;
    if (value === null || typeof value !== "object") {
      if (path) output[path] = value ?? null;
      return;
    }
    if (value instanceof Date) return;
    if (Array.isArray(value)) {
      if (path) output[path] = value.map((item) => this.compactArrayValue(item));
      return;
    }
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      if ((path && IGNORED_SNAPSHOT_KEYS.has(key)) || SENSITIVE_SNAPSHOT_KEY.test(key)) return;
      this.flattenTrackedValue(child, path ? `${path}.${key}` : key, output);
    });
  }

  private compactArrayValue(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => this.compactArrayValue(item));
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !IGNORED_SNAPSHOT_KEYS.has(key) && !SENSITIVE_SNAPSHOT_KEY.test(key))
        .map(([key, child]) => [key, this.compactArrayValue(child)])
    );
  }

  private diffTrackedState(previous: Record<string, unknown> | null, current: Record<string, unknown>): TrackedChange[] {
    if (!previous) return [];
    const keys = Array.from(new Set([...Object.keys(previous), ...Object.keys(current)])).sort();
    return keys
      .filter((key) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(current[key] ?? null))
      .map((key) => ({ field: key, from: previous[key] ?? null, to: current[key] ?? null }));
  }

  private changesFromMetadata(metadata?: Record<string, unknown>): TrackedChange[] {
    if (!metadata) return [];
    if (metadata.previousStage !== undefined || metadata.stage !== undefined) {
      return [{ field: "property.onboardingStage", from: metadata.previousStage ?? null, to: metadata.stage ?? null }];
    }
    return [];
  }

  private buildSlackThreadUrl(thread: SlackMessageEntity) {
    const workspaceUrl = String(process.env.SLACK_WORKSPACE_URL || "").trim().replace(/\/?$/, "/");
    const threadTs = thread.threadTs || thread.messageTs;
    if (!workspaceUrl || !thread.channel || !threadTs) return null;
    return `${workspaceUrl}archives/${thread.channel}/p${String(threadTs).replace(".", "")}`;
  }

  async ensureSlackThreadForProperty(propertyId: string, userId?: string) {
    const property = await this.propertyRepo.findOne({
      where: { id: propertyId, deletedAt: IsNull() },
      relations: ["client", "propertyInfo"],
    });
    if (!property) throw CustomErrorHandler.notFound("Property not found");
    const thread = await this.ensureSlackThread(property, userId);
    const slackThreadUrl = thread ? this.buildSlackThreadUrl(thread) : null;
    if (!slackThreadUrl) {
      throw CustomErrorHandler.validationError("Slack thread was created, but SLACK_WORKSPACE_URL is not configured");
    }
    return { slackThreadUrl };
  }

  private async ensureSlackThread(property: ClientPropertyEntity, userId?: string): Promise<SlackMessageEntity | null> {
    const client = property.client as any;
    if (!client?.id) return null;
    const existing = await this.slackRepo.findOne({
      where: {
        entityType: "client_onboarding",
        originalMessage: Like(`%"propertyId":"${property.id}"%`),
      },
      order: { createdAt: "DESC" },
    });
    if (existing?.threadTs) return existing;
    const user = userId ? await this.userRepo.findOne({ where: { uid: userId } }) : null;
    const author = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "SecureStay";
    const propertyName = (property as any).propertyInfo?.internalListingName || property.address || `Property #${property.id}`;
    const response = await sendSlackMessage({
      channel: "#onboarding",
      text: `📥 *Onboarding form received*\n*Client:* ${client.firstName || ""} ${client.lastName || ""}\n*Property:* ${propertyName}\n_Received by ${author}_`,
    });
    if (response?.ok) {
      return await this.slackRepo.save(this.slackRepo.create({
        channel: response.channel,
        messageTs: response.ts,
        threadTs: response.ts,
        entityType: "client_onboarding",
        entityId: null as any,
        originalMessage: JSON.stringify({ clientId: client.id, propertyId: property.id, source: "onboarding_form_received" }),
      }));
    } else {
      logger.error(
        `Failed to create onboarding Slack thread for property ${property.id}: ${response?.error || "No Slack response"}`
      );
    }
    return null;
  }

  private async postToSlack(property: ClientPropertyEntity, message: string, userId?: string, system = false) {
    try {
      const clientId = (property.client as any)?.id;
      if (!clientId) return;
      const propertyRoot = await this.slackRepo.findOne({
        where: {
          entityType: "client_onboarding",
          originalMessage: Like(`%"propertyId":"${property.id}"%`),
        },
        order: { createdAt: "DESC" },
      });
      const root = propertyRoot || await this.slackRepo.findOne({
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
