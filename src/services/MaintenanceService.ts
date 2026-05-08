import { Between, Equal, ILike, In, IsNull, LessThan, MoreThan, Not } from "typeorm";
import { ListingSchedule } from "../entity/ListingSchedule";
import { Maintenance } from "../entity/Maintenance";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { addDays, addMonths, eachDayOfInterval, endOfMonth, format, getDate, getDay, getYear, isAfter, isEqual, parseISO, setDate, startOfMonth } from "date-fns";
import { Contact } from "../entity/Contact";
import { ContactRole } from "../entity/ContactRole";
import { UsersEntity } from "../entity/Users";
import { ListingService } from "./ListingService";
import { Issue } from "../entity/Issue";
import { IssueUpdates } from "../entity/IsssueUpdates";
import * as XLSX from "xlsx";

interface MaintenanceFilter {
    listingId?: string[];
    workCategory?: string[];
    contactId?: number[];
    workType?: string[];
    fromDate?: string;
    toDate?: string;
    propertyType?: string[];
    keyword?: string;
    type?: string;
    page: number;
    limit: number;
    currentDate: string;
}

export class MaintenanceService {
    private maintenanceRepo = appDatabase.getRepository(Maintenance);
    private contactRepo = appDatabase.getRepository(Contact);
    private issueRepo = appDatabase.getRepository(Issue);
    private issueUpdatesRepo = appDatabase.getRepository(IssueUpdates);
    private listingScheduleRepo = appDatabase.getRepository(ListingSchedule);
    private contactRoleRepo = appDatabase.getRepository(ContactRole);
    private usersRepo = appDatabase.getRepository(UsersEntity);

    async createMaintenance(body: Partial<Maintenance> & { issueIds?: number[] }, userId: string) {
        const issueIds = Array.isArray(body.issueIds) && body.issueIds.length > 0
            ? body.issueIds.map(Number).filter((id) => Number.isFinite(id))
            : body.issueId
                ? [Number(body.issueId)].filter((id) => Number.isFinite(id))
                : [];
        const targetIssueIds = issueIds.length > 0 ? issueIds : [null];
        const savedMaintenanceLogs: Maintenance[] = [];
        const contact = body.contactId
            ? await this.contactRepo.findOne({ where: { id: Number(body.contactId) } })
            : null;

        //check if the maintenance log already exists
        for (const issueId of targetIssueIds) {
            const existingMaintenenace = await this.maintenanceRepo.find({
                where: {
                    listingId: body.listingId,
                    nextSchedule: body.nextSchedule,
                    workCategory: body.workCategory,
                    ...(issueId ? { issueId } : { issueId: IsNull() })
                }
            });

            if (existingMaintenenace.length > 0) {
                throw CustomErrorHandler.alreadyExists(`Maintenance log for ${body.workCategory} on ${body.nextSchedule} already exists`);
            }

            const maintenance = this.maintenanceRepo.create({
                listingId: body.listingId,
                workCategory: body.workCategory,
                nextSchedule: body.nextSchedule,
                contactId: body.contactId,
                issueId,
                createdBy: userId,
            });
            const savedMaintenance = await this.maintenanceRepo.save(maintenance);
            savedMaintenanceLogs.push(savedMaintenance);

            if (issueId) {
                const issue = await this.issueRepo.findOne({ where: { id: issueId } });
                if (issue) {
                    issue.status = "Scheduled";
                    issue.due_date = String(body.nextSchedule || "");
                    issue.date_time_contractor_deployed = body.nextSchedule as any;
                    if (contact?.name) {
                        issue.final_contractor_name = contact.name;
                    }
                    issue.updated_by = userId;
                    await this.issueRepo.save(issue);

                    const updateText = [
                        `Maintenance scheduled for ${body.nextSchedule}.`,
                        body.workCategory ? `Work category: ${body.workCategory}.` : null,
                        contact?.name ? `POC: ${contact.name}.` : null,
                    ].filter(Boolean).join(" ");
                    const issueUpdate = this.issueUpdatesRepo.create({
                        issue,
                        updates: updateText,
                        createdBy: userId,
                    });
                    await this.issueUpdatesRepo.save(issueUpdate);
                }
            }
        }

        return savedMaintenanceLogs.length === 1 ? savedMaintenanceLogs[0] : savedMaintenanceLogs;
    }

    async updateMaintenance(body: Partial<Maintenance>, userId: string) {
        const existing = await this.maintenanceRepo.findOneBy({ id: body.id });
        if (!existing) {
            throw CustomErrorHandler.notFound(`Maintenance with ID ${body.id} not found.`);
        }

        const updated = this.maintenanceRepo.merge(existing, {
            ...body,
            updatedBy: userId
        });

        return await this.maintenanceRepo.save(updated);
    }

    async deleteMaintenance(id: number, userId: string) {
        const maintenance = await this.maintenanceRepo.findOneBy({ id });
        if (!maintenance) {
            throw CustomErrorHandler.notFound(`Maintenance with ID ${id} not found.`);
        }

        maintenance.deletedBy = userId;
        maintenance.deletedAt = new Date();

        return await this.maintenanceRepo.save(maintenance);
    }

    async getMaintenanceList(filter: MaintenanceFilter, userId: string) {
        const { listingId, workCategory, contactId, workType, fromDate, toDate, propertyType, keyword, type, page, limit, currentDate } = filter;

        let listingIds = [];
        const listingService = new ListingService();
        if (propertyType && propertyType.length > 0) {
            listingIds = (await listingService.getListingsByPropertyTypes(propertyType)).map(l => l.id);
        } else {
            listingIds = listingId;
        }

        let whereConditions = {
            ...(workCategory && { workCategory: In(workCategory) }),
            ...(listingIds && listingIds.length > 0 && { listingId: In(listingIds) }),
            ...(contactId && contactId?.length > 0 && { contactId: In(contactId) }),
            ...(fromDate && toDate && {
                nextSchedule: Between(fromDate, toDate),
            }),
        };

        const today = currentDate;

        if (type && type == "unassigned") {
            whereConditions = {
                ...whereConditions,
                contactId: IsNull()
            };
        } else if (type && type == "today") {
            whereConditions = {
                ...whereConditions,
                nextSchedule: Equal(today),
            };
        } else if (type && type == "upcoming") {
            whereConditions = {
                ...whereConditions,
                nextSchedule: MoreThan(today),
            };
        } else if (type && type == "past") {
            whereConditions = {
                ...whereConditions,
                nextSchedule: LessThan(today),
            };
        }

        if (workType && workType.length > 0 && workType.length < 3) {
            const workTypeConditions = workType.map((selectedType) => {
                if (selectedType === "issue-related") {
                    return { ...whereConditions, issueId: Not(IsNull()) };
                }
                if (selectedType === "regular") {
                    return { ...whereConditions, issueId: IsNull(), createdBy: "system" };
                }
                return { ...whereConditions, issueId: IsNull(), createdBy: Not("system") };
            });
            whereConditions = workTypeConditions as any;
        }

        const buildKeywordWhere = (conditions: any) => [
            { ...conditions, workCategory: ILike(`%${keyword}%`) },
            { ...conditions, notes: ILike(`%${keyword}%`) },
        ];

        const where = keyword
            ? Array.isArray(whereConditions)
                ? whereConditions.flatMap((condition) => buildKeywordWhere(condition))
                : buildKeywordWhere(whereConditions)
            : whereConditions;

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));
        const contacts = await this.contactRepo.find();
        const roleCategory = await this.contactRoleRepo.find();

        const [maintenanceLogs, total] = await this.maintenanceRepo.findAndCount({
            where,
            skip: (page - 1) * limit,
            take: limit,
            ...(
                type == "past" ?
                    { order: { nextSchedule: 'DESC' } } :
                    { order: { nextSchedule: 'ASC' } }
            ),
        });

        const listings = await listingService.getListings(userId);

        const transformedMaintenanceLogs = maintenanceLogs.map(logs => {
            const role = roleCategory.find(r => r.workCategory == logs.workCategory)?.role;
            return {
                ...logs,
                contactOptions: contacts.filter(c => c.listingId == logs.listingId && (c.status == "active" || c.status == "active-backup") && c.role==role),
                contact: contacts.find(contact => contact.id == logs.contactId) || null,
                createdBy: userMap.get(logs.createdBy) || logs.createdBy,
                updatedBy: userMap.get(logs.updatedBy) || logs.updatedBy,
                typeOfWork: logs.issueId ? "Issue-Related" : logs.createdBy === "system" ? "Regular" : "One-Time",
                listingName: listings.find(l => l.id == Number(logs.listingId))?.internalListingName || listings.find(l => l.id == Number(logs.listingId))?.name || "Unknown"
            };
        });

        return { maintenanceLogs: transformedMaintenanceLogs, total };

    }

    async exportMaintenanceToExcel(filter: MaintenanceFilter, userId: string) {
        // Fetch the filtered list using the existing logic
        filter.page = 1;
        filter.limit = 10000; // Large limit to get all matching records for export
        const result = await this.getMaintenanceList(filter, userId);
        logger.info(`Exporting ${result.maintenanceLogs.length} maintenance logs for user ${userId}`);

        const formattedData = result.maintenanceLogs.map((log: any) => ({
            Date: log.nextSchedule ? format(new Date(log.nextSchedule), 'yyyy-MM-dd') : "-",
            Property: log.listingName,
            "Work Category": log.workCategory,
            "Type of Work": log.typeOfWork,
            Issue: log.issueId ? `Issue #${log.issueId}` : "-",
            Assignee: log.contact ? log.contact.name : "-",
            "Vendor Role": log.contact ? log.contact.role : "-",
            Notes: log.notes || "-",
            "Assigned By": log.createdBy
        }));

        const worksheet = XLSX.utils.json_to_sheet(formattedData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "MaintenanceLogs");

        const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
        return excelBuffer;
    }


    async automateMaintenanceLogs() {
        // Fetch all available listingSchedules
        const listingSchedules = await this.listingScheduleRepo.find();
        const contactRoles = await this.contactRoleRepo.find();
        if (!listingSchedules || listingSchedules.length === 0) {
            logger.info("No listing details found to automate maintenance logs.");
            return;
        }
        // Iterate through each listing schedule
        for (const schedule of listingSchedules) {
            logger.info(`Processing listing schedule: ListingId ${schedule.listingId}`);
            if (!schedule.scheduleType) {
                logger.info(`Schedule type not found for listingId ${schedule.listingId}(skipped)`);
                continue;
            }
            const nextSchedules = await this.getDateForNextMaintenance(schedule);
            for (const nextSchedule of nextSchedules) {
                await this.createMaintenanceLog(schedule, nextSchedule, contactRoles);
                logger.info(`Maintenance log created for listingId: ${schedule.listingId} for ${nextSchedule}`);
            }
        }
    }

    private async createMaintenanceLog(listingSchedule: ListingSchedule, nextSchedule: string, contactRoles: ContactRole[]) {
        const role = contactRoles.find(d => d.workCategory == listingSchedule.workCategory).role;
        const contacts = await this.contactRepo.find({
            where: {
                status: In(["active", "active-backup"]),
                listingId: String(listingSchedule.listingId),
                role: role
            }
        });

        //check if the maintenance log is already present for the nextSchedule
        const existingMaintenenace = await this.maintenanceRepo.find({
            where: {
                listingId: String(listingSchedule.listingId),
                nextSchedule: nextSchedule,
                workCategory: listingSchedule.workCategory
            }
        });

        if (existingMaintenenace.length > 0) {
            logger.info(`Maintenance log for the listingId ${listingSchedule.listingId} (workCategory:${listingSchedule.workCategory} nextSchedule:${nextSchedule}) already exists`);
            return 
        }

        const maintenance = new Maintenance();
        maintenance.listingId = String(listingSchedule.listingId);
        maintenance.workCategory = listingSchedule.workCategory;
        maintenance.nextSchedule = nextSchedule;
        maintenance.createdBy = "system";
        maintenance.contactId = contacts.length === 1 ? contacts[0].id : null;
        await this.maintenanceRepo.save(maintenance);
    }

    private async getDateForNextMaintenance(listingSchedule: ListingSchedule) {
        const currentDate = new Date();

        // Determine the next 30 days maintenance date based on schedule type
        // "weekly", "bi-weekly", "monthly", "quarterly", "annually", "check-out basis","as required"
        switch (listingSchedule.scheduleType) {
            case 'weekly': {
                // Calculate next maintenance date for weekly schedule
                const dayOfWeek = JSON.parse(listingSchedule.dayOfWeek);
                const nextSchedule = this.getUpcomingDatesForWeek(dayOfWeek);
                if (nextSchedule.length > 0) {
                    logger.info(`upcoming dates for weekly maintenance: ${nextSchedule.map(date => format(date, 'yyyy-MM-dd'))}`);
                }
                return nextSchedule;
                break;
            }
            case 'bi-weekly': {
                // Calculate next maintenance date for bi-weekly schedule
                const dayOfWeek = JSON.parse(listingSchedule.dayOfWeek);
                const nextSchedule = this.getBiWeeklyDatesFromToday(dayOfWeek);
                if (nextSchedule.length > 0) {
                    logger.info(`upcoming dates for bi-weekly maintenance: ${nextSchedule.map(date => format(date, 'yyyy-MM-dd'))}`);
                }
                return nextSchedule;
                break;
            }
            case 'monthly': {
                // Calculate next maintenance date for monthly schedule
                const dayOfMonth = listingSchedule.dayOfMonth;
                const dayOfWeek = JSON.parse(listingSchedule.dayOfWeek);
                const weekOfMonth = listingSchedule.weekOfMonth;

                let nextSchedule = [];
                if (dayOfMonth) {
                    nextSchedule = this.getThreeMonthsDatesFromToday(dayOfMonth);
                    logger.info('upcoming dates for monthly maintenance based on dayOfMonth: ' + nextSchedule.map(date => date));
                    return nextSchedule;
                } else if (dayOfWeek && weekOfMonth) {
                    nextSchedule = this.getUpcomingDatesForMonth(dayOfWeek, weekOfMonth);
                    logger.info('upcoming dates for monthly maintenance based on dayOfWeek and weekOfMonth: ' + nextSchedule.map(date => date));
                    return nextSchedule;
                }
                break;
            }
            case 'quarterly': {
                // Calculate next maintenance date for quarterly schedule
                const intervalMonth = listingSchedule.intervalMonth;
                const dayOfWeek = JSON.parse(listingSchedule.dayOfWeek);
                const weekOfMonth = listingSchedule.weekOfMonth;

                const dayOfMonth = listingSchedule.dayOfMonth;
                let nextSchedule = [];
                if (dayOfMonth && intervalMonth) {
                    nextSchedule = this.getQuarterlyDatesBasedOnDayOfMonth(dayOfMonth, intervalMonth);
                    logger.info('upcoming dates for quarterly maintenance based on dayOfMonth: ' + nextSchedule.map(date => date));
                    return nextSchedule;
                } else if (dayOfWeek && weekOfMonth && intervalMonth) {
                    nextSchedule = this.getQuarterlyDatesFromToday(dayOfWeek, weekOfMonth, intervalMonth);
                    logger.info('upcoming dates for quarterly maintenance based on dayOfWeek and weekOfMonth: ' + nextSchedule.map(date => date));
                    return nextSchedule;
                }

                break;
            }
            case 'annually': {
                // Calculate next maintenance date for annual schedule
                const intervalMonth = listingSchedule.intervalMonth;
                const dayOfWeek = JSON.parse(listingSchedule.dayOfWeek);
                const weekOfMonth = listingSchedule.weekOfMonth;

                const dayOfMonth = listingSchedule.dayOfMonth;
                let nextSchedule = [];
                if (dayOfMonth && intervalMonth) {
                    nextSchedule = this.getAnuallyDatesBasedOnDayOfMonth(dayOfMonth, intervalMonth);
                    logger.info('upcoming dates for annual maintenance based on dayOfMonth: ' + nextSchedule.map(date => date));
                    return nextSchedule;
                } else if (dayOfWeek && weekOfMonth && intervalMonth) {
                    nextSchedule = this.getAnuallyDatesFromToday(dayOfWeek, weekOfMonth, intervalMonth);
                    logger.info('upcoming dates for annual maintenance based on dayOfWeek and weekOfMonth: ' + nextSchedule.map(date => date));
                    return nextSchedule;
                }
                break;
            }
            case 'check-out basis':
                const reservations = await appDatabase.getRepository(ReservationInfoEntity).find({
                    where: {
                        departureDate: MoreThan(currentDate),
                        listingMapId: listingSchedule.listingId,
                        status: In(["new", "modified", "ownerStay"])
                    },
                    order: {
                        departureDate: "ASC"
                    },
                    take: 4
                });
                const nextSchedule = reservations.map(r => r.departureDate);
                return nextSchedule;
                break;
            case 'as required':
                break;
            default:

        }
    }

    private getUpcomingDatesForWeek(dayList: number[]) {
        const today = new Date();
        const endDate = addDays(today, 30);
        const result: string[] = [];

        // Iterate from today to 30 days ahead
        for (let i = 0; i <= 30; i++) {
            const current = addDays(today, i);
            const day = current.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

            if (dayList.includes(day)) {
                result.push(format(current, 'yyyy-MM-dd'));
            }
        }

        return result;
    }

    /**
     * Returns bi-weekly dates for the current and next month based on the provided dayList.
     * @param dayList - Array of days (0-6) representing the days of the week (0 = Sunday, 1 = Monday, ..., 6 = Saturday).
     * @returns Array of formatted date strings in 'yyyy-MM-dd' format.
     */

    private getBiWeeklyDatesFromToday(dayList: number[]): string[] {
        const today = new Date();
        const result: string[] = [];

        for (let offset = 0; offset <= 1; offset++) {
            const monthDate = addMonths(today, offset);
            const monthStart = startOfMonth(monthDate);
            const monthEnd = endOfMonth(monthDate);

            const allDaysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

            for (const targetDay of dayList) {
                const matchingDays = allDaysInMonth.filter(
                    (date) => getDay(date) === targetDay
                );

                // Pick 2nd, 4th, etc. (i = 1, 3, ...)
                for (let i = 1; i < matchingDays.length; i += 2) {
                    const match = matchingDays[i];

                    // Only include if the date is today or in future
                    if (isAfter(match, today) || isEqual(match, today)) {
                        result.push(format(match, 'yyyy-MM-dd'));
                    }
                }
            }
        }

        return result.sort();
    }

    private getThreeMonthsDatesFromToday(dateOfMonth: number): string[] {
        const today = new Date();
        const result: string[] = [];

        for (let offset = 0; offset < 3; offset++) {
            const monthDate = addMonths(today, offset);
            let targetDate = setDate(monthDate, dateOfMonth);

            // Ensure the date is valid (e.g., Feb 30 becomes Mar 2 — we should skip such cases)
            if (targetDate.getMonth() !== monthDate.getMonth()) {
                continue; // invalid date for that month
            }

            // Exclude if it's the current month and the date is in the past
            if (offset === 0 && isAfter(today, targetDate)) {
                continue;
            }

            // Include if today or a future date
            if (isEqual(today, targetDate) || isAfter(targetDate, today)) {
                result.push(format(targetDate, 'yyyy-MM-dd'));
            }
        }

        return result.sort();
    }

    private getUpcomingDatesForMonth(dayOfWeek: number[], weekOfMonth: number): string[] {
        const today = new Date();
        const result: string[] = [];

        for (let offset = 0; offset < 3; offset++) {
            const baseMonth = addMonths(today, offset);
            const monthStart = startOfMonth(baseMonth);
            const monthEnd = endOfMonth(baseMonth);

            const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

            for (const weekday of dayOfWeek) {
                const matchingDates = allDays.filter(date => {
                    const day = getDay(date); // 0 = Sunday ... 6 = Saturday
                    const dateNum = getDate(date);

                    // Check if it's the desired weekday and falls in the selected week range
                    const weekRanges = {
                        1: [1, 7],
                        2: [8, 14],
                        3: [15, 21],
                        4: [22, 28],
                        5: [29, 31] // will be bounded by endOfMonth anyway
                    };

                    const [minDate, maxDate] = weekRanges[weekOfMonth];
                    return day === weekday && dateNum >= minDate && dateNum <= maxDate;
                });

                for (const date of matchingDates) {
                    if (isAfter(date, today) || isEqual(date, today)) {
                        result.push(format(date, 'yyyy-MM-dd'));
                    }
                }
            }
        }

        return result.sort();
    }

    private getQuarterlyDatesFromToday(
        dayOfWeek: number[],
        weekOfMonth: number,
        intervalMonth: number // 1 = Jan, 2 = Feb, ..., 3 = Mar (relative month in quarter)
    ): string[] {
        const today = new Date();
        const currentYear = getYear(today);
        const result: string[] = [];

        // Generate actual months: Q1 = Jan+0, Q2 = Apr+0, Q3 = Jul+0, Q4 = Oct+0 → then add (intervalMonth - 1)
        const quarterStarts = [0, 3, 6, 9];
        const quarterlyMonths = quarterStarts.map(q => q + (intervalMonth - 1));

        for (const monthIndex of quarterlyMonths) {
            const baseMonth = new Date(currentYear, monthIndex, 1);

            // Skip whole month if it's fully past
            if (isAfter(today, endOfMonth(baseMonth))) continue;

            const monthStart = startOfMonth(baseMonth);
            const monthEnd = endOfMonth(baseMonth);
            const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

            for (const weekday of dayOfWeek) {
                const matchingDates = allDays.filter(date => {
                    const day = getDay(date); // 0 = Sun, 5 = Fri
                    const dateNum = getDate(date);

                    const weekRanges = {
                        1: [1, 7],
                        2: [8, 14],
                        3: [15, 21],
                        4: [22, 28],
                        5: [29, 31],
                    };

                    const [minDate, maxDate] = weekRanges[weekOfMonth];
                    return day === weekday && dateNum >= minDate && dateNum <= maxDate;
                });

                for (const date of matchingDates) {
                    if (isEqual(date, today) || isAfter(date, today)) {
                        result.push(format(date, 'yyyy-MM-dd'));
                    }
                }
            }
        }

        return result.sort();
    }

    private getQuarterlyDatesBasedOnDayOfMonth(dateOfMonth: number, intervalMonth: number): string[] {
        const today = new Date();
        const currentYear = getYear(today);
        const result: string[] = [];

        const quarterlyMonths = [0, 1, 2, 3]
            .map(i => intervalMonth - 1 + i * 3)
            .filter(month => month < 12); // valid months within this year

        for (const month of quarterlyMonths) {
            const baseDate = new Date(currentYear, month, 1);
            const targetDate = setDate(baseDate, dateOfMonth);

            // If it overflows into next month (e.g., Feb 30 → Mar 1), skip
            if (targetDate.getMonth() !== month) continue;

            if (isEqual(targetDate, today) || isAfter(targetDate, today)) {
                result.push(format(targetDate, 'yyyy-MM-dd'));
            }
        }

        return result.sort();
    }

    private getAnuallyDatesBasedOnDayOfMonth(dateOfMonth: number, intervalMonth: number): string[] {
        const today = new Date();
        const currentYear = getYear(today);
        const result: string[] = [];

        for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
            const year = currentYear + yearOffset;

            const baseDate = new Date(year, intervalMonth - 1, 1); // month is 0-indexed
            const targetDate = setDate(baseDate, dateOfMonth);

            // Skip invalid dates (e.g., Feb 30 → Mar 1)
            if (targetDate.getMonth() !== intervalMonth - 1) continue;

            if (isEqual(targetDate, today) || isAfter(targetDate, today)) {
                result.push(format(targetDate, 'yyyy-MM-dd'));
            }
        }

        return result;
    }

    private getAnuallyDatesFromToday(
        dayOfWeek: number[],
        weekOfMonth: number,
        intervalMonth: number
    ): string[] {
        const today = new Date();
        const currentYear = getYear(today);
        const result: string[] = [];

        const weekRanges: Record<number, [number, number]> = {
            1: [1, 7],
            2: [8, 14],
            3: [15, 21],
            4: [22, 28],
            5: [29, 31]
        };

        for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
            const year = currentYear + yearOffset;
            const month = intervalMonth - 1; // zero-based
            const monthStart = new Date(year, month, 1);
            const monthEnd = endOfMonth(monthStart);

            const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

            for (const weekday of dayOfWeek) {
                const [minDate, maxDate] = weekRanges[weekOfMonth];
                const match = allDays.find(date => {
                    const day = getDay(date);
                    const dateNum = getDate(date);
                    return day === weekday && dateNum >= minDate && dateNum <= maxDate;
                });

                if (match && (isEqual(match, today) || isAfter(match, today))) {
                    result.push(format(match, 'yyyy-MM-dd'));
                }
            }
        }

        return result.sort();
    }

}
