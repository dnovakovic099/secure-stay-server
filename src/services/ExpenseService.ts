import { appDatabase } from "../utils/database.util";
import { ExpenseEntity, ExpenseStatus } from "../entity/Expense";
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { Between, ILike, In, IsNull, MoreThan, Not, Raw } from "typeorm";
import { Listing } from "../entity/Listing";
import { CategoryService } from "./CategoryService";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ConnectedAccountService } from "./ConnectedAccountService";
import { MobileUsersEntity } from "../entity/MoblieUsers";
import { format } from 'date-fns';
import { UsersEntity } from "../entity/Users";
import { ListingDetail } from "../entity/ListingDetails";
import { ListingService } from "./ListingService";
import { CategoryEntity } from "../entity/Category";
import logger from "../utils/logger.utils";
import { haExpenseUpdateQueue } from "../queue/haQueue";
import { FileInfo } from "../entity/FileInfo";
import { IssuesService } from "./IssuesService";

interface ExpenseBulkUpdateObject {
    expenseDate: string;
    dateOfWork: string;
    status: ExpenseStatus;
    paymentMethod: string;
    categories: string;
    concept: string;
    listingMapId: number;
    amount: number;
    expenseId: number[];
    contractorName?: string;
    contractorNumber?: string;
    findings?: string;
    datePaid?: string;
}

export class ExpenseService {
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);
    private listingRepository = appDatabase.getRepository(Listing);
    private hostAwayClient = new HostAwayClient();
    private connectedAccountServices = new ConnectedAccountService();
    private mobileUserRepository = appDatabase.getRepository(MobileUsersEntity);
    private usersRepository = appDatabase.getRepository(UsersEntity);
    private fileInfoRepo = appDatabase.getRepository(FileInfo);
    private categoryRepo = appDatabase.getRepository(CategoryEntity);

    async createExpense(request: any, userId: string, fileInfo?: { fileName: string, filePath: string, mimeType: string; originalName: string; }[]) {
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
            datePaid,
            issues
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
        newExpense.fileNames = fileInfo ? JSON.stringify(fileInfo.map(file => file.fileName)) : "";
        newExpense.status = status;
        newExpense.paymentMethod = paymentMethod;
        newExpense.createdBy = userId;
        newExpense.datePaid = datePaid ? datePaid : "";
        newExpense.issues = issues ? issues : null;

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
        if (fileInfo) {
            for (const file of fileInfo) {
                const fileRecord = new FileInfo();
                fileRecord.entityType = 'expense';
                fileRecord.entityId = expense.id;
                fileRecord.fileName = file.fileName;
                fileRecord.createdBy = userId;
                fileRecord.localPath = file.filePath;
                fileRecord.mimetype = file.mimeType;
                fileRecord.originalName = file.originalName;
                await this.fileInfoRepo.save(fileRecord);
            }
        }
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
            tags,
            propertyType,
            keyword, 
            expenseId
        } = request.query;
        const page = Number(request.query.page) || 1;
        const limit = Number(request.query.limit) || 10;
        const skip = (page - 1) * limit;
        const categoriesFilter = categoryIds ? String(categoryIds).split(',').map(Number) : [];

        // expenseId filter
        const expenseIds = expenseId
            ? (Array.isArray(expenseId) ? expenseId.map(String) : String(expenseId).split(','))
            : [];

        // fetch all the listingIds associated with the tags
        const listingIdsFromTags = tags ? await this.getListingIdByTags(String(tags).split(',').map(Number)) : [];

        let listingIds = [];
        const listingService = new ListingService();

        if (propertyType && Array.isArray(propertyType)) {
            listingIds = (await listingService.getListingsByTagIds(propertyType as any)).map(l => l.id);
        } else {
            listingIds = Array.isArray(listingId) ? listingId.map(Number) : [];
        }

        // Decide which listing IDs to use
        const effectiveListingIds =
            Array.isArray(listingId) && listingId.length > 0
                ? listingId.map(Number)
                : listingIdsFromTags;

        const [expenses, total] = await this.expenseRepo.findAndCount({
            where: keyword
                ? [
                    { contractorNumber: ILike(`%${keyword}%`) },
                    { contractorName: ILike(`%${keyword}%`) },
                    { paymentMethod: ILike(`%${keyword}%`) },
                    { concept: ILike(`%${keyword}%`) },
                ]
                :
                {
                    ...(effectiveListingIds.length > 0 && {
                        listingMapId: In(effectiveListingIds),
                    }),
                    ...(listingIds && listingIds.length > 0 && { listingMapId: In(listingIds) }),
                    [`${dateType}`]: Between(String(fromDate), String(toDate)),
                    ...(expenseState && { isDeleted: expenseState === "active" ? 0 : 1 }),
                    ...(Array.isArray(status) && status.length > 0 && {
                        status: In(status),
                    }),
                    ...(Array.isArray(paymentMethod) && paymentMethod.length > 0 && {
                        paymentMethod: In(paymentMethod),
                    }),
                    ...(expenseIds.length > 0
                        ? { expenseId: In(expenseIds) }
                        : { expenseId: Raw(alias => `${alias} IS NOT NULL`) }),
                    ...(Array.isArray(contractorName) && contractorName.length > 0 && {
                        contractorName: In(contractorName),
                    }),
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
        }, {} as Record<number, string>);

        const categoryService = new CategoryService();
        const categories = await categoryService.getAllCategories();
        const users = await this.usersRepository.find();
        const fileInfoList = await this.fileInfoRepo.find({ where: { entityType: 'expense' } });

        const issueService = new IssuesService();

        const data = await Promise.all(
            expenses.map(async (expense) => {
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

                const issueIds = expense.issues ? JSON.parse(expense.issues) : [];
                let issueList = [];
                if (issueIds.length > 0) {
                    const { issues } = await issueService.getGuestIssues(
                        { issueId: issueIds, page: 1, limit: 50 },
                        userId
                    );
                    issueList = issues;
                }

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
                    fileInfo: fileInfoList.filter(file => file.entityId === expense.id),
                    issues: issueIds,
                    issuesList: issueList,
                };
            })
        );

        // calculate total expense filter values in given period of time without limit and page
        const qb = this.expenseRepo
            .createQueryBuilder('expense')
            .select('SUM(ABS(expense.amount))', 'totalExpense')
            .where(`expense.${dateType} BETWEEN :fromDate AND :toDate`, { fromDate, toDate })
            .andWhere('expense.isDeleted = :isDeleted', { isDeleted: expenseState === "active" ? 0 : 1 })
        
        if (expenseIds.length > 0) {
            qb.andWhere('expense.expenseId IN (:...expenseIds)', { expenseIds });
        } else {
            qb.andWhere('expense.expenseId IS NOT NULL');
        }


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
        };
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

    async updateExpense(request: any, userId: string, fileNames?: string[], fileInfo?: { fileName: string, filePath: string, mimeType: string; originalName: string; }[]) {
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
            datePaid,
            issues
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
        expense.issues = issues ? issues : null;
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
        if (fileInfo) {
            for (const file of fileInfo) {
                const fileRecord = new FileInfo();
                fileRecord.entityType = 'expense';
                fileRecord.entityId = expense.id;
                fileRecord.fileName = file.fileName;
                fileRecord.createdBy = userId;
                fileRecord.localPath = file.filePath;
                fileRecord.mimetype = file.mimeType;
                fileRecord.originalName = file.originalName;
                await this.fileInfoRepo.save(fileRecord);
            }
        }
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

    public async updateHostawayExpense(requestBody: {
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

    public async migrateExpenseCategoryIdsInRange(fromId: number, toId: number) {
        const expenses = await this.expenseRepo.find({
            where: {
                id: Between(fromId, toId)
            }
        });

        for (const expense of expenses) {
            try {
                let raw = expense.categories;
                let parsed: any;

                // Handle double-stringified or regular JSON
                try {
                    parsed = JSON.parse(raw);
                    if (typeof parsed === 'string') {
                        parsed = JSON.parse(parsed); // double-stringified
                    }
                } catch (err) {
                    logger.warn(`⚠️ Skipping invalid JSON in expense ID ${expense.id}`);
                    continue;
                }

                if (!Array.isArray(parsed)) {
                    logger.warn(`⚠️ Skipping non-array categories in expense ID ${expense.id}`);
                    continue;
                }

                const oldCategoryIds: number[] = parsed;
                const hostawayIds: number[] = [];

                for (const id of oldCategoryIds) {
                    const category = await this.categoryRepo.findOne({ where: { id } });
                    if (category?.hostawayId != null) {
                        hostawayIds.push(category.hostawayId);
                    } else {
                        logger.warn(`No hostawayId for category.id ${id} (expense ID ${expense.id})`);
                    }
                }

                expense.categories = hostawayIds.length > 0 ? JSON.stringify(hostawayIds) : JSON.stringify(oldCategoryIds);
                await this.expenseRepo.save(expense);
                logger.info(`✅ Migrated expense ID ${expense.id}`);
            } catch (err) {
                logger.error(`❌ Failed to migrate expense ID ${expense.id}:`, err);
            }
        }

        logger.info("✅ Completed category migration for specified range.");
    }



    async fixPositiveExpensesAndSync(userId: string, limit?: number) {
        // Fetch up to 10 most recent positive, non-deleted expenses
        const expenses = await this.expenseRepo.find({
            where: {
                amount: MoreThan(0),
                isDeleted: 0,
                expenseId: Not(IsNull()),
            },
            order: {
                id: 'DESC', // Order by ID descending
            },
            take: limit || 10, // Limit to 10
        });

        if (expenses.length === 0) {
            return { message: 'No positive expenses found to update.' };
        }

        const updatedExpenses = [];
        const failedExpenses = [];

        for (const expense of expenses) {
            const negatedAmount = expense.amount * -1;

            const result = await this.updateHostawayExpense({
                listingMapId: String(expense.listingMapId),
                expenseDate: expense.expenseDate,
                concept: expense.concept,
                amount: negatedAmount,
                categories: JSON.parse(expense.categories),
            }, userId, expense.expenseId);

            if (result) {
                expense.amount = negatedAmount;
                expense.updatedBy = userId;
                expense.updatedAt = new Date();
                updatedExpenses.push(expense);
            } else {
                failedExpenses.push(expense.expenseId);
            }

            // Optional: small delay (200ms) if needed for pacing
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Save only successfully synced expenses
        await this.expenseRepo.save(updatedExpenses);

        return {
            message: `${updatedExpenses.length} of ${expenses.length} expenses updated and synced with Hostaway.`,
            updatedIds: updatedExpenses.map(e => e.expenseId),
            failedIds: failedExpenses,
        };
    }

    public async bulkUpdateExpense(body: ExpenseBulkUpdateObject, userId: string) {
        const {
            expenseId,
            expenseDate,
            dateOfWork,
            status,
            paymentMethod,
            categories,
            concept,
            listingMapId,
            amount,
            contractorName,
            contractorNumber,
            findings,
            datePaid,
        } = body;

        const failedExpenseUpdate: number[] = [];
        const failedHostawayExpenseUpdate: number[] = [];

        for (const id of expenseId) {
            const expense = await this.expenseRepo.findOne({ where: { expenseId: id } });

            if (!expense) {
                logger.error(`Expense with expenseId ${id} not found.`);
                failedExpenseUpdate.push(id);
                continue;
            }

            // Update fields if provided
            if (expenseDate) expense.expenseDate = expenseDate;
            if (dateOfWork) expense.dateOfWork = dateOfWork;
            if (status) expense.status = status;
            if (paymentMethod) expense.paymentMethod = paymentMethod;
            if (categories) expense.categories = categories;
            if (concept) expense.concept = concept;
            if (listingMapId) expense.listingMapId = listingMapId;
            if (amount !== undefined && amount !== null) expense.amount = amount * -1;
            if (contractorName !== undefined && contractorName !==null) expense.contractorName = contractorName;
            if (contractorNumber !== undefined && contractorNumber !==null) expense.contractorNumber = contractorNumber;
            if (findings !== undefined && findings !==null) expense.findings = findings;
            if (datePaid !== undefined && datePaid !==null) expense.datePaid = datePaid;

            expense.updatedBy = userId;
            expense.updatedAt = new Date();

            await this.expenseRepo.save(expense);
            // Sync with Hostaway
            try {
                const payload = {
                    listingMapId: String(listingMapId || expense.listingMapId),
                    expenseDate: expenseDate || expense.expenseDate,
                    concept: concept || expense.concept,
                    amount: amount !== undefined && amount !== null ? amount * -1 : expense.amount,
                    categories: JSON.parse(categories || expense.categories),
                };

                await haExpenseUpdateQueue.add('syncHostawayExpense', {
                    payload,
                    userId,
                    expenseId: expense.expenseId,
                });

            } catch (err) {
                logger.error(`Queueing Hostaway job failed for expenseId ${id}: ${err.message}`);
                failedHostawayExpenseUpdate.push(id);
            }
            
        }

        return {
            failedExpenseUpdate,
            failedHostawayExpenseUpdate,
        };
    }

    async migrateFilesToDrive() {
        //get all expenses
        const expenses = await this.expenseRepo.find();
        const fileInfo = await this.fileInfoRepo.find({ where: { entityType: 'expense' } });

        for (const expense of expenses) {
            try {
                if (expense.fileNames) {
                    const fileNames = JSON.parse(expense.fileNames) as string[];
                    const fileForExpense = fileInfo.filter(file => file.entityId === expense.id);
                    for (const file of fileNames) {
                        const fileExists = fileForExpense.find(f => f.fileName === file);
                        if (!fileExists) {
                            const fileRecord = new FileInfo();
                            fileRecord.entityType = 'expense';
                            fileRecord.entityId = expense.id;
                            fileRecord.fileName = file;
                            fileRecord.createdBy = expense.createdBy;
                            fileRecord.localPath = `${process.cwd()}/dist/public/expense/${file}`;
                            fileRecord.mimetype = null;
                            fileRecord.originalName = null;
                            await this.fileInfoRepo.save(fileRecord);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Error migrating files for expense ID ${expense.id}: ${error.message}`);
            }
        }
    }


}


