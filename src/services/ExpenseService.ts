import { appDatabase } from "../utils/database.util";
import { ExpenseEntity, ExpenseStatus } from "../entity/Expense";
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { Between, In, Raw } from "typeorm";
import { Listing } from "../entity/Listing";
import { CategoryService } from "./CategoryService";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ConnectedAccountService } from "./ConnectedAccountService";
import { MobileUsersEntity } from "../entity/MoblieUsers";
import { format } from 'date-fns';
import { UsersEntity } from "../entity/Users";

export class ExpenseService {
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);
    private listingRepository = appDatabase.getRepository(Listing);
    private hostAwayClient = new HostAwayClient();
    private connectedAccountServices = new ConnectedAccountService();
    private mobileUserRepository = appDatabase.getRepository(MobileUsersEntity);
    private usersRepository = appDatabase.getRepository(UsersEntity);

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
            status,
            paymentMethod,
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
        newExpense.paymentMethod = paymentMethod;
        newExpense.createdBy = userId;

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
        const { clientId, clientSecret } = await this.connectedAccountServices.getPmAccountInfo(userId);
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
        const {
            listingId,
            fromDate,
            toDate,
            status,
            categories: categoryIds,
            contractorName,
            contractorNumber,
            dateOfWork,
            expenseState
        } = request.query;
        const page = Number(request.query.page) || 1;
        const limit = Number(request.query.limit) || 10;
        const skip = (page - 1) * limit;

        const categoriesFilter = categoryIds ? String(categoryIds).split(',').map(Number) : [];

        const expenses = await this.expenseRepo.find({
            where: {
                // userId,
                ...(listingId && { listingMapId: Number(listingId) }),
                expenseDate: Between(String(fromDate), String(toDate)),
                isDeleted: expenseState == "active" ? 0 : 1,
                ...(status !== "" && { status: In(status ? [status] : [ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE]) }),
                expenseId: Raw(alias => `${alias} IS NOT NULL`),
                ...(contractorName && {
                    contractorName: Raw(alias => `${alias} LIKE :contractorName`, {
                        contractorName: `${contractorName}%`
                    })
                }),
                ...(contractorNumber && {
                    contractorNumber: Raw(alias => `${alias} LIKE :contractorNumber`, {
                        contractorNumber: `${contractorNumber}%`
                    })
                }),
                ...(dateOfWork && { dateOfWork: String(dateOfWork) }),
                ...(categoriesFilter.length > 0 && {
                    categories: Raw(alias => `JSON_EXTRACT(${alias}, '$') REGEXP '${categoriesFilter.join('|')}'`)
                }),
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
            "Expense Id",
            "Status",
            "Amount",
            "Address",
            "Expense Date",
            "Description",
            "Catgories",
            "Contractor Name",
            "Contractor Number",
            "Findings",
            "Payment Method",
            "Created At",
            "Updated At",
            "Updated By",
            "Attachments",
        ];

        const categoryService = new CategoryService();
        const categories = await categoryService.getAllCategories();
        const users = await this.usersRepository.find();

        const rows = expenses.map((expense) => {
            const fileLinks = expense.fileNames
                ? expense.fileNames.split(',').map(fileName => {
                    // Strip unwanted quotes and brackets and return a proper link
                    const cleanFileName = fileName.replace(/[\[\]"]/g, '');
                    return `${cleanFileName}`;
                }).join(', ')
                : '';

            const categoryNames = expense.categories
                ? expense.categories.split(',').map(id => {
                    const cleanId = id.replace(/[\[\]"]/g, '');
                    // Find the category name matching the cleaned ID
                    const category = categories.find(category => category.id === Number(cleanId));

                    // Return the category name if found, otherwise return a placeholder
                    return category ? category.categoryName : 'Unknown Category';
                }).join(', ')
                : '';

            const user = users.find(user => user.uid == expense.updatedBy);

            return [
                expense.expenseId,
                expense.status,
                expense.amount,
                listingNameMap[expense.listingMapId] || 'N/A',
                expense.expenseDate,
                expense.concept,
                categoryNames,
                expense.contractorName,
                expense.contractorNumber,
                expense.findings,
                expense.paymentMethod,
                format(expense.createdAt, "yyyy-MM-dd"),
                format(expense.updatedAt, "yyyy-MM-dd"),
                (user && `${user?.firstName} ${user?.lastName}`) || "",
                fileLinks,
            ];
        });

        return {
            columns,
            rows
        };
    }

    async getExpenseById(expenseId: number, userId: string) {
        const expense = await this.expenseRepo.findOne({ where: { expenseId: expenseId } });
        if (!expense) {
            throw CustomErrorHandler.notFound('Expense not found.');
        }
        return expense;
    }

    async getExpenses(fromDate: string, toDate: string, listingId: number) {
        const expense = await this.expenseRepo.find({
            where: {
                listingMapId: listingId,
                expenseDate: Between(fromDate, toDate),
                isDeleted: 0,
            },
            order: { id: "DESC" },
        });
        return expense;
    }

    async updateExpense(request: Request, userId: string, fileNames?: string[]) {
        const {
            expenseId,
            listingMapId,
            expenseDate,
            concept,
            amount,
            categories,
            dateOfWork,
            contractorName,
            contractorNumber,
            findings,
            status,
            paymentMethod
        } = request.body;

        const expense = await this.expenseRepo.findOne({ where: { expenseId: expenseId } });
        if (!expense) {
            throw CustomErrorHandler.notFound('Expense not found.');
        }
        expense.listingMapId = listingMapId;
        expense.expenseDate = expenseDate;
        expense.concept = concept;
        expense.amount = amount;
        expense.categories = categories;
        expense.dateOfWork = dateOfWork;
        expense.contractorName = contractorName;
        expense.contractorNumber = contractorNumber;
        expense.findings = findings;
        expense.status = status;
        expense.paymentMethod = paymentMethod;
        expense.updatedBy = userId;
        expense.updatedAt = new Date();

        if (fileNames.length > 0) {
            expense.fileNames = JSON.stringify(fileNames);
        }

        await this.expenseRepo.save(expense);

        //update hostaway expense
        expense.expenseId && this.updateHostawayExpense({
            listingMapId,
            expenseDate,
            concept,
            amount,
            categories,
        }, userId, expense.expenseId);

        return expense;
    }

    async updateExpenseStatus(request: Request, userId: string,) {
        const { expenseId, status } = request.body;
        const expense = await this.expenseRepo.find({ where: { expenseId: In(expenseId) } });
        if (!expense) {
            throw CustomErrorHandler.notFound('Expense not found.');
        }

        expense.forEach((element) => {
            element.status = status;
            element.updatedBy = userId;
            element.updatedAt = new Date();
        });
        await this.expenseRepo.save(expense);
        
        return expense;
    }

    async deleteExpense(expenseId: number, userId: string) {
        const expense = await this.expenseRepo.findOne({ where: { expenseId: expenseId } });
        if (!expense) {
            throw CustomErrorHandler.notFound('Expense not found.');
        }

        expense.isDeleted = 1;
        expense.updatedBy = userId;
        expense.updatedAt = new Date();
        await this.expenseRepo.save(expense);

        //delete hostaway expense
        expense.expenseId && this.deleteHostawayExpense(expense.expenseId, userId);

        return expense;
    }

    private async deleteHostawayExpense(expenseId: number, userId: string) {
        const { clientId, clientSecret } = await this.connectedAccountServices.getPmAccountInfo(userId);
        await this.hostAwayClient.deleteExpense(expenseId, clientId, clientSecret);
    }

    private async updateHostawayExpense(requestBody: {
        listingMapId: string;
        expenseDate: string;
        concept: string;
        amount: number;
        categories: string;
    }, userId: string, expenseId: number) {
        const { clientId, clientSecret } = await this.connectedAccountServices.getPmAccountInfo(userId);
        const hostawayExpense = await this.hostAwayClient.updateExpense(requestBody, { clientId, clientSecret }, expenseId);
        return hostawayExpense;
    }

    public async getTotalExpenseByUserId(userId: number, listingId: number | null) {

        const mobileUser = await this.mobileUserRepository.findOne({ where: { id: userId } });
        if (!mobileUser) {
            throw CustomErrorHandler.notFound('User not found');
        }

        const { clientId, clientSecret } = await this.connectedAccountServices.getPmAccountInfo(mobileUser.user_id);

        //fetch listings by hostaway user id
        let listings = await this.hostAwayClient.getListingByUserId(mobileUser.hostawayId, clientId, clientSecret);
        if (listingId) {
            listings = listings.filter(listing => listing.id === listingId);
        }

        //fetch expenses from hostaway
        const expenses = await this.hostAwayClient.getExpenses(clientId, clientSecret);

        //filter expenses by listing map id
        const filteredExpenses = expenses.filter(expense => listings.some(listing => expense.listingMapId === listing.id));

        let totalExpense = filteredExpenses.reduce((sum, item) => sum + item.amount, 0) || 0;

        return { totalExpense };

    }

    public async getExpensesFromHostaway(clientId: string, clientSecret: string) {
        const expenses = await this.hostAwayClient.getExpenses(clientId, clientSecret);
        return expenses;
    }
}
