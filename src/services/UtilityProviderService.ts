import { appDatabase } from "../utils/database.util";
import { UtilityProvider, UtilityProviderPropertyLink } from "../entity/UtilityProvider";
import { UtilityPaymentMethod } from "../entity/UtilityPaymentMethod";
import CustomErrorHandler from "../middleware/customError.middleware";

type UtilityQuery = {
    search?: string;
    providerType?: string[];
    listingId?: number;
};

export class UtilityProviderService {
    private utilityRepo = appDatabase.getRepository(UtilityProvider);
    private paymentMethodRepo = appDatabase.getRepository(UtilityPaymentMethod);

    private normalizePropertyLinks(
        propertyLinks?: Array<Partial<UtilityProviderPropertyLink> | null> | null,
        fallbackPropertyIds?: Array<number | string> | null
    ): UtilityProviderPropertyLink[] {
        const normalizedLinks = (propertyLinks || [])
            .map((link) => ({
                propertyId: Number(link?.propertyId),
                accountNumber: link?.accountNumber?.toString().trim() || null,
                propertyNotes: link?.propertyNotes?.toString().trim() || null,
                autopay: Boolean(link?.autopay),
                paymentMethod: link?.paymentMethod?.toString().trim() || null,
            }))
            .filter((link) => Number.isFinite(link.propertyId) && link.propertyId > 0);

        if (normalizedLinks.length > 0) {
            return Array.from(
                new Map(normalizedLinks.map((link) => [link.propertyId, link])).values()
            );
        }

        return this.normalizePropertyIds(fallbackPropertyIds).map((propertyId) => ({
            propertyId,
            accountNumber: null,
            propertyNotes: null,
            autopay: false,
            paymentMethod: null,
        }));
    }

    private normalizePropertyIds(propertyIds?: Array<number | string> | null): number[] {
        return Array.from(
            new Set(
                (propertyIds || [])
                    .map((value) => Number(value))
                    .filter((value) => Number.isFinite(value) && value > 0)
            )
        );
    }

    private normalizeUtility(utility: UtilityProvider) {
        const propertyLinks = this.normalizePropertyLinks(utility.propertyLinks || [], utility.propertyIds || []);
        return {
            ...utility,
            lastpass: Boolean(utility.lastpass),
            propertyLinks,
            propertyIds: propertyLinks.map((link) => link.propertyId),
        };
    }

    async createUtilityProvider(body: Partial<UtilityProvider>, userId: string) {
        const propertyLinks = this.normalizePropertyLinks(
            body.propertyLinks as Array<Partial<UtilityProviderPropertyLink> | null> | undefined,
            body.propertyIds
        );
        const utility = this.utilityRepo.create({
            providerType: body.providerType?.trim(),
            customProviderLabel: body.customProviderLabel?.trim() || null,
            providerName: body.providerName?.trim() || null,
            accountName: body.accountName?.trim() || null,
            username: body.username?.trim() || null,
            password: body.password || null,
            lastpass: Boolean(body.lastpass),
            notes: body.notes || null,
            propertyIds: propertyLinks.map((link) => link.propertyId),
            propertyLinks,
            createdBy: userId,
            updatedBy: userId,
        });

        const created = await this.utilityRepo.save(utility);
        return this.normalizeUtility(created);
    }

    async updateUtilityProvider(id: number, body: Partial<UtilityProvider>, userId: string) {
        const existing = await this.utilityRepo.findOne({ where: { id } });
        if (!existing) {
            throw CustomErrorHandler.notFound("Utility provider not found");
        }

        const propertyLinks =
            body.propertyLinks !== undefined || body.propertyIds !== undefined
                ? this.normalizePropertyLinks(
                    body.propertyLinks as Array<Partial<UtilityProviderPropertyLink> | null> | undefined,
                    body.propertyIds
                )
                : this.normalizePropertyLinks(existing.propertyLinks || [], existing.propertyIds || []);

        existing.providerType = body.providerType?.trim() || existing.providerType;
        existing.customProviderLabel = body.customProviderLabel !== undefined ? body.customProviderLabel?.trim() || null : existing.customProviderLabel;
        existing.providerName = body.providerName !== undefined ? body.providerName?.trim() || null : existing.providerName;
        existing.accountName = body.accountName !== undefined ? body.accountName?.trim() || null : existing.accountName;
        existing.username = body.username !== undefined ? body.username?.trim() || null : existing.username;
        existing.password = body.password !== undefined ? body.password || null : existing.password;
        existing.lastpass = body.lastpass !== undefined ? Boolean(body.lastpass) : existing.lastpass;
        existing.notes = body.notes !== undefined ? body.notes || null : existing.notes;
        existing.propertyLinks = propertyLinks;
        existing.propertyIds = propertyLinks.map((link) => link.propertyId);
        existing.updatedBy = userId;

        const updated = await this.utilityRepo.save(existing);
        return this.normalizeUtility(updated);
    }

    async deleteUtilityProvider(id: number, userId: string) {
        const existing = await this.utilityRepo.findOne({ where: { id } });
        if (!existing) {
            throw CustomErrorHandler.notFound("Utility provider not found");
        }

        existing.deletedBy = userId;
        await this.utilityRepo.save(existing);
        await this.utilityRepo.softRemove(existing);
        return { message: "Utility provider deleted successfully" };
    }

    async getUtilityProviders(query: UtilityQuery) {
        const all = await this.utilityRepo.find({
            where: { deletedAt: null as any },
            order: { providerType: "ASC", customProviderLabel: "ASC", providerName: "ASC", updatedAt: "DESC" },
        });

        const normalized = all.map((utility) => this.normalizeUtility(utility));
        const keyword = (query.search || "").trim().toLowerCase();

        return normalized.filter((utility) => {
            if (query.providerType?.length && !query.providerType.includes(utility.providerType)) {
                return false;
            }

            if (query.listingId && !utility.propertyIds.includes(query.listingId)) {
                return false;
            }

            if (!keyword) {
                return true;
            }

            return [
                utility.providerType,
                utility.customProviderLabel,
                utility.providerName,
                utility.accountName,
                utility.username,
                utility.notes,
                ...(utility.propertyLinks || []).flatMap((link) => [String(link.propertyId), link.accountNumber, link.propertyNotes]),
            ]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(keyword));
        });
    }

    async getUtilityProvidersByListing(listingId: number) {
        const utilities = await this.getUtilityProviders({ listingId });
        return utilities;
    }

    async getUtilityPaymentMethods() {
        return this.paymentMethodRepo.find({
            where: { deletedAt: null as any },
            order: { sortOrder: "ASC", label: "ASC" },
        });
    }

    async createUtilityPaymentMethod(body: Partial<UtilityPaymentMethod>, userId: string) {
        const last = await this.paymentMethodRepo.find({
            where: { deletedAt: null as any },
            order: { sortOrder: "DESC" },
            take: 1,
        });

        const entry = this.paymentMethodRepo.create({
            label: body.label?.trim(),
            sortOrder: body.sortOrder ?? ((last[0]?.sortOrder ?? -1) + 1),
            isActive: body.isActive ?? true,
            createdBy: userId,
            updatedBy: userId,
        });

        return this.paymentMethodRepo.save(entry);
    }

    async updateUtilityPaymentMethod(id: number, body: Partial<UtilityPaymentMethod>, userId: string) {
        const existing = await this.paymentMethodRepo.findOne({ where: { id } });
        if (!existing) {
            throw CustomErrorHandler.notFound("Utility payment method not found");
        }

        existing.label = body.label !== undefined ? body.label?.trim() || existing.label : existing.label;
        existing.sortOrder = body.sortOrder !== undefined ? Number(body.sortOrder) : existing.sortOrder;
        existing.isActive = body.isActive !== undefined ? Boolean(body.isActive) : existing.isActive;
        existing.updatedBy = userId;

        return this.paymentMethodRepo.save(existing);
    }

    async deleteUtilityPaymentMethod(id: number, userId: string) {
        const existing = await this.paymentMethodRepo.findOne({ where: { id } });
        if (!existing) {
            throw CustomErrorHandler.notFound("Utility payment method not found");
        }

        existing.deletedBy = userId;
        await this.paymentMethodRepo.save(existing);
        await this.paymentMethodRepo.softRemove(existing);
        return { message: "Utility payment method deleted successfully" };
    }
}
