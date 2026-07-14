import { appDatabase } from "../utils/database.util";
import { ServiceRequestHistory } from "../entity/ServiceRequestHistory";

type ServiceRequestHistoryType = "photographer" | "cleaner" | "maintenance" | "itemSupply";

const TECHNICAL_FIELDS = new Set([
    "id",
    "property",
    "propertyId",
    "createdAt",
    "updatedAt",
    "createdBy",
    "updatedBy",
]);

const FIELD_LABELS: Record<string, string> = {
    status: "Status",
    ownerNamePropertyInternalName: "Owner / Internal Name",
    serviceType: "Service Type",
    completeAddress: "Address",
    numberOfBedrooms: "Bedrooms",
    numberOfBathrooms: "Bathrooms",
    sqftOfHouse: "Sq Ft",
    availability: "Availability",
    onboardingRep: "Onboarding Rep",
    fullAddress: "Full Address",
    specialArrangementPreference: "Special Arrangement",
    isPropertyReadyCleaned: "Ready/Cleaned",
    scheduleInitialClean: "Initial Clean",
    propertyAccessInformation: "Access Info",
    cleaningClosetCodeLocation: "Cleaning Closet",
    trashScheduleInstructions: "Trash Schedule",
    suppliesToRestock: "Supplies to Restock",
    budget: "Budget",
    email: "Email",
    scopeOfWork: "Scope of Work",
    expectedTimeframe: "Expected Timeframe",
    itemsToRestock: "Items to Restock",
    isUrgent: "Urgent",
    approvedByClient: "Approved by Client",
    sendToAddress: "Send To Address",
    requestedBy: "Requested By",
    expenseId: "Expense Entry",
};

const normalizeHistoryValue = (value: unknown) => {
    if (value === undefined || value === null || value === "") return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
};

export class ServiceRequestHistoryService {
    private historyRepo = appDatabase.getRepository(ServiceRequestHistory);

    async recordCreate(requestType: ServiceRequestHistoryType, requestId: number, createdBy?: string | null) {
        await this.historyRepo.save(this.historyRepo.create({
            requestType,
            requestId,
            action: "created",
            fieldName: null,
            fieldLabel: null,
            fromValue: null,
            toValue: null,
            createdBy: createdBy || null,
        }));
    }

    async recordUpdate(requestType: ServiceRequestHistoryType, requestId: number, before: any, after: any, createdBy?: string | null) {
        const entries = Object.keys(after || {})
            .filter((fieldName) => !TECHNICAL_FIELDS.has(fieldName))
            .map((fieldName) => {
                const fromValue = normalizeHistoryValue(before?.[fieldName]);
                const toValue = normalizeHistoryValue(after?.[fieldName]);
                if (fromValue === toValue) return null;
                return this.historyRepo.create({
                    requestType,
                    requestId,
                    action: "updated",
                    fieldName,
                    fieldLabel: FIELD_LABELS[fieldName] || fieldName,
                    fromValue,
                    toValue,
                    createdBy: createdBy || null,
                });
            })
            .filter(Boolean) as ServiceRequestHistory[];

        if (entries.length) await this.historyRepo.save(entries);
    }

    async recordExpenseLink(requestId: number, expenseId: number, createdBy?: string | null) {
        await this.historyRepo.save(this.historyRepo.create({
            requestType: "itemSupply",
            requestId,
            action: "linked_expense",
            fieldName: "expenseId",
            fieldLabel: FIELD_LABELS.expenseId,
            fromValue: null,
            toValue: String(expenseId),
            createdBy: createdBy || null,
        }));
    }

    async getHistory(requestType: ServiceRequestHistoryType, requestId: number) {
        return this.historyRepo.find({
            where: { requestType, requestId },
            order: { createdAt: "DESC", id: "DESC" },
        });
    }
}

export const serviceRequestHistoryService = new ServiceRequestHistoryService();
