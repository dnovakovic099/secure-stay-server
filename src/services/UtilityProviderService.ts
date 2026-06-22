import { appDatabase } from "../utils/database.util";
import { UtilityProvider, UtilityProviderPropertyLink } from "../entity/UtilityProvider";
import { UtilityPaymentMethod } from "../entity/UtilityPaymentMethod";
import { UtilityManagedOption, UtilityManagedOptionKind } from "../entity/UtilityManagedOption";
import { VendorAssignment } from "../entity/VendorAssignment";
import { VendorProfile } from "../entity/VendorProfile";
import CustomErrorHandler from "../middleware/customError.middleware";

type UtilityQuery = {
    search?: string;
    providerType?: string[];
    listingId?: number;
};

export class UtilityProviderService {
    private static readonly TRASH_PROVIDER_TYPE = "Trash";
    private static readonly TRASH_VENDOR_ROLE = "Trash Haul";

    private utilityRepo = appDatabase.getRepository(UtilityProvider);
    private paymentMethodRepo = appDatabase.getRepository(UtilityPaymentMethod);
    private managedOptionRepo = appDatabase.getRepository(UtilityManagedOption);
    private vendorProfileRepo = appDatabase.getRepository(VendorProfile);
    private vendorAssignmentRepo = appDatabase.getRepository(VendorAssignment);

    private async ensureManagedOptionTable() {
        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS utility_managed_option (
                id INT NOT NULL AUTO_INCREMENT,
                kind VARCHAR(50) NOT NULL,
                label VARCHAR(255) NOT NULL,
                sort_order INT NOT NULL DEFAULT 0,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deleted_at TIMESTAMP NULL DEFAULT NULL,
                created_by VARCHAR(255) NULL,
                updated_by VARCHAR(255) NULL,
                deleted_by VARCHAR(255) NULL,
                PRIMARY KEY (id),
                INDEX idx_utility_managed_option_kind (kind),
                INDEX idx_utility_managed_option_deleted_at (deleted_at)
            )
        `);
    }

    private async ensureManagedOption(kind: UtilityManagedOptionKind, label: string | null | undefined, userId: string) {
        await this.ensureManagedOptionTable();
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

    private normalizeNullableString(value: unknown) {
        return typeof value === "string" ? value.trim() || null : value == null ? null : String(value).trim() || null;
    }

    private normalizeNullableNumber(value: unknown) {
        const normalized = Number(value);
        return Number.isFinite(normalized) ? normalized : null;
    }

    private normalizeNullableDateString(value: unknown) {
        const normalized = this.normalizeNullableString(value);
        if (!normalized) return null;
        const date = new Date(normalized);
        return Number.isNaN(date.getTime()) ? null : normalized;
    }

    private isTrashProvider(utility: Partial<UtilityProvider>) {
        return (utility.providerType || "").trim().toLowerCase() === UtilityProviderService.TRASH_PROVIDER_TYPE.toLowerCase();
    }

    private async findOrCreateTrashVendorProfile(utility: UtilityProvider, propertyLinks: UtilityProviderPropertyLink[], userId: string) {
        const providerName = utility.providerName?.trim();
        if (!providerName) return null;

        const source = propertyLinks.find((link) => this.normalizeNullableString(link.source))?.source || null;
        let profile = await this.vendorProfileRepo
            .createQueryBuilder("profile")
            .where("profile.deletedAt IS NULL")
            .andWhere("LOWER(profile.name) = LOWER(:name)", { name: providerName })
            .getOne();

        const nextValues = {
            name: providerName,
            source: this.normalizeNullableString(source) || profile?.source || null,
            notes: this.normalizeNullableString(utility.notes) || profile?.notes || null,
            updatedBy: userId,
        };

        if (!profile) {
            profile = this.vendorProfileRepo.create({
                ...nextValues,
                companyName: null,
                contact: null,
                email: null,
                avatarUrl: null,
                icon: null,
                createdBy: userId,
            });
        } else {
            profile = this.vendorProfileRepo.merge(profile, nextValues);
        }

        return this.vendorProfileRepo.save(profile);
    }

    private buildTrashVendorAssignmentPayload(utility: UtilityProvider, link: UtilityProviderPropertyLink, userId: string) {
        return {
            listingId: String(link.propertyId),
            role: UtilityProviderService.TRASH_VENDOR_ROLE,
            status: "active",
            managedBy: this.normalizeNullableString(link.managedBy),
            workSchedule: this.normalizeNullableString(link.workSchedule),
            workScheduleDays: this.normalizeNullableString(link.workScheduleDays),
            workScheduleIntervalWeeks: this.normalizeNullableNumber(link.workScheduleIntervalWeeks),
            workScheduleDayOfMonth: this.normalizeNullableNumber(link.workScheduleDayOfMonth),
            workScheduleQuarter: this.normalizeNullableString(link.workScheduleQuarter),
            workScheduleMonth: this.normalizeNullableString(link.workScheduleMonth),
            workScheduleCheckoutTiming: this.normalizeNullableString(link.workScheduleCheckoutTiming),
            paymentScheduleType: this.normalizeNullableString(link.paymentScheduleType),
            paymentMethod: this.normalizeNullableString(link.paymentMethod),
            isAutoPay: Boolean(link.autopay),
            paidBy: this.normalizeNullableString(link.paidBy),
            rate: this.normalizeNullableString(link.rate),
            rateType: this.normalizeNullableString(link.rateType),
            customRateDescription: this.normalizeNullableString(link.customRateDescription),
            payoutDetails: this.normalizeNullableString(link.payoutDetails),
            paymentIntervalMonth: this.normalizeNullableNumber(link.paymentIntervalMonth),
            paymentDayOfWeek: this.normalizeNullableString(link.paymentDayOfWeek),
            paymentWeekOfMonth: this.normalizeNullableNumber(link.paymentWeekOfMonth),
            paymentDayOfMonth: this.normalizeNullableNumber(link.paymentDayOfMonth),
            nextServiceDate: this.normalizeNullableDateString(link.nextServiceDate) as any,
            website_name: this.normalizeNullableString(utility.providerName),
            website_link: this.normalizeNullableString(utility.website),
            notes: this.normalizeNullableString(link.propertyNotes),
            updatedBy: userId,
        };
    }

    private async syncTrashUtilityVendorAssignments(utility: UtilityProvider, propertyLinks: UtilityProviderPropertyLink[], userId: string) {
        if (!this.isTrashProvider(utility)) return;

        const profile = await this.findOrCreateTrashVendorProfile(utility, propertyLinks, userId);
        if (!profile) return;

        for (const link of propertyLinks) {
            const payload = this.buildTrashVendorAssignmentPayload(utility, link, userId);
            const existing = await this.vendorAssignmentRepo
                .createQueryBuilder("assignment")
                .where("assignment.deletedAt IS NULL")
                .andWhere("assignment.vendorProfileId = :vendorProfileId", { vendorProfileId: profile.id })
                .andWhere("assignment.listingId = :listingId", { listingId: payload.listingId })
                .andWhere("assignment.role = :role", { role: UtilityProviderService.TRASH_VENDOR_ROLE })
                .orderBy("assignment.updatedAt", "DESC")
                .getOne();

            if (existing) {
                await this.vendorAssignmentRepo.save(this.vendorAssignmentRepo.merge(existing, payload));
            } else {
                await this.vendorAssignmentRepo.save(this.vendorAssignmentRepo.create({
                    ...payload,
                    vendorProfileId: profile.id,
                    vendorProfile: profile,
                    createdBy: userId,
                }));
            }
        }
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
                source: this.normalizeNullableString(link?.source),
                managedBy: this.normalizeNullableString(link?.managedBy),
                workSchedule: this.normalizeNullableString(link?.workSchedule),
                workScheduleDays: this.normalizeNullableString(link?.workScheduleDays),
                workScheduleIntervalWeeks: this.normalizeNullableNumber(link?.workScheduleIntervalWeeks),
                workScheduleDayOfMonth: this.normalizeNullableNumber(link?.workScheduleDayOfMonth),
                workScheduleQuarter: this.normalizeNullableString(link?.workScheduleQuarter),
                workScheduleMonth: this.normalizeNullableString(link?.workScheduleMonth),
                workScheduleCheckoutTiming: this.normalizeNullableString(link?.workScheduleCheckoutTiming),
                autopay: Boolean(link?.autopay),
                paymentMethod: link?.paymentMethod?.toString().trim() || null,
                paymentScheduleType: this.normalizeNullableString(link?.paymentScheduleType),
                paidBy: this.normalizeNullableString(link?.paidBy),
                rate: this.normalizeNullableString(link?.rate),
                rateType: this.normalizeNullableString(link?.rateType),
                customRateDescription: this.normalizeNullableString(link?.customRateDescription),
                payoutDetails: this.normalizeNullableString(link?.payoutDetails),
                paymentIntervalMonth: this.normalizeNullableNumber(link?.paymentIntervalMonth),
                paymentDayOfWeek: this.normalizeNullableString(link?.paymentDayOfWeek),
                paymentWeekOfMonth: this.normalizeNullableNumber(link?.paymentWeekOfMonth),
                paymentDayOfMonth: this.normalizeNullableNumber(link?.paymentDayOfMonth),
                nextServiceDate: this.normalizeNullableDateString(link?.nextServiceDate),
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
            source: null,
            managedBy: null,
            workSchedule: null,
            workScheduleDays: null,
            workScheduleIntervalWeeks: null,
            workScheduleDayOfMonth: null,
            workScheduleQuarter: null,
            workScheduleMonth: null,
            workScheduleCheckoutTiming: null,
            autopay: false,
            paymentMethod: null,
            paymentScheduleType: null,
            paidBy: null,
            rate: null,
            rateType: null,
            customRateDescription: null,
            payoutDetails: null,
            paymentIntervalMonth: null,
            paymentDayOfWeek: null,
            paymentWeekOfMonth: null,
            paymentDayOfMonth: null,
            nextServiceDate: null,
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
        await this.syncTrashUtilityVendorAssignments(created, propertyLinks, userId);
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
        await this.syncTrashUtilityVendorAssignments(updated, propertyLinks, userId);
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
        await this.ensureManagedOptionTable();
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
        await this.ensureManagedOptionTable();
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
        await this.ensureManagedOptionTable();
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
        await this.ensureManagedOptionTable();
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
