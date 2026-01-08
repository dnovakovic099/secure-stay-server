import { appDatabase } from "../utils/database.util";
import { TimeEntryEntity } from "../entity/TimeEntry";
import { UsersEntity } from "../entity/Users";
import { Between, LessThanOrEqual, MoreThanOrEqual } from "typeorm";

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

        // Update the entry
        await this.timeEntryRepository.update(activeEntry.id, {
            clockOutAt,
            duration: durationSeconds,
            notes: notes || null,
            status: 'completed' as const,
        });

        const updatedEntry = await this.timeEntryRepository.findOne({
            where: { id: activeEntry.id },
        });

        return {
            success: true,
            message: "Successfully clocked out",
            entry: updatedEntry,
            duration: this.formatDuration(durationSeconds)
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
     * Format duration in seconds to human-readable format
     */
    private formatDuration(totalSeconds: number): string {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }
}

