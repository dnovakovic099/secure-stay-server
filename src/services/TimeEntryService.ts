import { appDatabase } from "../utils/database.util";
import { TimeEntryEntity } from "../entity/TimeEntry";
import { UsersEntity } from "../entity/Users";
import { DepartmentEntity } from "../entity/Department";
import { UserDepartmentEntity } from "../entity/UserDepartment";
import { OvertimeRequestEntity } from "../entity/OvertimeRequest";
import { Between, In, LessThanOrEqual, MoreThanOrEqual } from "typeorm";
import logger from "../utils/logger.utils";


interface TimeEntryFilters {
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
}

interface TimeEntrySummary {
    totalSeconds: number;
    totalEntries: number;
    formattedDuration: string;
}

export class TimeEntryService {
    private timeEntryRepository = appDatabase.getRepository(TimeEntryEntity);
    private usersRepository = appDatabase.getRepository(UsersEntity);
    private departmentRepository = appDatabase.getRepository(DepartmentEntity);
    private userDepartmentRepository = appDatabase.getRepository(UserDepartmentEntity);
    private overtimeRequestRepository = appDatabase.getRepository(OvertimeRequestEntity);

    // Constants for computation
    private readonly TWELVE_HOURS_SECONDS = 12 * 60 * 60;


    /**
     * Clock-in for a user
     */
    async clockIn(userId: number) {
        // Check if user exists
        const user = await this.usersRepository.findOne({
            where: { id: userId, deletedAt: null as any },
        });

        if (!user) {
            return { success: false, message: "User not found" };
        }

        // Check if user already has an active clock-in
        const activeEntry = await this.timeEntryRepository.findOne({
            where: { userId, status: 'active' },
        });

        if (activeEntry) {
            return {
                success: false,
                message: "You are already clocked in. Please clock out first.",
                entry: activeEntry
            };
        }

        // Create new time entry with UTC time
        const now = new Date();
        const utcDate = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            now.getUTCHours(),
            now.getUTCMinutes(),
            now.getUTCSeconds(),
            now.getUTCMilliseconds()
        ));

        const entry = await this.timeEntryRepository.save({
            userId,
            clockInAt: utcDate,
            status: 'active' as const,
        });

        return {
            success: true,
            message: "Successfully clocked in",
            entry
        };
    }

    /**
     * Clock-out for a user
     */
    async clockOut(userId: number, notes?: string) {
        // Find active clock-in entry
        const activeEntry = await this.timeEntryRepository.findOne({
            where: { userId, status: 'active' },
        });

        if (!activeEntry) {
            return {
                success: false,
                message: "You are not currently clocked in."
            };
        }

        // Fetch user's dailyHourLimit
        const user = await this.usersRepository.findOne({
            where: { id: userId },
            select: ['id', 'dailyHourLimit']
        });
        const dailyHourLimit = user?.dailyHourLimit ?? null;

        // Get current UTC time
        const now = new Date();
        const clockOutAt = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            now.getUTCHours(),
            now.getUTCMinutes(),
            now.getUTCSeconds(),
            now.getUTCMilliseconds()
        ));

        const clockInAt = new Date(activeEntry.clockInAt);
        const durationSeconds = Math.floor((clockOutAt.getTime() - clockInAt.getTime()) / 1000);

        // Get all completed entries for this user on the same day (based on clock-in date)
        const previousRawSeconds = await this.getPreviousRawSeconds(userId, clockInAt);

        logger.info(`Clock-out for user ${userId}: Previous raw total today = ${this.formatDuration(previousRawSeconds)}, Current session = ${this.formatDuration(durationSeconds)}, Daily limit = ${dailyHourLimit}h`);

        // Compute duration with daily total consideration
        const { computedSeconds, isOvertime, overtimeSeconds, isMissedClockout, totalDailyActualSeconds } =
            this.calculateComputedDurationWithDailyTotal(
                durationSeconds,
                dailyHourLimit,
                previousRawSeconds
            );

        // Update the entry
        await this.timeEntryRepository.update(activeEntry.id, {
            clockOutAt,
            duration: durationSeconds,
            computedDuration: computedSeconds,
            isMissedClockout,
            hasOvertimeRequest: isOvertime,
            notes: notes || null,
            status: 'completed' as const,
        });

        // Create or update overtime request if needed
        if (isOvertime) {
            const capSeconds = (dailyHourLimit || 8) * 3600;
            logger.info(`Creating/updating overtime request: entryId=${activeEntry.id}, dailyTotalActual=${this.formatDuration(totalDailyActualSeconds)}, cap=${this.formatDuration(capSeconds)}, totalOvertime=${this.formatDuration(overtimeSeconds)}`);
            await this.createOrUpdateDailyOvertimeRequest(
                activeEntry.id,
                userId,
                totalDailyActualSeconds,
                capSeconds,
                overtimeSeconds,
                clockInAt, // date for grouping
                isMissedClockout
            );
        } else {
            logger.info(`No overtime for user ${userId}: computed=${this.formatDuration(computedSeconds)}, totalActualDay=${this.formatDuration(totalDailyActualSeconds)}`);
        }

        const updatedEntry = await this.timeEntryRepository.findOne({
            where: { id: activeEntry.id },
        });

        return {
            success: true,
            message: "Successfully clocked out",
            entry: updatedEntry,
            duration: this.formatDuration(durationSeconds),
            computedDuration: this.formatDuration(computedSeconds),
            isOvertime,
            isMissedClockout,
            dailyTotal: this.formatDuration(totalDailyActualSeconds)
        };
    }

    /**
     * Get current clock-in status for a user
     */
    async getCurrentStatus(userId: number) {
        const activeEntry = await this.timeEntryRepository.findOne({
            where: { userId, status: 'active' },
        });

        if (activeEntry) {
            const clockInAt = new Date(activeEntry.clockInAt);
            const now = new Date();
            const elapsedSeconds = Math.floor((now.getTime() - clockInAt.getTime()) / 1000);

            return {
                isClockedIn: true,
                entry: activeEntry,
                elapsedSeconds,
                elapsedFormatted: this.formatDuration(elapsedSeconds),
            };
        }

        return {
            isClockedIn: false,
            entry: null,
            elapsedSeconds: 0,
            elapsedFormatted: null,
        };
    }

    /**
     * Get time entries for a user with pagination and filters
     */
    async getTimeEntries(userId: number, filters: TimeEntryFilters) {
        const page = filters.page || 1;
        const limit = filters.limit || 10;
        const offset = (page - 1) * limit;

        const queryBuilder = this.timeEntryRepository
            .createQueryBuilder("entry")
            .where("entry.userId = :userId", { userId });

        // Apply date filters
        if (filters.startDate) {
            queryBuilder.andWhere("entry.clockInAt >= :startDate", {
                startDate: new Date(filters.startDate)
            });
        }

        if (filters.endDate) {
            const endDate = new Date(filters.endDate);
            endDate.setHours(23, 59, 59, 999);
            queryBuilder.andWhere("entry.clockInAt <= :endDate", { endDate });
        }

        const [entries, total] = await queryBuilder
            .orderBy("entry.clockInAt", "DESC")
            .skip(offset)
            .take(limit)
            .getManyAndCount();

        // Format entries with human-readable durations
        const formattedEntries = entries.map(entry => ({
            ...entry,
            durationFormatted: entry.duration ? this.formatDuration(entry.duration) : null,
        }));

        return {
            data: formattedEntries,
            total,
            page,
            limit,
        };
    }

    /**
     * Get summary of time entries for a date range
     */
    async getSummary(userId: number, startDate?: string, endDate?: string): Promise<TimeEntrySummary> {
        const queryBuilder = this.timeEntryRepository
            .createQueryBuilder("entry")
            .where("entry.userId = :userId", { userId })
            .andWhere("entry.status = :status", { status: 'completed' });

        if (startDate) {
            queryBuilder.andWhere("entry.clockInAt >= :startDate", {
                startDate: new Date(startDate)
            });
        }

        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            queryBuilder.andWhere("entry.clockInAt <= :endDate", { endDate: end });
        }

        const entries = await queryBuilder.getMany();

        const totalSeconds = entries.reduce((sum, entry) => sum + (entry.duration || 0), 0);

        return {
            totalSeconds,
            totalEntries: entries.length,
            formattedDuration: this.formatDuration(totalSeconds),
        };
    }

    /**
     * Get today's summary for a user (based on UTC day)
     * Note: "Today" is calculated in UTC to match the stored times
     */
    async getTodaySummary(userId: number): Promise<TimeEntrySummary> {
        // Get start of today in UTC
        const now = new Date();
        const startOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
        const endOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

        return this.getSummaryByDateRange(userId, startOfDayUTC, endOfDayUTC);
    }

    /**
     * Get this week's summary for a user (based on UTC week, starting Sunday)
     */
    async getWeekSummary(userId: number): Promise<TimeEntrySummary> {
        const now = new Date();
        const dayOfWeek = now.getUTCDay();

        // Start of week (Sunday) in UTC
        const startOfWeekUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek, 0, 0, 0, 0));
        const endOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

        return this.getSummaryByDateRange(userId, startOfWeekUTC, endOfDayUTC);
    }

    /**
     * Get this month's summary for a user (based on UTC month)
     */
    async getMonthSummary(userId: number): Promise<TimeEntrySummary> {
        const now = new Date();

        // Start of month in UTC
        const startOfMonthUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
        const endOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

        return this.getSummaryByDateRange(userId, startOfMonthUTC, endOfDayUTC);
    }

    /**
     * Get summary by specific date range (using Date objects directly for UTC precision)
     */
    private async getSummaryByDateRange(userId: number, startDate: Date, endDate: Date): Promise<TimeEntrySummary> {
        const queryBuilder = this.timeEntryRepository
            .createQueryBuilder("entry")
            .where("entry.userId = :userId", { userId })
            .andWhere("entry.status = :status", { status: 'completed' })
            .andWhere("entry.clockInAt >= :startDate", { startDate })
            .andWhere("entry.clockInAt <= :endDate", { endDate });

        const entries = await queryBuilder.getMany();

        const totalSeconds = entries.reduce((sum, entry) => sum + (entry.duration || 0), 0);

        return {
            totalSeconds,
            totalEntries: entries.length,
            formattedDuration: this.formatDuration(totalSeconds),
        };
    }

    /**
     * Soft delete a time entry
     */
    async softDelete(userId: number, entryId: number, deletedByUserId: number) {
        const entry = await this.timeEntryRepository.findOne({
            where: { id: entryId, userId },
        });

        if (!entry) {
            return { success: false, message: "Time entry not found" };
        }

        // Set deletedBy before soft delete
        await this.timeEntryRepository.update(entryId, { deletedBy: deletedByUserId });

        // Use TypeORM soft delete
        await this.timeEntryRepository.softDelete(entryId);

        return { success: true, message: "Time entry deleted successfully" };
    }

    /**
     * Update notes for a time entry
     */
    async updateNotes(userId: number, entryId: number, notes: string) {
        const entry = await this.timeEntryRepository.findOne({
            where: { id: entryId, userId },
        });

        if (!entry) {
            return { success: false, message: "Time entry not found" };
        }

        await this.timeEntryRepository.update(entryId, { notes });

        const updatedEntry = await this.timeEntryRepository.findOne({
            where: { id: entryId },
        });

        return {
            success: true,
            message: "Notes updated successfully",
            entry: updatedEntry
        };
    }


    /**
     * Get admin overview for all users and departments
     */
    async getAdminOverview() {
        const now = new Date();
        const startOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
        const endOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

        // 1. Total active users
        const totalUsers = await this.usersRepository.count({
            where: { isActive: true, deletedAt: null as any }
        });

        // 2. Currently clocked in users (unique user count)
        const activeEntries = await this.timeEntryRepository.find({
            where: { status: 'active' },
            select: ['userId']
        });
        const clockedInUserIds = [...new Set(activeEntries.map(e => e.userId))];
        const clockedInCount = clockedInUserIds.length;

        // 3. Users who completed a session today
        const completedToday = await this.timeEntryRepository.find({
            where: {
                status: 'completed',
                clockInAt: Between(startOfDayUTC, endOfDayUTC)
            },
            select: ['userId']
        });
        const clockedOutUserIds = [...new Set(completedToday.map(e => e.userId))];
        const clockedOutCount = clockedOutUserIds.length;

        // 4. Department wise stats
        const departments = await this.departmentRepository.find({
            where: { deletedAt: null as any }
        });

        const departmentStats = await Promise.all(departments.map(async (dept) => {
            // Get all user ids in this department
            const userDepts = await this.userDepartmentRepository.find({
                where: { departmentId: dept.id },
                select: ['userId']
            });
            const deptUserIds = userDepts.map(ud => ud.userId);

            if (deptUserIds.length === 0) {
                return {
                    id: dept.id,
                    name: dept.name,
                    clockedIn: 0,
                    clockedOutToday: 0,
                    totalUsers: 0
                };
            }

            // 1. Get active user IDs for this department
            const activeSessionEntries = await this.timeEntryRepository.find({
                where: {
                    userId: In(deptUserIds),
                    status: 'active',
                    deletedAt: null as any
                },
                select: ['userId']
            });
            const activeUserIds = [...new Set(activeSessionEntries.map(e => e.userId))];

            // 2. Count distinct users who clocked out today in this department
            const clockedOutTodayResults = await this.timeEntryRepository.createQueryBuilder("entry")
                .where("entry.userId IN (:...ids)", { ids: deptUserIds })
                .andWhere("entry.status = :status", { status: 'completed' })
                .andWhere("entry.clockInAt >= :start", { start: startOfDayUTC })
                .andWhere("entry.clockInAt <= :end", { end: endOfDayUTC })
                .andWhere("entry.deletedAt IS NULL")
                .select("DISTINCT entry.userId", "userId")
                .getRawMany();

            // 3. Fetch user details separately for reliability
            let activeUsers: any[] = [];
            if (activeUserIds.length > 0) {
                const users = await this.usersRepository.find({
                    where: { id: In(activeUserIds) },
                    select: ['id', 'firstName', 'lastName', 'email']
                });

                activeUsers = users.map(u => ({
                    id: u.id,
                    name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Active User',
                    email: u.email || 'No email provided'
                }));
            }

            // Diagnostic log
            if (activeSessionEntries.length > 0) {
                logger.info(`[AdminOverview] Dept: ${dept.name}, Active IDs: ${activeUserIds.length}, Mapped Users: ${activeUsers.length}`);
            }

            return {
                id: dept.id,
                name: dept.name,
                clockedIn: activeUserIds.length,
                clockedOutToday: clockedOutTodayResults.length,
                totalUsers: deptUserIds.length,
                activeUsers
            };
        }));

        return {
            totalUsers,
            clockedIn: clockedInCount,
            clockedOutToday: clockedOutCount,
            departmentStats
        };
    }


    /**
     * Get all time entries for admin view (all users)
     */
    async getAllTimeEntriesAdmin(filters: any) {
        const page = filters.page || 1;
        const limit = filters.limit || 10;
        const offset = (page - 1) * limit;

        const queryBuilder = this.timeEntryRepository
            .createQueryBuilder("entry")
            .leftJoinAndSelect("entry.user", "user")
            .where("user.deletedAt IS NULL");

        // Apply search filter
        if (filters.search) {
            queryBuilder.andWhere(
                "(user.firstName LIKE :search OR user.lastName LIKE :search OR user.email LIKE :search)",
                { search: `%${filters.search}%` }
            );
        }

        // Apply status filter
        if (filters.status) {
            queryBuilder.andWhere("entry.status = :status", { status: filters.status });
        }

        // Apply date filters
        if (filters.startDate) {
            queryBuilder.andWhere("entry.clockInAt >= :startDate", {
                startDate: new Date(filters.startDate)
            });
        }

        if (filters.endDate) {
            const endDate = new Date(filters.endDate);
            endDate.setHours(23, 59, 59, 999);
            queryBuilder.andWhere("entry.clockInAt <= :endDate", { endDate });
        }

        const [entries, total] = await queryBuilder
            .orderBy("entry.clockInAt", "DESC")
            .skip(offset)
            .take(limit)
            .getManyAndCount();

        // Format entries and add user info
        const formattedEntries = await Promise.all(entries.map(async (entry) => {
            const userDepts = await this.userDepartmentRepository.find({
                where: { userId: entry.userId },
                relations: ["department"]
            });

            return {
                ...entry,
                userName: `${entry.user?.firstName || ''} ${entry.user?.lastName || ''}`.trim(),
                userEmail: entry.user?.email,
                departments: userDepts.map(ud => ud.department?.name).filter(Boolean),
                durationFormatted: entry.duration ? this.formatDuration(entry.duration) : null,
            };
        }));

        return {
            data: formattedEntries,
            total,
            page,
            limit,
        };
    }

    /**
     * Format duration in seconds to human-readable format
     */
    formatDuration(totalSeconds: number): string {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    /**
     * Calculate computed duration based on business rules:
     * - Round down to nearest hour
     * - Cap at user's dailyHourLimit if exceeded
     */
    private calculateComputedDuration(
        actualDurationSeconds: number,
        dailyHourLimit: number | null
    ): {
        computedSeconds: number;
        isOvertime: boolean;
        overtimeSeconds: number;
        isMissedClockout: boolean;
    } {
        const isMissedClockout = actualDurationSeconds > this.TWELVE_HOURS_SECONDS;

        // Step 1: Round down to nearest full hour
        const fullHours = Math.floor(actualDurationSeconds / 3600);
        let computedSeconds = fullHours * 3600;

        // Step 2: Apply daily cap if set
        let isOvertime = false;
        let overtimeSeconds = 0;
        if (dailyHourLimit !== null && dailyHourLimit > 0) {
            const capSeconds = dailyHourLimit * 3600;
            if (computedSeconds > capSeconds) {
                overtimeSeconds = computedSeconds - capSeconds;
                computedSeconds = capSeconds;
                isOvertime = true;
            }
            // For missed clockout, cap at daily limit
            if (isMissedClockout && computedSeconds > capSeconds) {
                computedSeconds = capSeconds;
            }
        }

        return { computedSeconds, isOvertime, overtimeSeconds, isMissedClockout };
    }

    /**
     * Calculate computed duration considering previous sessions in the same day.
     * The daily cap is applied against the cumulative total, not individual sessions.
     * 
     * Key behaviors:
     * 1. If previous sessions already exceed cap, current session = 0, flag remaining overtime
     * 2. If current session pushes total over cap, flag the excess as overtime
     * 3. Overtime is the TOTAL excess over the daily cap (cumulative)
     */
    private calculateComputedDurationWithDailyTotal(
        actualDurationSeconds: number,
        dailyHourLimit: number | null,
        previousRawSeconds: number
    ): {
        computedSeconds: number;
        isOvertime: boolean;
        overtimeSeconds: number;
        isMissedClockout: boolean;
        totalDailyActualSeconds: number;
    } {
        const isMissedClockout = actualDurationSeconds > this.TWELVE_HOURS_SECONDS;

        // Step 1: Calculate total raw duration for the work day
        const totalRawSeconds = previousRawSeconds + actualDurationSeconds;

        // Step 2: Round down the total daily work to the nearest full hour
        const totalDailyActualSeconds = Math.floor(totalRawSeconds / 3600) * 3600;

        let computedSeconds = 0;
        let isOvertime = false;
        let overtimeSeconds = 0;

        if (dailyHourLimit !== null && dailyHourLimit > 0) {
            const capSeconds = dailyHourLimit * 3600;

            // Total daily state based on rounded totals
            const totalDailyCappedSeconds = Math.min(totalDailyActualSeconds, capSeconds);
            overtimeSeconds = Math.max(0, totalDailyActualSeconds - capSeconds);
            isOvertime = overtimeSeconds > 0;

            // Calculate the contribution of previous sessions to the daily cap
            const previousRoundedSeconds = Math.floor(previousRawSeconds / 3600) * 3600;
            const previousCappedSeconds = Math.min(previousRoundedSeconds, capSeconds);

            // This session's contribution to the capped duration
            computedSeconds = Math.max(0, totalDailyCappedSeconds - previousCappedSeconds);

            if (isOvertime) {
                logger.info(`Overtime detected: daily total=${this.formatDuration(totalDailyActualSeconds)}, cap=${dailyHourLimit}h, total overtime excess=${this.formatDuration(overtimeSeconds)}`);
            }
        }

        return { computedSeconds, isOvertime, overtimeSeconds, isMissedClockout, totalDailyActualSeconds };
    }

    /**
     * Get the sum of RAW actual durations from earlier sessions on the "same day".
     * Uses a 16-hour lookback window to group sessions into a work day.
     */
    private async getPreviousRawSeconds(userId: number, date: Date): Promise<number> {
        // Look back 16 hours to find earlier shifts that belong to the same work day
        const lookbackStart = new Date(date.getTime() - 16 * 3600 * 1000);

        const existingEntriesToday = await this.timeEntryRepository.find({
            where: {
                userId,
                status: 'completed',
                clockInAt: Between(lookbackStart, date)
            }
        });

        return existingEntriesToday.reduce(
            (sum, entry) => sum + (entry.duration || 0),
            0
        );
    }

    /**
     * Create or update daily overtime request.
     * - If a pending overtime request exists for this user on the same day, update it
     * - Otherwise, create a new one
     * - Shows daily totals (not per-session values) for meaningful admin review
     */
    private async createOrUpdateDailyOvertimeRequest(
        timeEntryId: number,
        userId: number,
        actualDailyTotalSeconds: number,
        dailyCapSeconds: number,
        overtimeSeconds: number,
        date: Date,
        isMissedClockout: boolean = false
    ) {
        try {
            // To find an existing request, we look for any request linked to any entry in the last 16 hours
            const lookbackStart = new Date(date.getTime() - 16 * 3600 * 1000);
            const entries = await this.timeEntryRepository.find({
                where: {
                    userId,
                    clockInAt: Between(lookbackStart, date)
                },
                select: ['id']
            });
            const entryIds = entries.map(e => e.id);
            if (timeEntryId && !entryIds.includes(timeEntryId)) {
                entryIds.push(timeEntryId);
            }

            // Check if there's an existing overtime request for this user linked to any of these entries
            const existingRequest = entryIds.length > 0
                ? await this.overtimeRequestRepository
                    .createQueryBuilder("request")
                    .where("request.userId = :userId", { userId })
                    .andWhere("request.timeEntryId IN (:...entryIds)", { entryIds })
                    .orderBy("request.createdAt", "DESC")
                    .getOne()
                : null;

            if (existingRequest) {
                // Update existing request with new totals and reset status to pending
                // We also OR the isMissedClockout flag - if any part of the day was missed, it stays true
                await this.overtimeRequestRepository.update(existingRequest.id, {
                    timeEntryId, // Link to latest entry that triggered the update
                    actualDurationSeconds: actualDailyTotalSeconds,
                    cappedDurationSeconds: dailyCapSeconds,
                    overtimeSeconds: overtimeSeconds,
                    status: 'pending' as const,
                    isMissedClockout: (existingRequest as any).isMissedClockout || isMissedClockout,
                    approvedBy: null as any,
                    approvedAt: null,
                    notes: existingRequest.status !== 'pending'
                        ? `[System] Reset to pending due to new clock-out. Previous status: ${existingRequest.status}`
                        : existingRequest.notes
                });
                logger.info(`Updated existing overtime request ${existingRequest.id} for user ${userId} and reset to pending. MissedClockout=${(existingRequest as any).isMissedClockout || isMissedClockout}`);
            } else {
                // Create new overtime request
                await this.overtimeRequestRepository.save({
                    timeEntryId,
                    userId,
                    actualDurationSeconds: actualDailyTotalSeconds,
                    cappedDurationSeconds: dailyCapSeconds,
                    overtimeSeconds,
                    isMissedClockout,
                    status: 'pending' as const
                });
                logger.info(`Created new overtime request for user ${userId}, isMissedClockout=${isMissedClockout}`);
            }
        } catch (error) {
            logger.error(`Failed to create/update overtime request for user ${userId}:`, error);
        }
    }

    /**
     * Create an overtime request for admin approval (legacy - kept for backward compatibility)
     */
    private async createOvertimeRequest(
        timeEntryId: number,
        userId: number,
        actualDurationSeconds: number,
        cappedDurationSeconds: number,
        overtimeSeconds: number
    ) {
        try {
            await this.overtimeRequestRepository.save({
                timeEntryId,
                userId,
                actualDurationSeconds,
                cappedDurationSeconds,
                overtimeSeconds,
                status: 'pending' as const
            });
            logger.info(`Created overtime request for user ${userId}, overtime: ${this.formatDuration(overtimeSeconds)}`);
        } catch (error) {
            logger.error(`Failed to create overtime request for user ${userId}:`, error);
        }
    }

    /**
     * Process missed clock-outs: entries still 'active' after 12+ hours
     * Called by scheduled job every 3 hours
     */
    async processMissedClockouts() {
        const twelveHoursAgo = new Date(Date.now() - this.TWELVE_HOURS_SECONDS * 1000);

        const staleEntries = await this.timeEntryRepository.find({
            where: {
                status: 'active',
                clockInAt: LessThanOrEqual(twelveHoursAgo)
            },
            relations: ['user']
        });

        logger.info(`Found ${staleEntries.length} stale time entries to process`);

        for (const entry of staleEntries) {
            const dailyHourLimit = entry.user?.dailyHourLimit ?? 8;
            const now = new Date();
            const clockInAt = new Date(entry.clockInAt);

            // Calculate actual duration from clock-in to now
            const actualDurationSeconds = Math.floor((now.getTime() - clockInAt.getTime()) / 1000);

            // Fetch previous sessions for that day
            const previousRawSeconds = await this.getPreviousRawSeconds(entry.userId, clockInAt);

            // Calculate durations using the cumulative logic
            const { computedSeconds, isOvertime, overtimeSeconds, totalDailyActualSeconds } =
                this.calculateComputedDurationWithDailyTotal(
                    actualDurationSeconds,
                    dailyHourLimit,
                    previousRawSeconds
                );

            // Auto clock-out
            await this.timeEntryRepository.update(entry.id, {
                clockOutAt: now,
                duration: actualDurationSeconds,
                computedDuration: computedSeconds,
                isMissedClockout: true,
                hasOvertimeRequest: isOvertime,
                status: 'completed'
            });

            // Create overtime request if needed
            if (isOvertime) {
                const capSeconds = (dailyHourLimit || 8) * 3600;
                await this.createOrUpdateDailyOvertimeRequest(
                    entry.id,
                    entry.userId,
                    totalDailyActualSeconds,
                    capSeconds,
                    overtimeSeconds,
                    clockInAt,
                    true // isMissedClockout
                );
            }

            logger.info(`Auto-clocked out user ${entry.userId} (missed clockout). Actual: ${this.formatDuration(actualDurationSeconds)}, Computed: ${this.formatDuration(computedSeconds)}, Excess: ${this.formatDuration(overtimeSeconds)}`);
        }

        return { processed: staleEntries.length };
    }

    /**
     * Create a completed test time entry with specified duration
     * For testing purposes only - Admin use
     */
    async createTestEntry(userId: number, durationMinutes: number) {
        const durationSeconds = durationMinutes * 60;
        const clockOutAt = new Date();
        const clockInAt = new Date(clockOutAt.getTime() - durationSeconds * 1000);

        // Fetch user's dailyHourLimit
        const user = await this.usersRepository.findOne({
            where: { id: userId },
            select: ['id', 'dailyHourLimit', 'firstName', 'lastName']
        });

        if (!user) {
            return { success: false, message: 'User not found' };
        }

        const dailyHourLimit = user.dailyHourLimit ?? null;

        // Fetch previous sessions for that day
        const previousRawSeconds = await this.getPreviousRawSeconds(userId, clockInAt);

        // Calculate computed duration with cumulative logic
        const { computedSeconds, isOvertime, overtimeSeconds, totalDailyActualSeconds, isMissedClockout } =
            this.calculateComputedDurationWithDailyTotal(
                durationSeconds,
                dailyHourLimit,
                previousRawSeconds
            );

        // Create entry directly as completed
        const entry = await this.timeEntryRepository.save({
            userId,
            clockInAt,
            clockOutAt,
            duration: durationSeconds,
            computedDuration: computedSeconds,
            isMissedClockout,
            hasOvertimeRequest: isOvertime,
            status: 'completed' as const,
            notes: `[TEST] Created with ${durationMinutes} minutes duration`
        });

        // Create or update overtime request if needed
        if (isOvertime) {
            const capSeconds = (dailyHourLimit || 8) * 3600;
            await this.createOrUpdateDailyOvertimeRequest(
                entry.id,
                userId,
                totalDailyActualSeconds,
                capSeconds,
                overtimeSeconds,
                clockInAt,
                isMissedClockout
            );
        }

        logger.info(`Created test entry for user ${userId}: ${durationMinutes}min -> computed: ${this.formatDuration(computedSeconds)}, totalDailyActual: ${this.formatDuration(totalDailyActualSeconds)}, overtime: ${isOvertime}`);

        return {
            success: true,
            entry,
            actualDuration: this.formatDuration(durationSeconds),
            computedDuration: this.formatDuration(computedSeconds),
            isOvertime,
            isMissedClockout,
            dailyHourLimit
        };
    }

    /**
     * Get notification counts for admin badge
     */
    async getAdminNotificationCounts() {
        const pendingOvertimeCount = await this.overtimeRequestRepository.count({
            where: { status: 'pending' }
        });
        const missedClockoutCount = await this.timeEntryRepository.count({
            where: { isMissedClockout: true, status: 'completed' }
        });
        return { pendingOvertimeCount, missedClockoutCount };
    }
}


