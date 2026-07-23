import { appDatabase } from "../utils/database.util";
import { Employee, EmployeeDepartment } from "../entity/Employee";
import { EmployeeNote } from "../entity/EmployeeNote";
import { EmployeeChangeLog } from "../entity/EmployeeChangeLog";
import { EmployeeScheduleEntry, EmployeeScheduleShiftType } from "../entity/EmployeeScheduleEntry";
import { UsersEntity } from "../entity/Users";
import { FileInfo } from "../entity/FileInfo";
import { DepartmentEntity } from "../entity/Department";
import { UserDepartmentEntity } from "../entity/UserDepartment";
import { LeaveRequestEntity } from "../entity/LeaveRequest";
import { LeaveRequestStatus, PaymentType } from "../constant";
import { Between, IsNull } from "typeorm";
import sendSlackMessage from "../utils/sendSlackMsg";
import logger from "../utils/logger.utils";

const WORKLOG_OT_HOURS_SLACK_CHANNEL = process.env.WORKLOG_OT_HOURS_SLACK_CHANNEL || "#worklog-ot-hours";

interface CreateEmployeeDto {
    userId: number;
    department: string;
    departmentNames?: string[];
    jobTitle: string;
    jobType?: string | null;
    hiredFrom?: string | null;
    hiredFromOther?: string | null;
    hourlyRate: number;
    startDate: Date;
    slackUserId?: string;
    createdBy?: number;
    phone?: string | null;
    birthday?: Date | null;
    country?: string | null;
    preferredName?: string | null;
    schedule?: string | null;
    paymentMethod?: string | null;
    paymentMethodOther?: string | null;
    paymentSchedule?: string | null;
    paymentDay?: string | null;
    paymentStartDate?: Date | null;
    paymentInfo?: string | null;
    payrollNotes?: string | null;
}

interface UpdateEmployeeDto {
    firstName?: string;
    lastName?: string | null;
    department?: string;
    departmentNames?: string[];
    jobTitle?: string;
    jobType?: string | null;
    hiredFrom?: string | null;
    hiredFromOther?: string | null;
    employeeType?: string | null;
    hourlyRate?: number;
    startDate?: Date;
    overtimeHours?: number;
    bonuses?: number;
    slackUserId?: string | null;
    profilePhoto?: string | null;
    isActive?: boolean;
    phone?: string | null;
    birthday?: Date | null;
    country?: string | null;
    preferredName?: string | null;
    schedule?: string | null;
    slackId?: string | null;
    paymentMethod?: string | null;
    paymentMethodOther?: string | null;
    paymentSchedule?: string | null;
    paymentInfo?: string | null;
    payrollNotes?: string | null;
    paymentDay?: string | null;
    paymentRecurrence?: string | null;
    paymentStartDate?: Date | null;
}

// Flag to track if tables have been initialized
let tablesInitialized = false;

interface UpsertScheduleOverrideDto {
    date: string;
    shiftType: EmployeeScheduleShiftType;
    shiftStart?: string | null;
    shiftEnd?: string | null;
    shiftStartAt?: string | null;
    shiftEndAt?: string | null;
    notes?: string | null;
}

export class EmployeeService {
    private employeeRepo = appDatabase.getRepository(Employee);
    private noteRepo = appDatabase.getRepository(EmployeeNote);
    private changeLogRepo = appDatabase.getRepository(EmployeeChangeLog);
    private scheduleRepo = appDatabase.getRepository(EmployeeScheduleEntry);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private departmentRepo = appDatabase.getRepository(DepartmentEntity);
    private userDepartmentRepo = appDatabase.getRepository(UserDepartmentEntity);
    private leaveRequestRepo = appDatabase.getRepository(LeaveRequestEntity);

    private normalizeDepartmentName(name: string) {
        const trimmed = name.trim();
        const renames: Record<string, string> = {
            'Issue Resolution': 'Maintenance',
            'Issue Resolutions': 'Maintenance',
            'Issues Resolution': 'Maintenance',
            'Issues Resolutions': 'Maintenance',
            'Admin': 'Administrative',
        };
        return renames[trimmed] || trimmed;
    }

    private normalizeDepartmentNames(names: Array<string | null | undefined>) {
        return Array.from(new Set(names.filter(Boolean).map((name) => this.normalizeDepartmentName(String(name))).filter(Boolean)));
    }

    private async getOrCreateDepartment(name: string, createdBy?: number | string | null) {
        const normalized = this.normalizeDepartmentName(name);
        let department = await this.departmentRepo.findOne({ where: { name: normalized, deletedAt: null as any } });
        if (!department) {
            department = await this.departmentRepo.save(this.departmentRepo.create({
                name: normalized,
                createdBy: createdBy !== undefined && createdBy !== null ? String(createdBy) : null as any,
            }));
        }
        return department;
    }

    private async setUserDepartments(userId: number, departmentNames: string[], createdBy?: number | string | null) {
        const normalizedNames = this.normalizeDepartmentNames(departmentNames);
        await this.userDepartmentRepo.delete({ userId });

        if (normalizedNames.length === 0) return [];

        const departments = await Promise.all(normalizedNames.map((name) => this.getOrCreateDepartment(name, createdBy)));
        await this.userDepartmentRepo.save(departments.map((department) => ({
            userId,
            departmentId: department.id,
            createdBy: createdBy !== undefined && createdBy !== null ? String(createdBy) : null as any,
        })));
        return departments;
    }

    private async attachUserDepartments(employee: any) {
        const userDepartments = await this.userDepartmentRepo.find({
            where: { userId: employee.userId },
            relations: ['department'],
            order: { id: 'ASC' },
        });
        const departments = userDepartments.map((ud) => ud.department).filter(Boolean);
        employee.departments = departments;
        if (departments.length > 0) {
            employee.department = departments[0].name;
        } else if (employee.department) {
            employee.department = this.normalizeDepartmentName(employee.department);
        }
        return employee;
    }

    /**
     * Ensures the employees and employee_notes tables exist
     */
    private async ensureTables(): Promise<void> {
        if (tablesInitialized) return;

        try {
            // Check if employees table exists
            await appDatabase.query(`SELECT 1 FROM employees LIMIT 1`);

            // Table exists - ensure new columns are present
            const addColumnIfNotExists = async (col: string, definition: string) => {
                try {
                    await appDatabase.query(`SELECT ${col} FROM employees LIMIT 1`);
                } catch {
                    await appDatabase.query(`ALTER TABLE employees ADD COLUMN ${col} ${definition}`);
                    console.log(`Added column ${col} to employees table`);
                }
            };

            await addColumnIfNotExists('phone', 'VARCHAR(30) NULL');
            await addColumnIfNotExists('birthday', 'DATE NULL');
            await addColumnIfNotExists('country', 'VARCHAR(100) NULL');
            await addColumnIfNotExists('preferred_name', 'VARCHAR(100) NULL');
            await addColumnIfNotExists('schedule', 'VARCHAR(255) NULL');
            await addColumnIfNotExists('slack_id', 'VARCHAR(100) NULL');
            await addColumnIfNotExists('payment_method', 'VARCHAR(50) NULL');
            await addColumnIfNotExists('payment_method_other', 'VARCHAR(100) NULL');
            await addColumnIfNotExists('payment_schedule', 'VARCHAR(50) NULL');
            await addColumnIfNotExists('payment_info', 'TEXT NULL');
            await addColumnIfNotExists('payroll_notes', 'TEXT NULL');
            await addColumnIfNotExists('profile_photo', 'VARCHAR(500) NULL');
            await addColumnIfNotExists('employee_number_seq', 'INT NULL');
            await addColumnIfNotExists('job_type', 'VARCHAR(50) NULL');
            await addColumnIfNotExists('hired_from', 'VARCHAR(50) NULL');
            await addColumnIfNotExists('hired_from_other', 'VARCHAR(100) NULL');
            await addColumnIfNotExists('employee_type', 'VARCHAR(50) NULL');
            await addColumnIfNotExists('payment_day', 'VARCHAR(20) NULL');
            await addColumnIfNotExists('payment_recurrence', 'VARCHAR(20) NULL');
            await addColumnIfNotExists('payment_start_date', 'DATE NULL');
            await appDatabase.query(`
                CREATE TABLE IF NOT EXISTS employee_change_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    employee_id INT NOT NULL,
                    field_name VARCHAR(100) NOT NULL,
                    old_value TEXT NULL,
                    new_value TEXT NULL,
                    changed_by INT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
                    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
                    INDEX idx_employee_change_logs_employee_id (employee_id),
                    INDEX idx_employee_change_logs_created_at (created_at)
                )
            `);

            await appDatabase.query(`
                CREATE TABLE IF NOT EXISTS employee_schedules (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    employee_id INT NOT NULL,
                    \`date\` DATE NOT NULL,
                    shift_start TIME NULL,
                    shift_end TIME NULL,
                    shift_start_at DATETIME NULL,
                    shift_end_at DATETIME NULL,
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
            await appDatabase.query(`ALTER TABLE employee_schedules MODIFY COLUMN shift_start TIME NULL`);
            await appDatabase.query(`ALTER TABLE employee_schedules MODIFY COLUMN shift_end TIME NULL`);
            await appDatabase.query(`ALTER TABLE employee_schedules MODIFY COLUMN notes TEXT NULL`);
            try {
                await appDatabase.query(`SELECT shift_start_at FROM employee_schedules LIMIT 1`);
            } catch {
                await appDatabase.query(`ALTER TABLE employee_schedules ADD COLUMN shift_start_at DATETIME NULL AFTER shift_end`);
            }
            try {
                await appDatabase.query(`SELECT shift_end_at FROM employee_schedules LIMIT 1`);
            } catch {
                await appDatabase.query(`ALTER TABLE employee_schedules ADD COLUMN shift_end_at DATETIME NULL AFTER shift_start_at`);
            }
            await appDatabase.query(`
                UPDATE employee_schedules
                SET shift_start_at = CASE
                        WHEN shift_start_at IS NULL AND shift_start IS NOT NULL THEN STR_TO_DATE(CONCAT(\`date\`, ' ', shift_start), '%Y-%m-%d %H:%i:%s')
                        ELSE shift_start_at
                    END,
                    shift_end_at = CASE
                        WHEN shift_end_at IS NULL AND shift_end IS NOT NULL THEN
                            CASE
                                WHEN shift_start IS NOT NULL AND TIME_TO_SEC(shift_end) <= TIME_TO_SEC(shift_start)
                                    THEN DATE_ADD(STR_TO_DATE(CONCAT(\`date\`, ' ', shift_end), '%Y-%m-%d %H:%i:%s'), INTERVAL 1 DAY)
                                ELSE STR_TO_DATE(CONCAT(\`date\`, ' ', shift_end), '%Y-%m-%d %H:%i:%s')
                            END
                        ELSE shift_end_at
                    END
            `);

            // Cleanup soft-deleted employee numbers to prevent conflicts with active ones
            await appDatabase.query(`UPDATE employees SET employee_number = NULL, employee_number_seq = NULL WHERE deleted_at IS NOT NULL`);
            await appDatabase.query(`ALTER TABLE employees MODIFY COLUMN department VARCHAR(100) NOT NULL`);
            await appDatabase.query(`
                UPDATE employees
                SET department = CASE
                    WHEN department IN ('Issue Resolution', 'Issue Resolutions', 'Issues Resolution', 'Issues Resolutions') THEN 'Maintenance'
                    WHEN department = 'Admin' THEN 'Administrative'
                    ELSE department
                END
            `);

            tablesInitialized = true;
        } catch (error: any) {
            // Table doesn't exist, create it
            if (error.code === 'ER_NO_SUCH_TABLE' || error.message?.includes("doesn't exist")) {
                console.log('Creating employees tables...');
                
                // Create employees table
                await appDatabase.query(`
                    CREATE TABLE IF NOT EXISTS employees (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id INT NOT NULL UNIQUE,
                        employee_number VARCHAR(20) UNIQUE,
                        employee_number_seq INT NULL,
                        department VARCHAR(100) NOT NULL,
                        job_title VARCHAR(100) NOT NULL,
                        hourly_rate DECIMAL(10, 2) DEFAULT 0,
                        start_date DATE NOT NULL,
                        overtime_hours DECIMAL(10, 2) DEFAULT 0,
                        bonuses DECIMAL(10, 2) DEFAULT 0,
                        slack_user_id VARCHAR(50) NULL,
                        phone VARCHAR(30) NULL,
                        birthday DATE NULL,
                        country VARCHAR(100) NULL,
                        schedule VARCHAR(255) NULL,
                        slack_id VARCHAR(100) NULL,
                        payment_method VARCHAR(50) NULL,
                        payment_method_other VARCHAR(100) NULL,
                        payment_schedule VARCHAR(50) NULL,
                        payment_info TEXT NULL,
                        is_active BOOLEAN DEFAULT TRUE,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        deleted_at TIMESTAMP NULL,
                        created_by INT NULL,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
                        INDEX idx_employees_department (department),
                        INDEX idx_employees_start_date (start_date),
                        INDEX idx_employees_is_active (is_active)
                    )
                `);

                // Create employee_notes table
                await appDatabase.query(`
                    CREATE TABLE IF NOT EXISTS employee_notes (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        employee_id INT NOT NULL,
                        content TEXT NOT NULL,
                        added_by INT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
                        FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL,
                        INDEX idx_employee_notes_employee_id (employee_id)
                    )
                `);

                await appDatabase.query(`
                    CREATE TABLE IF NOT EXISTS employee_change_logs (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        employee_id INT NOT NULL,
                        field_name VARCHAR(100) NOT NULL,
                        old_value TEXT NULL,
                        new_value TEXT NULL,
                        changed_by INT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
                        FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
                        INDEX idx_employee_change_logs_employee_id (employee_id),
                        INDEX idx_employee_change_logs_created_at (created_at)
                    )
                `);

                await appDatabase.query(`
                    CREATE TABLE IF NOT EXISTS employee_schedules (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        employee_id INT NOT NULL,
                        \`date\` DATE NOT NULL,
                        shift_start TIME NULL,
                        shift_end TIME NULL,
                        shift_start_at DATETIME NULL,
                        shift_end_at DATETIME NULL,
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

                console.log('Employees tables created successfully');
                tablesInitialized = true;
            } else {
                console.error('Unexpected error checking tables:', error);
                // Don't throw - try to continue anyway, tables might exist
                tablesInitialized = true;
            }
        }
    }

    /**
     * Get all employees with pagination and filters
     */
    async getAllEmployees(filters: {
        page?: number;
        limit?: number;
        department?: string;
        jobType?: string;
        search?: string;
        isActive?: boolean;
        sortField?: string;
        sortDir?: 'ASC' | 'DESC';
    }) {
        await this.ensureTables();
        
        const page = filters.page || 1;
        const limit = filters.limit || 20;
        const offset = (page - 1) * limit;

        const queryBuilder = this.employeeRepo
            .createQueryBuilder('employee')
            .leftJoinAndSelect('employee.user', 'user')
            .where('employee.deletedAt IS NULL');

        // Apply filters
        if (filters.department) {
            const department = this.normalizeDepartmentName(filters.department);
            queryBuilder.andWhere(
                `(employee.department = :department OR EXISTS (
                    SELECT 1
                    FROM user_departments ud
                    INNER JOIN departments d ON d.id = ud.departmentId
                    WHERE ud.userId = employee.userId
                      AND d.name = :department
                      AND d.deletedAt IS NULL
                ))`,
                { department }
            );
        }

        if (filters.jobType) {
            queryBuilder.andWhere('employee.jobType = :jobType', { jobType: filters.jobType });
        }

        if (filters.search) {
            queryBuilder.andWhere(
                '(user.firstName LIKE :search OR user.lastName LIKE :search OR employee.preferredName LIKE :search OR user.email LIKE :search)',
                { search: `%${filters.search}%` }
            );
        }

        if (filters.isActive !== undefined) {
            queryBuilder.andWhere('user.isActive = :isActive', { isActive: filters.isActive });
        }

        // Sorting - whitelist allowed fields
        const sortFieldMap: Record<string, string> = {
            'name': 'user.firstName',
            'department': 'employee.department',
            'start_date': 'employee.startDate',
            'created_at': 'employee.createdAt',
            'hourly_rate': 'employee.hourlyRate',
            'job_title': 'employee.jobTitle',
            'employee_number_seq': 'employee.employeeNumber',
            'schedule': 'employee.schedule',
        };
        const sortDir = filters.sortDir || 'DESC'; // Default to DESC
        const sortColumn = filters.sortField ? sortFieldMap[filters.sortField] : 'employee.employeeNumber'; // Default to employee.employeeNumber
        queryBuilder.orderBy(sortColumn || 'employee.employeeNumber', sortDir as 'ASC' | 'DESC');

        let [employees, total] = await queryBuilder
            .skip(offset)
            .take(limit)
            .getManyAndCount();

        // Attach profile photo FileInfo
        const fileInfoRepo = appDatabase.getRepository(FileInfo);
        employees = await Promise.all(employees.map(async (emp: any) => {
            if (emp.user) {
                emp.isActive = !!emp.user.isActive;
            }
            if (emp.profilePhoto && !isNaN(Number(emp.profilePhoto))) {
                const fileInfo = await fileInfoRepo.findOne({ where: { id: Number(emp.profilePhoto) } });
                if (fileInfo) {
                    emp.profilePhotoInfo = fileInfo;
                }
            }
            return this.attachUserDepartments(emp);
        }));

        return {
            data: employees,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    /**
     * Get single employee by ID
     */
    async getEmployeeById(id: number) {
        const employee: any = await this.employeeRepo.findOne({
            where: { id, deletedAt: IsNull() },
            relations: ['user', 'notes', 'notes.addedByUser', 'changeLogs', 'changeLogs.changedByUser'],
        });

        if (employee && employee.profilePhoto && !isNaN(Number(employee.profilePhoto))) {
            const fileInfoRepo = appDatabase.getRepository(FileInfo);
            const fileInfo = await fileInfoRepo.findOne({ where: { id: Number(employee.profilePhoto) } });
            if (fileInfo) {
                employee.profilePhotoInfo = fileInfo;
            }
        }

        if (employee?.user) {
            employee.isActive = !!employee.user.isActive;
        }

        if (employee) {
            await this.attachUserDepartments(employee);
        }

        if (employee?.changeLogs) {
            employee.changeLogs.sort((a: EmployeeChangeLog, b: EmployeeChangeLog) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }

        return employee;
    }

    /**
     * Get available users (not yet assigned as employees)
     */
    async getAvailableUsers() {
        await this.ensureTables();
        
        const existingEmployeeUserIds = await this.employeeRepo
            .createQueryBuilder('employee')
            .select('employee.userId')
            .where('employee.deletedAt IS NULL')
            .getRawMany();

        const usedIds = existingEmployeeUserIds.map(e => e.employee_user_id);

        const queryBuilder = this.usersRepo
            .createQueryBuilder('user')
            .where('user.isActive = :isActive', { isActive: true })
            .andWhere('user.deletedAt IS NULL');

        if (usedIds.length > 0) {
            queryBuilder.andWhere('user.id NOT IN (:...usedIds)', { usedIds });
        }

        const users = await queryBuilder
            .select(['user.id', 'user.uid', 'user.firstName', 'user.lastName', 'user.email'])
            .orderBy('user.firstName', 'ASC')
            .getMany();

        return Promise.all(users.map(async (user: any) => {
            const userDepartments = await this.userDepartmentRepo.find({
                where: { userId: user.id },
                relations: ['department'],
                order: { id: 'ASC' },
            });
            user.departments = userDepartments.map((ud) => ud.department).filter(Boolean);
            return user;
        }));
    }

    /**
     * Create new employee
     */
    async createEmployee(dto: CreateEmployeeDto) {
        try {
            await this.ensureTables();
        } catch (tableError: any) {
            console.error('Error ensuring tables:', tableError);
            throw new Error(`Table setup failed: ${tableError.message}`);
        }
        
        // Check if user is already an employee
        const existing = await this.employeeRepo.findOne({
            where: { userId: dto.userId, deletedAt: IsNull() },
        });

        if (existing) {
            throw new Error('This user is already assigned as an employee');
        }

        console.log('Creating employee with data:', JSON.stringify(dto));

        // Verify the user exists first
        const userExists = await this.usersRepo.findOne({ where: { id: dto.userId } });
        if (!userExists) {
            throw new Error(`User with id ${dto.userId} not found`);
        }
        console.log('User verified:', userExists.email);

        const departmentNames = this.normalizeDepartmentNames(dto.departmentNames?.length ? dto.departmentNames : [dto.department]);
        const primaryDepartment = departmentNames[0] || this.normalizeDepartmentName(dto.department);

        // Create employee - don't include createdBy if it's undefined
        const employeeData: Partial<Employee> = {
            userId: dto.userId,
            department: primaryDepartment,
            jobTitle: dto.jobTitle,
            jobType: dto.jobType || null,
            hiredFrom: dto.hiredFrom || null,
            hiredFromOther: dto.hiredFromOther || null,
            hourlyRate: dto.hourlyRate || 0,
            startDate: dto.startDate,
            slackUserId: dto.slackUserId || null,
            phone: dto.phone || null,
            birthday: dto.birthday || null,
            country: dto.country || null,
            preferredName: dto.preferredName || null,
            schedule: dto.schedule || null,
            paymentMethod: dto.paymentMethod || null,
            paymentMethodOther: dto.paymentMethodOther || null,
            paymentSchedule: dto.paymentSchedule || null,
            paymentDay: dto.paymentDay || null,
            paymentStartDate: dto.paymentStartDate || null,
            paymentInfo: dto.paymentInfo || null,
            payrollNotes: dto.payrollNotes || null,
        };
        
        if (dto.createdBy) {
            employeeData.createdBy = dto.createdBy;
        }

        console.log('Employee data to save:', JSON.stringify(employeeData));

        try {
            const employee = this.employeeRepo.create(employeeData);
            const saved = await this.employeeRepo.save(employee);
            await this.setUserDepartments(dto.userId, departmentNames, dto.createdBy);
            if (dto.schedule) {
                await this.logEmployeeChange(saved.id, 'Schedule', null, dto.schedule, dto.createdBy);
            }
            console.log('Employee saved with id:', saved.id);

            // Generate employee number after save
            await this.regenerateEmployeeNumbers();

            return this.getEmployeeById(saved.id);
        } catch (saveError: any) {
            console.error('Error saving employee:', saveError);
            console.error('SQL Message:', saveError.sqlMessage);
            console.error('SQL:', saveError.sql);
            throw new Error(`Database error: ${saveError.sqlMessage || saveError.message}`);
        }
    }

    /**
     * Update employee
     */
    private normalizeLogValue(value: any): string | null {
        if (value === undefined || value === null || value === '') return null;
        if (value instanceof Date) return value.toISOString();
        return String(value);
    }

    async logEmployeeChange(employeeId: number, fieldName: string, oldValue: any, newValue: any, changedBy?: number | null) {
        const previous = this.normalizeLogValue(oldValue);
        const next = this.normalizeLogValue(newValue);
        if (previous === next) return;

        const log = this.changeLogRepo.create({
            employeeId,
            fieldName,
            oldValue: previous,
            newValue: next,
            changedBy: changedBy ?? null,
        });
        await this.changeLogRepo.save(log);
    }

    private describeScheduleOverride(entry: Partial<EmployeeScheduleEntry> | null | undefined): string | null {
        if (!entry) return null;
        if (entry.shiftType === EmployeeScheduleShiftType.OFF || entry.shiftType === EmployeeScheduleShiftType.HOLIDAY) {
            return entry.notes ? `${entry.shiftType} (${entry.notes})` : entry.shiftType || 'Off';
        }

        const start = entry.shiftStartAt ? entry.shiftStartAt.toISOString() : entry.shiftStart || '';
        const end = entry.shiftEndAt ? entry.shiftEndAt.toISOString() : entry.shiftEnd || '';
        const range = start && end ? `${start}-${end}` : 'Regular';
        return entry.notes ? `${range} (${entry.notes})` : range;
    }

    private escapeSlackText(value?: unknown) {
        return this.normalizeLogValue(value)?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '—';
    }

    private formatPersonName(user?: Pick<UsersEntity, 'firstName' | 'lastName' | 'email'> | null) {
        const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
        return fullName || user?.email || 'Unknown user';
    }

    private formatScheduleTime(value?: string | null) {
        if (!value) return '';
        const [hourRaw, minuteRaw = '0'] = value.split(':');
        const hour = Number(hourRaw);
        const minute = Number(minuteRaw);
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
        const suffix = hour >= 12 ? 'PM' : 'AM';
        const normalizedHour = hour % 12 || 12;
        return `${normalizedHour}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${suffix}`;
    }

    private formatScheduleRange(start?: string | null, end?: string | null) {
        const formattedStart = this.formatScheduleTime(start);
        const formattedEnd = this.formatScheduleTime(end);
        return formattedStart && formattedEnd ? `${formattedStart} - ${formattedEnd}` : 'Incomplete schedule';
    }

    private formatRegularScheduleForSlack(value?: string | null) {
        if (!value) return '—';
        try {
            const schedule = JSON.parse(value);
            const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const days = Array.isArray(schedule.days)
                ? schedule.days.map((day: number) => dayLabels[day]).filter(Boolean).join(', ')
                : '';
            const defaultRange = schedule.constantStart && schedule.constantEnd
                ? this.formatScheduleRange(schedule.constantStart, schedule.constantEnd)
                : '';
            const overrides = schedule.overrides && typeof schedule.overrides === 'object'
                ? Object.entries(schedule.overrides).map(([day, override]: [string, any]) =>
                    `${dayLabels[Number(day)] || day}: ${this.formatScheduleRange(override?.start, override?.end)}`
                )
                : [];
            const parts = [
                days ? `Days: ${days}` : null,
                defaultRange ? `Default: ${defaultRange}` : null,
                schedule.effectiveStartDate ? `Effective: ${schedule.effectiveStartDate}` : null,
                overrides.length ? `Overrides: ${overrides.join('; ')}` : null,
            ].filter(Boolean);
            return parts.length ? parts.join(' | ') : value;
        } catch {
            return value;
        }
    }

    private formatScheduleOverrideForSlack(entry: Partial<EmployeeScheduleEntry> | null | undefined) {
        if (!entry) return '—';
        if (entry.shiftType === EmployeeScheduleShiftType.OFF || entry.shiftType === EmployeeScheduleShiftType.HOLIDAY) {
            return [entry.shiftType, entry.notes ? `(${entry.notes})` : null].filter(Boolean).join(' ');
        }

        const start = entry.shiftStart || (entry.shiftStartAt ? this.toTimeStringFromDate(entry.shiftStartAt) : null);
        const end = entry.shiftEnd || (entry.shiftEndAt ? this.toTimeStringFromDate(entry.shiftEndAt) : null);
        return [this.formatScheduleRange(start, end), entry.notes ? `(${entry.notes})` : null].filter(Boolean).join(' ');
    }

    private async sendScheduleAdjustmentNotification(options: {
        employeeId: number;
        changeType: string;
        previousValue?: string | null;
        newValue?: string | null;
        date?: string | null;
        changedBy?: number;
    }) {
        try {
            const [employee, changedByUser] = await Promise.all([
                this.employeeRepo.findOne({
                    where: { id: options.employeeId, deletedAt: IsNull() },
                    relations: ['user'],
                }),
                options.changedBy ? this.usersRepo.findOne({ where: { id: options.changedBy } }) : Promise.resolve(null),
            ]);

            const employeeName = employee?.user ? this.formatPersonName(employee.user) : `Employee #${options.employeeId}`;
            const changedByName = changedByUser ? this.formatPersonName(changedByUser) : 'SecureStay';
            const lines = [
                '*Employee shift/schedule adjusted*',
                `*Employee:* ${this.escapeSlackText(employeeName)}`,
                `*Change:* ${this.escapeSlackText(options.changeType)}`,
                options.date ? `*Date:* ${this.escapeSlackText(options.date)}` : null,
                `*Previous:* ${this.escapeSlackText(options.previousValue)}`,
                `*New:* ${this.escapeSlackText(options.newValue)}`,
                `*Updated by:* ${this.escapeSlackText(changedByName)}`,
            ].filter(Boolean);

            await sendSlackMessage({
                channel: WORKLOG_OT_HOURS_SLACK_CHANNEL,
                text: lines.join('\n'),
            });
        } catch (error) {
            logger.error('[EmployeeService] Failed to send schedule adjustment Slack notification:', error);
        }
    }

    private extractScheduleLeavePaymentType(notes?: string | null) {
        const firstPhrase = notes?.split('.')[0]?.trim().toLowerCase();
        if (firstPhrase === 'paid leave') return PaymentType.PAID;
        if (firstPhrase === 'unpaid leave') return PaymentType.UNPAID;
        return null;
    }

    private async syncLeaveRequestFromScheduleOverride(employee: Employee, date: string, notes?: string | null, changedBy?: number) {
        const paymentType = this.extractScheduleLeavePaymentType(notes);
        if (!paymentType) return;

        const leaveType = paymentType === PaymentType.PAID ? 'Paid Leave' : 'Unpaid Leave';
        const reason = notes?.trim() || `Created from schedule adjustment: ${leaveType}`;
        const activeStatuses = [
            LeaveRequestStatus.PENDING,
            LeaveRequestStatus.APPROVED,
            LeaveRequestStatus.CANCELLATION_PENDING,
        ];

        const existingLeave = await this.leaveRequestRepo
            .createQueryBuilder('leave')
            .where('leave.userId = :userId', { userId: employee.userId })
            .andWhere('leave.deletedAt IS NULL')
            .andWhere('leave.status IN (:...statuses)', { statuses: activeStatuses })
            .andWhere('leave.startDate = :date AND leave.endDate = :date', { date })
            .orderBy('leave.createdAt', 'DESC')
            .getOne();

        const leaveRequest = existingLeave || this.leaveRequestRepo.create({
            userId: employee.userId,
            totalDays: 1,
        });

        leaveRequest.leaveType = leaveType;
        leaveRequest.startDate = new Date(date);
        leaveRequest.endDate = new Date(date);
        leaveRequest.totalDays = 1;
        leaveRequest.reason = reason;
        leaveRequest.status = LeaveRequestStatus.APPROVED;
        leaveRequest.paymentType = paymentType;
        leaveRequest.actionedBy = (changedBy ?? null) as any;
        leaveRequest.actionedAt = new Date();
        leaveRequest.adminNotes = 'Created from employee schedule adjustment';

        await this.leaveRequestRepo.save(leaveRequest);
    }

    private toDate(value?: string | null): Date | null {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    private toTimeStringFromDate(date: Date | null): string | null {
        if (!date) return null;
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }

    async getScheduleOverrides(filters: { startDate: string; endDate: string; employeeId?: number }) {
        await this.ensureTables();

        const where: any = {
            isRecurring: false,
            date: Between(filters.startDate, filters.endDate),
        };

        if (filters.employeeId !== undefined) {
            where.employeeId = filters.employeeId;
        }

        const rows = await this.scheduleRepo.find({
            where,
            order: {
                date: 'ASC',
                employeeId: 'ASC',
            },
        });

        return rows.map((row) => {
            if (!row.shiftStartAt && row.shiftStart) {
                row.shiftStartAt = this.toDate(`${row.date}T${row.shiftStart}`);
            }
            if (!row.shiftEndAt && row.shiftEnd) {
                const fallbackEnd = this.toDate(`${row.date}T${row.shiftEnd}`);
                if (fallbackEnd && row.shiftStart && row.shiftEnd && row.shiftEnd <= row.shiftStart) {
                    fallbackEnd.setDate(fallbackEnd.getDate() + 1);
                }
                row.shiftEndAt = fallbackEnd;
            }
            return row;
        });
    }

    async getScheduleOverrideHistory(employeeId: number, date?: string) {
        await this.ensureTables();

        const employee = await this.employeeRepo.findOne({
            where: { id: employeeId, deletedAt: IsNull() },
        });

        if (!employee) {
            throw new Error('Employee not found');
        }

        const query = this.changeLogRepo
            .createQueryBuilder('log')
            .leftJoinAndSelect('log.changedByUser', 'changedByUser')
            .where('log.employeeId = :employeeId', { employeeId })
            .andWhere('log.fieldName LIKE :fieldName', {
                fieldName: date ? `Schedule Override (${date})` : 'Schedule Override%',
            })
            .orderBy('log.createdAt', 'DESC');

        return query.getMany();
    }

    async upsertScheduleOverride(employeeId: number, dto: UpsertScheduleOverrideDto, changedBy?: number) {
        await this.ensureTables();

        const employee = await this.employeeRepo.findOne({
            where: { id: employeeId, deletedAt: IsNull() },
        });

        if (!employee) {
            throw new Error('Employee not found');
        }

        if (!dto.date) {
            throw new Error('Date is required');
        }

        const shiftStartAt = this.toDate(dto.shiftStartAt || null);
        const shiftEndAt = this.toDate(dto.shiftEndAt || null);

        if (dto.shiftType === EmployeeScheduleShiftType.REGULAR && (!shiftStartAt || !shiftEndAt)) {
            throw new Error('Shift start and end datetimes are required for a regular override');
        }

        if (shiftStartAt && shiftEndAt && shiftStartAt >= shiftEndAt) {
            throw new Error('Shift start must be before shift end');
        }

        let entry = await this.scheduleRepo.findOne({
            where: {
                employeeId,
                date: dto.date,
                isRecurring: false,
            },
        });

        const previousSummary = this.describeScheduleOverride(entry);
        const previousSlackSummary = this.formatScheduleOverrideForSlack(entry);

        if (!entry) {
            entry = this.scheduleRepo.create({
                employeeId,
                date: dto.date,
                isRecurring: false,
            });
        }

        entry.date = shiftStartAt ? shiftStartAt.toISOString().slice(0, 10) : dto.date;
        entry.shiftType = dto.shiftType;
        entry.shiftStartAt = dto.shiftType === EmployeeScheduleShiftType.REGULAR ? shiftStartAt : null;
        entry.shiftEndAt = dto.shiftType === EmployeeScheduleShiftType.REGULAR ? shiftEndAt : null;
        entry.shiftStart = dto.shiftType === EmployeeScheduleShiftType.REGULAR ? this.toTimeStringFromDate(shiftStartAt) : null;
        entry.shiftEnd = dto.shiftType === EmployeeScheduleShiftType.REGULAR ? this.toTimeStringFromDate(shiftEndAt) : null;
        entry.notes = dto.notes || null;
        entry.createdBy = changedBy !== undefined ? String(changedBy) : entry.createdBy || null;

        const saved = await this.scheduleRepo.save(entry);
        const nextSummary = this.describeScheduleOverride(saved);

        await this.logEmployeeChange(
            employeeId,
            `Schedule Override (${entry.date})`,
            previousSummary,
            nextSummary,
            changedBy
        );

        if (this.normalizeLogValue(previousSummary) !== this.normalizeLogValue(nextSummary)) {
            void this.sendScheduleAdjustmentNotification({
                employeeId,
                changeType: saved.shiftType === EmployeeScheduleShiftType.OFF ? 'Shift cancellation / leave' : 'Shift override',
                date: saved.date,
                previousValue: previousSlackSummary,
                newValue: this.formatScheduleOverrideForSlack(saved),
                changedBy,
            });
        }

        if (saved.shiftType === EmployeeScheduleShiftType.OFF) {
            await this.syncLeaveRequestFromScheduleOverride(employee, saved.date, saved.notes, changedBy);
        }

        return saved;
    }

    async clearScheduleOverride(employeeId: number, date: string, changedBy?: number) {
        await this.ensureTables();

        const entry = await this.scheduleRepo.findOne({
            where: {
                employeeId,
                date,
                isRecurring: false,
            },
        });

        if (!entry) {
            return { success: true };
        }

        const previousSummary = this.describeScheduleOverride(entry);
        await this.scheduleRepo.remove(entry);
        await this.logEmployeeChange(
            employeeId,
            `Schedule Override (${date})`,
            previousSummary,
            null,
            changedBy
        );

        void this.sendScheduleAdjustmentNotification({
            employeeId,
            changeType: 'Shift override removed',
            date,
            previousValue: this.formatScheduleOverrideForSlack(entry),
            newValue: null,
            changedBy,
        });

        return { success: true };
    }

    async updateEmployee(id: number, dto: UpdateEmployeeDto, changedBy?: number) {
        const employee = await this.employeeRepo.findOne({
            where: { id, deletedAt: IsNull() },
        });

        if (!employee) {
            throw new Error('Employee not found');
        }

        const logTasks: Promise<void>[] = [];
        let pendingDepartmentNames: string[] | null = null;
        const previousSchedule = employee.schedule;
        let nextSchedule: string | null | undefined;
        const queue = (fieldName: string, oldValue: any, newValue: any) => {
            logTasks.push(this.logEmployeeChange(id, fieldName, oldValue, newValue, changedBy));
        };

        if (dto.departmentNames !== undefined || dto.department !== undefined) {
            const departmentNames = this.normalizeDepartmentNames(dto.departmentNames?.length ? dto.departmentNames : [dto.department]);
            const primaryDepartment = departmentNames[0];
            if (primaryDepartment) {
                queue('Department', employee.department, departmentNames.join(', '));
                employee.department = primaryDepartment;
                pendingDepartmentNames = departmentNames;
            }
        }
        if (dto.firstName !== undefined || dto.lastName !== undefined) {
            const user = await this.usersRepo.findOne({ where: { id: employee.userId } });
            if (user) {
                if (dto.firstName !== undefined) {
                    queue('First Name', user.firstName, dto.firstName);
                    user.firstName = dto.firstName;
                }
                if (dto.lastName !== undefined) {
                    queue('Last Name', user.lastName, dto.lastName || null);
                    user.lastName = dto.lastName || null as any;
                }
                await this.usersRepo.save(user);
            }
        }
        if (dto.jobTitle !== undefined) { queue('Job Title', employee.jobTitle, dto.jobTitle); employee.jobTitle = dto.jobTitle; }
        if (dto.jobType !== undefined) { queue('Job Type', employee.jobType, dto.jobType || null); employee.jobType = dto.jobType || null; }
        if (dto.hiredFrom !== undefined) { queue('Hired From', employee.hiredFrom, dto.hiredFrom || null); employee.hiredFrom = dto.hiredFrom || null; }
        if (dto.hiredFromOther !== undefined) { queue('Hired From Other', employee.hiredFromOther, dto.hiredFromOther || null); employee.hiredFromOther = dto.hiredFromOther || null; }
        if (dto.employeeType !== undefined) { queue('Employee Type', employee.employeeType, dto.employeeType || null); employee.employeeType = dto.employeeType || null; }
        if (dto.hourlyRate !== undefined) { queue('Hourly Rate', employee.hourlyRate, dto.hourlyRate); employee.hourlyRate = dto.hourlyRate; }
        if (dto.overtimeHours !== undefined) { queue('Overtime Hours', employee.overtimeHours, dto.overtimeHours); employee.overtimeHours = dto.overtimeHours; }
        if (dto.bonuses !== undefined) { queue('Bonuses', employee.bonuses, dto.bonuses); employee.bonuses = dto.bonuses; }
        if (dto.slackUserId !== undefined) { queue('Slack User', employee.slackUserId, dto.slackUserId || null); employee.slackUserId = dto.slackUserId || null; }
        if (dto.profilePhoto !== undefined) { queue('Profile Photo', employee.profilePhoto, dto.profilePhoto || null); employee.profilePhoto = dto.profilePhoto || null; }
        if (dto.isActive !== undefined) { queue('Status', employee.isActive, dto.isActive); employee.isActive = dto.isActive; }
        if (dto.phone !== undefined) { queue('Phone', employee.phone, dto.phone || null); employee.phone = dto.phone || null; }
        if (dto.birthday !== undefined) { queue('Birthday', employee.birthday, dto.birthday || null); employee.birthday = dto.birthday || null; }
        if (dto.country !== undefined) { queue('Country', employee.country, dto.country || null); employee.country = dto.country || null; }
        if (dto.preferredName !== undefined) { queue('Preferred Name', employee.preferredName, dto.preferredName || null); employee.preferredName = dto.preferredName || null; }
        if (dto.schedule !== undefined) {
            nextSchedule = dto.schedule || null;
            queue('Schedule', employee.schedule, nextSchedule);
            employee.schedule = nextSchedule;
        }
        if (dto.slackId !== undefined) { queue('Slack ID', employee.slackId, dto.slackId || null); employee.slackId = dto.slackId || null; }
        if (dto.paymentMethod !== undefined) { queue('Payment Method', employee.paymentMethod, dto.paymentMethod || null); employee.paymentMethod = dto.paymentMethod || null; }
        if (dto.paymentMethodOther !== undefined) { queue('Payment Method Other', employee.paymentMethodOther, dto.paymentMethodOther || null); employee.paymentMethodOther = dto.paymentMethodOther || null; }
        if (dto.paymentSchedule !== undefined) { queue('Payment Schedule', employee.paymentSchedule, dto.paymentSchedule || null); employee.paymentSchedule = dto.paymentSchedule || null; }
        if (dto.paymentInfo !== undefined) { queue('Payment Info', employee.paymentInfo, dto.paymentInfo || null); employee.paymentInfo = dto.paymentInfo || null; }
        if (dto.payrollNotes !== undefined) { queue('Payroll Notes', employee.payrollNotes, dto.payrollNotes || null); employee.payrollNotes = dto.payrollNotes || null; }
        if (dto.paymentDay !== undefined) { queue('Payment Day', employee.paymentDay, dto.paymentDay || null); employee.paymentDay = dto.paymentDay || null; }
        if (dto.paymentRecurrence !== undefined) { queue('Payment Recurrence', employee.paymentRecurrence, dto.paymentRecurrence || null); employee.paymentRecurrence = dto.paymentRecurrence || null; }
        if (dto.paymentStartDate !== undefined) { queue('Payment Start Date', employee.paymentStartDate, dto.paymentStartDate || null); employee.paymentStartDate = dto.paymentStartDate || null; }

        const startDateChanged = dto.startDate !== undefined && 
            new Date(dto.startDate).getTime() !== new Date(employee.startDate).getTime();
        
        if (dto.startDate !== undefined) {
            queue('Start Date', employee.startDate, dto.startDate);
            employee.startDate = dto.startDate;
        }

        await this.employeeRepo.save(employee);
        if (pendingDepartmentNames) {
            await this.setUserDepartments(employee.userId, pendingDepartmentNames, changedBy);
        }
        await Promise.all(logTasks);

        // If start date changed, regenerate all employee numbers
        if (startDateChanged) {
            await this.regenerateEmployeeNumbers();
        }

        if (
            nextSchedule !== undefined &&
            this.normalizeLogValue(previousSchedule) !== this.normalizeLogValue(nextSchedule)
        ) {
            void this.sendScheduleAdjustmentNotification({
                employeeId: id,
                changeType: 'Regular schedule',
                previousValue: this.formatRegularScheduleForSlack(previousSchedule),
                newValue: this.formatRegularScheduleForSlack(nextSchedule),
                changedBy,
            });
        }

        return this.getEmployeeById(id);
    }

    /**
     * Delete employee (soft delete)
     */
    async deleteEmployee(id: number) {
        const employee = await this.employeeRepo.findOne({
            where: { id, deletedAt: IsNull() },
        });

        if (!employee) {
            throw new Error('Employee not found');
        }

        employee.deletedAt = new Date();
        employee.employeeNumber = null;
        employee.employeeNumberSeq = null;
        await this.employeeRepo.save(employee);

        // Regenerate employee numbers
        await this.regenerateEmployeeNumbers();

        return { success: true, message: 'Employee deleted successfully' };
    }

    /**
     * Regenerate employee numbers based on start date order
     * Format: LL-001, LL-002, etc.
     */
    async regenerateEmployeeNumbers() {
        await appDatabase.manager.transaction(async (transactionalEntityManager) => {
            // First, clear all employee numbers to avoid unique constraint violations
            // and use a pessimistic lock to ensure only one regeneration process runs at a time
            await transactionalEntityManager
                .createQueryBuilder(Employee, 'employee')
                .setLock('pessimistic_write')
                .update()
                .set({ employeeNumber: null, employeeNumberSeq: null })
                .execute();

            const employees = await transactionalEntityManager
                .createQueryBuilder(Employee, 'employee')
                .where('employee.deletedAt IS NULL')
                .orderBy('employee.startDate', 'ASC')
                .addOrderBy('employee.createdAt', 'ASC')
                .addOrderBy('employee.id', 'ASC')
                .getMany();

            for (let i = 0; i < employees.length; i++) {
                const seq = i + 1;
                const number = String(seq).padStart(3, '0');
                employees[i].employeeNumber = `LL-${number}`;
                employees[i].employeeNumberSeq = seq;
            }

            if (employees.length > 0) {
                await transactionalEntityManager.save(employees);
            }
        });
    }

    /**
     * Add internal note
     */
    async addNote(employeeId: number, content: string, addedBy: number) {
        const employee = await this.employeeRepo.findOne({
            where: { id: employeeId, deletedAt: IsNull() },
        });

        if (!employee) {
            throw new Error('Employee not found');
        }

        const note = this.noteRepo.create({
            employeeId,
            content,
            addedBy,
        });

        return this.noteRepo.save(note);
    }

    /**
     * Get notes for employee
     */
    async getNotes(employeeId: number) {
        return this.noteRepo.find({
            where: { employeeId },
            relations: ['addedByUser'],
            order: { createdAt: 'DESC' },
        });
    }

    /**
     * Delete note
     */
    async deleteNote(noteId: number) {
        const note = await this.noteRepo.findOne({ where: { id: noteId } });
        if (!note) {
            throw new Error('Note not found');
        }
        await this.noteRepo.remove(note);
        return { success: true, message: 'Note deleted successfully' };
    }

    /**
     * Get employee departments
     */
    async getDepartments() {
        await this.ensureTables();
        const departments = await this.departmentRepo.find({
            where: { deletedAt: null as any },
            order: { name: 'ASC' },
        });

        if (departments.length > 0) {
            return departments.map((department) => department.name);
        }

        return Object.values(EmployeeDepartment);
    }
}
