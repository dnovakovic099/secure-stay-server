import { appDatabase } from "../utils/database.util";
import { RentalAgreementTemplate } from "../entity/RentalAgreementTemplate";

const templateRepo = () => appDatabase.getRepository(RentalAgreementTemplate);

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
}

export const rentalAgreementTemplateService = new RentalAgreementTemplateService();
