import { ListingDetail } from "../entity/ListingDetails";
import { Maintenance } from "../entity/Maintenance";
import CustomErrorHandler from "../middleware/customError.middleware";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { addDays, addMonths, eachDayOfInterval, endOfMonth, format, getDate, getDay, getYear, isAfter, isEqual, setDate, startOfMonth } from "date-fns";

export class MaintenanceService {
    private maintenanceRepo = appDatabase.getRepository(Maintenance);
    private listingDetailRepo = appDatabase.getRepository(ListingDetail);

    async createMaintenance(body: Partial<Maintenance>, userId: string) {
        const maintenance = this.maintenanceRepo.create({
            ...body,
            createdBy: userId,
            updatedBy: userId
        });
        return await this.maintenanceRepo.save(maintenance);
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


    async automateMaintenanceLogs() {
        // Fetch all available listingDetails
        const listingDetails = await this.listingDetailRepo.find();
        if (!listingDetails || listingDetails.length === 0) {
            logger.info("No listing details found to automate maintenance logs.");
            return;
        }
        // Iterate through each listing detail
        for (const detail of listingDetails) {
            logger.info(`Processing listing detail: ListingId ${detail.listingId}`);
            const currentDate = format(new Date(), 'yyyy-MM-dd');
            const result = await this.getDateForNextMaintenance(detail);
            logger.info(result)
        }
    }

    async getDateForNextMaintenance(listingDetail: ListingDetail) {
        const currentDate = new Date();

        // Determine the next 30 days maintenance date based on schedule type
        // "weekly", "bi-weekly", "monthly", "quarterly", "annually", "check-out basis","as required"
        switch (listingDetail.scheduleType) {
            case 'weekly': {
                // Calculate next maintenance date for weekly schedule
                const dayOfWeek = JSON.parse(listingDetail.dayOfWeek);
                const nextSchedule = this.getUpcomingDatesForWeek(dayOfWeek);
                if (nextSchedule.length > 0) {
                    logger.info(`upcoming dates for weekly maintenance: ${nextSchedule.map(date => format(date, 'yyyy-MM-dd'))}`);
                }
                return nextSchedule;
                break;
            }
            case 'bi-weekly': {
                // Calculate next maintenance date for bi-weekly schedule
                const dayOfWeek = JSON.parse(listingDetail.dayOfWeek);
                const nextSchedule = this.getBiWeeklyDatesFromToday(dayOfWeek);
                if (nextSchedule.length > 0) {
                    logger.info(`upcoming dates for bi-weekly maintenance: ${nextSchedule.map(date => format(date, 'yyyy-MM-dd'))}`);
                }
                return nextSchedule;
                break;
            }
            case 'monthly': {
                // Calculate next maintenance date for monthly schedule
                const dayOfMonth = listingDetail.dayOfMonth;
                const dayOfWeek = JSON.parse(listingDetail.dayOfWeek);
                const weekOfMonth = listingDetail.weekOfMonth;

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
                const intervalMonth = listingDetail.intervalMonth;
                const dayOfWeek = JSON.parse(listingDetail.dayOfWeek);
                const weekOfMonth = listingDetail.weekOfMonth;

                const dayOfMonth = listingDetail.dayOfMonth;
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
            case 'annually':
                break;
            case 'check-out basis':
                break;
            case 'as required':
                break;
            default:

        }
    }

    getUpcomingDatesForWeek(dayList: number[]) {
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

    getBiWeeklyDatesFromToday(dayList: number[]): string[] {
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

    getThreeMonthsDatesFromToday(dateOfMonth: number): string[] {
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

    getUpcomingDatesForMonth(dayOfWeek: number[], weekOfMonth: number): string[] {
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

    getQuarterlyDatesFromToday(
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

    getQuarterlyDatesBasedOnDayOfMonth(dateOfMonth: number, intervalMonth: number): string[] {
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



}