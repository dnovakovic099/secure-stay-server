import { appDatabase } from "../utils/database.util";
import { PhotographerRequest } from "../entity/PhotographerRequest";
import { CleanerRequest } from "../entity/CleanerRequest";
import { MaintenanceFormRequest } from "../entity/MaintenanceFormRequest";
import { ItemSupplyRequest } from "../entity/ItemSupplyRequest";
import * as XLSX from "xlsx";
import { format } from "date-fns";

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

    async exportToExcel(params: {
        status?: string[];
        propertyId?: number[];
        type?: string;
    }): Promise<any> {
        let formattedData: any[] = [];
        let sheetName = "ServiceRequests";

        if (params.type && params.type !== 'all') {
            let rows: any[] = [];
            switch (params.type) {
                case 'photographer':
                    rows = await this.queryRepo(this.photographerRepo, "pr", params.status, params.propertyId);
                    sheetName = "PhotographerRequests";
                    formattedData = rows.map((r: any) => {
                        const { propertyName, clientName } = this.normalize(r, "Photographer");
                        return {
                            "ID": r.id,
                            "Property": propertyName,
                            "Client": clientName,
                            "Service Type": r.serviceType || "-",
                            "Address": r.completeAddress || "-",
                            "Bedrooms": r.numberOfBedrooms || 0,
                            "Bathrooms": r.numberOfBathrooms || 0,
                            "Sqft": r.sqftOfHouse || 0,
                            "Availability": r.availability || "-",
                            "Onboarding Rep": r.onboardingRep || "-",
                            "Status": r.status,
                            "Created At": format(new Date(r.createdAt), 'yyyy-MM-dd HH:mm:ss')
                        };
                    });
                    break;
                case 'cleaner':
                    rows = await this.queryRepo(this.cleanerRepo, "cr", params.status, params.propertyId);
                    sheetName = "CleanerRequests";
                    formattedData = rows.map((r: any) => {
                        const { propertyName, clientName } = this.normalize(r, "Cleaner");
                        return {
                            "ID": r.id,
                            "Property": propertyName,
                            "Client": clientName,
                            "Address": r.fullAddress || "-",
                            "Special Arrangement": r.specialArrangementPreference || "-",
                            "Property Ready/Cleaned": r.isPropertyReadyCleaned || "-",
                            "Schedule Initial Clean": r.scheduleInitialClean || "-",
                            "Access Info": r.propertyAccessInformation || "-",
                            "Closet Code/Location": r.cleaningClosetCodeLocation || "-",
                            "Trash Schedule": r.trashScheduleInstructions || "-",
                            "Restock Supplies": r.suppliesToRestock || "-",
                            "Status": r.status,
                            "Created At": format(new Date(r.createdAt), 'yyyy-MM-dd HH:mm:ss')
                        };
                    });
                    break;
                case 'maintenance':
                    rows = await this.queryRepo(this.maintenanceRepo, "mr", params.status, params.propertyId);
                    sheetName = "MaintenanceRequests";
                    formattedData = rows.map((r: any) => {
                        const { propertyName, clientName } = this.normalize(r, "Maintenance");
                        return {
                            "ID": r.id,
                            "Property": propertyName,
                            "Client": clientName,
                            "Budget": r.budget || "-",
                            "Email": r.email || "-",
                            "Scope of Work": r.scopeOfWork || "-",
                            "Access Info": r.propertyAccessInformation || "-",
                            "Timeframe": r.expectedTimeframe || "-",
                            "Status": r.status,
                            "Created At": format(new Date(r.createdAt), 'yyyy-MM-dd HH:mm:ss')
                        };
                    });
                    break;
                case 'itemSupply':
                    rows = await this.queryRepo(this.itemSupplyRepo, "ir", params.status, params.propertyId);
                    sheetName = "ItemSupplyRequests";
                    formattedData = rows.map((r: any) => {
                        const { propertyName, clientName } = this.normalize(r, "Item/Supply");
                        return {
                            "ID": r.id,
                            "Property": propertyName,
                            "Client": clientName,
                            "Items to Restock": r.itemsToRestock || "-",
                            "Urgent": r.isUrgent || "No",
                            "Approved By Client": r.approvedByClient || "No",
                            "Send To Address": r.sendToAddress || "-",
                            "Requested By": r.requestedBy || "-",
                            "Status": r.status,
                            "Created At": format(new Date(r.createdAt), 'yyyy-MM-dd HH:mm:ss')
                        };
                    });
                    break;
                default:
                    const allData = await this.getAll({ ...params, page: 1, limit: 100000 });
                    formattedData = allData.data.map(req => ({
                        "Request ID": req.id,
                        "Service Type": req.type,
                        "Status": req.status,
                        "Property": req.propertyName,
                        "Client Name": req.clientName,
                        "Created At": format(new Date(req.createdAt), 'yyyy-MM-dd HH:mm:ss')
                    }));
            }
        } else {
            const allData = await this.getAll({ ...params, page: 1, limit: 100000 });
            formattedData = allData.data.map(req => ({
                "Request ID": req.id,
                "Service Type": req.type,
                "Status": req.status,
                "Property": req.propertyName,
                "Client Name": req.clientName,
                "Created At": format(new Date(req.createdAt), 'yyyy-MM-dd HH:mm:ss')
            }));
        }

        const worksheet = XLSX.utils.json_to_sheet(formattedData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

        return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    }
}
