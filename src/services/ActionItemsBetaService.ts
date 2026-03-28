import OpenAI from "openai";
import { In, Not } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { ActionItemBetaCategoryEntity } from "../entity/ActionItemBetaCategory";
import { ActionItemBetaRuleEntity } from "../entity/ActionItemBetaRule";
import { ActionItemBetaItemEntity } from "../entity/ActionItemBetaItem";
import { ActionItemBetaSettingEntity } from "../entity/ActionItemBetaSetting";
import { GuestCommunicationEntity } from "../entity/GuestCommunication";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { GuestCommunicationService } from "./GuestCommunicationService";
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
    categoryName: string;
    priority: string;
    confidence: number;
    reason: string;
    source: string;
    messageIds: string[];
    snippet?: string;
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
];

export class ActionItemsBetaService {
    private readonly categoryRepo = appDatabase.getRepository(ActionItemBetaCategoryEntity);
    private readonly ruleRepo = appDatabase.getRepository(ActionItemBetaRuleEntity);
    private readonly itemRepo = appDatabase.getRepository(ActionItemBetaItemEntity);
    private readonly settingRepo = appDatabase.getRepository(ActionItemBetaSettingEntity);
    private readonly communicationRepo = appDatabase.getRepository(GuestCommunicationEntity);
    private readonly reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private readonly communicationService = new GuestCommunicationService();
    private readonly openai: OpenAI | null;

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        this.openai = apiKey ? new OpenAI({ apiKey }) : null;
    }

    async ensureDefaults(userId?: string): Promise<void> {
        const categoryCount = await this.categoryRepo.count();
        if (categoryCount === 0) {
            const categories = DEFAULT_CATEGORIES.map((category, index) => this.categoryRepo.create({
                ...category,
                isDefault: true,
                isActive: true,
                sortOrder: index,
                createdBy: userId || "system",
                updatedBy: userId || "system",
            }));
            await this.categoryRepo.save(categories);
        }

        const ruleCount = await this.ruleRepo.count();
        if (ruleCount === 0) {
            const categories = await this.categoryRepo.find();
            const categoryMap = new Map(categories.map((category) => [category.name, category]));
            const rules = DEFAULT_RULES.map((rule) => this.ruleRepo.create({
                ...rule,
                categoryId: categoryMap.get(rule.categoryName)?.id || null,
                autoCreateThreshold: DEFAULT_SETTINGS.autoCreateThreshold,
                reviewThreshold: DEFAULT_SETTINGS.reviewThreshold,
                enabled: true,
                builtIn: true,
                createdBy: userId || "system",
                updatedBy: userId || "system",
            }));
            await this.ruleRepo.save(rules);
        }

        const settings = await this.settingRepo.findOne({ where: { settingKey: "global" } });
        if (!settings) {
            await this.settingRepo.save(this.settingRepo.create({
                settingKey: "global",
                value: DEFAULT_SETTINGS,
                updatedBy: userId || "system",
            }));
        }
    }

    async getOverview(filters: ActionItemsBetaFilters = {}) {
        await this.ensureDefaults();
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
            resolvedCount: items.filter((item) => item.status === "Resolved").length,
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
            ...item,
            linkedMessages: (item.messageIds || []).map((id) => messageMap.get(id)).filter(Boolean),
        }));
    }

    async getItemById(id: string) {
        const item = await this.itemRepo.findOne({ where: { id } });
        if (!item) return null;
        const linkedMessages = item.messageIds?.length
            ? await this.communicationRepo.find({ where: { id: In(item.messageIds) }, order: { communicatedAt: "ASC" } })
            : [];
        return { ...item, linkedMessages };
    }

    async updateItem(id: string, data: Partial<ActionItemBetaItemEntity>, userId?: string) {
        const item = await this.itemRepo.findOne({ where: { id } });
        if (!item) {
            throw new Error("Action item not found");
        }
        Object.assign(item, {
            ...data,
            updatedBy: userId || item.updatedBy || "system",
        });
        if (data.status === "Resolved" && !item.resolvedAt) {
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
        if (updates.assignedTo !== undefined) item.assignedTo = updates.assignedTo;

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

    async analyzeReservation(reservationId: number, options: { inboxId?: string; triggeredBy?: string } = {}) {
        await this.ensureDefaults(options.triggeredBy);
        const settings = await this.getSettings();

        if (settings.sourceToggles.openphone) {
            await this.communicationService.fetchAndStoreFromOpenPhone(reservationId);
        }
        if (settings.sourceToggles.hostify) {
            await this.communicationService.fetchAndStoreFromHostify(reservationId, options.inboxId);
        }

        const reservation = await this.reservationRepo.findOne({ where: { id: reservationId } });
        const communications = await this.communicationService.getAllCommunicationsForReservation(reservationId);
        const timeline = await this.communicationService.buildCommunicationTimeline(reservationId);
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
            triggeredBy: options.triggeredBy || "manual",
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
                    status: In(["New", "In Progress", "Pending Review"]),
                },
                order: { updatedAt: "DESC" },
            });

            const nextStatus = detection.confidence >= settings.autoCreateThreshold ? "New" : "Pending Review";
            const nextDecision = detection.confidence >= settings.autoCreateThreshold ? "auto_created" : "review";

            if (existing) {
                existing.description = detection.description;
                existing.confidence = Math.max(existing.confidence || 0, detection.confidence);
                existing.flagReason = detection.reason;
                existing.messageIds = Array.from(new Set([...(existing.messageIds || []), ...detection.messageIds]));
                existing.conversationSnippet = detection.snippet || existing.conversationSnippet;
                existing.priority = detection.priority;
                existing.status = existing.status === "In Progress" ? existing.status : nextStatus;
                existing.decisionType = existing.status === "In Progress" ? existing.decisionType : nextDecision;
                existing.lastDetectedAt = now;
                existing.updatedBy = triggeredBy;
                existing.notificationTargets = category?.notificationTargets || [];
                savedItems.push(await this.itemRepo.save(existing));
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
                },
                notificationTargets: category?.notificationTargets || [],
                lastDetectedAt: now,
                createdBy: triggeredBy,
                updatedBy: triggeredBy,
            });
            savedItems.push(await this.itemRepo.save(created));
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
        return this.mergeDetections([...heuristicCandidates, ...aiCandidates]);
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
                    categoryName: category?.name || rule.categoryName || "Other",
                    priority: rule.priority || "Medium",
                    confidence,
                    reason: `Matched built-in/custom rule "${rule.name}" on phrases: ${matchedTriggers.join(", ")}`,
                    source: this.resolveCandidateSource(matchingMessages),
                    messageIds: matchingMessages.map((message) => message.id),
                    snippet: lastMessage?.content?.slice(0, 280) || "",
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

        const systemPrompt = [
            "You are evaluating guest conversations for SecureStay Action Items (Beta).",
            "Only flag issues or requests that clearly require team action.",
            "Be conservative. Prefer no result over false positives.",
            "Return compact JSON with a top-level key called candidates.",
            "Each candidate must include title, description, categoryName, priority, confidence, reason, source, and messageIds.",
            "Confidence must be a number from 0 to 1.",
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
            categoryName,
            priority: String(candidate.priority || "Medium"),
            confidence: Math.max(0, Math.min(1, Number(candidate.confidence || 0))),
            reason: String(candidate.reason || "Flagged by AI review"),
            source: String(candidate.source || this.resolveCandidateSource(linkedMessages) || "unknown"),
            messageIds: linkedMessages.map((message) => message.id),
            snippet: linkedMessages[linkedMessages.length - 1]?.content?.slice(0, 280) || description.slice(0, 280),
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
}
