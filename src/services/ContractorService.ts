import { appDatabase } from "../utils/database.util";
import { Request } from "express";
import { ContractorEntity } from "../entity/ContractorInfo";
import { ExpenseEntity } from "../entity/Expense";

export class ContractorInfoService {
    private contractorInfoRepo = appDatabase.getRepository(ContractorEntity);
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);

    private normalizeName(name: string) {
        return String(name || "").trim();
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
        const { contractorName, contractorNumber } = request.body;

        const newContractor = new ContractorEntity();
        newContractor.contractorName = contractorName;
        newContractor.contractorNumber = contractorNumber;

        const contractor = await this.contractorInfoRepo.save(newContractor);
        return contractor;
    }

    async getContractors() {
        const contractors = await this.contractorInfoRepo.find({ order: { contractorName: "ASC" } });
        return await Promise.all(contractors.map(async (contractor) => ({
            ...contractor,
            ...(await this.getExpenseUsageByContractorName(contractor.contractorName)),
        })));
    }

    async updateContractorInfo(request: Request) {
        const contractorId = Number(request.params.id);
        const { contractorName, contractorNumber, updateExistingExpenses = true } = request.body;
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
            await this.expenseRepo
                .createQueryBuilder()
                .update(ExpenseEntity)
                .set({
                    contractorName: saved.contractorName,
                    contractorNumber: saved.contractorNumber,
                })
                .where("LOWER(TRIM(contractorName)) = LOWER(TRIM(:name))", { name: previousName })
                .execute();
        }

        return {
            ...saved,
            ...(await this.getExpenseUsageByContractorName(saved.contractorName)),
        };
    }

    async deleteContractorInfo(request: Request) {
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
