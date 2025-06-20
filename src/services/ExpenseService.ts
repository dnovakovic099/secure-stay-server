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
import { ListingDetail } from "../entity/ListingDetails";
import { ListingService } from "./ListingService";

export class ExpenseService {
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);
    private listingRepository = appDatabase.getRepository(Listing);
    private hostAwayClient = new HostAwayClient();
    private connectedAccountServices = new ConnectedAccountService();
    private mobileUserRepository = appDatabase.getRepository(MobileUsersEntity);
    private usersRepository = appDatabase.getRepository(UsersEntity);
    private listingDetailRepository = appDatabase.getRepository(ListingDetail);

    async createExpense(request: any, userId: string, fileNames?: string[]) {
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
            datePaid
        } = request.body;

        const negatedAmount = amount * (-1);

        const newExpense = new ExpenseEntity();
        newExpense.listingMapId = listingMapId;
        newExpense.expenseDate = expenseDate;
        newExpense.concept = concept;
        newExpense.amount = negatedAmount;
        newExpense.isDeleted = 0;
        newExpense.categories = categories;
        newExpense.contractorName = contractorName;
        newExpense.dateOfWork = dateOfWork;
        newExpense.contractorNumber = contractorNumber;
        newExpense.findings = findings;
        newExpense.userId = userId;
        newExpense.fileNames = fileNames ? JSON.stringify(fileNames) : "";
        newExpense.status = status;
        newExpense.paymentMethod = paymentMethod;
        newExpense.createdBy = userId;
        newExpense.datePaid = datePaid ? datePaid : "";

        const hostawayExpense = await this.createHostawayExpense({
            listingMapId,
            expenseDate,
            concept,
            amount: negatedAmount,
            categories: JSON.parse(categories),
        }, userId);

        if (!hostawayExpense) {
            throw new CustomErrorHandler(500, 'Failed to create expense');
        } 

        newExpense.expenseId = hostawayExpense?.id;
        const expense = await this.expenseRepo.save(newExpense);
        return expense;
    }

    private async createHostawayExpense(requestBody: {
        listingMapId: string;
        expenseDate: string;
        concept: string;
        amount: number;
        categories: string;
    }, userId: string) {
        // const { clientId, clientSecret } = await this.connectedAccountServices.getPmAccountInfo(userId);
        const clientId = process.env.HOST_AWAY_CLIENT_ID;
        const clientSecret = process.env.HOST_AWAY_CLIENT_SECRET;
        const hostawayExpense = await this.hostAwayClient.createExpense(requestBody, { clientId, clientSecret });
        return hostawayExpense;
    }

    private async getListingIdByTags(tags: number[]): Promise<number[]> {
        const listingService = new ListingService();
        const listings = await listingService.getListingsByTagIds(tags);

        const listingIds = listings.map(listing => listing.id);
        const distinctIds = Array.from(new Set(listingIds));

        return distinctIds;
    }


    async getExpenseList(request: Request, userId: string) {
        const {
            listingId,
            fromDate,
            toDate,
            status,
            categories: categoryIds,
            contractorName,
            expenseState,
            dateType,
            paymentMethod,
            tags
        } = request.query;
        const page = Number(request.query.page) || 1;
        const limit = Number(request.query.limit) || 10;
        const skip = (page - 1) * limit;        
        const categoriesFilter = categoryIds ? String(categoryIds).split(',').map(Number) : [];

        //fetch all the listingIds assciated with the tags
        const listingIdsFromTags = tags ? await this.getListingIdByTags(String(tags).split(',').map(Number)) : [];

        // Decide which listing IDs to use
        const effectiveListingIds =
            Array.isArray(listingId) && listingId.length > 0
                ? listingId.map(Number)
                : listingIdsFromTags;
        const [expenses, total] = await this.expenseRepo.findAndCount({
            where: {
                // userId,
                ...(effectiveListingIds.length > 0 && {
                    listingMapId: In(effectiveListingIds),
                }),
                [`${dateType}`]: Between(String(fromDate), String(toDate)),
                isDeleted: expenseState === "active" ? 0 : 1,
                ...(status !== "" && {
                    status: In(
                        status
                            ? [status]
                            : [ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE]
                    ),
                }),
                ...(paymentMethod !== "" && {
                    paymentMethod: In([paymentMethod])
                }),

                expenseId: Raw(alias => `${alias} IS NOT NULL`),
                ...(Array.isArray(contractorName) && contractorName.length > 0 && {
                    contractorName: In(contractorName),
                }),
                // ...(dateOfWork && { dateOfWork: String(dateOfWork) }),
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
            acc[listing.id] = listing.internalListingName;
            return acc;
        }, {});

        const categoryService = new CategoryService();
        const categories = await categoryService.getAllCategories();
        const users = await this.usersRepository.find();

        const data = expenses.map((expense) => {
            const fileLinks = expense.fileNames
                ? expense.fileNames.split(',').map(fileName => {
                    const cleanFileName = fileName.replace(/[\[\]"]/g, '');
                    return `${cleanFileName}`;
                }).join(', ')
                : '';

            const categoryNames = expense.categories
                ? expense.categories.split(',').map(id => {
                    const cleanId = id.replace(/[\[\]"]/g, '');
                    const category = categories.find(category => category.id === Number(cleanId));
                    return category ? category.categoryName : 'Unknown Category';
                }).join(', ')
                : '';

            const user = users.find(user => user.uid == expense.updatedBy);

            return {
                expenseId: expense.expenseId,
                status: expense.status,
                amount: Math.abs(expense.amount),
                listing: listingNameMap[expense.listingMapId] || 'N/A',
                dateAdded: expense.expenseDate,
                dateOfWork: expense.dateOfWork,
                datePaid: expense.datePaid,
                description: expense.concept,
                categories: categoryNames,
                contractorName: expense.contractorName,
                contractorNumber: expense.contractorNumber,
                findings: expense.findings,
                paymentMethod: expense.paymentMethod,
                createdAt: format(expense.createdAt, "yyyy-MM-dd"),
                updatedAt: format(expense.updatedAt, "yyyy-MM-dd"),
                updatedBy: user ? `${user.firstName} ${user.lastName}` : "",
                attachments: fileLinks,
            };
        });

        //calculate total expense filter values in given period of time without limit and page.
        const qb = this.expenseRepo
            .createQueryBuilder('expense')
            .select('SUM(ABS(expense.amount))', 'totalExpense')
            .where(`expense.${dateType} BETWEEN :fromDate AND :toDate`, { fromDate, toDate })
            .andWhere('expense.isDeleted = :isDeleted', { isDeleted: expenseState === "active" ? 0 : 1 })
            .andWhere('expense.expenseId IS NOT NULL');

        if (effectiveListingIds.length > 0) {
            qb.andWhere('expense.listingMapId IN (:...listingIds)', { listingIds: effectiveListingIds });
        }

        if (status !== "") {
            qb.andWhere('expense.status IN (:...statuses)', {
                statuses: [status],
            });
        }

        if (Array.isArray(contractorName) && contractorName.length > 0) {
            qb.andWhere('expense.contractorName IN (:...contractors)', { contractors: contractorName });
        }

        if (categoriesFilter.length > 0) {
            qb.andWhere(`JSON_EXTRACT(expense.categories, '$') REGEXP :regex`, {
                regex: categoriesFilter.join('|'),
            });
        }

        const { totalExpense } = await qb.getRawOne();


        return {
            data,
            totalExpense,
            total
        }
    }

    async getExpenseById(expenseId: number, userId: string) {
        const expense = await this.expenseRepo.findOne({ where: { expenseId: expenseId } });
        if (!expense) {
            throw CustomErrorHandler.notFound('Expense not found.');
        }
        expense.amount = Math.abs(expense.amount); // Ensure amount is positive for display
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

    async updateExpense(request: any, userId: string, fileNames?: string[]) {
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
            paymentMethod,
            datePaid
        } = request.body;

        const expense = await this.expenseRepo.findOne({ where: { expenseId: expenseId } });
        if (!expense) {
            throw CustomErrorHandler.notFound('Expense not found.');
        }

        const negatedAmount = amount * (-1);

        expense.listingMapId = listingMapId;
        expense.expenseDate = expenseDate;
        expense.concept = concept;
        expense.amount = negatedAmount;
        expense.categories = categories;
        expense.dateOfWork = dateOfWork;
        expense.contractorName = contractorName;
        expense.contractorNumber = contractorNumber;
        expense.findings = findings;
        expense.status = status;
        expense.paymentMethod = paymentMethod;
        expense.updatedBy = userId;
        expense.updatedAt = new Date();
        expense.datePaid = datePaid ? datePaid : "";
        if (fileNames && fileNames.length > 0) {
            expense.fileNames = JSON.stringify(fileNames);
        }

        //update hostaway expense
        const result = expense.expenseId && await this.updateHostawayExpense({
            listingMapId,
            expenseDate,
            concept,
            amount: negatedAmount,
            categories: JSON.parse(categories),
        }, userId, expense.expenseId);

        if(!result){
            throw new CustomErrorHandler(500,'Unable to update expense');
        }

        await this.expenseRepo.save(expense);
        return expense;
    }

    async updateExpenseStatus(request: Request, userId: string,) {
        const { expenseId, status, datePaid } = request.body;
        const expense = await this.expenseRepo.find({ where: { expenseId: In(expenseId) } });
        if (!expense) {
            throw CustomErrorHandler.notFound('Expense not found.');
        }

        expense.forEach((element) => {
            element.status = status;
            if (datePaid !== "") {
                element.datePaid = datePaid;
            }
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

        let totalExpense = filteredExpenses.reduce((sum, item) => sum + Math.abs(item.amount), 0) || 0;

        return { totalExpense };

    }

    public async getExpensesFromHostaway(clientId: string, clientSecret: string) {
        const expenses = await this.hostAwayClient.getExpenses(clientId, clientSecret);
        return expenses;
    }

    public async getExpense(id: number) {
        const expense = await this.expenseRepo.findOne({ where: { id } });
        expense.amount = Math.abs(expense.amount); // Ensure amount is positive for display
        return expense;
    }
}
