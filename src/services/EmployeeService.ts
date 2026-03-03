import { appDatabase } from "../utils/database.util";
import { Employee, EmployeeDepartment } from "../entity/Employee";
import { EmployeeNote } from "../entity/EmployeeNote";
import { UsersEntity } from "../entity/Users";
import { FileInfo } from "../entity/FileInfo";
import { IsNull } from "typeorm";

interface CreateEmployeeDto {
    userId: number;
    department: EmployeeDepartment;
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
    paymentMethod?: string | null;
    paymentMethodOther?: string | null;
    paymentSchedule?: string | null;
    paymentDay?: string | null;
    paymentStartDate?: Date | null;
    paymentInfo?: string | null;
}

interface UpdateEmployeeDto {
    department?: EmployeeDepartment;
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
    schedule?: string | null;
    slackId?: string | null;
    paymentMethod?: string | null;
    paymentMethodOther?: string | null;
    paymentSchedule?: string | null;
    paymentInfo?: string | null;
    paymentDay?: string | null;
    paymentRecurrence?: string | null;
    paymentStartDate?: Date | null;
}

// Flag to track if tables have been initialized
let tablesInitialized = false;

export class EmployeeService {
    private employeeRepo = appDatabase.getRepository(Employee);
    private noteRepo = appDatabase.getRepository(EmployeeNote);
    private usersRepo = appDatabase.getRepository(UsersEntity);

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
            await addColumnIfNotExists('schedule', 'VARCHAR(255) NULL');
            await addColumnIfNotExists('slack_id', 'VARCHAR(100) NULL');
            await addColumnIfNotExists('payment_method', 'VARCHAR(50) NULL');
            await addColumnIfNotExists('payment_method_other', 'VARCHAR(100) NULL');
            await addColumnIfNotExists('payment_schedule', 'VARCHAR(50) NULL');
            await addColumnIfNotExists('payment_info', 'TEXT NULL');
            await addColumnIfNotExists('profile_photo', 'VARCHAR(500) NULL');
            await addColumnIfNotExists('employee_number_seq', 'INT NULL');
            await addColumnIfNotExists('job_type', 'VARCHAR(50) NULL');
            await addColumnIfNotExists('hired_from', 'VARCHAR(50) NULL');
            await addColumnIfNotExists('hired_from_other', 'VARCHAR(100) NULL');
            await addColumnIfNotExists('employee_type', 'VARCHAR(50) NULL');
            await addColumnIfNotExists('payment_day', 'VARCHAR(20) NULL');
            await addColumnIfNotExists('payment_recurrence', 'VARCHAR(20) NULL');
            await addColumnIfNotExists('payment_start_date', 'DATE NULL');

            // Cleanup soft-deleted employee numbers to prevent conflicts with active ones
            await appDatabase.query(`UPDATE employees SET employee_number = NULL, employee_number_seq = NULL WHERE deleted_at IS NOT NULL`);

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
                        department ENUM('Guest Relations', 'Client Relations', 'Maintenance', 'Onboarding', 'Admin') NOT NULL,
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
            queryBuilder.andWhere('employee.department = :department', { department: filters.department });
        }

        if (filters.jobType) {
            queryBuilder.andWhere('employee.jobType = :jobType', { jobType: filters.jobType });
        }

        if (filters.search) {
            queryBuilder.andWhere(
                '(user.firstName LIKE :search OR user.lastName LIKE :search OR user.email LIKE :search)',
                { search: `%${filters.search}%` }
            );
        }

        if (filters.isActive !== undefined) {
            queryBuilder.andWhere('employee.isActive = :isActive', { isActive: filters.isActive });
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
            if (emp.profilePhoto && !isNaN(Number(emp.profilePhoto))) {
                const fileInfo = await fileInfoRepo.findOne({ where: { id: Number(emp.profilePhoto) } });
                if (fileInfo) {
                    emp.profilePhotoInfo = fileInfo;
                }
            }
            return emp;
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
            relations: ['user', 'notes', 'notes.addedByUser'],
        });

        if (employee && employee.profilePhoto && !isNaN(Number(employee.profilePhoto))) {
            const fileInfoRepo = appDatabase.getRepository(FileInfo);
            const fileInfo = await fileInfoRepo.findOne({ where: { id: Number(employee.profilePhoto) } });
            if (fileInfo) {
                employee.profilePhotoInfo = fileInfo;
            }
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

        return queryBuilder
            .select(['user.id', 'user.uid', 'user.firstName', 'user.lastName', 'user.email'])
            .orderBy('user.firstName', 'ASC')
            .getMany();
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

        // Create employee - don't include createdBy if it's undefined
        const employeeData: Partial<Employee> = {
            userId: dto.userId,
            department: dto.department,
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
            paymentMethod: dto.paymentMethod || null,
            paymentMethodOther: dto.paymentMethodOther || null,
            paymentSchedule: dto.paymentSchedule || null,
            paymentDay: dto.paymentDay || null,
            paymentStartDate: dto.paymentStartDate || null,
            paymentInfo: dto.paymentInfo || null,
        };
        
        if (dto.createdBy) {
            employeeData.createdBy = dto.createdBy;
        }

        console.log('Employee data to save:', JSON.stringify(employeeData));

        try {
            const employee = this.employeeRepo.create(employeeData);
            const saved = await this.employeeRepo.save(employee);
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
    async updateEmployee(id: number, dto: UpdateEmployeeDto) {
        const employee = await this.employeeRepo.findOne({
            where: { id, deletedAt: IsNull() },
        });

        if (!employee) {
            throw new Error('Employee not found');
        }

        // Update fields
        if (dto.department !== undefined) employee.department = dto.department;
        if (dto.jobTitle !== undefined) employee.jobTitle = dto.jobTitle;
        if (dto.jobType !== undefined) employee.jobType = dto.jobType || null;
        if (dto.hiredFrom !== undefined) employee.hiredFrom = dto.hiredFrom || null;
        if (dto.hiredFromOther !== undefined) employee.hiredFromOther = dto.hiredFromOther || null;
        if (dto.employeeType !== undefined) employee.employeeType = dto.employeeType || null;
        if (dto.hourlyRate !== undefined) employee.hourlyRate = dto.hourlyRate;
        if (dto.overtimeHours !== undefined) employee.overtimeHours = dto.overtimeHours;
        if (dto.bonuses !== undefined) employee.bonuses = dto.bonuses;
        if (dto.slackUserId !== undefined) employee.slackUserId = dto.slackUserId || null;
        if (dto.profilePhoto !== undefined) employee.profilePhoto = dto.profilePhoto || null;
        if (dto.isActive !== undefined) employee.isActive = dto.isActive;
        if (dto.phone !== undefined) employee.phone = dto.phone || null;
        if (dto.birthday !== undefined) employee.birthday = dto.birthday || null;
        if (dto.country !== undefined) employee.country = dto.country || null;
        if (dto.schedule !== undefined) employee.schedule = dto.schedule || null;
        if (dto.slackId !== undefined) employee.slackId = dto.slackId || null;
        if (dto.paymentMethod !== undefined) employee.paymentMethod = dto.paymentMethod || null;
        if (dto.paymentMethodOther !== undefined) employee.paymentMethodOther = dto.paymentMethodOther || null;
        if (dto.paymentSchedule !== undefined) employee.paymentSchedule = dto.paymentSchedule || null;
        if (dto.paymentInfo !== undefined) employee.paymentInfo = dto.paymentInfo || null;
        if (dto.paymentDay !== undefined) employee.paymentDay = dto.paymentDay || null;
        if (dto.paymentRecurrence !== undefined) employee.paymentRecurrence = dto.paymentRecurrence || null;
        if (dto.paymentStartDate !== undefined) employee.paymentStartDate = dto.paymentStartDate || null;

        const startDateChanged = dto.startDate !== undefined && 
            new Date(dto.startDate).getTime() !== new Date(employee.startDate).getTime();
        
        if (dto.startDate !== undefined) {
            employee.startDate = dto.startDate;
        }

        await this.employeeRepo.save(employee);

        // If start date changed, regenerate all employee numbers
        if (startDateChanged) {
            await this.regenerateEmployeeNumbers();
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
    getDepartments() {
        return Object.values(EmployeeDepartment);
    }
}
