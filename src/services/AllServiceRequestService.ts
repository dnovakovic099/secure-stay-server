import { appDatabase } from "../utils/database.util";
import { PhotographerRequest } from "../entity/PhotographerRequest";
import { CleanerRequest } from "../entity/CleanerRequest";
import { MaintenanceFormRequest } from "../entity/MaintenanceFormRequest";
import { ItemSupplyRequest } from "../entity/ItemSupplyRequest";

interface UnifiedRequest {
    id: number;
    type: string;
    status: string;
    propertyName: string;
    clientName: string;
    createdAt: Date;
}

export class AllServiceRequestService {
    private photographerRepo = appDatabase.getRepository(PhotographerRequest);
    private cleanerRepo = appDatabase.getRepository(CleanerRequest);
    private maintenanceRepo = appDatabase.getRepository(MaintenanceFormRequest);
    private itemSupplyRepo = appDatabase.getRepository(ItemSupplyRequest);

    async getAll(params: {
        page: number;
        limit: number;
        status?: string[];
        propertyId?: number[];
    }): Promise<{ data: UnifiedRequest[]; total: number; page: number; limit: number; totalPages: number }> {
        const { page, limit, status, propertyId } = params;

        // Build all 4 queries in parallel
        const [photographerRows, cleanerRows, maintenanceRows, itemSupplyRows] = await Promise.all([
            this.queryRepo(this.photographerRepo, "pr", status, propertyId),
            this.queryRepo(this.cleanerRepo, "cr", status, propertyId),
            this.queryRepo(this.maintenanceRepo, "mr", status, propertyId),
            this.queryRepo(this.itemSupplyRepo, "ir", status, propertyId),
        ]);

        // Normalize into unified shape
        const all: UnifiedRequest[] = [
            ...photographerRows.map((r: any) => this.normalize(r, "Photographer")),
            ...cleanerRows.map((r: any) => this.normalize(r, "Cleaner")),
            ...maintenanceRows.map((r: any) => this.normalize(r, "Maintenance")),
            ...itemSupplyRows.map((r: any) => this.normalize(r, "Item/Supply")),
        ];

        // Sort by createdAt DESC
        all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const total = all.length;
        const totalPages = Math.ceil(total / limit);
        const skip = (page - 1) * limit;
        const data = all.slice(skip, skip + limit);

        return { data, total, page, limit, totalPages };
    }

    private async queryRepo(repo: any, alias: string, status?: string[], propertyId?: number[]) {
        const qb = repo
            .createQueryBuilder(alias)
            .leftJoinAndSelect(`${alias}.property`, "property")
            .leftJoinAndSelect("property.client", "client")
            .leftJoinAndSelect("property.propertyInfo", "info");

        if (status && status.length > 0) {
            qb.andWhere(`${alias}.status IN (:...status)`, { status });
        }

        if (propertyId && propertyId.length > 0) {
            qb.andWhere(`${alias}.propertyId IN (:...propertyId)`, { propertyId });
        }

        return qb.getMany();
    }

    private normalize(row: any, type: string): UnifiedRequest {
        const property = row.property;
        const propertyName =
            property?.propertyInfo?.internalListingName ||
            property?.propertyInfo?.externalListingName ||
            property?.address ||
            `Property ${row.propertyId}`;

        const client = property?.client;
        const clientName = client
            ? `${client.firstName || ""} ${client.lastName || ""}`.trim()
            : "—";

        return {
            id: row.id,
            type,
            status: row.status || "new",
            propertyName,
            clientName,
            createdAt: row.createdAt,
        };
    }
}
