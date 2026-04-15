import { appDatabase } from "../utils/database.util";
import { UtilityProvider } from "../entity/UtilityProvider";
import CustomErrorHandler from "../middleware/customError.middleware";

type UtilityQuery = {
    search?: string;
    providerType?: string[];
    listingId?: number;
};

export class UtilityProviderService {
    private utilityRepo = appDatabase.getRepository(UtilityProvider);

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
        return {
            ...utility,
            propertyIds: this.normalizePropertyIds(utility.propertyIds || []),
        };
    }

    async createUtilityProvider(body: Partial<UtilityProvider>, userId: string) {
        const utility = this.utilityRepo.create({
            providerType: body.providerType?.trim(),
            customProviderLabel: body.customProviderLabel?.trim() || null,
            providerName: body.providerName?.trim() || null,
            username: body.username?.trim() || null,
            password: body.password || null,
            notes: body.notes || null,
            propertyIds: this.normalizePropertyIds(body.propertyIds),
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

        existing.providerType = body.providerType?.trim() || existing.providerType;
        existing.customProviderLabel = body.customProviderLabel !== undefined ? body.customProviderLabel?.trim() || null : existing.customProviderLabel;
        existing.providerName = body.providerName !== undefined ? body.providerName?.trim() || null : existing.providerName;
        existing.username = body.username !== undefined ? body.username?.trim() || null : existing.username;
        existing.password = body.password !== undefined ? body.password || null : existing.password;
        existing.notes = body.notes !== undefined ? body.notes || null : existing.notes;
        existing.propertyIds = body.propertyIds !== undefined ? this.normalizePropertyIds(body.propertyIds) : existing.propertyIds;
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
