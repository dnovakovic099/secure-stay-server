import { appDatabase } from "../utils/database.util";
import { TimeEntryEntity } from "../entity/TimeEntry";
import { UsersEntity } from "../entity/Users";
import { OvertimeRequestEntity } from "../entity/OvertimeRequest";
import { UserDepartmentEntity } from "../entity/UserDepartment";
import { DepartmentEntity } from "../entity/Department";
import logger from "../utils/logger.utils";

export interface TimesheetFilters {
    startDate: string;
    endDate: string;
    userId?: number;
    hasOvertime?: 'all' | 'with' | 'without' | 'pending';
    hasHourlyRate?: 'all' | 'set' | 'notset';
    page?: number;
    limit?: number;
}

export interface SessionDetail {
    clockIn: string;
    clockOut: string | null;
    duration: string;
}

export interface TimesheetRow {
    date: string;
    userId: number;
    employeeName: string;
    employeeEmail: string;
    department: string;

    // Time calculations (in seconds)
    totalActualSeconds: number;
    totalComputedSeconds: number;
    totalOvertimeSeconds: number;
    totalPayableSeconds: number;
    regularHoursSeconds: number; // Work hours minus overtime (for breakdown display)

    // Formatted display values
    totalActualFormatted: string;
    totalComputedFormatted: string;
    totalOvertimeFormatted: string;
    totalPayableFormatted: string;
    regularHoursFormatted: string; // Work hours minus overtime

    // Session info
    sessionCount: number;
    firstClockIn: string;
    lastClockOut: string | null;
    sessionDetails: SessionDetail[]; // All sessions for tooltip display

    // Salary calculation
    hourlyRate: number | null;
    salaryAmount: number | null;
    hasHourlyRate: boolean;
    payableHoursForSalary: number; // Floored hours used for salary calculation

    // Overtime status
    hasOvertime: boolean;
    pendingOvertimeSeconds: number;
    overtimeStatus: 'approved' | 'pending' | 'rejected' | 'none';
}

export interface TimesheetSummary {
    totalActualSeconds: number;
    totalComputedSeconds: number;
    totalOvertimeSeconds: number;
    totalPayableSeconds: number;
    totalSalary: number;
    employeeCount: number;
    employeesWithRate: number;
    employeesWithoutRate: number;
    daysWithData: number;

    // Formatted
    totalActualFormatted: string;
    totalComputedFormatted: string;
    totalOvertimeFormatted: string;
    totalPayableFormatted: string;
}

export class TimesheetService {
    private timeEntryRepository = appDatabase.getRepository(TimeEntryEntity);
    private usersRepository = appDatabase.getRepository(UsersEntity);
    private overtimeRepository = appDatabase.getRepository(OvertimeRequestEntity);
    private userDepartmentRepository = appDatabase.getRepository(UserDepartmentEntity);
    private departmentRepository = appDatabase.getRepository(DepartmentEntity);

    /**
     * Get aggregated timesheet data for all employees within a date range
     */
    async getTimesheets(filters: TimesheetFilters): Promise<{ data: TimesheetRow[]; total: number; page: number; limit: number; }> {
        const page = filters.page || 1;
        const limit = filters.limit || 50;
        const offset = (page - 1) * limit;

        const startDate = new Date(filters.startDate);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);

        // Build query for time entries
        const queryBuilder = this.timeEntryRepository
            .createQueryBuilder("entry")
            .leftJoinAndSelect("entry.user", "user")
            .where("entry.clockInAt >= :startDate", { startDate })
            .andWhere("entry.clockInAt <= :endDate", { endDate })
            .andWhere("entry.status = :status", { status: 'completed' })
            .andWhere("entry.deletedAt IS NULL");

        // Filter by specific user
        if (filters.userId) {
            queryBuilder.andWhere("entry.userId = :userId", { userId: filters.userId });
        }

        // Filter by hourly rate
        if (filters.hasHourlyRate === 'set') {
            queryBuilder.andWhere("user.hourlyRate IS NOT NULL");
        } else if (filters.hasHourlyRate === 'notset') {
            queryBuilder.andWhere("user.hourlyRate IS NULL");
        }

        const entries = await queryBuilder
            .orderBy("entry.clockInAt", "ASC")
            .getMany();

        // Get all overtime requests for the date range
        const overtimeRequests = await this.overtimeRepository
            .createQueryBuilder("ot")
            .leftJoinAndSelect("ot.timeEntry", "timeEntry")
            .where("timeEntry.clockInAt >= :startDate", { startDate })
            .andWhere("timeEntry.clockInAt <= :endDate", { endDate })
            .getMany();

        // Create a map of timeEntryId to overtime request
        const overtimeMap = new Map<number, OvertimeRequestEntity>();
        overtimeRequests.forEach(ot => {
            overtimeMap.set(ot.timeEntryId, ot);
        });

        // Get user departments
        const userDepartments = await this.userDepartmentRepository
            .createQueryBuilder("ud")
            .leftJoinAndSelect("ud.department", "dept")
            .getMany();

        const userDeptMap = new Map<number, string>();
        userDepartments.forEach(ud => {
            userDeptMap.set(ud.userId, ud.department?.name || 'Unassigned');
        });

        // Group entries by user and date (using local date, not UTC)
        const groupedData = new Map<string, {
            entries: TimeEntryEntity[];
            user: UsersEntity;
            date: string;
        }>();

        entries.forEach(entry => {
            // Use local date components to avoid timezone issues
            // The clockInAt is stored in the database in local time or server time
            // We need to extract the date portion consistently
            const clockIn = new Date(entry.clockInAt);
            const year = clockIn.getFullYear();
            const month = String(clockIn.getMonth() + 1).padStart(2, '0');
            const day = String(clockIn.getDate()).padStart(2, '0');
            const dateKey = `${year}-${month}-${day}`;
            const key = `${entry.userId}_${dateKey}`;

            if (!groupedData.has(key)) {
                groupedData.set(key, {
                    entries: [],
                    user: entry.user,
                    date: dateKey
                });
            }
            groupedData.get(key)!.entries.push(entry);
        });

        // Process grouped data into timesheet rows
        let allRows: TimesheetRow[] = [];

        groupedData.forEach((group, key) => {
            const { entries, user, date } = group;

            // Calculate totals
            let totalActualSeconds = 0;
            let totalComputedSeconds = 0;
            let totalApprovedOvertimeSeconds = 0;
            let totalPendingOvertimeSeconds = 0;
            let overtimeStatus: 'approved' | 'pending' | 'rejected' | 'none' = 'none';

            let firstClockIn: Date | null = null;
            let lastClockOut: Date | null = null;

            entries.forEach(entry => {
                totalActualSeconds += entry.duration || 0;
                totalComputedSeconds += entry.computedDuration || entry.duration || 0;

                // Track clock in/out times
                if (!firstClockIn || entry.clockInAt < firstClockIn) {
                    firstClockIn = entry.clockInAt;
                }
                if (entry.clockOutAt && (!lastClockOut || entry.clockOutAt > lastClockOut)) {
                    lastClockOut = entry.clockOutAt;
                }

                // Check for overtime
                const ot = overtimeMap.get(entry.id);
                if (ot) {
                    if (ot.status === 'approved') {
                        totalApprovedOvertimeSeconds += ot.overtimeSeconds;
                        overtimeStatus = 'approved';
                    } else if (ot.status === 'pending') {
                        totalPendingOvertimeSeconds += ot.overtimeSeconds;
                        if (overtimeStatus !== 'approved') {
                            overtimeStatus = 'pending';
                        }
                    } else if (ot.status === 'rejected' && overtimeStatus === 'none') {
                        overtimeStatus = 'rejected';
                    }
                }
            });

            // Total payable for DISPLAY = computed + approved overtime (for showing in UI)
            // But for SALARY: computedDuration already includes approved overtime after approval!
            // (See OvertimeRequestService.approveRequest - it updates computedDuration)
            // So we should NOT add overtime again for salary calculation
            const totalPayableSeconds = totalComputedSeconds; // Don't add overtime again!

            // Calculate salary - round down to nearest whole hour for payroll
            // Note: computedDuration already includes approved overtime
            // Example: 8h 50m → 8h for salary, 7h 30m → 7h for salary
            const hourlyRate = user.hourlyRate ? Number(user.hourlyRate) : null;
            let salaryAmount: number | null = null;
            let payableHoursForSalary = 0;

            if (hourlyRate !== null) {
                // Round DOWN to nearest whole hour for salary calculation
                payableHoursForSalary = Math.floor(totalPayableSeconds / 3600);
                salaryAmount = payableHoursForSalary * hourlyRate;
            } else {
                // Still calculate floored hours for display even without rate
                payableHoursForSalary = Math.floor(totalPayableSeconds / 3600);
            }

            // Calculate regular hours (work hours minus overtime for breakdown display)
            const regularHoursSeconds = Math.max(0, totalPayableSeconds - totalApprovedOvertimeSeconds);

            // Build session details for tooltip
            const sessionDetails: SessionDetail[] = entries.map(entry => ({
                clockIn: entry.clockInAt.toISOString(),
                clockOut: entry.clockOutAt ? entry.clockOutAt.toISOString() : null,
                duration: this.formatDuration(entry.duration || 0)
            }));

            const row: TimesheetRow = {
                date,
                userId: user.id,
                employeeName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown',
                employeeEmail: user.email || '',
                department: userDeptMap.get(user.id) || 'Unassigned',

                totalActualSeconds,
                totalComputedSeconds,
                totalOvertimeSeconds: totalApprovedOvertimeSeconds,
                totalPayableSeconds,
                regularHoursSeconds,

                totalActualFormatted: this.formatDuration(totalActualSeconds),
                totalComputedFormatted: this.formatDuration(totalComputedSeconds),
                totalOvertimeFormatted: this.formatDuration(totalApprovedOvertimeSeconds),
                totalPayableFormatted: this.formatDuration(totalPayableSeconds),
                regularHoursFormatted: this.formatDuration(regularHoursSeconds),

                sessionCount: entries.length,
                firstClockIn: firstClockIn ? firstClockIn.toISOString() : '',
                lastClockOut: lastClockOut ? lastClockOut.toISOString() : null,
                sessionDetails,

                hourlyRate,
                salaryAmount,
                hasHourlyRate: hourlyRate !== null,
                payableHoursForSalary,

                hasOvertime: totalApprovedOvertimeSeconds > 0 || totalPendingOvertimeSeconds > 0,
                pendingOvertimeSeconds: totalPendingOvertimeSeconds,
                overtimeStatus
            };

            allRows.push(row);
        });

        // Apply overtime filter
        if (filters.hasOvertime === 'with') {
            allRows = allRows.filter(r => r.hasOvertime);
        } else if (filters.hasOvertime === 'without') {
            allRows = allRows.filter(r => !r.hasOvertime);
        } else if (filters.hasOvertime === 'pending') {
            allRows = allRows.filter(r => r.overtimeStatus === 'pending');
        }

        // Sort by date descending, then by employee name
        allRows.sort((a, b) => {
            const dateCompare = b.date.localeCompare(a.date);
            if (dateCompare !== 0) return dateCompare;
            return a.employeeName.localeCompare(b.employeeName);
        });

        const total = allRows.length;
        const paginatedData = allRows.slice(offset, offset + limit);

        return {
            data: paginatedData,
            total,
            page,
            limit
        };
    }

    /**
     * Get summary statistics for the timesheet
     */
    async getSummary(startDate: string, endDate: string, userId?: number): Promise<TimesheetSummary> {
        // Get all data without pagination for summary
        const result = await this.getTimesheets({
            startDate,
            endDate,
            userId,
            page: 1,
            limit: 10000 // Get all for summary
        });

        const rows = result.data;

        let totalActualSeconds = 0;
        let totalComputedSeconds = 0;
        let totalOvertimeSeconds = 0;
        let totalPayableSeconds = 0;
        let totalSalary = 0;

        const employeeSet = new Set<number>();
        const employeesWithRateSet = new Set<number>();
        const employeesWithoutRateSet = new Set<number>();
        const datesSet = new Set<string>();

        rows.forEach(row => {
            totalActualSeconds += row.totalActualSeconds;
            totalComputedSeconds += row.totalComputedSeconds;
            totalOvertimeSeconds += row.totalOvertimeSeconds;
            totalPayableSeconds += row.totalPayableSeconds;

            if (row.salaryAmount !== null) {
                totalSalary += row.salaryAmount;
            }

            employeeSet.add(row.userId);
            datesSet.add(row.date);

            if (row.hasHourlyRate) {
                employeesWithRateSet.add(row.userId);
            } else {
                employeesWithoutRateSet.add(row.userId);
            }
        });

        return {
            totalActualSeconds,
            totalComputedSeconds,
            totalOvertimeSeconds,
            totalPayableSeconds,
            totalSalary: Math.round(totalSalary * 100) / 100,
            employeeCount: employeeSet.size,
            employeesWithRate: employeesWithRateSet.size,
            employeesWithoutRate: employeesWithoutRateSet.size,
            daysWithData: datesSet.size,

            totalActualFormatted: this.formatDuration(totalActualSeconds),
            totalComputedFormatted: this.formatDuration(totalComputedSeconds),
            totalOvertimeFormatted: this.formatDuration(totalOvertimeSeconds),
            totalPayableFormatted: this.formatDuration(totalPayableSeconds)
        };
    }

    /**
     * Get all employees for the filter dropdown
     */
    async getEmployees(): Promise<{ id: number; name: string; email: string; }[]> {
        const users = await this.usersRepository.find({
            where: { deletedAt: null as any, isActive: true },
            order: { firstName: 'ASC' }
        });

        return users.map(u => ({
            id: u.id,
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown',
            email: u.email || ''
        }));
    }

    /**
     * Format duration in seconds to human-readable format
     */
    private formatDuration(totalSeconds: number): string {
        if (totalSeconds <= 0) return '0m';

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }
}
