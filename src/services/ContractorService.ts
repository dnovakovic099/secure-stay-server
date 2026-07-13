import { appDatabase } from "../utils/database.util";
import { Request } from "express";
import { ContractorEntity } from "../entity/ContractorInfo";
import { ExpenseEntity } from "../entity/Expense";
import { VendorProfile } from "../entity/VendorProfile";

export class ContractorInfoService {
    private contractorInfoRepo = appDatabase.getRepository(ContractorEntity);
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);
    private vendorProfileRepo = appDatabase.getRepository(VendorProfile);
    private static schemaReady = false;

    private normalizeName(name: string) {
        return String(name || "").trim();
    }

    private normalizeKey(name: string) {
        return this.normalizeName(name).toLowerCase();
    }

    private async ensureContractorSchema() {
        if (ContractorInfoService.schemaReady) return;
        await appDatabase.query(`
            ALTER TABLE contractor_info
            ADD COLUMN IF NOT EXISTS vendorProfileId INT NULL
        `).catch(async () => {
            const columns = await appDatabase.query("SHOW COLUMNS FROM contractor_info LIKE 'vendorProfileId'");
            if (!columns?.length) {
                await appDatabase.query("ALTER TABLE contractor_info ADD COLUMN vendorProfileId INT NULL");
            }
        });
        ContractorInfoService.schemaReady = true;
    }

    private async getExpenseUsageByContractorName(name: string) {
        const normalizedName = this.normalizeName(name);
        if (!normalizedName) return { totalExpenseCount: 0, activeExpenseCount: 0, totalExpenseAmount: 0, lastExpenseDate: null };

        const result = await this.expenseRepo
            .createQueryBuilder("expense")
            .select("COUNT(expense.id)", "totalExpenseCount")
            .addSelect("SUM(CASE WHEN expense.isDeleted = 0 THEN 1 ELSE 0 END)", "activeExpenseCount")
            .addSelect("COALESCE(SUM(expense.amount), 0)", "totalExpenseAmount")
            .addSelect("MAX(expense.createdAt)", "lastExpenseDate")
            .where("LOWER(TRIM(expense.contractorName)) = LOWER(TRIM(:name))", { name: normalizedName })
            .getRawOne();

        return {
            totalExpenseCount: Number(result?.totalExpenseCount || 0),
            activeExpenseCount: Number(result?.activeExpenseCount || 0),
            totalExpenseAmount: Number(result?.totalExpenseAmount || 0),
            lastExpenseDate: result?.lastExpenseDate || null,
        };
    }

    async saveContractorInfo(request: Request) {
        await this.ensureContractorSchema();
        const { contractorName, contractorNumber } = request.body;

        const newContractor = new ContractorEntity();
        newContractor.contractorName = contractorName;
        newContractor.contractorNumber = contractorNumber;

        const contractor = await this.contractorInfoRepo.save(newContractor);
        return contractor;
    }

    async getContractors() {
        await this.ensureContractorSchema();
        const contractors = await this.contractorInfoRepo.find({ order: { contractorName: "ASC" } });
        const knownContractorNames = new Set(contractors.map((contractor) => this.normalizeKey(contractor.contractorName)));

        const expenseUsageRows = await this.expenseRepo
            .createQueryBuilder("expense")
            .select("LOWER(TRIM(expense.contractorName))", "contractorKey")
            .addSelect("MIN(TRIM(expense.contractorName))", "contractorName")
            .addSelect("MAX(NULLIF(TRIM(expense.contractorNumber), ''))", "contractorNumber")
            .addSelect("COUNT(expense.id)", "totalExpenseCount")
            .addSelect("SUM(CASE WHEN expense.isDeleted = 0 THEN 1 ELSE 0 END)", "activeExpenseCount")
            .addSelect("COALESCE(SUM(expense.amount), 0)", "totalExpenseAmount")
            .addSelect("MAX(expense.createdAt)", "lastExpenseDate")
            .where("expense.contractorName IS NOT NULL")
            .andWhere("TRIM(expense.contractorName) != ''")
            .groupBy("LOWER(TRIM(expense.contractorName))")
            .getRawMany();

        const usageByKey = new Map<string, {
            contractorName: string;
            contractorNumber: string | null;
            totalExpenseCount: number;
            activeExpenseCount: number;
            totalExpenseAmount: number;
            lastExpenseDate: string | null;
        }>();
        for (const row of expenseUsageRows) {
            usageByKey.set(row.contractorKey, {
                contractorName: row.contractorName,
                contractorNumber: row.contractorNumber || null,
                totalExpenseCount: Number(row.totalExpenseCount || 0),
                activeExpenseCount: Number(row.activeExpenseCount || 0),
                totalExpenseAmount: Number(row.totalExpenseAmount || 0),
                lastExpenseDate: row.lastExpenseDate || null,
            });
        }

        for (const [contractorKey, usage] of usageByKey) {
            const contractorName = this.normalizeName(usage.contractorName);
            if (!contractorName || knownContractorNames.has(contractorKey)) continue;

            const contractor = new ContractorEntity();
            contractor.contractorName = contractorName;
            contractor.contractorNumber = usage.contractorNumber || null;
            contractors.push(await this.contractorInfoRepo.save(contractor));
            knownContractorNames.add(contractorKey);
        }

        contractors.sort((a, b) => String(a.contractorName || "").localeCompare(String(b.contractorName || ""), undefined, { sensitivity: "base" }));

        const vendorIds = contractors.map((contractor) => contractor.vendorProfileId).filter((id): id is number => Boolean(id));
        const vendors = vendorIds.length
            ? await this.vendorProfileRepo.createQueryBuilder("vendor").where("vendor.id IN (:...vendorIds)", { vendorIds }).getMany()
            : [];
        const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor]));

        return contractors.map((contractor) => {
            const vendorProfile = contractor.vendorProfileId ? vendorById.get(contractor.vendorProfileId) : null;
            const usage = usageByKey.get(this.normalizeKey(contractor.contractorName));
            return {
                ...contractor,
                vendorProfile: vendorProfile ? {
                    id: vendorProfile.id,
                    name: vendorProfile.name,
                    contact: vendorProfile.contact,
                    companyName: vendorProfile.companyName,
                } : null,
                totalExpenseCount: usage?.totalExpenseCount ?? 0,
                activeExpenseCount: usage?.activeExpenseCount ?? 0,
                totalExpenseAmount: usage?.totalExpenseAmount ?? 0,
                lastExpenseDate: usage?.lastExpenseDate ?? null,
            };
        });
    }

    async updateContractorInfo(request: Request) {
        await this.ensureContractorSchema();
        const contractorId = Number(request.params.id);
        const { contractorName, contractorNumber, updateExistingExpenses = true, syncVendorProfile = true } = request.body;
        const contractor = await this.contractorInfoRepo.findOne({ where: { id: contractorId } });

        if (!contractor) {
            throw new Error("Contractor not found");
        }

        const previousName = contractor.contractorName;
        const nextName = this.normalizeName(contractorName);
        contractor.contractorName = nextName;
        contractor.contractorNumber = contractorNumber || null;

        const saved = await this.contractorInfoRepo.save(contractor);

        if (updateExistingExpenses && previousName) {
            await this.updateExpensesForContractor(previousName, saved.contractorName, saved.contractorNumber);
        }

        if (syncVendorProfile && saved.vendorProfileId) {
            await this.vendorProfileRepo.update(saved.vendorProfileId, {
                name: saved.contractorName,
                contact: saved.contractorNumber || null,
            });
        }

        return {
            ...saved,
            vendorProfile: saved.vendorProfileId ? await this.getVendorSummary(saved.vendorProfileId) : null,
            ...(await this.getExpenseUsageByContractorName(saved.contractorName)),
        };
    }

    async mapContractorToVendorProfile(request: Request) {
        await this.ensureContractorSchema();
        const contractorId = Number(request.params.id);
        const {
            vendorProfileId,
            keepNameFrom = "contractor",
            keepPhoneFrom = "contractor",
            updateExistingExpenses = true,
        } = request.body;
        const contractor = await this.contractorInfoRepo.findOne({ where: { id: contractorId } });
        if (!contractor) throw new Error("Contractor not found");

        const vendor = await this.vendorProfileRepo.findOne({ where: { id: Number(vendorProfileId) } });
        if (!vendor) throw new Error("Vendor profile not found");

        const previousName = contractor.contractorName;
        const nextName = keepNameFrom === "vendor" ? this.normalizeName(vendor.name) : this.normalizeName(contractor.contractorName);
        const nextPhone = keepPhoneFrom === "vendor" ? (vendor.contact || null) : (contractor.contractorNumber || null);

        contractor.vendorProfileId = vendor.id;
        contractor.contractorName = nextName;
        contractor.contractorNumber = nextPhone;
        const saved = await this.contractorInfoRepo.save(contractor);

        await this.vendorProfileRepo.update(vendor.id, {
            name: nextName,
            contact: nextPhone,
        });

        if (updateExistingExpenses && previousName) {
            await this.updateExpensesForContractor(previousName, nextName, nextPhone);
        }

        return {
            ...saved,
            vendorProfile: await this.getVendorSummary(vendor.id),
            ...(await this.getExpenseUsageByContractorName(saved.contractorName)),
        };
    }

    async syncVendorProfileToContractors(
        vendorProfileId: number,
        nextName: string,
        nextPhone: string | null,
        updateExistingExpenses = true,
    ) {
        await this.ensureContractorSchema();
        const contractors = await this.contractorInfoRepo.find({ where: { vendorProfileId } });
        for (const contractor of contractors) {
            const previousName = contractor.contractorName;
            contractor.contractorName = this.normalizeName(nextName);
            contractor.contractorNumber = nextPhone || null;
            await this.contractorInfoRepo.save(contractor);
            if (updateExistingExpenses && previousName) {
                await this.updateExpensesForContractor(previousName, contractor.contractorName, contractor.contractorNumber);
            }
        }
        return contractors.length;
    }

    private async updateExpensesForContractor(previousName: string, contractorName: string, contractorNumber: string | null) {
        await this.expenseRepo
            .createQueryBuilder()
            .update(ExpenseEntity)
            .set({
                contractorName,
                contractorNumber,
            })
            .where("LOWER(TRIM(contractorName)) = LOWER(TRIM(:name))", { name: previousName })
            .execute();
    }

    private async getVendorSummary(vendorProfileId: number) {
        const vendor = await this.vendorProfileRepo.findOne({ where: { id: vendorProfileId } });
        return vendor ? {
            id: vendor.id,
            name: vendor.name,
            contact: vendor.contact,
            companyName: vendor.companyName,
        } : null;
    }

    async deleteContractorInfo(request: Request) {
        await this.ensureContractorSchema();
        const contractorId = Number(request.params.id);
        const { replacementContractorId, replacementContractorName, replacementContractorNumber } = request.body;
        const contractor = await this.contractorInfoRepo.findOne({ where: { id: contractorId } });

        if (!contractor) {
            throw new Error("Contractor not found");
        }

        const usage = await this.getExpenseUsageByContractorName(contractor.contractorName);
        let replacement: ContractorEntity | null = null;

        if (usage.totalExpenseCount > 0) {
            if (replacementContractorId) {
                replacement = await this.contractorInfoRepo.findOne({ where: { id: Number(replacementContractorId) } });
            } else if (replacementContractorName) {
                replacement = new ContractorEntity();
                replacement.contractorName = this.normalizeName(replacementContractorName);
                replacement.contractorNumber = replacementContractorNumber || null;
                replacement = await this.contractorInfoRepo.save(replacement);
            }

            if (!replacement) {
                throw new Error("This contractor has associated expenses. Select or create a replacement contractor before deleting.");
            }

            await this.expenseRepo
                .createQueryBuilder()
                .update(ExpenseEntity)
                .set({
                    contractorName: replacement.contractorName,
                    contractorNumber: replacement.contractorNumber,
                })
                .where("LOWER(TRIM(contractorName)) = LOWER(TRIM(:name))", { name: contractor.contractorName })
                .execute();
        }

        await this.contractorInfoRepo.delete(contractorId);

        return {
            message: "Contractor deleted successfully",
            movedExpenseCount: usage.totalExpenseCount,
            replacementContractor: replacement,
        };
    }

    async mergeContractors(request: Request) {
        await this.ensureContractorSchema();
        const { sourceContractorIds, targetContractorId } = request.body;
        const target = await this.contractorInfoRepo.findOne({ where: { id: Number(targetContractorId) } });

        if (!target) {
            throw new Error("Target contractor not found");
        }

        const sourceIds = Array.from(new Set((sourceContractorIds || []).map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id !== target.id)));
        const sources = sourceIds.length
            ? await this.contractorInfoRepo.createQueryBuilder("contractor").where("contractor.id IN (:...sourceIds)", { sourceIds }).getMany()
            : [];

        let movedExpenseCount = 0;
        for (const source of sources) {
            const usage = await this.getExpenseUsageByContractorName(source.contractorName);
            movedExpenseCount += usage.totalExpenseCount;
            await this.expenseRepo
                .createQueryBuilder()
                .update(ExpenseEntity)
                .set({
                    contractorName: target.contractorName,
                    contractorNumber: target.contractorNumber,
                })
                .where("LOWER(TRIM(contractorName)) = LOWER(TRIM(:name))", { name: source.contractorName })
                .execute();
        }

        if (sourceIds.length) {
            await this.contractorInfoRepo.createQueryBuilder().delete().where("id IN (:...sourceIds)", { sourceIds }).execute();
        }

        return {
            message: "Contractors merged successfully",
            movedExpenseCount,
            targetContractor: {
                ...target,
                ...(await this.getExpenseUsageByContractorName(target.contractorName)),
            },
        };
    }

}
