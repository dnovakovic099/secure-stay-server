import { appDatabase } from "../utils/database.util";
import { ExpenseEntity, ExpenseStatus } from "../entity/Expense";
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { Between, ILike, In, IsNull, LessThan, MoreThan, Not, Raw } from "typeorm";
import { Listing } from "../entity/Listing";
import { CategoryService } from "./CategoryService";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ConnectedAccountService } from "./ConnectedAccountService";
import { MobileUsersEntity } from "../entity/MoblieUsers";
import { format, getDate, getDaysInMonth, parseISO } from 'date-fns';
import { UsersEntity } from "../entity/Users";
import { ListingDetail } from "../entity/ListingDetails";
import { ListingService } from "./ListingService";
import { CategoryEntity } from "../entity/Category";
import logger from "../utils/logger.utils";
import { haExpenseUpdateQueue } from "../queue/haQueue";
import { FileInfo } from "../entity/FileInfo";
import { IssuesService } from "./IssuesService";
import { ResolutionService } from "./ResolutionService";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { generateSlackMessageLink } from "../helpers/helpers";
import { ExpenseHistoryEntity } from "../entity/ExpenseHistory";
import { RefundRequestEntity } from "../entity/RefundRequest";

const ACCOUNTING_TIME_ZONE = "America/New_York";
const ACCOUNTING_TIMESTAMP_DATE_TYPES = new Set(["createdAt", "updatedAt"]);
const EXPENSE_SORT_FIELD_MAP: Record<string, keyof ExpenseEntity> = {
    status: "status",
    listing: "listingMapId",
    listingMapId: "listingMapId",
    propertyType: "listingMapId",
    serviceType: "listingMapId",
    amount: "amount",
    dateAdded: "expenseDate",
    expenseDate: "expenseDate",
    dateOfWork: "dateOfWork",
    datePaid: "datePaid",
    description: "concept",
    concept: "concept",
    categories: "categories",
    contractorName: "contractorName",
    contractorNumber: "contractorNumber",
    findings: "findings",
    paymentMethod: "paymentMethod",
    paymentDetails: "paymentDetails",
    createdAt: "createdAt",
    createdAtTimestamp: "createdAt",
    createdBy: "createdBy",
    updatedAt: "updatedAt",
    updatedAtTimestamp: "updatedAt",
    updatedBy: "updatedBy",
    attachments: "fileNames",
};

interface ExpenseBulkUpdateObject {
    expenseDate: string;
    dateOfWork: string;
    status: ExpenseStatus;
    paymentMethod: string;
    paymentDetails?: string;
    slackNotes?: string;
    categories: string;
    concept: string;
    listingMapId: number;
    amount: number;
    expenseId: number[];
    contractorName?: string;
    contractorNumber?: string;
    findings?: string;
    datePaid?: string;
    isRecurring?: number;
    llCover?: number;
    type?: "expense" | "extras";
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
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private expenseHistoryRepo = appDatabase.getRepository(ExpenseHistoryEntity);
    private refundRequestRepo = appDatabase.getRepository(RefundRequestEntity);

    private buildSlackPermalink(slackMessage?: SlackMessageEntity | null) {
        const workspaceUrl = String(process.env.SLACK_WORKSPACE_URL || "").trim();
        if (!workspaceUrl || !slackMessage?.channel || !slackMessage?.threadTs) return null;
        return generateSlackMessageLink(workspaceUrl.replace(/\/$/, ""), slackMessage.channel, slackMessage.threadTs);
    }

    private async attachSlackPermalink(expense: ExpenseEntity) {
        const slackMessage = await this.slackMessageRepo.findOne({
            where: { entityType: "expense", entityId: expense.id },
            order: { id: "DESC" },
        });

        return {
            ...expense,
            expenseId: expense.id,
            slackThreadPermalink: this.buildSlackPermalink(slackMessage),
        };
    }

    private getTimeZoneOffsetMs(date: Date, timeZone: string) {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            hourCycle: "h23"
        }).formatToParts(date);
        const values = parts.reduce((acc, part) => {
            if (part.type !== "literal") acc[part.type] = Number(part.value);
            return acc;
        }, {} as Record<string, number>);
        const normalizedHour = values.hour === 24 ? 0 : values.hour;
        const utcLikeTime = Date.UTC(values.year, values.month - 1, values.day, normalizedHour, values.minute, values.second);
        return utcLikeTime - (date.getTime() - date.getMilliseconds());
    }

    private zonedDateTimeToUtc(dateString: string, hour: number, minute: number, second: number, millisecond: number) {
        const [year, month, day] = dateString.split("-").map(Number);
        const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
        const firstOffset = this.getTimeZoneOffsetMs(utcGuess, ACCOUNTING_TIME_ZONE);
        const firstPass = new Date(utcGuess.getTime() - firstOffset);
        const secondOffset = this.getTimeZoneOffsetMs(firstPass, ACCOUNTING_TIME_ZONE);
        return new Date(utcGuess.getTime() - secondOffset);
    }

    private getAccountingTimestampRange(fromDate: string, toDate: string) {
        return {
            start: this.zonedDateTimeToUtc(fromDate, 0, 0, 0, 0),
            end: this.zonedDateTimeToUtc(toDate, 23, 59, 59, 999)
        };
    }

    private formatAccountingTimestamp(date?: Date | null) {
        if (!date) return "";
        return new Intl.DateTimeFormat("en-US", {
            timeZone: ACCOUNTING_TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
            timeZoneName: "short"
        }).format(date);
    }

    private extractTypeFromTags(tags: string | null | undefined, options: string[]) {
        if (!tags) return null;
        const tagList = tags.split(",").map(tag => tag.trim().toLowerCase());
        const match = options.find(option => tagList.includes(option.toLowerCase()));
        return match || null;
    }

    private extractPropertyType(listing?: Listing | null) {
        return this.extractTypeFromTags(listing?.tags, ["Own", "Arb", "PM"]) || null;
    }

    private extractServiceType(listing?: Listing | null) {
        return this.extractTypeFromTags(listing?.tags, ["Full", "Pro", "Launch"]) || null;
    }

    private normalizeHistoryValue(value: any) {
        if (value === undefined || value === null || value === "") return "";
        if (typeof value === "boolean") return value ? "Yes" : "No";
        if (Array.isArray(value)) return JSON.stringify(value);
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
    }

    private historyValueChanged(previous: any, next: any) {
        return this.normalizeHistoryValue(previous) !== this.normalizeHistoryValue(next);
    }

    private normalizeSortRules(sort: any) {
        const sortItems = Array.isArray(sort) ? sort : sort ? Object.values(sort) : [];
        return sortItems
            .map((item: any) => ({
                field: String(item?.field || ""),
                direction: String(item?.direction || "asc").toLowerCase() === "desc" ? "desc" : "asc",
            }))
            .filter((item) => item.field)
            .slice(0, 3);
    }

    private async logExpenseChanges(
        expenseId: number,
        previous: Partial<ExpenseEntity>,
        next: Partial<ExpenseEntity>,
        userId: string,
        fields: Array<keyof ExpenseEntity>,
        action: "UPDATE" | "DELETE" = "UPDATE"
    ) {
        const rows = fields
            .filter((fieldName) => this.historyValueChanged(previous[fieldName], next[fieldName]))
            .map((fieldName) => this.expenseHistoryRepo.create({
                expenseId,
                fieldName: String(fieldName),
                oldValue: this.normalizeHistoryValue(previous[fieldName]) || null,
                newValue: this.normalizeHistoryValue(next[fieldName]) || null,
                changedBy: userId,
                action,
            }));

        if (rows.length) await this.expenseHistoryRepo.save(rows);
    }

    private getUserDisplayName(user?: UsersEntity | null) {
        if (!user) return "";
        const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
        return fullName || user.email || user.uid || "";
    }

    private getRefundStatusFromExpenseStatus(status?: ExpenseStatus | string | null) {
        if (status === ExpenseStatus.PAID) return "Paid";
        if (status === ExpenseStatus.CANCELLED) return "Cancelled";
        return null;
    }

    private async syncLinkedRefundRequestFromExpense(expense: ExpenseEntity, userId: string) {
        if (expense.comesFrom !== "refund_request") return;

        const refundRequest = await this.refundRequestRepo.findOne({ where: { expenseId: expense.id } });
        if (!refundRequest) return;

        const mappedStatus = this.getRefundStatusFromExpenseStatus(expense.status);
        if (mappedStatus) refundRequest.status = mappedStatus;
        refundRequest.explaination = expense.concept;
        refundRequest.refundAmount = Math.abs(Number(expense.amount || 0));
        refundRequest.paymentMethod = expense.paymentMethod;
        refundRequest.paymentDetails = expense.paymentDetails;
        refundRequest.chargeToClient = expense.llCover ? 0 : 1;
        refundRequest.updatedBy = userId;
        refundRequest.updatedAt = new Date();

        await this.refundRequestRepo.save(refundRequest);
    }

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
            paymentDetails,
            slackNotes,
            datePaid,
            issues,
            isRecurring,
            llCover,
            comesFrom,
            reservationId,
            guestName,
            skipRefundRequestSync
        } = request.body;

        const negatedAmount = amount * (-1);

        const newExpense = new ExpenseEntity();
        newExpense.listingMapId = listingMapId;
        newExpense.expenseDate = expenseDate;
        newExpense.concept = concept;
        newExpense.amount = amount;
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
        newExpense.paymentDetails = paymentDetails || null;
        newExpense.slackNotes = slackNotes || null;
        newExpense.createdBy = userId;
        newExpense.datePaid = datePaid ? datePaid : "";
        newExpense.issues = issues ? issues : null;
        newExpense.isRecurring = isRecurring ? isRecurring : 0;
        newExpense.llCover = llCover ? llCover : 0;
        newExpense.comesFrom = comesFrom || null;
        newExpense.reservationId = reservationId || null;
        newExpense.guestName = guestName || null;

        // const hostawayExpense = await this.createHostawayExpense({
        //     listingMapId,
        //     expenseDate,
        //     concept,
        //     amount: negatedAmount,
        //     categories: JSON.parse(categories),
        // }, userId);

        // if (!hostawayExpense) {
        //     throw new CustomErrorHandler(500, 'Failed to create expense');
        // } 

        // newExpense.expenseId = hostawayExpense?.id;
        const expense = await this.expenseRepo.save(newExpense);
        if (!skipRefundRequestSync) {
            await this.syncLinkedRefundRequestFromExpense(expense, userId);
        }
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
        return this.attachSlackPermalink(expense);
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

    private async getListingIdByPropertyTypes(propertyTypes: string[]): Promise<number[]> {
        const listingService = new ListingService();
        const listings = await listingService.getListingsByPropertyTypes(propertyTypes as any);

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
            paymentDetails,
            llCover,
            tags,
            propertyType,
            serviceType,
            keyword,
            expenseId,
            issueId,
            reservationId,
            isRecurring,
            type,
            excludeCategories,
            excludeContractorName,
            sort
        } = request.query;
        const page = Number(request.query.page) || 1;
        const limit = Number(request.query.limit) || 10;
        const skip = (page - 1) * limit;
        const categoriesFilter = categoryIds ? String(categoryIds).split(',').map(Number) : [];

        // expenseId filter
        const expenseIds = expenseId
            ? (Array.isArray(expenseId) ? expenseId.map(String) : String(expenseId).split(','))
            : [];
        const issueIds = issueId
            ? (Array.isArray(issueId) ? issueId.map(Number) : String(issueId).split(',').map(Number)).filter((id) => Number.isFinite(id))
            : [];
        const reservationIds = reservationId
            ? (Array.isArray(reservationId) ? reservationId.map(String) : String(reservationId).split(','))
                .map((id) => id.trim())
                .filter(Boolean)
            : [];

        // fetch all the listingIds associated with the tags
        const listingIdsFromTags = tags ? await this.getListingIdByPropertyTypes(String(tags).split(',')) : [];

        let listingIds = [];
        const listingService = new ListingService();

        const hasPropertyTypeFilter = propertyType && Array.isArray(propertyType) && propertyType.length > 0;
        const hasServiceTypeFilter = serviceType && Array.isArray(serviceType) && serviceType.length > 0;
        const propertyTypeListingIds = hasPropertyTypeFilter
            ? (await listingService.getListingsByPropertyTypes(propertyType as any)).map(l => l.id)
            : [];
        const serviceTypeListingIds = hasServiceTypeFilter
            ? (await listingService.getListingsByServiceTypes(serviceType as any)).map(l => l.id)
            : [];

        if (hasPropertyTypeFilter || hasServiceTypeFilter) {
            if (hasPropertyTypeFilter && hasServiceTypeFilter) {
                listingIds = propertyTypeListingIds.filter(id => serviceTypeListingIds.includes(id));
            } else {
                listingIds = hasPropertyTypeFilter ? propertyTypeListingIds : serviceTypeListingIds;
            }
            if (listingIds.length === 0) listingIds = [-1];
        } else {
            listingIds = Array.isArray(listingId) ? listingId.map(Number) : (listingId ? [Number(listingId)] : []);
        }

        const normalizedContractorName = Array.isArray(contractorName) ? contractorName : (contractorName ? [String(contractorName)] : []);
        const normalizedStatus = Array.isArray(status) ? status : (status ? [String(status)] : []);
        const normalizedPaymentMethod = Array.isArray(paymentMethod) ? paymentMethod : (paymentMethod ? [String(paymentMethod)] : []);
        const normalizedPaymentDetails = Array.isArray(paymentDetails) ? paymentDetails.map(String) : (paymentDetails ? [String(paymentDetails)] : []);
        const normalizedLlCover = Array.isArray(llCover) ? llCover.map(Number) : (llCover !== undefined && llCover !== '' ? [Number(llCover)] : []);
        const dateTypeString = String(dateType || "expenseDate");
        const isTimestampDateType = ACCOUNTING_TIMESTAMP_DATE_TYPES.has(dateTypeString);
        const accountingTimestampRange = fromDate && toDate && isTimestampDateType
            ? this.getAccountingTimestampRange(String(fromDate), String(toDate))
            : null;

        // Decide which listing IDs to use
        const effectiveListingIds =
            Array.isArray(listingId) && listingId.length > 0
                ? listingId.map(Number)
                : listingIdsFromTags;

        const sortRules = this.normalizeSortRules(sort);
        const order = sortRules.reduce((acc, rule) => {
            const field = EXPENSE_SORT_FIELD_MAP[rule.field];
            if (field) acc[field] = rule.direction.toUpperCase() as "ASC" | "DESC";
            return acc;
        }, {} as Record<string, "ASC" | "DESC">);

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
                    ...(fromDate && toDate && {
                        [dateTypeString]: accountingTimestampRange
                            ? Between(accountingTimestampRange.start, accountingTimestampRange.end)
                            : Between(String(fromDate), String(toDate))
                    }),
                    ...(expenseState && { isDeleted: expenseState === "active" ? 0 : 1 }),
                    ...(normalizedStatus.length > 0 && {
                        status: In(normalizedStatus),
                    }),
                    ...(normalizedPaymentMethod.length > 0 && {
                        paymentMethod: In(normalizedPaymentMethod),
                    }),
                    ...(normalizedPaymentDetails.length === 1 && normalizedPaymentDetails[0] === 'with' && {
                        paymentDetails: Raw(alias => `${alias} IS NOT NULL AND ${alias} != ''`),
                    }),
                    ...(normalizedPaymentDetails.length === 1 && normalizedPaymentDetails[0] === 'without' && {
                        paymentDetails: Raw(alias => `(${alias} IS NULL OR ${alias} = '')`),
                    }),
                    ...(normalizedLlCover.length === 1 && Number.isFinite(normalizedLlCover[0]) && {
                        llCover: normalizedLlCover[0],
                    }),
                    ...(expenseIds.length > 0 && { id: In(expenseIds) }),
                    ...(reservationIds.length > 0 && { reservationId: In(reservationIds) }),
                    ...(issueIds.length > 0 && {
                        issues: Raw((alias) => {
                            const containsChecks = issueIds
                                .map((_, index) => `JSON_CONTAINS(${alias}, :issueId${index}, '$')`)
                                .join(' OR ');
                            return `${alias} IS NOT NULL AND JSON_VALID(${alias}) AND (${containsChecks})`;
                        }, issueIds.reduce((params, id, index) => ({
                            ...params,
                            [`issueId${index}`]: String(id),
                        }), {} as Record<string, string>))
                    }),
                    ...(normalizedContractorName.length > 0 && {
                        contractorName: excludeContractorName === 'true' ? Not(In(normalizedContractorName)) : In(normalizedContractorName),
                    }),
                    ...(categoriesFilter.length > 0 && {
                        categories: excludeCategories === 'true'
                            ? Raw(alias => `(${alias} IS NULL OR JSON_LENGTH(${alias}) = 0 OR NOT (JSON_EXTRACT(${alias}, '$') REGEXP '${categoriesFilter.join('|')}'))`)
                            : Raw(alias => `JSON_EXTRACT(${alias}, '$') REGEXP '${categoriesFilter.join('|')}'`)
                    }),
                    ...(isRecurring !== undefined && { isRecurring: Number(isRecurring) }),
                    ...(type && type == "extras" && { amount: MoreThan(0) }),
                    ...(type && type == "expense" && { amount: LessThan(0) }),
                    // Filter out llCover expenses for non-securestay.ai domains
                    ...(request.hostname !== "securestay.ai" && { llCover: 0 }),
                },
            order: Object.keys(order).length ? order : { expenseDate: "DESC" },
            skip,
            take: limit,
        });

        const listingMapIds = expenses
            .map(expense => expense.listingMapId)
            .filter((id, index, self) => id != null && self.indexOf(id) === index);

        const listings = await this.listingRepository.find({
            where: { id: In(listingMapIds) },
            withDeleted: true
        });

        const listingMap = listings.reduce((acc, listing) => {
            acc[listing.id] = listing;
            return acc;
        }, {} as Record<number, Listing>);

        const categoryService = new CategoryService();
        const categories = await categoryService.getAllCategories();
        const users = await this.usersRepository.find();
        const fileInfoList = await this.fileInfoRepo.find({ where: { entityType: 'expense' } });
        const expenseIdsForSlack = expenses.map(expense => expense.id);
        const slackMessages = expenseIdsForSlack.length > 0
            ? await this.slackMessageRepo.find({ where: { entityType: "expense", entityId: In(expenseIdsForSlack) } })
            : [];
        const slackMessageMap = new Map<number, SlackMessageEntity>();
        slackMessages.forEach((message) => {
            const existing = slackMessageMap.get(message.entityId);
            if (!existing || message.createdAt > existing.createdAt) {
                slackMessageMap.set(message.entityId, message);
            }
        });

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
                const updatedBy = user ? `${user.firstName} ${user.lastName}` : "";
                const createdByUser = users.find(user => user.uid == expense.createdBy);
                const createdBy = createdByUser ? `${createdByUser.firstName} ${createdByUser.lastName}` : expense.createdBy;

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
                    expenseId: expense.id,
                    status: expense.status,
                    amount: expense.amount,
                    listing: listingMap[expense.listingMapId]?.internalListingName || 'N/A',
                    listingMapId: expense.listingMapId,
                    propertyType: this.extractPropertyType(listingMap[expense.listingMapId]),
                    serviceType: this.extractServiceType(listingMap[expense.listingMapId]),
                    dateAdded: expense.expenseDate,
                    dateOfWork: expense.dateOfWork,
                    datePaid: expense.datePaid,
                    description: expense.concept,
                    categories: categoryNames,
                    contractorName: expense.contractorName,
                    contractorNumber: expense.contractorNumber,
                    findings: expense.findings,
                    paymentMethod: expense.paymentMethod,
                    paymentDetails: expense.paymentDetails,
                    slackNotes: expense.slackNotes,
                    slackThreadPermalink: this.buildSlackPermalink(slackMessageMap.get(expense.id)),
                    createdAt: this.formatAccountingTimestamp(expense.createdAt),
                    updatedAt: this.formatAccountingTimestamp(expense.updatedAt),
                    createdAtTimestamp: expense.createdAt?.getTime() || 0,
                    updatedAtTimestamp: expense.updatedAt?.getTime() || 0,
                    updatedBy: user ? `${user.firstName} ${user.lastName}` : "",
                    attachments: fileLinks,
                    fileInfo: fileInfoList.filter(file => file.entityId === expense.id),
                    issues: issueIds,
                    issuesList: issueList,
                    createdBy: createdBy,
                    guestName: expense.guestName,
                    llCover: expense.llCover,
                    comesFrom: expense.comesFrom,
                };
            })
        );

        // calculate total expense filter values in given period of time without limit and page
        const qb = this.expenseRepo
            .createQueryBuilder('expense')
            .select('SUM(ABS(expense.amount))', 'totalExpense')
            .andWhere('expense.isDeleted = :isDeleted', { isDeleted: expenseState === "active" ? 0 : 1 });

        if (fromDate && toDate) {
            if (accountingTimestampRange) {
                qb.andWhere(`expense.${dateTypeString} BETWEEN :fromDate AND :toDate`, {
                    fromDate: accountingTimestampRange.start,
                    toDate: accountingTimestampRange.end
                });
            } else {
                qb.andWhere(`expense.${dateTypeString} BETWEEN :fromDate AND :toDate`, { fromDate, toDate });
            }
        }

        if (expenseIds.length > 0) {
            qb.andWhere('expense.id IN (:...expenseIds)', { expenseIds });
        }

        if (reservationIds.length > 0) {
            qb.andWhere('expense.reservationId IN (:...reservationIds)', { reservationIds });
        }


        if (effectiveListingIds.length > 0) {
            qb.andWhere('expense.listingMapId IN (:...listingIds)', { listingIds: effectiveListingIds });
        }

        if (listingIds.length > 0) {
            qb.andWhere('expense.listingMapId IN (:...typeListingIds)', { typeListingIds: listingIds });
        }

        if (status !== "") {
            qb.andWhere('expense.status IN (:...statuses)', {
                statuses: [status],
            });
        }

        if (normalizedContractorName.length > 0) {
            if (excludeContractorName === 'true') {
                qb.andWhere('(expense.contractorName NOT IN (:...contractors) OR expense.contractorName IS NULL)', { contractors: normalizedContractorName });
            } else {
                qb.andWhere('expense.contractorName IN (:...contractors)', { contractors: normalizedContractorName });
            }
        }

        if (categoriesFilter.length > 0) {
            if (excludeCategories === 'true') {
                qb.andWhere(`(expense.categories IS NULL OR JSON_LENGTH(expense.categories) = 0 OR NOT (JSON_EXTRACT(expense.categories, '$') REGEXP :regex))`, {
                    regex: categoriesFilter.join('|'),
                });
            } else {
                qb.andWhere(`JSON_EXTRACT(expense.categories, '$') REGEXP :regex`, {
                    regex: categoriesFilter.join('|'),
                });
            }
        }

        if (type && type == "extras") {
            qb.andWhere('expense.amount > 0');
        }

        if (type && type == "expense") {
            qb.andWhere('expense.amount < 0');
        }

        const { totalExpense } = await qb.getRawOne();


        // const excludeResolution = request.hostname == "securestay.ai";
        // const resolutionService = new ResolutionService();

        // const resolutions = excludeResolution ?
        //     { resolutions: [] } :
        //     await resolutionService.getResolutions({
        //         listingId,
        //         fromDate,
        //         toDate,
        //         dateType: fromDate && toDate ? "claimDate" : null,
        //         page,
        //         limit
        //     });



        // const refactoredResolutions = resolutions.resolutions.map(resolution => {
        //     return {
        //         expenseId: resolution.ha_id,
        //         status: 'Approved',
        //         amount: resolution.amount,
        //         listing: resolution.listingName || 'Unkown Listing',
        //         listingMapId: resolution.listingMapId,
        //         dateAdded: resolution.claimDate,
        //         dateOfWork: "",
        //         datePaid: '',
        //         description: resolution.type,
        //         categories: resolution.category,
        //         contractorName: "",
        //         contractorNumber: '',
        //         findings: "",
        //         paymentMethod: "",
        //         createdAt: resolution.createdAt,
        //         updatedAt: resolution.updatedAt,
        //         updatedBy: resolution.updatedBy,
        //         attachments: '',
        //         fileInfo: [],
        //         issues: [],
        //         issuesList: [],
        //         createdBy: resolution.createdBy,
        //         guestName: resolution.guestName
        //     };
        // });

        return {
            // data: excludeResolution ? data : [...data, ...refactoredResolutions],
            data,
            totalExpense,
            total
        };
    }

    async getExpenseById(expenseId: number, userId: string) {
        const expense = await this.expenseRepo.findOne({ where: { id: expenseId } });
        if (!expense) {
            throw CustomErrorHandler.notFound('Expense not found.');
        }
        expense.amount = Math.abs(expense.amount); // Ensure amount is positive for display
        return this.attachSlackPermalink(expense);
    }

    async getExpenseHistory(expenseId: number) {
        const history = await this.expenseHistoryRepo.find({
            where: { expenseId },
            order: { changedAt: "DESC", id: "DESC" },
        });

        if (!history.length) return [];

        const users = await this.usersRepository.find({
            where: { uid: In(Array.from(new Set(history.map((row) => row.changedBy).filter(Boolean)))) },
        });
        const userMap = new Map(users.map((user) => [user.uid, this.getUserDisplayName(user)]));

        return history.map((row) => ({
            id: row.id,
            expenseId: row.expenseId,
            fieldName: row.fieldName,
            oldValue: row.oldValue,
            newValue: row.newValue,
            changedBy: row.changedBy,
            changedByName: userMap.get(row.changedBy) || row.changedBy || "System",
            action: row.action,
            changedAt: this.formatAccountingTimestamp(row.changedAt),
            changedAtTimestamp: row.changedAt?.getTime() || 0,
        }));
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
           paymentDetails,
            slackNotes,
           datePaid,
            issues,
            isRecurring,
            llCover,
            comesFrom,
            reservationId,
            guestName,
            skipRefundRequestSync
        } = request.body;

        const expense = await this.expenseRepo.findOne({ where: { id: expenseId } });
        if (!expense) {
            throw CustomErrorHandler.notFound('Expense not found.');
        }

        const previousExpense = { ...expense };

        const negatedAmount = amount * (-1);

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
        expense.paymentDetails = paymentDetails || null;
        expense.slackNotes = slackNotes || null;
        expense.updatedBy = userId;
        expense.updatedAt = new Date();
        expense.datePaid = datePaid ? datePaid : "";
        expense.issues = issues ? issues : null;
        expense.isRecurring = isRecurring ? isRecurring : 0;
        expense.llCover = llCover ? llCover : 0;
        expense.comesFrom = comesFrom || null;
        expense.reservationId = reservationId || null;
        expense.guestName = guestName || null;
        (expense as any).__slackPreviousData = previousExpense;
        if (fileNames && fileNames.length > 0) {
            expense.fileNames = JSON.stringify(fileNames);
        }

        //update hostaway expense
        // const result = expense.expenseId && await this.updateHostawayExpense({
        //     listingMapId,
        //     expenseDate,
        //     concept,
        //     amount: negatedAmount,
        //     categories: JSON.parse(categories),
        // }, userId, expense.expenseId);

        // if(!result){
        //     throw new CustomErrorHandler(500,'Unable to update expense');
        // }

        await this.expenseRepo.save(expense);
        delete (expense as any).__slackPreviousData;
        if (!skipRefundRequestSync) {
            await this.syncLinkedRefundRequestFromExpense(expense, userId);
        }
        await this.logExpenseChanges(
            expense.id,
            previousExpense,
            expense,
            userId,
            [
                "listingMapId",
                "expenseDate",
                "concept",
                "amount",
                "categories",
                "dateOfWork",
                "contractorName",
                "contractorNumber",
                "findings",
                "status",
                "paymentMethod",
                "paymentDetails",
                "slackNotes",
                "datePaid",
                "issues",
                "isRecurring",
                "llCover",
                "comesFrom",
                "reservationId",
                "guestName",
                "fileNames",
            ]
        );
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
        return this.attachSlackPermalink(expense);
    }

    async updateExpenseStatus(request: Request, userId: string,) {
        const { expenseId, status, datePaid, skipRefundRequestSync } = request.body as any;
        const expense = await this.expenseRepo.find({ where: { id: In(expenseId) } });
        if (!expense) {
            throw CustomErrorHandler.notFound('Expense not found.');
        }
        const paidDate = status === ExpenseStatus.PAID && !datePaid
            ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
            : datePaid;

        const previousById = new Map(expense.map((element) => [element.id, { ...element }]));

        expense.forEach((element) => {
            (element as any).__slackPreviousData = previousById.get(element.id);
            element.status = status;
            if (paidDate !== "") {
                element.datePaid = paidDate;
            }
            element.updatedBy = userId;
            element.updatedAt = new Date();
        });
        await this.expenseRepo.save(expense);
        expense.forEach((element) => {
            delete (element as any).__slackPreviousData;
        });
        for (const element of expense) {
            if (!skipRefundRequestSync) {
                await this.syncLinkedRefundRequestFromExpense(element, userId);
            }
            await this.logExpenseChanges(
                element.id,
                previousById.get(element.id) || {},
                element,
                userId,
                ["status", "datePaid"]
            );
        }

        return expense;
    }

    async deleteExpense(expenseId: number, userId: string) {
        const expense = await this.expenseRepo.findOne({ where: { id: expenseId } });
        if (!expense) {
            throw CustomErrorHandler.notFound('Expense not found.');
        }

        const previousExpense = { ...expense };
        expense.isDeleted = 1;
        expense.updatedBy = userId;
        expense.updatedAt = new Date();
        await this.expenseRepo.save(expense);
        await this.logExpenseChanges(expense.id, previousExpense, expense, userId, ["isDeleted"], "DELETE");

        //delete hostaway expense
        // expense.expenseId && this.deleteHostawayExpense(expense.expenseId, userId);

        return expense;
    }

    async bulkDeleteExpenses(expenseIds: number[], userId: string): Promise<number> {
        const expenses = await this.expenseRepo.findByIds(expenseIds);
        
        if (expenses.length === 0) {
            return 0;
        }

        const now = new Date();
        for (const expense of expenses) {
            expense.isDeleted = 1;
            expense.updatedBy = userId;
            expense.updatedAt = now;
        }

        await this.expenseRepo.save(expenses);
        
        return expenses.length;
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

    /**
     * Fix positive expenses by negating their amounts (local DB only, no Hostaway sync).
     * This is useful for fixing expenses created via public URL that don't have Hostaway expenseId.
     * 
     * IMPORTANT: Since expenses and extras are stored in the same table (expenses = negative, extras = positive),
     * you MUST provide a categoryName filter to avoid accidentally negating legitimate extras.
     * 
     * @param userId - The user performing the fix
     * @param categoryName - Category name to filter by (required to avoid fixing legitimate extras)
     * @param limit - Maximum number of expenses to fix (default: 200)
     * @param dryRun - If true, only returns what would be fixed without actually updating
     */
    async fixPositiveExpensesLocal(userId: string, categoryName?: string, limit?: number, dryRun: boolean = false) {
        // First, get the category by name if provided (case-insensitive search)
        let categoryIds: (number | string)[] = [];
        let categoryInfo: { id: number, name: string, hostawayId: number | null; } | null = null;

        if (categoryName) {
            // Find category with case-insensitive LIKE search
            const categories = await this.categoryRepo
                .createQueryBuilder('category')
                .where('LOWER(category.categoryName) LIKE LOWER(:name)', { name: `%${categoryName}%` })
                .getMany();

            if (categories.length === 0) {
                return {
                    message: `Category containing "${categoryName}" not found.`,
                    count: 0,
                    dryRun
                };
            }

            // Collect all possible IDs to match (id and hostawayId)
            for (const cat of categories) {
                categoryIds.push(cat.id);
                categoryIds.push(String(cat.id));
                if (cat.hostawayId) {
                    categoryIds.push(cat.hostawayId);
                    categoryIds.push(String(cat.hostawayId));
                }
            }

            categoryInfo = {
                id: categories[0].id,
                name: categories[0].categoryName,
                hostawayId: categories[0].hostawayId
            };
        }

        // Fetch positive, non-deleted expenses
        const allPositiveExpenses = await this.expenseRepo.find({
            where: {
                amount: MoreThan(0),
                isDeleted: 0,
            },
            order: {
                id: 'DESC',
            },
            take: limit || 200,
        });

        // Filter by category if specified
        let expenses = allPositiveExpenses;
        if (categoryIds.length > 0) {
            expenses = allPositiveExpenses.filter(expense => {
                try {
                    let categoriesRaw = expense.categories;
                    let categoriesList: any[] = [];

                    // Handle different JSON formats
                    if (typeof categoriesRaw === 'string') {
                        try {
                            let parsed = JSON.parse(categoriesRaw);
                            if (typeof parsed === 'string') {
                                parsed = JSON.parse(parsed);
                            }
                            categoriesList = Array.isArray(parsed) ? parsed : [];
                        } catch {
                            // If not valid JSON, check if it's a comma-separated list
                            categoriesList = categoriesRaw.replace(/[\[\]"]/g, '').split(',').map((s: string) => s.trim());
                        }
                    } else if (Array.isArray(categoriesRaw)) {
                        categoriesList = categoriesRaw;
                    }

                    return categoriesList.some(cat => categoryIds.includes(cat) || categoryIds.includes(Number(cat)) || categoryIds.includes(String(cat)));
                } catch {
                    return false;
                }
            });
        }

        if (expenses.length === 0) {
            // Include debug info when no matching expenses found
            const sampleExpenses = allPositiveExpenses.slice(0, 5).map(e => ({
                id: e.id,
                amount: e.amount,
                categories: e.categories
            }));

            return {
                message: categoryName
                    ? `No positive expenses found with category "${categoryName}".`
                    : 'No positive expenses found to update.',
                count: 0,
                dryRun,
                debug: {
                    categoryInfo,
                    categoryIdsSearched: categoryIds,
                    totalPositiveExpenses: allPositiveExpenses.length,
                    sampleExpensesCategories: sampleExpenses
                }
            };
        }

        if (dryRun) {
            return {
                message: `Found ${expenses.length} positive expenses ${categoryName ? `with category "${categoryName}" ` : ''}that would be fixed.`,
                count: expenses.length,
                expenseIds: expenses.map(e => e.id),
                dryRun,
                categoryInfo
            };
        }

        // Negate amounts and save
        for (const expense of expenses) {
            expense.amount = expense.amount * -1;
            expense.updatedBy = userId;
            expense.updatedAt = new Date();
        }

        await this.expenseRepo.save(expenses);

        return {
            message: `Successfully fixed ${expenses.length} expenses ${categoryName ? `with category "${categoryName}" ` : ''}by negating their amounts.`,
            count: expenses.length,
            expenseIds: expenses.map(e => e.id),
            dryRun
        };
    }

    public async bulkUpdateExpense(body: ExpenseBulkUpdateObject, userId: string) {
        const {
            expenseId,
            expenseDate,
            dateOfWork,
            status,
            paymentMethod,
            paymentDetails,
            slackNotes,
            categories,
            concept,
            listingMapId,
            amount,
            contractorName,
            contractorNumber,
            findings,
            datePaid,
            isRecurring,
            type
        } = body;

        const failedExpenseUpdate: number[] = [];
        const failedHostawayExpenseUpdate: number[] = [];

        for (const id of expenseId) {
            const expense = await this.expenseRepo.findOne({ where: { id: id } });

            if (!expense) {
                logger.error(`Expense with id ${id} not found.`);
                failedExpenseUpdate.push(id);
                continue;
            }

            const previousExpense = { ...expense };

            // Update fields if provided
            if (expenseDate) expense.expenseDate = expenseDate;
            if (dateOfWork) expense.dateOfWork = dateOfWork;
            if (status) expense.status = status;
            if (paymentMethod) expense.paymentMethod = paymentMethod;
            if (paymentDetails !== undefined && paymentDetails !== null) expense.paymentDetails = paymentDetails;
            if (slackNotes !== undefined && slackNotes !== null) expense.slackNotes = slackNotes;
            if (categories) expense.categories = categories;
            if (concept) expense.concept = concept;
            if (listingMapId) expense.listingMapId = listingMapId;
            if (amount !== undefined && amount !== null) {
                expense.amount = type === "extras" ? Math.abs(Number(amount)) : Math.abs(Number(amount)) * -1;
            }
            if (contractorName !== undefined && contractorName !== null) expense.contractorName = contractorName;
            if (contractorNumber !== undefined && contractorNumber !== null) expense.contractorNumber = contractorNumber;
            if (findings !== undefined && findings !== null) expense.findings = findings;
            if (datePaid !== undefined && datePaid !== null) expense.datePaid = datePaid;
            if (isRecurring !== undefined && isRecurring !== null) expense.isRecurring = isRecurring ? isRecurring : 0;

            expense.updatedBy = userId;
            expense.updatedAt = new Date();

            await this.expenseRepo.save(expense);
            await this.syncLinkedRefundRequestFromExpense(expense, userId);
            await this.logExpenseChanges(
                expense.id,
                previousExpense,
                expense,
                userId,
                [
                    "expenseDate",
                    "dateOfWork",
                    "status",
                    "paymentMethod",
                    "paymentDetails",
                    "slackNotes",
                    "categories",
                    "concept",
                    "listingMapId",
                    "amount",
                    "contractorName",
                    "contractorNumber",
                    "findings",
                    "datePaid",
                    "isRecurring",
                ]
            );
            // Sync with Hostaway
            // try {
            //     const payload = {
            //         listingMapId: String(listingMapId || expense.listingMapId),
            //         expenseDate: expenseDate || expense.expenseDate,
            //         concept: concept || expense.concept,
            //         amount: amount !== undefined && amount !== null ? amount * -1 : expense.amount,
            //         categories: JSON.parse(categories || expense.categories),
            //     };

            //     await haExpenseUpdateQueue.add('syncHostawayExpense', {
            //         payload,
            //         userId,
            //         expenseId: expense.expenseId,
            //     });

            // } catch (err) {
            //     logger.error(`Queueing Hostaway job failed for expenseId ${id}: ${err.message}`);
            //     failedHostawayExpenseUpdate.push(id);
            // }

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

    async processRecurringExpenses() {
        // 🕒 Get current date in Eastern Time (America/New_York)
        const now = new Date();
        const todayInET = new Date(
            now.toLocaleString("en-US", { timeZone: "America/New_York" })
        );

        const yyyy = todayInET.getFullYear();
        const mm = String(todayInET.getMonth() + 1).padStart(2, "0");
        const dd = String(todayInET.getDate()).padStart(2, "0");
        const todayStr = `${yyyy}-${mm}-${dd}`; // 'yyyy-MM-dd'

        const expenseList = await this.expenseRepo.find({
            where: {
                isRecurring: 1,
                isDeleted: 0,
            },
        });

        for (const expense of expenseList) {
            try {
                const originalDate = parseISO(expense.expenseDate);
                const recurringDay = getDate(originalDate);

                // Determine this month's recurring date
                const targetYear = todayInET.getFullYear();
                const targetMonth = todayInET.getMonth();
                let recurringExpenseDate = new Date(targetYear, targetMonth, recurringDay);

                // Adjust for months with fewer days
                const daysInMonth = getDaysInMonth(recurringExpenseDate);
                if (recurringDay > daysInMonth) {
                    recurringExpenseDate = new Date(targetYear, targetMonth, daysInMonth);
                }

                const recurringExpenseDateStr = format(recurringExpenseDate, "yyyy-MM-dd");

                // Only create if today matches recurring day
                if (todayStr !== recurringExpenseDateStr) continue;

                // Skip if already exists
                const existing = await this.expenseRepo.findOne({
                    where: {
                        listingMapId: expense.listingMapId,
                        expenseDate: recurringExpenseDateStr,
                        isDeleted: 0,
                        comesFrom: "recurring_expense",
                    },
                });

                if (existing) {
                    logger.info(
                        `Recurring expense already exists for listingMapId ${expense.listingMapId} on ${recurringExpenseDateStr}`
                    );
                    continue;
                }

                const newExpense = new ExpenseEntity();
                newExpense.listingMapId = expense.listingMapId;
                newExpense.expenseDate = recurringExpenseDateStr;
                newExpense.concept = expense.concept;
                newExpense.amount = expense.amount;
                newExpense.isDeleted = 0;
                newExpense.categories = expense.categories;
                newExpense.contractorName = expense.contractorName;
                newExpense.dateOfWork = null;
                newExpense.contractorNumber = expense.contractorNumber;
                newExpense.findings = expense.findings;
                newExpense.userId = expense.userId;
                newExpense.fileNames = expense.fileNames;
                newExpense.status = expense.status;
                newExpense.createdBy = expense.userId;
                newExpense.datePaid = recurringExpenseDateStr;
                newExpense.paymentMethod = expense.paymentMethod;
                newExpense.paymentDetails = expense.paymentDetails;
                newExpense.comesFrom = "recurring_expense";

                logger.info(
                    `Creating recurring expense for listingMapId ${expense.listingMapId} on ${recurringExpenseDateStr}`
                );

                // const hostawayExpense = await this.createHostawayExpense(
                //     {
                //         listingMapId: String(newExpense.listingMapId),
                //         expenseDate: newExpense.expenseDate,
                //         concept: newExpense.concept,
                //         amount: newExpense.amount,
                //         categories: JSON.parse(expense.categories),
                //     },
                //     expense.userId
                // );

                // if (!hostawayExpense) {
                //     logger.error(
                //         `Failed to create recurring expense in Hostaway for listingMapId ${newExpense.listingMapId}`
                //     );
                //     continue;
                // }

                // newExpense.expenseId = hostawayExpense.id;
                await this.expenseRepo.save(newExpense);
            } catch (error) {
                logger.error(
                    `Error processing recurring expense for listingMapId ${expense.listingMapId}: ${error?.message}`
                );
            }
        }
    }

    /**
     * Delete duplicate tech fee expenses for a given date.
     * This method finds all tech fee expenses for the specified date,
     * groups them by listingMapId, and soft-deletes all but the first one
     * (keeping the one with the lowest ID).
     * 
     * @param targetDate - The date to check for duplicates (format: 'yyyy-MM-dd')
     * @param dryRun - If true, only returns what would be deleted without actually deleting
     */
    async deleteDuplicateTechFeeExpenses(targetDate: string, dryRun: boolean = false) {
        logger.info(`Checking for duplicate tech fee expenses on date: ${targetDate} (dryRun: ${dryRun})`);

        // Find all tech fee expenses for the given date
        const techFeeExpenses = await this.expenseRepo.find({
            where: {
                expenseDate: targetDate,
                comesFrom: "tech_fee",
                isDeleted: 0,
            },
            order: { id: "ASC" }, // Order by ID ascending to keep the first one
        });

        if (techFeeExpenses.length === 0) {
            logger.info(`No tech fee expenses found for date: ${targetDate}`);
            return {
                duplicatesFound: 0,
                duplicatesDeleted: 0,
                details: [],
                dryRun
            };
        }

        // Group by listingMapId
        const groupedByListing: Record<number, typeof techFeeExpenses> = {};
        for (const expense of techFeeExpenses) {
            if (!groupedByListing[expense.listingMapId]) {
                groupedByListing[expense.listingMapId] = [];
            }
            groupedByListing[expense.listingMapId].push(expense);
        }

        const duplicatesToDelete: typeof techFeeExpenses = [];
        const details: Array<{
            listingMapId: number;
            keptExpenseId: number;
            deletedExpenseIds: number[];
        }> = [];

        // Find duplicates (all except the first one per listing)
        for (const [listingMapId, expenses] of Object.entries(groupedByListing)) {
            if (expenses.length > 1) {
                // Keep the first one (lowest ID), mark the rest for deletion
                const [kept, ...duplicates] = expenses;
                duplicatesToDelete.push(...duplicates);
                details.push({
                    listingMapId: Number(listingMapId),
                    keptExpenseId: kept.id,
                    deletedExpenseIds: duplicates.map(e => e.id),
                });
            }
        }

        if (duplicatesToDelete.length === 0) {
            logger.info(`No duplicate tech fee expenses found for date: ${targetDate}`);
            return {
                duplicatesFound: 0,
                duplicatesDeleted: 0,
                details: [],
                dryRun
            };
        }

        logger.info(`Found ${duplicatesToDelete.length} duplicate tech fee expenses to delete`);

        // If not a dry run, soft-delete the duplicates
        if (!dryRun) {
            for (const expense of duplicatesToDelete) {
                expense.isDeleted = 1;
                expense.updatedBy = "system_cleanup";
                expense.updatedAt = new Date();
                await this.expenseRepo.save(expense);
            }
            logger.info(`Successfully soft-deleted ${duplicatesToDelete.length} duplicate tech fee expenses`);
        }

        return {
            duplicatesFound: duplicatesToDelete.length,
            duplicatesDeleted: dryRun ? 0 : duplicatesToDelete.length,
            details,
            dryRun,
        };
    }

    /**
     * Delete duplicate recurring expenses for a given date.
     * Similar to deleteDuplicateTechFeeExpenses but for recurring expenses.
     */
    async deleteDuplicateRecurringExpenses(targetDate: string, dryRun: boolean = false) {
        logger.info(`Checking for duplicate recurring expenses on date: ${targetDate} (dryRun: ${dryRun})`);

        // Find all recurring expenses for the given date
        const recurringExpenses = await this.expenseRepo.find({
            where: {
                expenseDate: targetDate,
                comesFrom: "recurring_expense",
                isDeleted: 0,
            },
            order: { id: "ASC" },
        });

        if (recurringExpenses.length === 0) {
            logger.info(`No recurring expenses found for date: ${targetDate}`);
            return {
                duplicatesFound: 0,
                duplicatesDeleted: 0,
                details: [],
                dryRun
            };
        }

        // Group by listingMapId
        const groupedByListing: Record<number, typeof recurringExpenses> = {};
        for (const expense of recurringExpenses) {
            if (!groupedByListing[expense.listingMapId]) {
                groupedByListing[expense.listingMapId] = [];
            }
            groupedByListing[expense.listingMapId].push(expense);
        }

        const duplicatesToDelete: typeof recurringExpenses = [];
        const details: Array<{
            listingMapId: number;
            keptExpenseId: number;
            deletedExpenseIds: number[];
        }> = [];

        for (const [listingMapId, expenses] of Object.entries(groupedByListing)) {
            if (expenses.length > 1) {
                const [kept, ...duplicates] = expenses;
                duplicatesToDelete.push(...duplicates);
                details.push({
                    listingMapId: Number(listingMapId),
                    keptExpenseId: kept.id,
                    deletedExpenseIds: duplicates.map(e => e.id),
                });
            }
        }

        if (duplicatesToDelete.length === 0) {
            logger.info(`No duplicate recurring expenses found for date: ${targetDate}`);
            return {
                duplicatesFound: 0,
                duplicatesDeleted: 0,
                details: [],
                dryRun
            };
        }

        logger.info(`Found ${duplicatesToDelete.length} duplicate recurring expenses to delete`);

        if (!dryRun) {
            for (const expense of duplicatesToDelete) {
                expense.isDeleted = 1;
                expense.updatedBy = "system_cleanup";
                expense.updatedAt = new Date();
                await this.expenseRepo.save(expense);
            }
            logger.info(`Successfully soft-deleted ${duplicatesToDelete.length} duplicate recurring expenses`);
        }

        return {
            duplicatesFound: duplicatesToDelete.length,
            duplicatesDeleted: dryRun ? 0 : duplicatesToDelete.length,
            details,
            dryRun,
        };
    }

    async processTechFeeExpenses() {
        const listingDetailRepo = appDatabase.getRepository(ListingDetail);

        // Get current date in Eastern Time
        const now = new Date();
        const todayInET = new Date(
            now.toLocaleString("en-US", { timeZone: "America/New_York" })
        );

        const yyyy = todayInET.getFullYear();
        const mm = String(todayInET.getMonth() + 1).padStart(2, "0");
        const dd = String(todayInET.getDate()).padStart(2, "0");
        const todayStr = `${yyyy}-${mm}-${dd}`;

        logger.info(`Processing tech fee expenses for date: ${todayStr}`);

        // Get all listings with techFee enabled and techFeeAmount set
        const eligibleListings = await listingDetailRepo.find({
            where: {
                techFee: true,
                techFeeAmount: Not(IsNull()),
            },
        });

        if (eligibleListings.length === 0) {
            logger.info("No listings with tech fee enabled found.");
            return { created: 0, skipped: 0 };
        }

        // Get the Tech Fee category
        const techFeeCategory = await this.categoryRepo.findOne({
            where: { categoryName: "Tech Fee" },
        });

        if (!techFeeCategory) {
            logger.error("Tech Fee category not found in database. Please run the migration.");
            return { created: 0, skipped: 0, error: "Tech Fee category not found" };
        }

        let created = 0;
        let skipped = 0;

        for (const listingDetail of eligibleListings) {
            try {
                // Check if expense already exists for this listing and date
                const existing = await this.expenseRepo.findOne({
                    where: {
                        listingMapId: listingDetail.listingId,
                        expenseDate: todayStr,
                        isDeleted: 0,
                        comesFrom: "tech_fee",
                    },
                });

                if (existing) {
                    logger.info(
                        `Tech fee expense already exists for listingId ${listingDetail.listingId} on ${todayStr}`
                    );
                    skipped++;
                    continue;
                }

                // Create the expense
                const newExpense = new ExpenseEntity();
                newExpense.listingMapId = listingDetail.listingId;
                newExpense.expenseDate = todayStr;
                newExpense.concept = "Tech Fees";
                newExpense.amount = Number(listingDetail.techFeeAmount) * -1; // Negative for expense
                newExpense.isDeleted = 0;
                newExpense.categories = JSON.stringify([techFeeCategory.hostawayId]);
                newExpense.contractorName = "";
                newExpense.dateOfWork = null;
                newExpense.contractorNumber = "";
                newExpense.findings = "";
                newExpense.userId = "system";
                newExpense.fileNames = "";
                newExpense.status = ExpenseStatus.APPROVED;
                newExpense.createdBy = "system";
                newExpense.datePaid = todayStr;
                newExpense.paymentMethod = "";
                newExpense.comesFrom = "tech_fee";

                await this.expenseRepo.save(newExpense);
                created++;

                logger.info(
                    `Created tech fee expense for listingId ${listingDetail.listingId}: $${listingDetail.techFeeAmount}`
                );
            } catch (error) {
                logger.error(
                    `Error creating tech fee expense for listingId ${listingDetail.listingId}: ${error?.message}`
                );
            }
        }

        logger.info(`Tech fee expense processing complete. Created: ${created}, Skipped: ${skipped}`);
        return { created, skipped };
    }
}


