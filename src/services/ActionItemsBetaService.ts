import OpenAI from "openai";
import { In, Not } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { ActionItemBetaCategoryEntity } from "../entity/ActionItemBetaCategory";
import { ActionItemBetaRuleEntity } from "../entity/ActionItemBetaRule";
import { ActionItemBetaItemEntity } from "../entity/ActionItemBetaItem";
import { ActionItemBetaSettingEntity } from "../entity/ActionItemBetaSetting";
import { GuestCommunicationEntity } from "../entity/GuestCommunication";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { MessagingService } from "./MessagingServices";
import { OpenPhoneService } from "./OpenPhoneService";
import { Hostify } from "../client/Hostify";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";
import { resolveDetectorInstructions } from "./AIDetectorInstructions";
import logger from "../utils/logger.utils";

export interface ActionItemsBetaFilters {
    status?: string[];
    category?: string[];
    property?: string[];
    source?: string[];
    assignedTo?: string[];
    priority?: string[];
    search?: string;
}

interface DetectionCandidate {
    title: string;
    description: string;
    proposedResolution: string;
    categoryName: string;
    priority: string;
    confidence: number;
    reason: string;
    source: string;
    messageIds: string[];
    snippet?: string;
    highlightTerms?: string[];
    resolvedAt?: Date | null;
    suggestedStatus?: string;
}

interface ActionItemsBetaSettings {
    autoCreateThreshold: number;
    reviewThreshold: number;
    sourceToggles: {
        hostify: boolean;
        openphone: boolean;
    };
    dedupeWindowHours: number;
    enableBuiltInDetection: boolean;
    historicalBackfillStartedAt?: string | null;
    historicalBackfillCompletedAt?: string | null;
}

const DEFAULT_SETTINGS: ActionItemsBetaSettings = {
    autoCreateThreshold: 0.85,
    reviewThreshold: 0.65,
    sourceToggles: {
        hostify: true,
        openphone: true,
    },
    dedupeWindowHours: 72,
    enableBuiltInDetection: true,
    historicalBackfillStartedAt: null,
    historicalBackfillCompletedAt: null,
};

const DEFAULT_CATEGORIES = [
    {
        name: "Cleanliness",
        description: "Tasks related to unit cleanliness, housekeeping quality, or restocking misses.",
        color: "#38bdf8",
        icon: "sparkles",
        notificationTargets: ["Cleaners"],
    },
    {
        name: "Guest Requests",
        description: "Guest asks for accommodations, approvals, amenities, or operational help.",
        color: "#a855f7",
        icon: "users",
        notificationTargets: ["Ops"],
    },
    {
        name: "Maintenance",
        description: "Broken, damaged, unsafe, or malfunctioning items and amenities.",
        color: "#f59e0b",
        icon: "wrench",
        notificationTargets: ["Maintenance"],
    },
    {
        name: "Reservation Changes",
        description: "Stay extensions, date changes, payment issues, and booking modifications.",
        color: "#3b82f6",
        icon: "calendar",
        notificationTargets: ["Reservations"],
    },
    {
        name: "Other",
        description: "Fallback category for actionable matters that do not fit another category clearly.",
        color: "#6b7280",
        icon: "ellipsis",
        notificationTargets: ["Ops"],
    },
    {
        name: "Communication Quality",
        description: "Coaching opportunities where a team response may be incomplete, robotic, unclear, missing empathy, or lacking ownership.",
        color: "#ec4899",
        icon: "message",
        notificationTargets: ["Guest Relations"],
    },
];

const DEFAULT_RULES = [
    {
        name: "Early check-in requests",
        description: "Detect guest requests to arrive before standard check-in.",
        categoryName: "Guest Requests",
        priority: "Medium",
        sensitivity: "medium",
        triggerPhrases: ["early check in", "check in earlier", "arrive early", "can we check in at", "early arrival"],
        excludePhrases: ["already approved", "we approved your early check in"],
        examples: ["Can we check in a little earlier tomorrow?", "We will arrive around 1pm, is early check-in possible?"],
        negativeExamples: ["Thanks for approving the early check-in"],
        instructions: "Trigger when the guest is asking for an earlier arrival or early access, unless the conversation clearly shows the request has already been resolved.",
    },
    {
        name: "Late check-out requests",
        description: "Detect guests asking to depart after standard check-out.",
        categoryName: "Guest Requests",
        priority: "Medium",
        sensitivity: "medium",
        triggerPhrases: ["late check out", "check out late", "extend checkout", "leave later"],
        excludePhrases: ["already approved", "thanks for the late checkout"],
        examples: ["Can we check out at noon instead?", "Is late checkout available on Sunday?"],
        negativeExamples: ["Perfect, the late checkout works."],
        instructions: "Trigger when the guest is asking to leave later than planned and still needs staff attention or approval.",
    },
    {
        name: "Maintenance & safety",
        description: "Detect broken amenities, repair requests, lockouts, and safety issues.",
        categoryName: "Maintenance",
        priority: "High",
        sensitivity: "high",
        triggerPhrases: ["broken", "not working", "doesn't work", "lock out", "locked out", "can't get in", "ac is", "heater is", "water leak", "smoke alarm", "power out"],
        excludePhrases: ["fixed now", "working now", "resolved"],
        examples: ["The AC is still broken", "We are locked out", "The door code isn't working"],
        negativeExamples: ["Everything is working now, thank you"],
        instructions: "Trigger when the guest reports a malfunction, access issue, lockout, utility failure, or safety concern that still needs intervention.",
    },
    {
        name: "Cleaning complaints",
        description: "Detect cleanliness concerns or housekeeping misses.",
        categoryName: "Cleanliness",
        priority: "High",
        sensitivity: "high",
        triggerPhrases: ["dirty", "unclean", "not cleaned", "hair on", "stains", "trash", "smells bad", "smells like", "housekeeping"],
        excludePhrases: ["clean now", "resolved", "thanks for sending someone"],
        examples: ["The bathroom is dirty", "There is hair on the sheets", "The place wasn't cleaned properly"],
        negativeExamples: ["Thanks, housekeeping fixed it"],
        instructions: "Trigger when the guest is reporting a cleanliness problem that requires follow-up or remediation.",
    },
    {
        name: "Reservation changes",
        description: "Detect extensions, date changes, and booking modifications.",
        categoryName: "Reservation Changes",
        priority: "Medium",
        sensitivity: "medium",
        triggerPhrases: ["extend our stay", "stay another night", "change our dates", "move our reservation", "modify reservation", "booking extension"],
        excludePhrases: ["already extended", "extension confirmed"],
        examples: ["Can we stay one more night?", "We need to change our departure date"],
        negativeExamples: ["Thank you for extending our stay"],
        instructions: "Trigger when the guest asks to modify reservation timing or booking terms.",
    },
    {
        name: "Emergencies and approvals",
        description: "Detect urgent issues, parties, security concerns, or questions needing owner approval.",
        categoryName: "Other",
        priority: "Critical",
        sensitivity: "high",
        triggerPhrases: ["emergency", "party", "security", "noise complaint", "police", "urgent", "need approval", "can you approve"],
        excludePhrases: ["false alarm", "resolved now"],
        examples: ["There is a loud party next door", "We need approval for an exception", "This is urgent"],
        negativeExamples: ["No need anymore, we figured it out"],
        instructions: "Trigger when the message indicates urgency, security risk, party/noise escalation, or a question that explicitly needs approval from ops/host.",
    },
    {
        name: "Communication quality coaching",
        description: "Detect responses that may need coaching or correction even if the guest received a reply.",
        categoryName: "Communication Quality",
        priority: "Medium",
        sensitivity: "medium",
        triggerPhrases: ["sorry", "apologize", "frustrated", "upset", "confused", "not answered", "no one responded", "still waiting"],
        excludePhrases: ["all set", "resolved", "thank you", "perfect"],
        examples: ["The reply did not answer the guest's actual concern.", "The guest sounded frustrated and the response did not acknowledge it."],
        negativeExamples: ["The team clearly acknowledged the issue, gave ownership, and provided a next step."],
        instructions: "Trigger when the conversation suggests weak communication quality: missing empathy, no clear next step, incomplete answer, robotic tone, possible misinformation, repeated unnecessary information, or missing ownership/follow-through.",
    },
];

export class ActionItemsBetaService {
    private readonly categoryRepo = appDatabase.getRepository(ActionItemBetaCategoryEntity);
    private readonly ruleRepo = appDatabase.getRepository(ActionItemBetaRuleEntity);
    private readonly itemRepo = appDatabase.getRepository(ActionItemBetaItemEntity);
    private readonly settingRepo = appDatabase.getRepository(ActionItemBetaSettingEntity);
    private readonly communicationRepo = appDatabase.getRepository(GuestCommunicationEntity);
    private readonly reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private readonly messagingService = new MessagingService();
    private readonly openPhoneService = new OpenPhoneService();
    private readonly hostifyClient = new Hostify();
    private readonly openai: OpenAI | null;
    private defaultsEnsured = false;

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        this.openai = apiKey ? new OpenAI({ apiKey }) : null;
    }

    async ensureDefaults(userId?: string): Promise<void> {
        if (this.defaultsEnsured) return;
        const existingCategories = await this.categoryRepo.find();
        const existingCategoryNames = new Set(existingCategories.map((category) => category.name));
        const missingCategories = DEFAULT_CATEGORIES
            .filter((category) => !existingCategoryNames.has(category.name))
            .map((category, index) => this.categoryRepo.create({
                ...category,
                isDefault: true,
                isActive: true,
                sortOrder: existingCategories.length + index,
                createdBy: userId || "system",
                updatedBy: userId || "system",
            }));
        if (missingCategories.length > 0) {
            await this.categoryRepo.save(missingCategories);
        }

        const existingRules = await this.ruleRepo.find();
        const existingRuleNames = new Set(existingRules.map((rule) => rule.name));
        const categories = await this.categoryRepo.find();
        const categoryMap = new Map(categories.map((category) => [category.name, category]));
        const missingRules = DEFAULT_RULES
            .filter((rule) => !existingRuleNames.has(rule.name))
            .map((rule) => this.ruleRepo.create({
                ...rule,
                categoryId: categoryMap.get(rule.categoryName)?.id || null,
                autoCreateThreshold: DEFAULT_SETTINGS.autoCreateThreshold,
                reviewThreshold: DEFAULT_SETTINGS.reviewThreshold,
                enabled: true,
                builtIn: true,
                createdBy: userId || "system",
                updatedBy: userId || "system",
            }));
        if (missingRules.length > 0) {
            await this.ruleRepo.save(missingRules);
        }

        const settings = await this.settingRepo.findOne({ where: { settingKey: "global" } });
        if (!settings) {
            await this.settingRepo.save(this.settingRepo.create({
                settingKey: "global",
                value: DEFAULT_SETTINGS,
                updatedBy: userId || "system",
            }));
        }
        this.defaultsEnsured = true;
    }

    async getOverview(filters: ActionItemsBetaFilters = {}) {
        await this.ensureDefaults();
        if (this.shouldAutoGenerate(filters)) {
            const settings = await this.getSettings();
            const existingCount = await this.itemRepo.count();
            if (!settings.historicalBackfillCompletedAt) {
                // Run in background — do not block the overview response
                this.backfillHistoricalItems({
                    fromDate: "2026-01-01",
                    triggeredBy: "system",
                }).catch((err) => logger.error("[ActionItemsBetaService] Background backfill failed:", err));
            } else if (existingCount === 0) {
                // Run in background — do not block the overview response
                this.analyzeRecentReservations({ triggeredBy: "system" })
                    .catch((err) => logger.error("[ActionItemsBetaService] Background analysis failed:", err));
            }
        }
        const categories = await this.getCategories();
        const rules = await this.getRules();
        const settings = await this.getSettings();
        const items = await this.getItems(filters);
        const pendingReview = items.filter((item) => item.status === "Pending Review");
        const activeItems = items.filter((item) => item.status !== "Pending Review" && item.status !== "Dismissed");

        const summary = {
            total: items.length,
            newCount: items.filter((item) => item.status === "New").length,
            inProgressCount: items.filter((item) => item.status === "In Progress").length,
            resolvedCount: items.filter((item) => item.status === "Resolved" || item.status === "Completed").length,
            reviewCount: pendingReview.length,
            criticalCount: items.filter((item) => item.priority === "Critical").length,
            byCategory: categories.map((category) => ({
                id: category.id,
                name: category.name,
                count: items.filter((item) => item.categoryId === category.id || item.categoryName === category.name).length,
                color: category.color,
                icon: category.icon,
            })),
        };

        return {
            summary,
            items: activeItems,
            reviewQueue: pendingReview,
            categories,
            rules,
            settings,
        };
    }

    async getItems(filters: ActionItemsBetaFilters = {}) {
        await this.ensureDefaults();
        const rawItems = await this.itemRepo.find({ order: { updatedAt: "DESC" } });
        const normalized = rawItems.filter((item) => this.matchesFilters(item, filters));
        const messageIds = Array.from(new Set(normalized.flatMap((item) => item.messageIds || [])));
        const linkedMessages = messageIds.length
            ? await this.communicationRepo.find({ where: { id: In(messageIds) } })
            : [];
        const messageMap = new Map(linkedMessages.map((message) => [message.id, message]));

        return normalized.map((item) => ({
            ...this.serializeItem(item),
            linkedMessages: (item.messageIds || []).map((id) => messageMap.get(id)).filter(Boolean),
        }));
    }

    async getItemById(id: string) {
        const item = await this.itemRepo.findOne({ where: { id } });
        if (!item) return null;
        const linkedMessages = item.messageIds?.length
            ? await this.communicationRepo.find({ where: { id: In(item.messageIds) }, order: { communicatedAt: "ASC" } })
            : [];
        return { ...this.serializeItem(item), linkedMessages };
    }

    async updateItem(id: string, data: Partial<ActionItemBetaItemEntity>, userId?: string) {
        const item = await this.itemRepo.findOne({ where: { id } });
        if (!item) {
            throw new Error("Action item not found");
        }
        const nextData = { ...data } as Record<string, any>;
        if (nextData.proposedResolution !== undefined) {
            item.sourceMeta = {
                ...(item.sourceMeta || {}),
                proposedResolution: nextData.proposedResolution,
            };
            delete nextData.proposedResolution;
        }
        Object.assign(item, {
            ...nextData,
            updatedBy: userId || item.updatedBy || "system",
        });
        if ((data.status === "Resolved" || data.status === "Completed") && !item.resolvedAt) {
            item.resolvedAt = new Date();
        }
        return this.itemRepo.save(item);
    }

    async approveItem(id: string, updates: Partial<ActionItemBetaItemEntity> = {}, userId?: string) {
        const item = await this.itemRepo.findOne({ where: { id } });
        if (!item) {
            throw new Error("Action item not found");
        }

        item.status = updates.status || "New";
        item.decisionType = "approved";
        item.approvedAt = new Date();
        item.updatedBy = userId || "system";
        if (updates.categoryId || updates.categoryName) {
            item.categoryId = updates.categoryId ?? item.categoryId;
            item.categoryName = updates.categoryName ?? item.categoryName;
        }
        if (updates.priority) item.priority = updates.priority;
        if (updates.title) item.title = updates.title;
        if (updates.description) item.description = updates.description;
        if ((updates as any).proposedResolution !== undefined) {
            item.sourceMeta = {
                ...(item.sourceMeta || {}),
                proposedResolution: (updates as any).proposedResolution,
            };
        }
        if (updates.assignedTo !== undefined) item.assignedTo = updates.assignedTo;
        if ((item.status === "Resolved" || item.status === "Completed") && !item.resolvedAt) {
            item.resolvedAt = new Date();
        }

        return this.itemRepo.save(item);
    }

    async rejectItem(id: string, reason: string | null, userId?: string) {
        const item = await this.itemRepo.findOne({ where: { id } });
        if (!item) {
            throw new Error("Action item not found");
        }

        item.status = "Dismissed";
        item.decisionType = "rejected";
        item.rejectedAt = new Date();
        item.updatedBy = userId || "system";
        if (reason) {
            item.flagReason = item.flagReason ? `${item.flagReason}\n\nRejected note: ${reason}` : `Rejected note: ${reason}`;
        }

        return this.itemRepo.save(item);
    }

    async getCategories() {
        await this.ensureDefaults();
        return this.categoryRepo.find({ order: { sortOrder: "ASC", name: "ASC" } });
    }

    async createCategory(data: Partial<ActionItemBetaCategoryEntity>, userId?: string) {
        const category = this.categoryRepo.create({
            name: data.name?.trim() || "",
            description: data.description?.trim() || null,
            color: data.color || "#6b7280",
            icon: data.icon || "tag",
            iconImage: data.iconImage || null,
            notificationTargets: data.notificationTargets || [],
            isDefault: false,
            isActive: data.isActive ?? true,
            sortOrder: data.sortOrder ?? 99,
            createdBy: userId || "system",
            updatedBy: userId || "system",
        });
        return this.categoryRepo.save(category);
    }

    async updateCategory(id: string, data: Partial<ActionItemBetaCategoryEntity>, userId?: string) {
        const category = await this.categoryRepo.findOne({ where: { id } });
        if (!category) throw new Error("Category not found");
        Object.assign(category, data, { updatedBy: userId || "system" });
        return this.categoryRepo.save(category);
    }

    async deleteCategory(id: string, replacementCategoryId?: string, userId?: string) {
        const category = await this.categoryRepo.findOne({ where: { id } });
        if (!category) throw new Error("Category not found");
        if (category.name === "Other") {
            throw new Error("The Other category cannot be deleted");
        }

        const linkedItems = await this.itemRepo.find({ where: { categoryId: id, status: Not("Dismissed") } });
        const linkedRules = await this.ruleRepo.find({ where: { categoryId: id } });

        if ((linkedItems.length > 0 || linkedRules.length > 0) && !replacementCategoryId) {
            const error: any = new Error("Category is in use");
            error.details = { linkedItems: linkedItems.length, linkedRules: linkedRules.length };
            throw error;
        }

        if (replacementCategoryId) {
            const replacement = await this.categoryRepo.findOne({ where: { id: replacementCategoryId } });
            if (!replacement) throw new Error("Replacement category not found");
            for (const item of linkedItems) {
                item.categoryId = replacement.id;
                item.categoryName = replacement.name;
                item.notificationTargets = replacement.notificationTargets || [];
                item.updatedBy = userId || "system";
            }
            if (linkedItems.length > 0) await this.itemRepo.save(linkedItems);

            for (const rule of linkedRules) {
                rule.categoryId = replacement.id;
                rule.categoryName = replacement.name;
                rule.updatedBy = userId || "system";
            }
            if (linkedRules.length > 0) await this.ruleRepo.save(linkedRules);
        }

        await this.categoryRepo.remove(category);
        return { success: true };
    }

    async getRules() {
        await this.ensureDefaults();
        return this.ruleRepo.find({ order: { builtIn: "DESC", name: "ASC" } });
    }

    async createRule(data: Partial<ActionItemBetaRuleEntity>, userId?: string) {
        const category = data.categoryId ? await this.categoryRepo.findOne({ where: { id: data.categoryId } }) : null;
        const rule = this.ruleRepo.create({
            name: data.name?.trim() || "",
            description: data.description?.trim() || null,
            categoryId: category?.id || null,
            categoryName: category?.name || data.categoryName || "Other",
            priority: data.priority || "Medium",
            sensitivity: data.sensitivity || "medium",
            autoCreateThreshold: data.autoCreateThreshold ?? DEFAULT_SETTINGS.autoCreateThreshold,
            reviewThreshold: data.reviewThreshold ?? DEFAULT_SETTINGS.reviewThreshold,
            enabled: data.enabled ?? true,
            builtIn: false,
            triggerPhrases: data.triggerPhrases || [],
            excludePhrases: data.excludePhrases || [],
            examples: data.examples || [],
            negativeExamples: data.negativeExamples || [],
            instructions: data.instructions || null,
            createdBy: userId || "system",
            updatedBy: userId || "system",
        });
        return this.ruleRepo.save(rule);
    }

    async updateRule(id: string, data: Partial<ActionItemBetaRuleEntity>, userId?: string) {
        const rule = await this.ruleRepo.findOne({ where: { id } });
        if (!rule) throw new Error("Rule not found");
        if (data.categoryId) {
            const category = await this.categoryRepo.findOne({ where: { id: data.categoryId } });
            if (category) {
                rule.categoryId = category.id;
                rule.categoryName = category.name;
            }
        }
        Object.assign(rule, {
            ...data,
            updatedBy: userId || "system",
        });
        return this.ruleRepo.save(rule);
    }

    async deleteRule(id: string) {
        const rule = await this.ruleRepo.findOne({ where: { id } });
        if (!rule) throw new Error("Rule not found");
        await this.ruleRepo.remove(rule);
        return { success: true };
    }

    async getSettings(): Promise<ActionItemsBetaSettings> {
        await this.ensureDefaults();
        const row = await this.settingRepo.findOne({ where: { settingKey: "global" } });
        return {
            ...DEFAULT_SETTINGS,
            ...(row?.value || {}),
        };
    }

    async updateSettings(value: Partial<ActionItemsBetaSettings>, userId?: string) {
        await this.ensureDefaults(userId);
        let row = await this.settingRepo.findOne({ where: { settingKey: "global" } });
        if (!row) {
            row = this.settingRepo.create({
                settingKey: "global",
                value: DEFAULT_SETTINGS,
                updatedBy: userId || "system",
            });
        }
        row.value = {
            ...DEFAULT_SETTINGS,
            ...(row.value || {}),
            ...value,
            sourceToggles: {
                ...DEFAULT_SETTINGS.sourceToggles,
                ...(row.value?.sourceToggles || {}),
                ...(value.sourceToggles || {}),
            },
        };
        row.updatedBy = userId || "system";
        return this.settingRepo.save(row);
    }

    async testDetection(payload: {
        message: string;
        guestName?: string;
        propertyName?: string;
        source?: string;
    }) {
        await this.ensureDefaults();
        const categories = await this.getCategories();
        const rules = await this.getRules();
        const settings = await this.getSettings();
        const syntheticCommunication: GuestCommunicationEntity = {
            id: "test-message",
            reservationId: 0,
            source: payload.source || "manual_test",
            externalId: "manual_test",
            content: payload.message,
            direction: "inbound",
            senderName: payload.guestName || "Guest",
            senderPhone: "",
            communicatedAt: new Date(),
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const detections = await this.generateDetections({
            reservation: null,
            communications: [syntheticCommunication],
            categories,
            rules,
            settings,
            timeline: payload.message,
            customContext: {
                guestName: payload.guestName || null,
                propertyName: payload.propertyName || null,
            },
        });

        return detections.map((candidate) => ({
            ...candidate,
            decision: candidate.confidence >= settings.autoCreateThreshold
                ? "auto_create"
                : candidate.confidence >= settings.reviewThreshold
                    ? "review_queue"
                    : "ignore",
        }));
    }

    async analyzeReservation(reservationId: number, options: { triggeredBy?: string } = {}) {
        await this.ensureDefaults(options.triggeredBy);

        return this.analyzeStoredReservation(reservationId, options.triggeredBy || "manual");
    }

    async backfillHistoricalItems(options: { fromDate: string; triggeredBy?: string }) {
        await this.ensureDefaults(options.triggeredBy);
        const settings = await this.getSettings();
        if (settings.historicalBackfillCompletedAt) {
            return {
                scannedReservations: 0,
                createdOrUpdated: 0,
                completedAt: settings.historicalBackfillCompletedAt,
                skipped: true,
            };
        }

        await this.updateSettings({
            historicalBackfillStartedAt: new Date().toISOString(),
            historicalBackfillCompletedAt: null,
        }, options.triggeredBy);

        const since = new Date(options.fromDate);
        if (Number.isNaN(since.getTime())) {
            throw new Error("Invalid fromDate for historical backfill");
        }

        const historicalReservations = await this.communicationRepo
            .createQueryBuilder("communication")
            .select("communication.reservationId", "reservationId")
            .addSelect("MAX(communication.communicatedAt)", "lastCommunicatedAt")
            .where("communication.reservationId IS NOT NULL")
            .andWhere("communication.communicatedAt >= :since", { since })
            .groupBy("communication.reservationId")
            .orderBy("lastCommunicatedAt", "DESC")
            .getRawMany<{ reservationId: string }>();

        let createdOrUpdated = 0;
        for (const entry of historicalReservations) {
            const reservationId = Number(entry.reservationId);
            if (!reservationId) continue;
            try {
                const result = await this.analyzeStoredReservation(reservationId, options.triggeredBy || "system", { since });
                createdOrUpdated += result.createdOrUpdated;
            } catch (error: any) {
                logger.warn(`[ActionItemsBetaService] Failed historical backfill for reservation ${reservationId}: ${error.message}`);
            }
        }

        const completedAt = new Date().toISOString();
        await this.updateSettings({
            historicalBackfillCompletedAt: completedAt,
        }, options.triggeredBy);

        return {
            scannedReservations: historicalReservations.length,
            createdOrUpdated,
            completedAt,
            skipped: false,
        };
    }

    async replyToItem(id: string, content: string, userId?: string) {
        const trimmedContent = String(content || "").trim();
        if (!trimmedContent) {
            throw new Error("Message content is required");
        }

        const item = await this.itemRepo.findOne({ where: { id } });
        if (!item) {
            throw new Error("Action item not found");
        }
        if (!item.reservationId) {
            throw new Error("Action item is not linked to a reservation");
        }

        const linkedMessages = item.messageIds?.length
            ? await this.communicationRepo.find({ where: { id: In(item.messageIds) }, order: { communicatedAt: "ASC" } })
            : [];
        const primarySource = this.resolveReplySource(item.source, linkedMessages);

        if (primarySource === "Hostify") {
            const inboxId = this.resolveHostifyInboxId(linkedMessages);
            let threadId = inboxId;
            if (!threadId) {
                const reservationInfo = await this.hostifyClient.getReservationInfo(process.env.HOSTIFY_API_KEY || "", item.reservationId);
                threadId = reservationInfo?.reservation?.message_id ? String(reservationInfo.reservation.message_id) : null;
            }
            if (!threadId) {
                throw new Error("Unable to resolve the Hostify thread for this action item");
            }
            await this.messagingService.postHostifyReply(threadId, trimmedContent);
        } else {
            const reservation = await this.reservationRepo.findOne({ where: { id: item.reservationId } });
            const guestPhone = this.openPhoneService.formatPhoneNumber(undefined, reservation?.phone || undefined);
            if (!guestPhone) {
                throw new Error("Unable to resolve the guest phone number for this action item");
            }
            const openPhoneResult = await this.openPhoneService.findMessagesByParticipant(guestPhone, 100);
            const latestMessage = ((openPhoneResult.data || []) as Array<Record<string, any>>)
                .filter((entry) => entry?.phoneNumberId)
                .sort((a, b) => new Date(String(b.createdAt || "")).getTime() - new Date(String(a.createdAt || "")).getTime())[0];
            if (!latestMessage?.phoneNumberId) {
                throw new Error("Unable to resolve the OpenPhone conversation for this action item");
            }
            await this.openPhoneService.sendConversationReply(latestMessage.phoneNumberId, [guestPhone], trimmedContent);
        }

        return this.getItemById(id);
    }

    private async analyzeRecentReservations(options: { triggeredBy?: string; days?: number; limit?: number } = {}) {
        const days = options.days ?? 14;
        const limit = options.limit ?? 25;
        const since = new Date();
        since.setDate(since.getDate() - days);

        const recentReservations = await this.communicationRepo
            .createQueryBuilder("communication")
            .select("communication.reservationId", "reservationId")
            .addSelect("MAX(communication.communicatedAt)", "lastCommunicatedAt")
            .where("communication.reservationId IS NOT NULL")
            .andWhere("communication.communicatedAt >= :since", { since })
            .groupBy("communication.reservationId")
            .orderBy("lastCommunicatedAt", "DESC")
            .limit(limit)
            .getRawMany<{ reservationId: string }>();

        for (const entry of recentReservations) {
            const reservationId = Number(entry.reservationId);
            if (!reservationId) continue;
            try {
                await this.analyzeStoredReservation(reservationId, options.triggeredBy || "system");
            } catch (error: any) {
                logger.warn(`[ActionItemsBetaService] Failed auto-analyzing reservation ${reservationId}: ${error.message}`);
            }
        }
    }

    private async analyzeStoredReservation(reservationId: number, triggeredBy: string, options: { since?: Date } = {}) {
        await this.ensureDefaults(triggeredBy);
        const settings = await this.getSettings();

        const reservation = await this.reservationRepo.findOne({ where: { id: reservationId } });
        const allCommunications = await this.communicationRepo.find({
            where: { reservationId },
            order: { communicatedAt: "ASC" },
        });
        const enabledCommunications = allCommunications.filter((message) => this.isSourceEnabled(message.source, settings));
        const communications = options.since
            ? enabledCommunications.filter((message) => new Date(message.communicatedAt).getTime() >= options.since!.getTime())
            : enabledCommunications;
        const timeline = communications
            .map((message) => `[${new Date(message.communicatedAt).toISOString()}] ${message.direction.toUpperCase()} ${message.senderName || "Unknown"} (${message.source}): ${message.content || ""}`)
            .join("\n");
        const categories = await this.getCategories();
        const rules = await this.getRules();

        const detections = await this.generateDetections({
            reservation,
            communications,
            categories,
            rules,
            settings,
            timeline,
        });

        const savedItems = await this.persistDetections({
            reservation,
            detections,
            categories,
            settings,
            triggeredBy,
        });

        return {
            reservationId,
            detected: detections.length,
            createdOrUpdated: savedItems.length,
            items: savedItems,
        };
    }

    private async persistDetections(input: {
        reservation: ReservationInfoEntity | null;
        detections: DetectionCandidate[];
        categories: ActionItemBetaCategoryEntity[];
        settings: ActionItemsBetaSettings;
        triggeredBy: string;
    }) {
        const {
            reservation,
            detections,
            categories,
            settings,
            triggeredBy,
        } = input;
        const now = new Date();
        const savedItems: ActionItemBetaItemEntity[] = [];

        for (const detection of detections) {
            if (detection.confidence < settings.reviewThreshold) {
                continue;
            }

            const category = categories.find((entry) => entry.name === detection.categoryName) || categories.find((entry) => entry.name === "Other") || null;
            const dedupeKey = this.buildDedupeKey(reservation?.id || null, detection.categoryName, detection.title);
            const existing = await this.itemRepo.findOne({
                where: {
                    dedupeKey,
                    status: In(["New", "In Progress", "Pending Review", "Resolved", "Completed"]),
                },
                order: { updatedAt: "DESC" },
            });

            const nextStatus = detection.suggestedStatus
                || (detection.confidence >= settings.autoCreateThreshold ? "New" : "Pending Review");
            const nextDecision = detection.confidence >= settings.autoCreateThreshold ? "auto_created" : "review";

            if (existing) {
                const existingMessageIds = existing.messageIds || [];
                const nextMessageIds = Array.from(new Set([...existingMessageIds, ...detection.messageIds]));

                existing.description = detection.description;
                existing.confidence = Math.max(existing.confidence || 0, detection.confidence);
                existing.flagReason = detection.reason;
                existing.messageIds = nextMessageIds;
                existing.conversationSnippet = detection.snippet || existing.conversationSnippet;
                existing.priority = detection.priority;
                existing.status = existing.status === "In Progress" ? existing.status : nextStatus;
                existing.decisionType = existing.status === "In Progress" ? existing.decisionType : nextDecision;
                existing.lastDetectedAt = now;
                existing.updatedBy = triggeredBy;
                existing.notificationTargets = category?.notificationTargets || [];
                existing.sourceMeta = {
                    ...(existing.sourceMeta || {}),
                    generatedBy: "action-items-beta",
                    generatedAt: now.toISOString(),
                    proposedResolution: detection.proposedResolution || existing.sourceMeta?.proposedResolution || null,
                    highlightTerms: Array.from(new Set([...(existing.sourceMeta?.highlightTerms || []), ...(detection.highlightTerms || [])])),
                };
                if ((existing.status === "Completed" || existing.status === "Resolved") && !existing.resolvedAt) {
                    existing.resolvedAt = detection.resolvedAt || now;
                }
                const saved = await this.itemRepo.save(existing);
                savedItems.push(saved);
                continue;
            }

            const created = this.itemRepo.create({
                reservationId: reservation?.id || null,
                listingId: reservation?.listingMapId || null,
                guestName: reservation?.guestName || null,
                propertyName: reservation?.listingName || null,
                confirmationCode: reservation?.confirmation_code || null,
                source: detection.source,
                title: detection.title,
                description: detection.description,
                categoryId: category?.id || null,
                categoryName: category?.name || detection.categoryName || "Other",
                priority: detection.priority,
                status: nextStatus,
                assignedTo: null,
                confidence: detection.confidence,
                decisionType: nextDecision,
                flagReason: detection.reason,
                dedupeKey,
                conversationSnippet: detection.snippet || null,
                messageIds: detection.messageIds,
                sourceMeta: {
                    generatedBy: "action-items-beta",
                    generatedAt: now.toISOString(),
                    proposedResolution: detection.proposedResolution || null,
                    highlightTerms: detection.highlightTerms || [],
                },
                notificationTargets: category?.notificationTargets || [],
                lastDetectedAt: now,
                resolvedAt: nextStatus === "Completed" || nextStatus === "Resolved" ? (detection.resolvedAt || now) : null,
                createdBy: triggeredBy,
                updatedBy: triggeredBy,
            });
            const saved = await this.itemRepo.save(created);
            savedItems.push(saved);
        }

        return savedItems;
    }

    private async generateDetections(input: {
        reservation: ReservationInfoEntity | null;
        communications: GuestCommunicationEntity[];
        categories: ActionItemBetaCategoryEntity[];
        rules: ActionItemBetaRuleEntity[];
        settings: ActionItemsBetaSettings;
        timeline: string;
        customContext?: {
            guestName?: string | null;
            propertyName?: string | null;
        };
    }): Promise<DetectionCandidate[]> {
        const heuristicCandidates = this.runHeuristicDetection(input.communications, input.rules, input.categories);
        const aiCandidates = await this.runAIDetection(input);
        return this.mergeDetections([...heuristicCandidates, ...aiCandidates]).map((candidate) => ({
            ...candidate,
            ...this.inferDetectionOutcome(candidate, input.communications, input.reservation),
        }));
    }

    private runHeuristicDetection(
        communications: GuestCommunicationEntity[],
        rules: ActionItemBetaRuleEntity[],
        categories: ActionItemBetaCategoryEntity[],
    ): DetectionCandidate[] {
        const inboundMessages = communications.filter((message) => message.direction === "inbound");
        const text = inboundMessages.map((message) => message.content || "").join("\n\n").toLowerCase();
        if (!text.trim()) {
            return [];
        }

        return rules
            .filter((rule) => rule.enabled)
            .map((rule) => {
                const triggers = (rule.triggerPhrases || []).filter(Boolean);
                const excludes = (rule.excludePhrases || []).filter(Boolean);
                const matchedTriggers = triggers.filter((phrase) => text.includes(phrase.toLowerCase()));
                const matchedExcludes = excludes.filter((phrase) => text.includes(phrase.toLowerCase()));

                if (matchedTriggers.length === 0 || matchedExcludes.length > 0) {
                    return null;
                }

                const matchingMessages = inboundMessages.filter((message) =>
                    matchedTriggers.some((phrase) => (message.content || "").toLowerCase().includes(phrase.toLowerCase()))
                );
                const category = categories.find((entry) => entry.id === rule.categoryId) || categories.find((entry) => entry.name === rule.categoryName);
                const confidence = Math.min(0.58 + matchedTriggers.length * 0.1, 0.92);
                const lastMessage = matchingMessages[matchingMessages.length - 1];
                const summaryTitle = this.buildCandidateTitle(rule.name, lastMessage?.content || "");

                return {
                    title: summaryTitle,
                    description: lastMessage?.content || rule.description || rule.name,
                    proposedResolution: this.buildProposedResolution(lastMessage?.content || rule.description || rule.name, category?.name || rule.categoryName || "Other"),
                    categoryName: category?.name || rule.categoryName || "Other",
                    priority: rule.priority || "Medium",
                    confidence,
                    reason: `Matched built-in/custom rule "${rule.name}" on phrases: ${matchedTriggers.join(", ")}`,
                    source: this.resolveCandidateSource(matchingMessages),
                    messageIds: matchingMessages.map((message) => message.id),
                    snippet: lastMessage?.content?.slice(0, 280) || "",
                    highlightTerms: matchedTriggers.slice(0, 6),
                } satisfies DetectionCandidate;
            })
            .filter(Boolean) as DetectionCandidate[];
    }

    private async runAIDetection(input: {
        reservation: ReservationInfoEntity | null;
        communications: GuestCommunicationEntity[];
        categories: ActionItemBetaCategoryEntity[];
        rules: ActionItemBetaRuleEntity[];
        settings: ActionItemsBetaSettings;
        timeline: string;
        customContext?: {
            guestName?: string | null;
            propertyName?: string | null;
        };
    }): Promise<DetectionCandidate[]> {
        if (!this.openai || input.communications.length === 0) {
            return [];
        }

        const activeRules = input.rules
            .filter((rule) => rule.enabled)
            .map((rule) => ({
                name: rule.name,
                category: rule.categoryName,
                priority: rule.priority,
                instructions: rule.instructions,
                examples: rule.examples || [],
                negativeExamples: rule.negativeExamples || [],
            }));

        const categoryGuide = input.categories.map((category) => ({
            name: category.name,
            description: category.description,
        }));

        const trimmedMessages = input.communications.slice(-30).map((message) => ({
            id: message.id,
            source: message.source,
            direction: message.direction,
            senderName: message.senderName,
            communicatedAt: message.communicatedAt,
            content: (message.content || "").slice(0, 1200),
        }));

        // Admin-editable base prompt (falls back to built-in default).
        const settings = await new AIMessagingSettingsService()
            .getGlobalCached()
            .catch(() => null);
        const { betaSystemPrompt } = resolveDetectorInstructions(settings);
        const systemPrompt = [
            betaSystemPrompt,
            "Use only these categories when possible:",
            JSON.stringify(categoryGuide),
        ].join("\n");

        const userPrompt = JSON.stringify({
            reservation: input.reservation ? {
                id: input.reservation.id,
                guestName: input.reservation.guestName,
                listingName: input.reservation.listingName,
                confirmationCode: input.reservation.confirmation_code,
                status: input.reservation.status,
                arrivalDate: input.reservation.arrivalDate,
                departureDate: input.reservation.departureDate,
            } : {
                guestName: input.customContext?.guestName || null,
                listingName: input.customContext?.propertyName || null,
            },
            rules: activeRules,
            messages: trimmedMessages,
        });

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4.1",
                temperature: 0.1,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
            });

            const content = response.choices[0]?.message?.content;
            if (!content) return [];
            const parsed = JSON.parse(content) as { candidates?: Array<Record<string, any>> };
            return (parsed.candidates || [])
                .map((candidate) => this.normalizeAICandidate(candidate, input.communications))
                .filter((candidate): candidate is DetectionCandidate => Boolean(candidate));
        } catch (error: any) {
            logger.warn(`[ActionItemsBetaService] AI detection fallback: ${error.message}`);
            return [];
        }
    }

    private normalizeAICandidate(candidate: Record<string, any>, communications: GuestCommunicationEntity[]): DetectionCandidate | null {
        const title = String(candidate.title || "").trim();
        const description = String(candidate.description || "").trim();
        const categoryName = String(candidate.categoryName || "Other").trim() || "Other";
        if (!title || !description) return null;

        const candidateMessageIds = Array.isArray(candidate.messageIds)
            ? candidate.messageIds.map((value) => String(value))
            : [];
        const linkedMessages = communications.filter((message) => candidateMessageIds.includes(message.id));
        return {
            title,
            description,
            proposedResolution: String(candidate.proposedResolution || this.buildProposedResolution(description, categoryName)).trim(),
            categoryName,
            priority: String(candidate.priority || "Medium"),
            confidence: Math.max(0, Math.min(1, Number(candidate.confidence || 0))),
            reason: String(candidate.reason || "Flagged by AI review"),
            // Model-generated; clamp to the column width (varchar(40)) so a
            // verbose value can't fail the whole detection batch.
            source: String(candidate.source || this.resolveCandidateSource(linkedMessages) || "unknown").slice(0, 40),
            messageIds: linkedMessages.map((message) => message.id),
            snippet: linkedMessages[linkedMessages.length - 1]?.content?.slice(0, 280) || description.slice(0, 280),
            highlightTerms: Array.isArray(candidate.highlightTerms)
                ? candidate.highlightTerms.map((value) => String(value)).filter(Boolean).slice(0, 8)
                : this.extractHighlightTerms(title, description),
        };
    }

    private mergeDetections(candidates: DetectionCandidate[]) {
        const merged = new Map<string, DetectionCandidate>();
        for (const candidate of candidates) {
            const key = `${candidate.categoryName.toLowerCase()}::${this.slugify(candidate.title)}`;
            const existing = merged.get(key);
            if (!existing) {
                merged.set(key, candidate);
                continue;
            }
            existing.confidence = Math.max(existing.confidence, candidate.confidence);
            existing.reason = `${existing.reason}\n${candidate.reason}`.trim();
            existing.messageIds = Array.from(new Set([...existing.messageIds, ...candidate.messageIds]));
            existing.source = existing.source === candidate.source ? existing.source : "mixed";
            if (!existing.snippet && candidate.snippet) existing.snippet = candidate.snippet;
            if (candidate.description.length > existing.description.length) {
                existing.description = candidate.description;
            }
            const existingResolution = String(existing.proposedResolution || "").trim();
            const nextResolution = existingResolution.length >= candidate.proposedResolution.length
                ? existingResolution
                : candidate.proposedResolution;
            existing.proposedResolution = nextResolution;
            existing.highlightTerms = Array.from(new Set([...(existing.highlightTerms || []), ...(candidate.highlightTerms || [])]));
        }
        return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
    }

    private buildCandidateTitle(ruleName: string, messageContent: string) {
        const cleaned = messageContent.replace(/\s+/g, " ").trim();
        if (!cleaned) return ruleName;
        return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
    }

    private resolveCandidateSource(messages: GuestCommunicationEntity[]) {
        const uniqueSources = Array.from(new Set(messages.map((message) => {
            if (message.source.startsWith("hostify")) return "Hostify";
            if (message.source.startsWith("openphone")) return "OpenPhone";
            return message.source;
        })));
        if (uniqueSources.length === 0) return "unknown";
        if (uniqueSources.length === 1) return uniqueSources[0];
        return "mixed";
    }

    private resolveReplySource(itemSource: string | null | undefined, messages: GuestCommunicationEntity[]) {
        if (String(itemSource || "").toLowerCase() === "hostify") return "Hostify";
        if (String(itemSource || "").toLowerCase() === "openphone") return "OpenPhone";
        const latestMessage = [...messages].sort((a, b) => new Date(b.communicatedAt).getTime() - new Date(a.communicatedAt).getTime())[0];
        if (latestMessage?.source?.startsWith("hostify")) return "Hostify";
        return "OpenPhone";
    }

    private resolveHostifyInboxId(messages: GuestCommunicationEntity[]) {
        const latestHostifyMessage = [...messages]
            .filter((message) => message.source?.startsWith("hostify"))
            .sort((a, b) => new Date(b.communicatedAt).getTime() - new Date(a.communicatedAt).getTime())[0];
        const inboxId = latestHostifyMessage?.metadata?.inboxId;
        return inboxId ? String(inboxId) : null;
    }

    private buildProposedResolution(text: string, categoryName: string) {
        const normalized = String(text || "").toLowerCase();
        if (normalized.includes("early check")) {
            return "Check whether early access is possible, confirm any fee or approval needed, and reply with the earliest approved check-in time.";
        }
        if (normalized.includes("late check")) {
            return "Review departure-day availability, confirm any late check-out fee or approval, and send the guest the final approved departure time.";
        }
        if (normalized.includes("extend") || normalized.includes("another night") || normalized.includes("change our dates")) {
            return "Review reservation availability and pricing, then confirm the extension or date-change options back to the guest.";
        }
        if (normalized.includes("locked out") || normalized.includes("can't get in") || normalized.includes("door code")) {
            return "Verify the access method, issue updated entry instructions or code if needed, and stay on the thread until the guest confirms entry.";
        }
        if (normalized.includes("dirty") || normalized.includes("clean") || normalized.includes("housekeeping")) {
            return "Confirm the cleanliness issue, dispatch housekeeping or replacement supplies if needed, and update the guest with the remediation timeline.";
        }
        if (normalized.includes("broken") || normalized.includes("not working") || normalized.includes("leak") || normalized.includes("ac")) {
            return "Confirm the maintenance issue, route it to the repair team with urgency, and update the guest on the next service step or workaround.";
        }
        if (normalized.includes("party") || normalized.includes("noise") || normalized.includes("emergency") || normalized.includes("security")) {
            return "Escalate to the appropriate ops or emergency contact immediately, document the issue, and send the guest a clear follow-up update.";
        }

        switch (categoryName) {
            case "Cleanliness":
                return "Confirm the issue, send the right cleaning follow-up, and update the guest with the service timing.";
            case "Maintenance":
                return "Route the issue to maintenance, confirm the next step, and keep the guest updated until it is resolved.";
            case "Reservation Changes":
                return "Review the reservation details, confirm what can be changed, and reply with the approved option or next action.";
            case "Guest Requests":
                return "Review the request, confirm availability or approval needs, and send the guest a clear next-step response.";
            case "Communication Quality":
                return "Review the exchange for empathy, completeness, accuracy, ownership, and a clear next step; coach or correct the response if needed.";
            default:
                return "Review the conversation, assign the right owner, and reply with the next operational step for the guest.";
        }
    }

    private extractHighlightTerms(...values: Array<string | null | undefined>) {
        const stopWords = new Set(["about", "after", "again", "already", "because", "could", "guest", "their", "there", "these", "this", "with", "would", "please", "thanks"]);
        return values
            .flatMap((value) => String(value || "").toLowerCase().split(/[^a-z0-9]+/g))
            .filter((entry) => entry.length >= 4 && !stopWords.has(entry))
            .filter((entry, index, all) => all.indexOf(entry) === index)
            .slice(0, 8);
    }

    private inferDetectionOutcome(
        detection: DetectionCandidate,
        communications: GuestCommunicationEntity[],
        reservation: ReservationInfoEntity | null,
    ) {
        const relatedMessages = communications.filter((message) => detection.messageIds.includes(message.id));
        const lastDetectedAt = relatedMessages.length
            ? new Date(Math.max(...relatedMessages.map((message) => new Date(message.communicatedAt).getTime())))
            : null;
        const laterMessages = lastDetectedAt
            ? communications.filter((message) => new Date(message.communicatedAt).getTime() > lastDetectedAt.getTime())
            : [];
        const laterText = laterMessages.map((message) => String(message.content || "").toLowerCase()).join("\n");

        const completionPhrases = [
            "all set",
            "resolved",
            "fixed",
            "taken care",
            "completed",
            "approved",
            "confirmed",
            "sent someone",
            "on the way",
            "sorted",
            "working now",
            "issue is solved",
        ];
        const guestAcknowledgementPhrases = [
            "thank you",
            "thanks",
            "perfect",
            "works now",
            "that works",
            "got it",
            "appreciate it",
        ];

        const hasCompletionSignal = completionPhrases.some((phrase) => laterText.includes(phrase));
        const hasGuestAck = laterMessages.some((message) =>
            message.direction === "inbound"
            && guestAcknowledgementPhrases.some((phrase) => String(message.content || "").toLowerCase().includes(phrase))
        );

        const reservationEnded = reservation?.departureDate
            ? new Date(reservation.departureDate).getTime() < Date.now()
            : false;
        const categoryImpliesShortLivedIssue = ["Guest Requests", "Reservation Changes"].includes(detection.categoryName);

        if (hasCompletionSignal || (hasGuestAck && laterMessages.some((message) => message.direction === "outbound")) || (reservationEnded && categoryImpliesShortLivedIssue)) {
            return {
                suggestedStatus: "Completed",
                resolvedAt: laterMessages.length
                    ? new Date(Math.max(...laterMessages.map((message) => new Date(message.communicatedAt).getTime())))
                    : new Date(),
            };
        }

        return {
            suggestedStatus: detection.confidence >= DEFAULT_SETTINGS.autoCreateThreshold ? "New" : "Pending Review",
            resolvedAt: null,
        };
    }

    private getProposedResolution(item: Pick<ActionItemBetaItemEntity, "sourceMeta">) {
        return String(item.sourceMeta?.proposedResolution || "").trim();
    }

    private serializeItem(item: ActionItemBetaItemEntity) {
        return {
            ...item,
            proposedResolution: this.getProposedResolution(item) || null,
        };
    }

    private buildDedupeKey(reservationId: number | null, categoryName: string, title: string) {
        return `${reservationId || "none"}:${this.slugify(categoryName)}:${this.slugify(title).slice(0, 120)}`;
    }

    private slugify(value: string) {
        return String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");
    }

    private matchesFilters(item: ActionItemBetaItemEntity, filters: ActionItemsBetaFilters) {
        const includesAny = (values: string[] | undefined, target: string | null | undefined) => {
            if (!values || values.length === 0) return true;
            return values.some((value) => String(target || "").toLowerCase() === value.toLowerCase());
        };

        if (!includesAny(filters.status, item.status)) return false;
        if (!includesAny(filters.category, item.categoryName)) return false;
        if (!includesAny(filters.property, item.propertyName)) return false;
        if (!includesAny(filters.source, item.source)) return false;
        if (!includesAny(filters.assignedTo, item.assignedTo)) return false;
        if (!includesAny(filters.priority, item.priority)) return false;

        if (filters.search?.trim()) {
            const haystack = [
                item.title,
                item.description,
                this.getProposedResolution(item),
                item.guestName,
                item.propertyName,
                item.confirmationCode,
                item.flagReason,
            ].join(" ").toLowerCase();
            if (!haystack.includes(filters.search.trim().toLowerCase())) {
                return false;
            }
        }

        return true;
    }

    private shouldAutoGenerate(filters: ActionItemsBetaFilters) {
        return !filters.status?.length &&
            !filters.category?.length &&
            !filters.property?.length &&
            !filters.source?.length &&
            !filters.assignedTo?.length &&
            !filters.priority?.length &&
            !filters.search?.trim();
    }

    private isSourceEnabled(source: string | null | undefined, settings: ActionItemsBetaSettings) {
        const normalizedSource = String(source || "").toLowerCase();
        if (normalizedSource.startsWith("hostify")) {
            return settings.sourceToggles.hostify;
        }
        if (normalizedSource.startsWith("openphone")) {
            return settings.sourceToggles.openphone;
        }
        return true;
    }
}
