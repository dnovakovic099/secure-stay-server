import { appDatabase } from "../utils/database.util";
import { In, IsNull } from "typeorm";
import { RentalAgreementTemplate } from "../entity/RentalAgreementTemplate";
import { RentalAgreementTemplateRule } from "../entity/RentalAgreementTemplateRule";

const templateRepo = () => appDatabase.getRepository(RentalAgreementTemplate);
const ruleRepo = () => appDatabase.getRepository(RentalAgreementTemplateRule);

type TemplateRulePayload = {
    listingIds?: Array<number | string>;
    channelIds?: Array<number | string | null>;
    channels?: Array<{ channelId?: number | string | null; channelName?: string | null }>;
    templateId?: number | string;
    isActive?: boolean;
    action?: "update" | "removeProperty" | "addChannels" | "removeChannels";
};

export class RentalAgreementTemplateService {
    async getAll(page = 1, limit = 20): Promise<{ data: RentalAgreementTemplate[]; total: number; page: number; limit: number }> {
        const [data, total] = await templateRepo().findAndCount({
            order: { createdAt: "DESC" },
            skip: (page - 1) * limit,
            take: limit,
        });
        return { data, total, page, limit };
    }

    async getById(id: number): Promise<RentalAgreementTemplate> {
        const template = await templateRepo().findOne({ where: { id } });
        if (!template) throw new Error("Template not found");
        return template;
    }

    async getDefault(): Promise<RentalAgreementTemplate | null> {
        const defaultTemplate = await templateRepo().findOne({ where: { isDefault: true, isActive: true } });
        if (defaultTemplate) return defaultTemplate;
        // Fall back to first active template when no default is set
        return templateRepo().findOne({ where: { isActive: true }, order: { createdAt: "ASC" } });
    }

    async getForReservationContext(listingId?: number | null, channelId?: number | null): Promise<RentalAgreementTemplate | null> {
        if (listingId) {
            const rules = await ruleRepo().find({
                where: { listingId, isActive: true },
                relations: ["template"],
                order: { updatedAt: "DESC" },
            });
            const activeRules = rules.filter((rule) => rule.template?.isActive);
            const exactRule = activeRules.find((rule) => rule.channelId != null && channelId != null && Number(rule.channelId) === Number(channelId));
            if (exactRule?.template) return exactRule.template;
            const allChannelRule = activeRules.find((rule) => rule.channelId == null);
            if (allChannelRule?.template) return allChannelRule.template;
        }

        return this.getDefault();
    }

    async getRules(): Promise<RentalAgreementTemplateRule[]> {
        return ruleRepo().find({
            relations: ["listing", "template"],
            order: { updatedAt: "DESC" },
        });
    }

    async create(data: Partial<RentalAgreementTemplate>, userId?: string): Promise<RentalAgreementTemplate> {
        if (data.isDefault) {
            await templateRepo().update({ isDefault: true }, { isDefault: false });
        }
        const template = templateRepo().create({
            headerHtml: data.headerHtml || "",
            ...data,
            footerHtml: data.footerHtml || "",
            createdBy: userId,
            updatedBy: userId,
        });
        return templateRepo().save(template);
    }

    async update(id: number, data: Partial<RentalAgreementTemplate>, userId?: string): Promise<RentalAgreementTemplate> {
        const template = await this.getById(id);
        if (data.isDefault && !template.isDefault) {
            await templateRepo().update({ isDefault: true }, { isDefault: false });
        }
        Object.assign(template, data, { updatedBy: userId });
        return templateRepo().save(template);
    }

    async delete(id: number): Promise<void> {
        const template = await this.getById(id);
        // Soft delete: deactivate rather than hard delete to preserve signing history
        template.isActive = false;
        if (template.isDefault) template.isDefault = false;
        await templateRepo().save(template);
    }

    async upsertRules(payload: TemplateRulePayload, userId?: string): Promise<RentalAgreementTemplateRule[]> {
        const templateId = Number(payload.templateId);
        if (!templateId) throw new Error("Template is required");
        const template = await this.getById(templateId);
        if (!template.isActive) throw new Error("Template must be active");

        const listingIds = (payload.listingIds || []).map((id) => Number(id)).filter(Boolean);
        if (!listingIds.length) throw new Error("At least one property is required");

        const channels = this.normalizeChannels(payload);
        const saved: RentalAgreementTemplateRule[] = [];

        for (const listingId of listingIds) {
            for (const channel of channels) {
                const existing = await ruleRepo().findOne({
                    where: {
                        listingId,
                        channelId: channel.channelId === null ? IsNull() : channel.channelId,
                    },
                });
                const rule = existing || ruleRepo().create({
                    listingId,
                    channelId: channel.channelId,
                    createdBy: userId,
                });
                rule.channelName = channel.channelName;
                rule.templateId = templateId;
                rule.isActive = payload.isActive ?? true;
                rule.updatedBy = userId;
                saved.push(await ruleRepo().save(rule));
            }
        }

        return saved;
    }

    async updateRule(id: number, payload: Partial<TemplateRulePayload>, userId?: string): Promise<RentalAgreementTemplateRule> {
        const rule = await ruleRepo().findOne({ where: { id } });
        if (!rule) throw new Error("Template rule not found");
        if (payload.templateId !== undefined) {
            const template = await this.getById(Number(payload.templateId));
            if (!template.isActive) throw new Error("Template must be active");
            rule.templateId = Number(payload.templateId);
        }
        if (payload.isActive !== undefined) rule.isActive = Boolean(payload.isActive);
        rule.updatedBy = userId;
        await ruleRepo().save(rule);
        return this.getRuleById(id);
    }

    async bulkUpdateRules(ids: number[], payload: Partial<TemplateRulePayload>, userId?: string): Promise<RentalAgreementTemplateRule[]> {
        const normalizedIds = ids.map((id) => Number(id)).filter(Boolean);
        if (!normalizedIds.length) throw new Error("Select at least one rule");
        const action = payload.action || "update";
        const channels = this.normalizeChannels(payload as TemplateRulePayload);
        if (payload.templateId !== undefined && payload.templateId !== null && payload.templateId !== "") {
            const template = await this.getById(Number(payload.templateId));
            if (!template.isActive) throw new Error("Template must be active");
        }
        const rules = await ruleRepo().find({ where: { id: In(normalizedIds) } });
        if (!rules.length) return this.getRules();

        if (action === "removeProperty") {
            await ruleRepo().delete({ id: In(normalizedIds) });
            return this.getRules();
        }

        if (action === "removeChannels") {
            const selectedChannelKeys = new Set(channels.map((channel) => channel.channelId === null ? "all" : String(channel.channelId)));
            const idsToDelete = rules
                .filter((rule) => selectedChannelKeys.has(rule.channelId === null ? "all" : String(rule.channelId)))
                .map((rule) => rule.id);
            if (idsToDelete.length) await ruleRepo().delete({ id: In(idsToDelete) });
            return this.getRules();
        }

        if (action === "addChannels") {
            const targetRows = new Map<string, RentalAgreementTemplateRule>();
            rules.forEach((rule) => {
                const templateId = payload.templateId !== undefined && payload.templateId !== null && payload.templateId !== ""
                    ? Number(payload.templateId)
                    : rule.templateId;
                const isActive = payload.isActive !== undefined ? Boolean(payload.isActive) : rule.isActive;
                targetRows.set(`${rule.listingId}-${templateId}-${isActive ? "active" : "inactive"}`, {
                    ...rule,
                    templateId,
                    isActive,
                } as RentalAgreementTemplateRule);
            });

            for (const rule of targetRows.values()) {
                for (const channel of channels) {
                    const existing = await ruleRepo().findOne({
                        where: {
                            listingId: rule.listingId,
                            channelId: channel.channelId === null ? IsNull() : channel.channelId,
                        },
                    });
                    const nextRule = existing || ruleRepo().create({
                        listingId: rule.listingId,
                        channelId: channel.channelId,
                        createdBy: userId,
                    });
                    nextRule.channelName = channel.channelName;
                    nextRule.templateId = rule.templateId;
                    nextRule.isActive = rule.isActive;
                    nextRule.updatedBy = userId;
                    await ruleRepo().save(nextRule);
                }
            }
            return this.getRules();
        }

        for (const rule of rules) {
            if (payload.templateId !== undefined && payload.templateId !== null && payload.templateId !== "") rule.templateId = Number(payload.templateId);
            if (payload.isActive !== undefined) rule.isActive = Boolean(payload.isActive);
            rule.updatedBy = userId;
        }
        await ruleRepo().save(rules);
        return this.getRules();
    }

    async deleteRule(id: number): Promise<void> {
        await ruleRepo().delete(id);
    }

    private async getRuleById(id: number): Promise<RentalAgreementTemplateRule> {
        const rule = await ruleRepo().findOne({ where: { id }, relations: ["listing", "template"] });
        if (!rule) throw new Error("Template rule not found");
        return rule;
    }

    private normalizeChannels(payload: TemplateRulePayload) {
        const channels = payload.channels?.length
            ? payload.channels
            : (payload.channelIds || [null]).map((channelId) => ({ channelId, channelName: null }));
        const normalized = channels.map((channel) => ({
            channelId: channel.channelId === null || channel.channelId === undefined || channel.channelId === "" ? null : Number(channel.channelId),
            channelName: channel.channelName || null,
        }));
        return normalized.length ? normalized : [{ channelId: null, channelName: null }];
    }
}

export const rentalAgreementTemplateService = new RentalAgreementTemplateService();
