import { appDatabase } from "../utils/database.util";
import { ExpenseEntity, ExpenseStatus } from "../entity/Expense";
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { ConnectedAccountInfo } from "../entity/ConnectedAccountInfo";
import { Between, In } from "typeorm";
import { Listing } from "../entity/Listing"
import { CategoryService } from "./CategoryService";

export class ExpenseService {
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);
    private connectedAccountInfoRepo = appDatabase.getRepository(ConnectedAccountInfo);
    private listingRepository = appDatabase.getRepository(Listing);
    private hostAwayClient = new HostAwayClient();

    async createExpense(request: Request, userId: string, fileNames?: string[]) {
        const {
            listingMapId,
            expenseDate,
            concept,
            amount,
            categories,
            dateOfWork,
            contractorName,
            contractorNumber,
            findings,
            status
        } = request.body;


        const newExpense = new ExpenseEntity();
        newExpense.listingMapId = listingMapId;
        newExpense.expenseDate = expenseDate;
        newExpense.concept = concept;
        newExpense.amount = amount;
        newExpense.isDeleted = 0;
        newExpense.categories = JSON.stringify(categories);
        newExpense.contractorName = contractorName;
        newExpense.dateOfWork = dateOfWork;
        newExpense.contractorNumber = contractorNumber;
        newExpense.findings = findings;
        newExpense.userId = userId;
        newExpense.fileNames = fileNames ? JSON.stringify(fileNames) : "";
        newExpense.status = status;

        const expense = await this.expenseRepo.save(newExpense);
        if (expense.id) {
            //create a new expense in hostaway
            const hostawayExpense = await this.createHostawayExpense({
                listingMapId,
                expenseDate,
                concept,
                amount,
                categories,
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
        const { listingId, fromDate, toDate, status } = request.query;
        const page = Number(request.query.page) || 1;
        const limit = Number(request.query.limit) || 10;
        const skip = (page - 1) * limit;

        const expenses = await this.expenseRepo.find({
            where: {
                userId,
                ...(listingId && { listingMapId: Number(listingId) }),
                expenseDate: Between(String(fromDate), String(toDate)),
                isDeleted: 0,
                status: In(status ? [status] : [ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE]),
            },
            order: { id: "DESC" },
            skip,
            take: limit,
        });

        const listingMapIds = expenses
            .map(expense => expense.listingMapId)
            .filter((id, index, self) => id != null && self.indexOf(id) === index);

        const listings = await this.listingRepository.find({
            where: { id: In(listingMapIds) }
        });

        const listingNameMap = listings.reduce((acc, listing) => {
            acc[listing.id] = listing.address;
            return acc;
        }, {});

        const columns = [
            "Status",
            "Expense Id",
            "Address",
            "Expense Date",
            "Concept",
            "Amount",
            "Catgories",
            "Contractor Name",
            "Contractor Number",
            "Findings",
            "Attachments"
        ];

        const categoryService = new CategoryService();
        const categories = await categoryService.getAllCategories();

        const rows = expenses.map((expense) => {
            const fileLinks = expense.fileNames
                ? expense.fileNames.split(',').map(fileName => {
                    // Strip unwanted quotes and brackets and return a proper link
                    const cleanFileName = fileName.replace(/[\[\]"]/g, '');
                    return `${cleanFileName}`;
                }).join(', ')
                : '';

            const categoryNames = expense.fileNames
                ? expense.categories.split(',').map(id => {
                    const cleanId = id.replace(/[\[\]"]/g, '');
                    // Find the category name matching the cleaned ID
                    const category = categories.find(category => category.id === Number(cleanId));

                    // Return the category name if found, otherwise return a placeholder
                    return category ? category.categoryName : 'Unknown Category';
                }).join(', ')
                : '';

            return [
                expense.status,
                expense.expenseId,
                listingNameMap[expense.listingMapId] || 'N/A',
                expense.expenseDate,
                expense.concept,
                expense.amount,
                categoryNames,
                expense.contractorName,
                expense.contractorNumber,
                expense.findings,
                fileLinks
        ];
        });

        return {
            columns,
            rows
        };
    }
}
