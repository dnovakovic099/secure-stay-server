import { appDatabase } from "../utils/database.util";
import { EmployeeSchedule, ShiftType } from "../entity/EmployeeSchedule";
import { Employee } from "../entity/Employee";
import { LeaveRequestEntity } from "../entity/LeaveRequest";
import { Between, In } from "typeorm";

interface CreateScheduleDto {
    employeeId: number;
    date: string; // YYYY-MM-DD
    shiftStart: string; // HH:mm
    shiftEnd: string; // HH:mm
    breakDuration?: number;
    shiftType?: ShiftType;
    notes?: string;
    createdBy?: string;
}

interface CreateRecurringDto {
    employeeId: number;
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    daysOfWeek: number[]; // 0=Sun, 6=Sat
    shiftStart: string;
    shiftEnd: string;
    breakDuration?: number;
    shiftType?: ShiftType;
    notes?: string;
    createdBy?: string;
}

interface UpdateScheduleDto {
    date?: string;
    shiftStart?: string;
    shiftEnd?: string;
    breakDuration?: number | null;
    shiftType?: ShiftType;
    notes?: string | null;
}

interface ScheduleFilters {
    page?: number;
    limit?: number;
    employeeId?: number;
    startDate?: string;
    endDate?: string;
    department?: string;
    shiftType?: string;
}

// Flag to track if table has been initialized
let tableInitialized = false;

export class EmployeeScheduleService {
    private scheduleRepo = appDatabase.getRepository(EmployeeSchedule);
    private employeeRepo = appDatabase.getRepository(Employee);
    private leaveRepo = appDatabase.getRepository(LeaveRequestEntity);

    /**
     * Ensures the employee_schedules table exists
     */
    private async ensureTable(): Promise<void> {
        if (tableInitialized) return;

        try {
            await appDatabase.query(`SELECT 1 FROM employee_schedules LIMIT 1`);
            tableInitialized = true;
        } catch (error: any) {
            if (error.code === 'ER_NO_SUCH_TABLE' || error.message?.includes("doesn't exist")) {
                console.log('Creating employee_schedules table...');
                await appDatabase.query(`
                    CREATE TABLE IF NOT EXISTS employee_schedules (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        employee_id INT NOT NULL,
                        \`date\` DATE NOT NULL,
                        shift_start TIME NOT NULL,
                        shift_end TIME NOT NULL,
                        break_duration INT NULL,
                        shift_type ENUM('Regular', 'Off', 'Holiday') NOT NULL DEFAULT 'Regular',
                        notes TEXT NULL,
                        is_recurring BOOLEAN DEFAULT FALSE,
                        recurring_day_of_week TINYINT NULL,
                        created_by VARCHAR(255) NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
                        UNIQUE INDEX idx_schedule_employee_date (employee_id, \`date\`),
                        INDEX idx_schedule_date (\`date\`),
                        INDEX idx_schedule_shift_type (shift_type)
                    )
                `);
                console.log('employee_schedules table created successfully');
                tableInitialized = true;
            } else {
                console.error('Unexpected error checking employee_schedules table:', error);
                tableInitialized = true;
            }
        }
    }

    /**
     * Get schedules with pagination and filters
     */
    async getSchedules(filters: ScheduleFilters) {
        await this.ensureTable();

        const page = filters.page || 1;
        const limit = filters.limit || 50;
        const offset = (page - 1) * limit;

        const qb = this.scheduleRepo
            .createQueryBuilder('schedule')
            .leftJoinAndSelect('schedule.employee', 'employee')
            .leftJoinAndSelect('employee.user', 'user');

        // Filters
        if (filters.employeeId) {
            qb.andWhere('schedule.employeeId = :employeeId', { employeeId: filters.employeeId });
        }

        if (filters.startDate) {
            qb.andWhere('schedule.date >= :startDate', { startDate: filters.startDate });
        }

        if (filters.endDate) {
            qb.andWhere('schedule.date <= :endDate', { endDate: filters.endDate });
        }

        if (filters.department) {
            qb.andWhere('employee.department = :department', { department: filters.department });
        }

        if (filters.shiftType) {
            qb.andWhere('schedule.shiftType = :shiftType', { shiftType: filters.shiftType });
        }

        qb.orderBy('schedule.date', 'ASC')
            .addOrderBy('user.firstName', 'ASC');

        const [data, total] = await qb.skip(offset).take(limit).getManyAndCount();

        // Enrich with leave status
        const enriched = await this.enrichWithLeaveStatus(data, filters.startDate, filters.endDate);

        return {
            data: enriched,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    /**
     * Get schedules for a specific employee in a date range
     */
    async getSchedulesByEmployee(employeeId: number, startDate?: string, endDate?: string) {
        await this.ensureTable();

        const qb = this.scheduleRepo
            .createQueryBuilder('schedule')
            .leftJoinAndSelect('schedule.employee', 'employee')
            .leftJoinAndSelect('employee.user', 'user')
            .where('schedule.employeeId = :employeeId', { employeeId });

        if (startDate) {
            qb.andWhere('schedule.date >= :startDate', { startDate });
        }

        if (endDate) {
            qb.andWhere('schedule.date <= :endDate', { endDate });
        }

        qb.orderBy('schedule.date', 'ASC');

        const schedules = await qb.getMany();
        return this.enrichWithLeaveStatus(schedules, startDate, endDate);
    }

    /**
     * Create a single schedule entry
     */
    async createSchedule(dto: CreateScheduleDto) {
        await this.ensureTable();

        // Verify employee exists
        const employee = await this.employeeRepo.findOne({ where: { id: dto.employeeId } });
        if (!employee) {
            throw new Error('Employee not found');
        }

        // Check for duplicate
        const existing = await this.scheduleRepo.findOne({
            where: { employeeId: dto.employeeId, date: dto.date },
        });
        if (existing) {
            throw new Error(`Schedule already exists for this employee on ${dto.date}`);
        }

        const schedule = this.scheduleRepo.create({
            employeeId: dto.employeeId,
            date: dto.date,
            shiftStart: dto.shiftStart,
            shiftEnd: dto.shiftEnd,
            breakDuration: dto.breakDuration || null,
            shiftType: dto.shiftType || ShiftType.REGULAR,
            notes: dto.notes || null,
            createdBy: dto.createdBy || null,
        });

        const saved = await this.scheduleRepo.save(schedule);

        return this.scheduleRepo.findOne({
            where: { id: saved.id },
            relations: ['employee', 'employee.user'],
        });
    }

    /**
     * Create weekly recurring schedules
     */
    async createWeeklyRecurring(dto: CreateRecurringDto) {
        await this.ensureTable();

        // Verify employee exists
        const employee = await this.employeeRepo.findOne({ where: { id: dto.employeeId } });
        if (!employee) {
            throw new Error('Employee not found');
        }

        const start = new Date(dto.startDate);
        const end = new Date(dto.endDate);
        const created: EmployeeSchedule[] = [];
        const skipped: string[] = [];

        const current = new Date(start);
        while (current <= end) {
            const dayOfWeek = current.getDay(); // 0=Sun, 6=Sat

            if (dto.daysOfWeek.includes(dayOfWeek)) {
                const dateStr = current.toISOString().split('T')[0];

                // Check for existing
                const existing = await this.scheduleRepo.findOne({
                    where: { employeeId: dto.employeeId, date: dateStr },
                });

                if (existing) {
                    skipped.push(dateStr);
                } else {
                    const schedule = this.scheduleRepo.create({
                        employeeId: dto.employeeId,
                        date: dateStr,
                        shiftStart: dto.shiftStart,
                        shiftEnd: dto.shiftEnd,
                        breakDuration: dto.breakDuration || null,
                        shiftType: dto.shiftType || ShiftType.REGULAR,
                        notes: dto.notes || null,
                        isRecurring: true,
                        recurringDayOfWeek: dayOfWeek,
                        createdBy: dto.createdBy || null,
                    });
                    created.push(schedule);
                }
            }

            current.setDate(current.getDate() + 1);
        }

        if (created.length > 0) {
            await this.scheduleRepo.save(created);
        }

        return {
            created: created.length,
            skipped: skipped.length,
            skippedDates: skipped,
        };
    }

    /**
     * Update a schedule entry
     */
    async updateSchedule(id: number, dto: UpdateScheduleDto) {
        const schedule = await this.scheduleRepo.findOne({ where: { id } });

        if (!schedule) {
            throw new Error('Schedule not found');
        }

        if (dto.date !== undefined) schedule.date = dto.date;
        if (dto.shiftStart !== undefined) schedule.shiftStart = dto.shiftStart;
        if (dto.shiftEnd !== undefined) schedule.shiftEnd = dto.shiftEnd;
        if (dto.breakDuration !== undefined) schedule.breakDuration = dto.breakDuration;
        if (dto.shiftType !== undefined) schedule.shiftType = dto.shiftType;
        if (dto.notes !== undefined) schedule.notes = dto.notes;

        await this.scheduleRepo.save(schedule);

        return this.scheduleRepo.findOne({
            where: { id },
            relations: ['employee', 'employee.user'],
        });
    }

    /**
     * Delete a schedule entry
     */
    async deleteSchedule(id: number) {
        const schedule = await this.scheduleRepo.findOne({ where: { id } });

        if (!schedule) {
            throw new Error('Schedule not found');
        }

        await this.scheduleRepo.remove(schedule);
        return { success: true, message: 'Schedule deleted successfully' };
    }

    /**
     * Get available shift types
     */
    getShiftTypes() {
        return Object.values(ShiftType);
    }

    /**
     * Enrich schedules with leave status information
     */
    private async enrichWithLeaveStatus(
        schedules: EmployeeSchedule[],
        startDate?: string,
        endDate?: string
    ): Promise<(EmployeeSchedule & { leaveStatus?: string })[]> {
        if (schedules.length === 0) return schedules;

        // Get unique employee user IDs
        const employeeUserIds = [...new Set(schedules.map(s => s.employee?.userId).filter(Boolean))];

        if (employeeUserIds.length === 0) return schedules;

        try {
            // Find approved leaves overlapping the date range
            const qb = this.leaveRepo
                .createQueryBuilder('leave')
                .where('leave.userId IN (:...userIds)', { userIds: employeeUserIds })
                .andWhere('leave.status = :status', { status: 'approved' });

            if (startDate) {
                qb.andWhere('leave.endDate >= :startDate', { startDate });
            }
            if (endDate) {
                qb.andWhere('leave.startDate <= :endDate', { endDate });
            }

            const leaves = await qb.getMany();

            // Build a lookup: userId -> list of leave date ranges
            const leaveLookup = new Map<number, { start: Date; end: Date }[]>();
            for (const leave of leaves) {
                const ranges = leaveLookup.get(leave.userId) || [];
                ranges.push({
                    start: new Date(leave.startDate),
                    end: new Date(leave.endDate),
                });
                leaveLookup.set(leave.userId, ranges);
            }

            // Enrich each schedule
            return schedules.map(schedule => {
                const userId = schedule.employee?.userId;
                const result: any = { ...schedule };

                if (userId && leaveLookup.has(userId)) {
                    const schedDate = new Date(schedule.date);
                    const onLeave = leaveLookup.get(userId)!.some(
                        range => schedDate >= range.start && schedDate <= range.end
                    );
                    if (onLeave) {
                        result.leaveStatus = 'On Leave';
                    }
                }

                return result;
            });
        } catch {
            // If leave_requests table doesn't exist yet, just return without enrichment
            return schedules;
        }
    }
}
