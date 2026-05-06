import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { UsersEntity } from "../entity/Users";
import {
    GuestAnalysisDerivedStatus,
    GuestAnalysisMigrationMapping,
    GuestAnalysisMigrationPlan,
    GuestAnalysisSettingsAuditEntity,
    GuestAnalysisSettingsEntity,
    GuestAnalysisSettingsEntry,
    GuestAnalysisSettingsSection,
    GuestAnalysisSettingsSectionKey,
    GuestAnalysisSettingsValue,
} from "../entity/GuestAnalysisSettings";
import { GuestAnalysisEntity } from "../entity/GuestAnalysis";

const SETTINGS_KEY = "taxonomy";

const DEFAULT_SETTINGS: GuestAnalysisSettingsValue = {
    version: 1,
    sections: {
        categories: {
            key: "categories",
            title: "Categories",
            items: [
                {
                    id: "responsiveness",
                    name: "Responsiveness",
                    shortLabel: "Responsiveness",
                    description: "Speed and consistency of replies or follow-up.",
                    criteria: "Use when replies are delayed, missing, inconsistent, or the guest had to ask multiple times before getting help.",
                    sortOrder: 0,
                    isActive: true,
                },
                {
                    id: "execution-failure",
                    name: "Execution Failure",
                    shortLabel: "Execution Failure",
                    description: "Promised work was not completed.",
                    criteria: "Use when something should have been done but was not done, not completed correctly, or was missed entirely.",
                    sortOrder: 1,
                    isActive: true,
                },
                {
                    id: "property-unit-issue",
                    name: "Property / Unit Issue",
                    shortLabel: "Property / Unit Issue",
                    description: "Physical issue at the unit or property.",
                    criteria: "Use for AC, plumbing, cleanliness, broken items, pests, noise, smells, access issues, or anything materially wrong in the unit/property.",
                    sortOrder: 2,
                    isActive: true,
                },
                {
                    id: "information-problem",
                    name: "Information Problem",
                    shortLabel: "Information Problem",
                    description: "Wrong, missing, or conflicting instructions.",
                    criteria: "Use when the guest received inaccurate details, unclear directions, missing information, or conflicting answers.",
                    sortOrder: 3,
                    isActive: true,
                },
                {
                    id: "service-quality",
                    name: "Service Quality",
                    shortLabel: "Service Quality",
                    description: "Tone, empathy, or professionalism issue.",
                    criteria: "Use when the concern is about helpfulness, empathy, tone, professionalism, or the overall guest-service experience.",
                    sortOrder: 4,
                    isActive: true,
                },
                {
                    id: "process-problem",
                    name: "Process Problem",
                    shortLabel: "Process Problem",
                    description: "Internal ownership or handoff failure.",
                    criteria: "Use when there is internal confusion, no clear owner, broken SOP, or handoff/coordination failure between teams.",
                    sortOrder: 5,
                    isActive: true,
                },
                {
                    id: "escalation-risk",
                    name: "Escalation / Risk",
                    shortLabel: "Escalation / Risk",
                    description: "Refund, safety, review, or urgent escalation risk.",
                    criteria: "Use when the guest requests a manager, threatens a bad review, requests a refund, raises a safety concern, or there is another urgent escalation risk.",
                    sortOrder: 6,
                    isActive: true,
                },
            ],
        },
        departments: {
            key: "departments",
            title: "Departments",
            items: [
                {
                    id: "guest-relations",
                    name: "Guest Relations",
                    shortLabel: "Guest Relations",
                    description: "Guest-facing communication and issue ownership.",
                    criteria: "Choose when the issue should primarily be owned by the guest-facing support or coordination team.",
                    sortOrder: 0,
                    isActive: true,
                },
                {
                    id: "maintenance",
                    name: "Maintenance",
                    shortLabel: "Maintenance",
                    description: "Physical fixes and repair work.",
                    criteria: "Choose when the issue requires repair, troubleshooting, or other maintenance work at the property.",
                    sortOrder: 1,
                    isActive: true,
                },
                {
                    id: "housekeeping",
                    name: "Housekeeping",
                    shortLabel: "Housekeeping",
                    description: "Cleaning and room readiness.",
                    criteria: "Choose when the issue is tied to cleaning quality, supplies, or housekeeping execution.",
                    sortOrder: 2,
                    isActive: true,
                },
                {
                    id: "operations",
                    name: "Operations",
                    shortLabel: "Operations",
                    description: "General operational ownership.",
                    criteria: "Choose when the issue is broader operational coordination, access, systems, scheduling, or process execution.",
                    sortOrder: 3,
                    isActive: true,
                },
                {
                    id: "training-qa",
                    name: "Training / QA",
                    shortLabel: "Training / QA",
                    description: "Training, coaching, and quality control.",
                    criteria: "Choose when the issue points to knowledge gaps, coaching needs, or quality-assurance failure.",
                    sortOrder: 4,
                    isActive: true,
                },
                {
                    id: "leadership",
                    name: "Leadership",
                    shortLabel: "Leadership",
                    description: "Escalations requiring managerial review.",
                    criteria: "Choose when the matter requires leadership involvement, approval, or high-level escalation.",
                    sortOrder: 5,
                    isActive: true,
                },
                {
                    id: "vendor",
                    name: "Vendor",
                    shortLabel: "Vendor",
                    description: "Third-party service ownership.",
                    criteria: "Choose when the issue belongs to an external vendor or partner rather than an internal team.",
                    sortOrder: 6,
                    isActive: true,
                },
            ],
        },
        priorities: {
            key: "priorities",
            title: "Priority",
            items: [
                {
                    id: "low",
                    name: "Low",
                    shortLabel: "Low",
                    description: "Small inconvenience with limited guest impact.",
                    criteria: "Use for minor issues or inconveniences with low urgency and low risk of escalation.",
                    sortOrder: 0,
                    isActive: true,
                    rank: 1,
                    statusBucket: "Monitor",
                },
                {
                    id: "medium",
                    name: "Medium",
                    shortLabel: "Medium",
                    description: "Noticeable issue that should be monitored.",
                    criteria: "Use for meaningful issues that affect the stay or experience but do not yet represent a severe escalation.",
                    sortOrder: 1,
                    isActive: true,
                    rank: 2,
                    statusBucket: "Monitor",
                },
                {
                    id: "high",
                    name: "High",
                    shortLabel: "High",
                    description: "Major problem likely to create escalation.",
                    criteria: "Use for serious issues likely to create strong dissatisfaction, negative review risk, or urgent follow-up needs.",
                    sortOrder: 2,
                    isActive: true,
                    rank: 3,
                    statusBucket: "Action needed",
                },
                {
                    id: "critical",
                    name: "Critical",
                    shortLabel: "Critical",
                    description: "Severe, urgent, or safety-related issue.",
                    criteria: "Use for safety issues, no access, no AC, severe habitability problems, or urgent matters needing immediate action.",
                    sortOrder: 3,
                    isActive: true,
                    rank: 4,
                    statusBucket: "Action needed",
                },
            ],
        },
    },
};

export class GuestAnalysisSettingsService {
    private readonly settingsRepo = appDatabase.getRepository(GuestAnalysisSettingsEntity);
    private readonly auditRepo = appDatabase.getRepository(GuestAnalysisSettingsAuditEntity);
    private readonly usersRepo = appDatabase.getRepository(UsersEntity);
    private readonly analysisRepo = appDatabase.getRepository(GuestAnalysisEntity);
    private schemaEnsured = false;

    private cloneSettings(value: GuestAnalysisSettingsValue): GuestAnalysisSettingsValue {
        return JSON.parse(JSON.stringify(value)) as GuestAnalysisSettingsValue;
    }

    private normalizeSection(section: GuestAnalysisSettingsSection, key: GuestAnalysisSettingsSectionKey): GuestAnalysisSettingsSection {
        const items = [...(section.items || [])]
            .map((item, index) => ({
                id: String(item.id || "").trim(),
                name: String(item.name || "").trim(),
                shortLabel: item.shortLabel == null ? null : String(item.shortLabel).trim(),
                description: item.description == null ? null : String(item.description).trim(),
                criteria: String(item.criteria || "").trim(),
                sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
                isActive: item.isActive !== false,
                rank: key === "priorities" ? (item.rank == null ? index + 1 : Number(item.rank)) : null,
                statusBucket: key === "priorities" ? ((item.statusBucket || "Monitor") as GuestAnalysisDerivedStatus) : null,
            }))
            .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
            .map((item, index) => ({ ...item, sortOrder: index }));

        return {
            key,
            title: String(section.title || this.cloneSettings(DEFAULT_SETTINGS).sections[key].title).trim(),
            items,
        };
    }

    private normalizeSettings(value?: Partial<GuestAnalysisSettingsValue> | null): GuestAnalysisSettingsValue {
        const sections = value?.sections || DEFAULT_SETTINGS.sections;
        return {
            version: Number(value?.version || DEFAULT_SETTINGS.version || 1),
            sections: {
                categories: this.normalizeSection(
                    sections.categories || DEFAULT_SETTINGS.sections.categories,
                    "categories",
                ),
                departments: this.normalizeSection(
                    sections.departments || DEFAULT_SETTINGS.sections.departments,
                    "departments",
                ),
                priorities: this.normalizeSection(
                    sections.priorities || DEFAULT_SETTINGS.sections.priorities,
                    "priorities",
                ),
            },
        };
    }

    private async ensureSchema() {
        if (this.schemaEnsured) return;

        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS guest_analysis_settings (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                settingKey VARCHAR(120) NOT NULL UNIQUE,
                value JSON NOT NULL,
                updatedBy VARCHAR(120) NULL,
                createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS guest_analysis_settings_audit (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                settingKey VARCHAR(120) NOT NULL,
                previousValue JSON NOT NULL,
                nextValue JSON NOT NULL,
                migrationPlan JSON NULL,
                updatedBy VARCHAR(120) NULL,
                createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        this.schemaEnsured = true;
    }

    private async ensureSecureStayAdmin(userId: string) {
        const user = await this.usersRepo.findOne({ where: { uid: userId, deletedAt: null as any } });
        if (!user || (user.userType !== "admin" && user.userType !== "super admin" && !user.isSuperAdmin)) {
            throw new Error("Only SecureStay admin users can update AI analysis settings.");
        }
        return user;
    }

    private getItemMap(section: GuestAnalysisSettingsSection) {
        return new Map(section.items.map((item) => [item.id, item]));
    }

    private validateSection(section: GuestAnalysisSettingsSection, key: GuestAnalysisSettingsSectionKey) {
        if (!section.title.trim()) {
            throw new Error(`${key} section title is required.`);
        }
        if (!section.items.length) {
            throw new Error(`${key} must include at least one item.`);
        }

        const seenIds = new Set<string>();
        const seenNames = new Set<string>();
        const activeItems = section.items.filter((item) => item.isActive);

        if (!activeItems.length) {
            throw new Error(`${key} must include at least one active item.`);
        }

        section.items.forEach((item) => {
            if (!item.id) throw new Error(`${key} item id is required.`);
            if (seenIds.has(item.id)) throw new Error(`${key} item ids must be unique.`);
            seenIds.add(item.id);

            if (!item.name) throw new Error(`${key} item names are required.`);
            const lowerName = item.name.toLowerCase();
            if (seenNames.has(lowerName)) throw new Error(`${key} item names must be unique.`);
            seenNames.add(lowerName);

            if (!item.criteria) throw new Error(`${item.name} criteria is required.`);

            if (key === "priorities") {
                if (!Number.isFinite(Number(item.rank))) {
                    throw new Error(`Priority rank is required for ${item.name}.`);
                }
                if (!item.statusBucket || !["No issue", "Monitor", "Action needed"].includes(item.statusBucket)) {
                    throw new Error(`Priority status bucket is required for ${item.name}.`);
                }
            }
        });

        if (key === "priorities") {
            const ranks = activeItems.map((item) => Number(item.rank));
            const uniqueRanks = new Set(ranks);
            if (uniqueRanks.size !== ranks.length) {
                throw new Error("Priority ranks must be unique among active priorities.");
            }
        }
    }

    private validateMigrationPlan(
        previous: GuestAnalysisSettingsValue,
        next: GuestAnalysisSettingsValue,
        migrationPlan: GuestAnalysisMigrationPlan | null | undefined,
    ) {
        (["categories", "departments", "priorities"] as GuestAnalysisSettingsSectionKey[]).forEach((key) => {
            const previousSection = previous.sections[key];
            const nextSection = next.sections[key];
            const nextActiveIds = new Set(nextSection.items.filter((item) => item.isActive).map((item) => item.id));
            const mappings = new Map<string, string>((migrationPlan?.[key] || []).map((entry) => [entry.fromId, entry.toId]));

            previousSection.items
                .filter((item) => item.isActive)
                .forEach((item) => {
                    const stillActive = nextSection.items.find((nextItem) => nextItem.id === item.id && nextItem.isActive);
                    if (stillActive) return;
                    const replacementId = mappings.get(item.id);
                    if (!replacementId || !nextActiveIds.has(replacementId)) {
                        throw new Error(`Please choose a replacement ${key.slice(0, -1)} for "${item.name}".`);
                    }
                });
        });
    }

    private async migrateExistingAnalyses(
        previous: GuestAnalysisSettingsValue,
        next: GuestAnalysisSettingsValue,
        migrationPlan: GuestAnalysisMigrationPlan | null | undefined,
    ) {
        const sectionMappings = (["categories", "departments", "priorities"] as GuestAnalysisSettingsSectionKey[]).reduce<Record<GuestAnalysisSettingsSectionKey, Map<string, string>>>((accumulator, key) => {
            const currentItems = this.getItemMap(previous.sections[key]);
            const nextItems = this.getItemMap(next.sections[key]);
            const mapping = new Map<string, string>();

            previous.sections[key].items.forEach((previousItem) => {
                const nextItem = nextItems.get(previousItem.id);
                if (nextItem?.isActive) {
                    mapping.set(previousItem.name, nextItem.name);
                    return;
                }

                const replacementId = (migrationPlan?.[key] || []).find((entry) => entry.fromId === previousItem.id)?.toId;
                if (replacementId) {
                    const replacement = nextItems.get(replacementId);
                    if (replacement?.isActive) {
                        mapping.set(previousItem.name, replacement.name);
                    }
                }
            });

            currentItems.forEach((item) => {
                if (!mapping.has(item.name) && nextItems.get(item.id)?.isActive) {
                    mapping.set(item.name, nextItems.get(item.id)!.name);
                }
            });

            accumulator[key] = mapping;
            return accumulator;
        }, {
            categories: new Map<string, string>(),
            departments: new Map<string, string>(),
            priorities: new Map<string, string>(),
        });

        const analyses = await this.analysisRepo.find();
        const updates = analyses
            .map((analysis) => {
                const nextFlags = (analysis.flags || []).map((flag) => ({
                    ...flag,
                    flag: sectionMappings.categories.get(flag.flag) || flag.flag,
                    owner: flag.owner ? (sectionMappings.departments.get(flag.owner) || flag.owner) : flag.owner,
                    severity: flag.severity ? (sectionMappings.priorities.get(flag.severity) || flag.severity) : flag.severity,
                }));

                const changed = JSON.stringify(nextFlags) !== JSON.stringify(analysis.flags || []);
                if (!changed) return null;
                analysis.flags = nextFlags;
                return analysis;
            })
            .filter(Boolean) as GuestAnalysisEntity[];

        if (updates.length) {
            await this.analysisRepo.save(updates);
            logger.info(`[GuestAnalysisSettingsService] Migrated ${updates.length} guest analysis records to the latest taxonomy`);
        }
    }

    async getSettings(): Promise<GuestAnalysisSettingsEntity> {
        await this.ensureSchema();
        let settings = await this.settingsRepo.findOne({ where: { settingKey: SETTINGS_KEY } });
        if (!settings) {
            settings = this.settingsRepo.create({
                settingKey: SETTINGS_KEY,
                value: this.cloneSettings(DEFAULT_SETTINGS),
                updatedBy: "system",
            });
            settings = await this.settingsRepo.save(settings);
        }

        const normalized = this.normalizeSettings(settings.value);
        if (JSON.stringify(normalized) !== JSON.stringify(settings.value)) {
            settings.value = normalized;
            settings = await this.settingsRepo.save(settings);
        }

        return settings;
    }

    async updateSettings(
        nextValue: GuestAnalysisSettingsValue,
        migrationPlan: GuestAnalysisMigrationPlan | null | undefined,
        userId: string,
    ): Promise<GuestAnalysisSettingsEntity> {
        await this.ensureSecureStayAdmin(userId);
        const existing = await this.getSettings();
        const previousValue = this.normalizeSettings(existing.value);
        const normalizedNext = this.normalizeSettings(nextValue);

        this.validateSection(normalizedNext.sections.categories, "categories");
        this.validateSection(normalizedNext.sections.departments, "departments");
        this.validateSection(normalizedNext.sections.priorities, "priorities");
        this.validateMigrationPlan(previousValue, normalizedNext, migrationPlan);

        await this.migrateExistingAnalyses(previousValue, normalizedNext, migrationPlan);

        existing.value = normalizedNext;
        existing.updatedBy = userId;
        const saved = await this.settingsRepo.save(existing);

        const audit = this.auditRepo.create({
            settingKey: SETTINGS_KEY,
            previousValue,
            nextValue: normalizedNext,
            migrationPlan: migrationPlan || null,
            updatedBy: userId,
        });
        await this.auditRepo.save(audit);

        return saved;
    }

    async getActiveSectionItems(key: GuestAnalysisSettingsSectionKey): Promise<GuestAnalysisSettingsEntry[]> {
        const settings = await this.getSettings();
        return [...settings.value.sections[key].items]
            .filter((item) => item.isActive)
            .sort((left, right) => {
                if (key === "priorities") {
                    return Number(left.rank || 0) - Number(right.rank || 0);
                }
                return left.sortOrder - right.sortOrder;
            });
    }

    async getPriorityRankMap(): Promise<Map<string, number>> {
        const priorities = await this.getActiveSectionItems("priorities");
        return new Map(priorities.map((item) => [item.name, Number(item.rank || 0)]));
    }

    async getPriorityStatusMap(): Promise<Map<string, GuestAnalysisDerivedStatus>> {
        const priorities = await this.getActiveSectionItems("priorities");
        return new Map(priorities.map((item) => [item.name, (item.statusBucket || "Monitor") as GuestAnalysisDerivedStatus]));
    }
}
