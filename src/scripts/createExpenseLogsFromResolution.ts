import { In, IsNull, Not } from "typeorm";
import { ExpenseEntity, ExpenseStatus } from "../entity/Expense";
import { Resolution } from "../entity/Resolution";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { categoryIds, resolutionCategoryMappings } from "../constant";

export const createExpenseLogsFromResolution = async () => {
    try {
        logger.info("Creating expense logs from resolutions...");

        const resolutionRepository = appDatabase.getRepository(Resolution);
        const expenseRepository = appDatabase.getRepository(ExpenseEntity);

        //fetch the expenses with resolutionId not null
        const expenses = await expenseRepository.find({ where: { resolutionId: Not(IsNull()) } });
        const resolutionIds = expenses.map(expense => expense.resolutionId);

        //fetch resolutions which do not have corresponding expense logs
        const resolutions = await resolutionRepository.find({
            where: {
                id: Not(In(resolutionIds))
            }
        });

        const totalResolutions = resolutions.length;
        logger.info(`Total resolutions found without expense logs: ${totalResolutions}`);
        const failedResolutions: number[] = [];
        const succeededResolutions: number[] = [];

        for (const resolution of resolutions) {

            try {
                const category = resolutionCategoryMappings.find(cat => cat.name === resolution.category)?.value;
                const categories = category ? JSON.stringify([category]) : JSON.stringify([categoryIds.Resolutions]);

                const newExpense = new ExpenseEntity();
                newExpense.listingMapId = resolution.listingMapId;
                newExpense.expenseDate = resolution.claimDate;
                newExpense.concept = resolution.type ? `${resolution.type} : ${resolution.guestName}` : `${resolution.guestName}`;
                newExpense.amount = resolution.amountToPayout ? resolution.amountToPayout : resolution.amount;
                newExpense.isDeleted = 0;
                newExpense.categories = categories;
                newExpense.contractorName = "";
                newExpense.findings = resolution.description ? resolution.description : null;
                newExpense.userId = "system";
                newExpense.fileNames = "";
                newExpense.status = ExpenseStatus.NA;
                newExpense.reservationId = String(resolution.reservationId);
                newExpense.guestName = resolution.guestName;
                newExpense.resolutionId = resolution.id;

                await expenseRepository.save(newExpense);

                succeededResolutions.push(resolution.id);
            } catch (error) {
                logger.error(`Error creating expense log for Resolution ID: ${resolution.id}`, error);
                failedResolutions.push(resolution.id);
                continue; // Proceed to the next resolution
            }
            logger.info(`Created expense log for Resolution ID: ${resolution.id}`);
        }

        logger.info("Expense logs creation from resolutions completed.");
    } catch (error) {
        logger.error("Error creating expense logs from resolutions:", error);
    }
};