import { appDatabase } from "../utils/database.util";
import { UtilityProvider, UtilityProviderPropertyLink } from "../entity/UtilityProvider";
import { UtilityPaymentMethod } from "../entity/UtilityPaymentMethod";
import { UtilityManagedOption, UtilityManagedOptionKind } from "../entity/UtilityManagedOption";
import CustomErrorHandler from "../middleware/customError.middleware";

type UtilityQuery = {
    search?: string;
    providerType?: string[];
    listingId?: number;
};

export class UtilityProviderService {
    private utilityRepo = appDatabase.getRepository(UtilityProvider);
    private paymentMethodRepo = appDatabase.getRepository(UtilityPaymentMethod);
    private managedOptionRepo = appDatabase.getRepository(UtilityManagedOption);

    private async ensureManagedOption(kind: UtilityManagedOptionKind, label: string | null | undefined, userId: string) {
        const normalizedLabel = label?.trim();
        if (!normalizedLabel) return;

        const existing = await this.managedOptionRepo
            .createQueryBuilder("option")
            .where("option.deletedAt IS NULL")
            .andWhere("option.kind = :kind", { kind })
            .andWhere("LOWER(option.label) = LOWER(:label)", { label: normalizedLabel })
            .getOne();

        if (existing) {
            if (!existing.isActive) {
                existing.isActive = true;
                existing.updatedBy = userId;
                await this.managedOptionRepo.save(existing);
            }
            return;
        }

        const last = await this.managedOptionRepo.find({
            where: { deletedAt: null as any, kind },
            order: { sortOrder: "DESC" },
            take: 1,
        });

        const created = this.managedOptionRepo.create({
            kind,
            label: normalizedLabel,
            sortOrder: (last[0]?.sortOrder ?? -1) + 1,
            isActive: true,
            createdBy: userId,
            updatedBy: userId,
        });

        await this.managedOptionRepo.save(created);
    }

    private async ensurePaymentMethod(label: string | null | undefined, userId: string) {
        const normalizedLabel = label?.trim();
        if (!normalizedLabel) return;

        const existing = await this.paymentMethodRepo
            .createQueryBuilder("payment_method")
            .where("payment_method.deletedAt IS NULL")
            .andWhere("LOWER(payment_method.label) = LOWER(:label)", { label: normalizedLabel })
            .getOne();

        if (existing) {
            if (!existing.isActive) {
                existing.isActive = true;
                existing.updatedBy = userId;
                await this.paymentMethodRepo.save(existing);
            }
            return;
        }

        const last = await this.paymentMethodRepo.find({
            where: { deletedAt: null as any },
            order: { sortOrder: "DESC" },
            take: 1,
        });

        const created = this.paymentMethodRepo.create({
            label: normalizedLabel,
            sortOrder: (last[0]?.sortOrder ?? -1) + 1,
            isActive: true,
            createdBy: userId,
            updatedBy: userId,
        });

        await this.paymentMethodRepo.save(created);
    }

    private async syncUtilityDerivedOptions(utility: Partial<UtilityProvider>, propertyLinks: UtilityProviderPropertyLink[], userId: string) {
        await Promise.all([
            this.ensureManagedOption("providerName", utility.providerName, userId),
            this.ensureManagedOption("accountName", utility.accountName, userId),
            this.ensureManagedOption("username", utility.username, userId),
            ...propertyLinks.map((link) => this.ensurePaymentMethod(link.paymentMethod, userId)),
        ]);
    }

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
            website: body.website?.trim() || null,
            password: body.password || null,
            lastpass: Boolean(body.lastpass),
            notes: body.notes || null,
            propertyIds: propertyLinks.map((link) => link.propertyId),
            propertyLinks,
            createdBy: userId,
            updatedBy: userId,
        });

        const created = await this.utilityRepo.save(utility);
        await this.syncUtilityDerivedOptions(created, propertyLinks, userId);
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
        existing.website = body.website !== undefined ? body.website?.trim() || null : existing.website;
        existing.password = body.password !== undefined ? body.password || null : existing.password;
        existing.lastpass = body.lastpass !== undefined ? Boolean(body.lastpass) : existing.lastpass;
        existing.notes = body.notes !== undefined ? body.notes || null : existing.notes;
        existing.propertyLinks = propertyLinks;
        existing.propertyIds = propertyLinks.map((link) => link.propertyId);
        existing.updatedBy = userId;

        const updated = await this.utilityRepo.save(existing);
        await this.syncUtilityDerivedOptions(updated, propertyLinks, userId);
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

    async getUtilityManagedOptions(kind: UtilityManagedOptionKind) {
        const stored = await this.managedOptionRepo.find({
            where: { deletedAt: null as any, kind },
            order: { sortOrder: "ASC", label: "ASC" },
        });

        const utilities = await this.utilityRepo.find({ where: { deletedAt: null as any } });
        const derivedLabels = Array.from(
            new Set(
                utilities
                    .map((utility) => {
                        if (kind === "providerName") return utility.providerName;
                        if (kind === "accountName") return utility.accountName;
                        return utility.username;
                    })
                    .map((value) => value?.trim())
                    .filter(Boolean) as string[]
            )
        );

        const existingLabels = new Set(stored.map((option) => option.label.toLowerCase()));
        const virtuals = derivedLabels
            .filter((label) => !existingLabels.has(label.toLowerCase()))
            .sort((a, b) => a.localeCompare(b))
            .map((label, index) => ({
                id: -1 * (index + 1),
                kind,
                label,
                sortOrder: stored.length + index,
                isActive: true,
                createdAt: null,
                updatedAt: null,
                deletedAt: null,
                createdBy: null,
                updatedBy: null,
                deletedBy: null,
            }));

        return [...stored, ...virtuals];
    }

    async createUtilityManagedOption(kind: UtilityManagedOptionKind, body: Partial<UtilityManagedOption>, userId: string) {
        const normalizedLabel = body.label?.trim();
        if (!normalizedLabel) {
            throw CustomErrorHandler.validationError("Utility managed option label is required");
        }

        const existing = await this.managedOptionRepo
            .createQueryBuilder("option")
            .where("option.kind = :kind", { kind })
            .andWhere("LOWER(option.label) = LOWER(:label)", { label: normalizedLabel })
            .getOne();

        if (existing) {
            if (existing.deletedAt) {
                existing.deletedAt = null;
                existing.deletedBy = null;
            }
            if (!existing.isActive) {
                existing.isActive = true;
            }
            existing.updatedBy = userId;
            if (body.sortOrder !== undefined) {
                existing.sortOrder = Number(body.sortOrder);
            }
            return this.managedOptionRepo.save(existing);
        }

        const last = await this.managedOptionRepo.find({
            where: { deletedAt: null as any, kind },
            order: { sortOrder: "DESC" },
            take: 1,
        });

        const entry = this.managedOptionRepo.create({
            kind,
            label: normalizedLabel,
            sortOrder: body.sortOrder ?? ((last[0]?.sortOrder ?? -1) + 1),
            isActive: body.isActive ?? true,
            createdBy: userId,
            updatedBy: userId,
        });

        return this.managedOptionRepo.save(entry);
    }

    async updateUtilityManagedOption(kind: UtilityManagedOptionKind, id: number, body: Partial<UtilityManagedOption>, userId: string) {
        const existing = await this.managedOptionRepo.findOne({ where: { id, kind } });
        if (!existing) {
            throw CustomErrorHandler.notFound("Utility managed option not found");
        }

        existing.label = body.label !== undefined ? body.label?.trim() || existing.label : existing.label;
        existing.sortOrder = body.sortOrder !== undefined ? Number(body.sortOrder) : existing.sortOrder;
        existing.isActive = body.isActive !== undefined ? Boolean(body.isActive) : existing.isActive;
        existing.updatedBy = userId;

        return this.managedOptionRepo.save(existing);
    }

    async deleteUtilityManagedOption(kind: UtilityManagedOptionKind, id: number, userId: string) {
        const existing = await this.managedOptionRepo.findOne({ where: { id, kind } });
        if (!existing) {
            throw CustomErrorHandler.notFound("Utility managed option not found");
        }

        existing.deletedBy = userId;
        await this.managedOptionRepo.save(existing);
        await this.managedOptionRepo.softRemove(existing);
        return { message: "Utility managed option deleted successfully" };
    }

    async getUtilityPaymentMethods() {
        const stored = await this.paymentMethodRepo.find({
            where: { deletedAt: null as any },
            order: { sortOrder: "ASC", label: "ASC" },
        });

        const utilities = await this.utilityRepo.find({ where: { deletedAt: null as any } });
        const derivedLabels = Array.from(
            new Set(
                utilities
                    .flatMap((utility) => (utility.propertyLinks || []).map((link) => link?.paymentMethod?.trim()))
                    .filter(Boolean) as string[]
            )
        );

        const existingLabels = new Set(stored.map((method) => method.label.toLowerCase()));
        const virtuals = derivedLabels
            .filter((label) => !existingLabels.has(label.toLowerCase()))
            .sort((a, b) => a.localeCompare(b))
            .map((label, index) => ({
                id: -1 * (index + 1),
                label,
                sortOrder: stored.length + index,
                isActive: true,
                createdAt: null,
                updatedAt: null,
                deletedAt: null,
                createdBy: null,
                updatedBy: null,
                deletedBy: null,
            }));

        return [...stored, ...virtuals];
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
