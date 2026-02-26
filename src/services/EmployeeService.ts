import { appDatabase } from "../utils/database.util";
import { Employee, EmployeeDepartment, PaymentMethod, PaymentSchedule } from "../entity/Employee";
import { EmployeeNote } from "../entity/EmployeeNote";
import { UsersEntity } from "../entity/Users";
import { IsNull } from "typeorm";

interface CreateEmployeeDto {
    userId: number;
    department: EmployeeDepartment;
    jobTitle: string;
    hourlyRate: number;
    startDate: Date;
    createdBy?: number;
    phone?: string;
    birthday?: Date;
    schedule?: string;
    slackId?: string;
    paymentMethod?: PaymentMethod;
    paymentMethodOther?: string;
    paymentSchedule?: PaymentSchedule;
    paymentInfo?: string;
}

interface UpdateEmployeeDto {
    department?: EmployeeDepartment;
    jobTitle?: string;
    hourlyRate?: number;
    startDate?: Date;
    overtimeHours?: number;
    bonuses?: number;
    isActive?: boolean;
    phone?: string;
    birthday?: Date;
    schedule?: string;
    slackId?: string;
    paymentMethod?: PaymentMethod;
    paymentMethodOther?: string;
    paymentSchedule?: PaymentSchedule;
    paymentInfo?: string;
}

interface EmployeeFilters {
    page?: number;
    limit?: number;
    department?: EmployeeDepartment;
    search?: string;
    isActive?: boolean;
    sortField?: string;
    sortDir?: 'ASC' | 'DESC';
}

// Flag to track if tables have been initialized
let tablesInitialized = false;

export class EmployeeService {
    private employeeRepo = appDatabase.getRepository(Employee);
    private noteRepo = appDatabase.getRepository(EmployeeNote);
    private usersRepo = appDatabase.getRepository(UsersEntity);

    /**
     * Ensures the employees and employee_notes tables exist with all columns
     */
    private async ensureTables(): Promise<void> {
        if (tablesInitialized) return;

        try {
            // Check if employees table exists
            await appDatabase.query(`SELECT 1 FROM employees LIMIT 1`);
            
            // Add new columns if they don't exist
            const columnsToAdd = [
                { name: 'employee_number_seq', sql: 'INT NULL' },
                { name: 'phone', sql: 'VARCHAR(50) NULL' },
                { name: 'birthday', sql: 'DATE NULL' },
                { name: 'schedule', sql: 'VARCHAR(100) NULL' },
                { name: 'slack_id', sql: 'VARCHAR(100) NULL' },
                { name: 'payment_method', sql: "ENUM('Wise', 'ACH', 'Other') NULL" },
                { name: 'payment_method_other', sql: 'VARCHAR(100) NULL' },
                { name: 'payment_schedule', sql: "ENUM('Batch A', 'Batch B') NULL" },
                { name: 'payment_info', sql: 'TEXT NULL' },
            ];

            for (const col of columnsToAdd) {
                try {
                    await appDatabase.query(`ALTER TABLE employees ADD COLUMN ${col.name} ${col.sql}`);
                    console.log(`Added column ${col.name} to employees table`);
                } catch (e: any) {
                    // Column likely already exists
                    if (!e.message?.includes('Duplicate column')) {
                        // console.log(`Column ${col.name} check:`, e.message);
                    }
                }
            }

            // Backfill employee_number_seq for existing records
            await this.backfillEmployeeNumberSeq();

            tablesInitialized = true;
        } catch (error: any) {
            // Table doesn't exist, create it
            if (error.code === 'ER_NO_SUCH_TABLE' || error.message?.includes("doesn't exist")) {
                console.log('Creating employees tables...');
                
                // Create employees table with all columns
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
                        is_active BOOLEAN DEFAULT TRUE,
                        phone VARCHAR(50) NULL,
                        birthday DATE NULL,
                        schedule VARCHAR(100) NULL,
                        slack_id VARCHAR(100) NULL,
                        payment_method ENUM('Wise', 'ACH', 'Other') NULL,
                        payment_method_other VARCHAR(100) NULL,
                        payment_schedule ENUM('Batch A', 'Batch B') NULL,
                        payment_info TEXT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        deleted_at TIMESTAMP NULL,
                        created_by INT NULL,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
                        INDEX idx_employees_department (department),
                        INDEX idx_employees_start_date (start_date),
                        INDEX idx_employees_is_active (is_active),
                        INDEX idx_employees_number_seq (employee_number_seq)
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
                        FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE CASCADE,
                        INDEX idx_employee_notes_employee (employee_id)
                    )
                `);

                tablesInitialized = true;
                console.log('Employees tables created successfully');
            } else {
                throw error;
            }
        }
    }

    /**
     * Backfill employee_number_seq for existing employees
     */
    private async backfillEmployeeNumberSeq(): Promise<void> {
        try {
            // Find employees with employee_number but no employee_number_seq
            const employees = await appDatabase.query(`
                SELECT id, employee_number 
                FROM employees 
                WHERE employee_number IS NOT NULL 
                AND employee_number_seq IS NULL
                AND deleted_at IS NULL
            `);

            for (const emp of employees) {
                if (emp.employee_number) {
                    const match = emp.employee_number.match(/LL-(\d+)/);
                    if (match) {
                        const seq = parseInt(match[1], 10);
                        await appDatabase.query(
                            `UPDATE employees SET employee_number_seq = ? WHERE id = ?`,
                            [seq, emp.id]
                        );
                    }
                }
            }
        } catch (e) {
            console.error('Error backfilling employee_number_seq:', e);
        }
    }

    /**
     * Generate next employee number (transaction-safe)
     */
    private async generateEmployeeNumber(): Promise<{ number: string; seq: number }> {
        // Get max sequence number with FOR UPDATE lock
        const result = await appDatabase.query(`
            SELECT COALESCE(MAX(employee_number_seq), 0) as max_seq 
            FROM employees 
            WHERE deleted_at IS NULL
            FOR UPDATE
        `);
        
        const nextSeq = (result[0]?.max_seq || 0) + 1;
        const employeeNumber = `LL-${String(nextSeq).padStart(3, '0')}`;
        
        return { number: employeeNumber, seq: nextSeq };
    }

    /**
     * Get all employees with filters and sorting
     */
    async getAllEmployees(filters: EmployeeFilters = {}) {
        await this.ensureTables();

        const page = filters.page || 1;
        const limit = filters.limit || 20;
        const offset = (page - 1) * limit;
        const sortField = filters.sortField || 'employee_number_seq';
        const sortDir = filters.sortDir || 'DESC';

        const queryBuilder = this.employeeRepo
            .createQueryBuilder('employee')
            .leftJoinAndSelect('employee.user', 'user')
            .where('employee.deletedAt IS NULL');

        // Apply filters
        if (filters.department) {
            queryBuilder.andWhere('employee.department = :department', { department: filters.department });
        }

        if (filters.search) {
            queryBuilder.andWhere(
                '(user.firstName LIKE :search OR user.lastName LIKE :search OR user.email LIKE :search OR employee.employeeNumber LIKE :search)',
                { search: `%${filters.search}%` }
            );
        }

        if (filters.isActive !== undefined) {
            queryBuilder.andWhere('employee.isActive = :isActive', { isActive: filters.isActive });
        }

        // Apply sorting
        const sortMap: Record<string, string> = {
            'employee_number_seq': 'employee.employeeNumberSeq',
            'employee_number': 'employee.employeeNumberSeq', // Sort by seq for proper numeric order
            'name': 'user.firstName',
            'department': 'employee.department',
            'start_date': 'employee.startDate',
            'created_at': 'employee.createdAt',
        };

        const orderField = sortMap[sortField] || 'employee.employeeNumberSeq';
        queryBuilder.orderBy(orderField, sortDir);
        
        // Secondary sort for stability
        if (orderField !== 'employee.employeeNumberSeq') {
            queryBuilder.addOrderBy('employee.employeeNumberSeq', 'DESC');
        }

        const [employees, total] = await queryBuilder
            .skip(offset)
            .take(limit)
            .getManyAndCount();

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
        return this.employeeRepo.findOne({
            where: { id, deletedAt: IsNull() },
            relations: ['user', 'notes', 'notes.addedByUser'],
        });
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
     * Create new employee with unique employee number
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

        // Verify the user exists
        const userExists = await this.usersRepo.findOne({ where: { id: dto.userId } });
        if (!userExists) {
            throw new Error(`User with id ${dto.userId} not found`);
        }

        // Generate unique employee number (transaction-safe)
        const { number: employeeNumber, seq: employeeNumberSeq } = await this.generateEmployeeNumber();

        // Create employee
        const employeeData: any = {
            userId: dto.userId,
            employeeNumber,
            employeeNumberSeq,
            department: dto.department,
            jobTitle: dto.jobTitle,
            hourlyRate: dto.hourlyRate || 0,
            startDate: dto.startDate,
            phone: dto.phone,
            birthday: dto.birthday,
            schedule: dto.schedule,
            slackId: dto.slackId,
            paymentMethod: dto.paymentMethod,
            paymentMethodOther: dto.paymentMethodOther,
            paymentSchedule: dto.paymentSchedule,
            paymentInfo: dto.paymentInfo,
        };
        
        if (dto.createdBy) {
            employeeData.createdBy = dto.createdBy;
        }

        try {
            const employee = this.employeeRepo.create(employeeData);
            const saved = await this.employeeRepo.save(employee);
            return this.getEmployeeById(saved.id);
        } catch (saveError: any) {
            console.error('Error saving employee:', saveError);
            
            // Handle duplicate key error - retry with new number
            if (saveError.code === 'ER_DUP_ENTRY' && saveError.message?.includes('employee_number')) {
                console.log('Duplicate employee number, retrying...');
                const { number: newNumber, seq: newSeq } = await this.generateEmployeeNumber();
                employeeData.employeeNumber = newNumber;
                employeeData.employeeNumberSeq = newSeq;
                const employee = this.employeeRepo.create(employeeData);
                const saved = await this.employeeRepo.save(employee);
                return this.getEmployeeById(saved.id);
            }
            
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

        // Update basic fields
        if (dto.department !== undefined) employee.department = dto.department;
        if (dto.jobTitle !== undefined) employee.jobTitle = dto.jobTitle;
        if (dto.hourlyRate !== undefined) employee.hourlyRate = dto.hourlyRate;
        if (dto.overtimeHours !== undefined) employee.overtimeHours = dto.overtimeHours;
        if (dto.bonuses !== undefined) employee.bonuses = dto.bonuses;
        if (dto.isActive !== undefined) employee.isActive = dto.isActive;
        if (dto.startDate !== undefined) employee.startDate = dto.startDate;

        // Update new fields
        if (dto.phone !== undefined) employee.phone = dto.phone;
        if (dto.birthday !== undefined) employee.birthday = dto.birthday;
        if (dto.schedule !== undefined) employee.schedule = dto.schedule;
        if (dto.slackId !== undefined) employee.slackId = dto.slackId;
        if (dto.paymentMethod !== undefined) employee.paymentMethod = dto.paymentMethod;
        if (dto.paymentMethodOther !== undefined) employee.paymentMethodOther = dto.paymentMethodOther;
        if (dto.paymentSchedule !== undefined) employee.paymentSchedule = dto.paymentSchedule;
        if (dto.paymentInfo !== undefined) employee.paymentInfo = dto.paymentInfo;

        await this.employeeRepo.save(employee);
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
        await this.employeeRepo.save(employee);

        return { success: true, message: 'Employee deleted successfully' };
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
