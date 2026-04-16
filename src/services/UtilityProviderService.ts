import { appDatabase } from "../utils/database.util";
import { UtilityProvider, UtilityProviderPropertyLink } from "../entity/UtilityProvider";
import CustomErrorHandler from "../middleware/customError.middleware";

type UtilityQuery = {
    search?: string;
    providerType?: string[];
    listingId?: number;
};

export class UtilityProviderService {
    private utilityRepo = appDatabase.getRepository(UtilityProvider);

    private normalizePropertyLinks(
        propertyLinks?: Array<Partial<UtilityProviderPropertyLink> | null> | null,
        fallbackPropertyIds?: Array<number | string> | null
    ): UtilityProviderPropertyLink[] {
        const normalizedLinks = (propertyLinks || [])
            .map((link) => ({
                propertyId: Number(link?.propertyId),
                accountNumber: link?.accountNumber?.toString().trim() || null,
                propertyNotes: link?.propertyNotes?.toString().trim() || null,
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
}
