import { appDatabase } from "../utils/database.util";
import { ExpenseEntity } from "../entity/Expense";
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { ConnectedAccountInfo } from "../entity/ConnectedAccountInfo";
import { Between, In } from "typeorm";
import { Listing } from "../entity/Listing"

export class ExpenseService {
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);
    private connectedAccountInfoRepo = appDatabase.getRepository(ConnectedAccountInfo);
    private listingRepository = appDatabase.getRepository(Listing);
    private hostAwayClient = new HostAwayClient();

    async createExpense(request: Request, userId: string) {
        const {
            listingMapId,
            expenseDate,
            concept,
            amount,
            categories,
            categoriesNames,
            dateOfWork,
            workDone,
            contractorName
        } = request.body;


        const newExpense = new ExpenseEntity();
        newExpense.listingMapId = listingMapId;
        newExpense.expenseDate = expenseDate;
        newExpense.concept = concept;
        newExpense.amount = amount;
        newExpense.isDeleted = 0;
        newExpense.categories = JSON.stringify(categories);
        newExpense.categoriesNames = JSON.stringify(categoriesNames);
        newExpense.contractorName = contractorName;
        newExpense.dateOfWork = dateOfWork;
        newExpense.workDone = workDone;
        newExpense.userId = userId;

        const expense = await this.expenseRepo.save(newExpense);
        if (expense.id) {
            //create a new expense in hostaway
            const hostawayExpense = await this.createHostawayExpense({
                listingMapId,
                expenseDate,
                concept,
                amount,
                categories,
                categoriesNames,
                dateOfWork,
                workDone
            }, expense.id, userId);
            return hostawayExpense;
        }
    }

    private async createHostawayExpense(requestBody: {
        listingMapId: string;
        expenseDate: string;
        concept: string;
        amount: number;
        categories: string;
        categoriesNames: string;
        dateOfWork: string;
        workDone: string;
    }, id: number, userId: string) {
        const { clientId, clientSecret } = await this.connectedAccountInfoRepo.findOne({ where: { userId, account: "pm" } });
        const hostawayExpense = await this.hostAwayClient.createExpense(requestBody, { clientId, clientSecret });
        if (hostawayExpense) {
            //update the local db with the hostaway expense id
            const expense = await this.expenseRepo.findOne({ where: { id } });
            if (expense) {
                expense.expenseId = hostawayExpense.id;
                return await this.expenseRepo.save(expense);
            }
        }
    }

    async getExpenseList(request: Request, userId: string) {
        const { listingId, fromDate, toDate } = request.query;
        const expenses = await this.expenseRepo.find({
            where: {
                userId,
                ...(listingId && { listingMapId: Number(listingId) }),
                expenseDate: Between(String(fromDate), String(toDate)),
                isDeleted: 0,
            }
        });

        const listingMapIds = expenses
            .map(expense => expense.listingMapId)
            .filter((id, index, self) => id != null && self.indexOf(id) === index);

        const listings = await this.listingRepository.find({
            where: { id: In(listingMapIds) }
        });

        const listingNameMap = listings.reduce((acc, listing) => {
            acc[listing.id] = listing.name;
            return acc;
        }, {});

        const columns = [
            "Expense Id",
            "Listing",
            "Expense Date",
            "Concept",
            "Amount",
            "Catgories",
            "Contractor Name",
            "Date of Work",
            "Work Done",
        ];

        const rows = expenses.map((expense) => {
            return [
                expense.expenseId,
                listingNameMap[expense.listingMapId] || 'N/A', ,
                expense.expenseDate,
                expense.concept,
                expense.amount,
                expense.categoriesNames,
                expense.contractorName,
                expense.dateOfWork,
                expense.workDone
            ];
        });

        return {
            columns,
            rows
        };
    }

}
