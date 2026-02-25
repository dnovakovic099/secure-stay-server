import { appDatabase } from "../utils/database.util";
import { Employee, EmployeeDepartment } from "../entity/Employee";
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
}

interface UpdateEmployeeDto {
    department?: EmployeeDepartment;
    jobTitle?: string;
    hourlyRate?: number;
    startDate?: Date;
    overtimeHours?: number;
    bonuses?: number;
    isActive?: boolean;
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
                        department ENUM('Guest Relations', 'Client Relations', 'Maintenance', 'Onboarding', 'Admin') NOT NULL,
                        job_title VARCHAR(100) NOT NULL,
                        hourly_rate DECIMAL(10, 2) DEFAULT 0,
                        start_date DATE NOT NULL,
                        overtime_hours DECIMAL(10, 2) DEFAULT 0,
                        bonuses DECIMAL(10, 2) DEFAULT 0,
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
        search?: string;
        isActive?: boolean;
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

        if (filters.search) {
            queryBuilder.andWhere(
                '(user.firstName LIKE :search OR user.lastName LIKE :search OR user.email LIKE :search)',
                { search: `%${filters.search}%` }
            );
        }

        if (filters.isActive !== undefined) {
            queryBuilder.andWhere('employee.isActive = :isActive', { isActive: filters.isActive });
        }

        // Order by start date for consistent employee numbering display
        queryBuilder.orderBy('employee.startDate', 'ASC');

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

        // Create employee - don't include createdBy if it's undefined
        const employeeData: any = {
            userId: dto.userId,
            department: dto.department,
            jobTitle: dto.jobTitle,
            hourlyRate: dto.hourlyRate || 0,
            startDate: dto.startDate,
        };
        
        if (dto.createdBy) {
            employeeData.createdBy = dto.createdBy;
        }

        const employee = this.employeeRepo.create(employeeData);

        const saved = await this.employeeRepo.save(employee);
        console.log('Employee saved with id:', saved.id);

        // Generate employee number after save
        await this.regenerateEmployeeNumbers();

        return this.getEmployeeById(saved.id);
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
        if (dto.hourlyRate !== undefined) employee.hourlyRate = dto.hourlyRate;
        if (dto.overtimeHours !== undefined) employee.overtimeHours = dto.overtimeHours;
        if (dto.bonuses !== undefined) employee.bonuses = dto.bonuses;
        if (dto.isActive !== undefined) employee.isActive = dto.isActive;

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
        const employees = await this.employeeRepo
            .createQueryBuilder('employee')
            .where('employee.deletedAt IS NULL')
            .orderBy('employee.startDate', 'ASC')
            .addOrderBy('employee.createdAt', 'ASC')
            .addOrderBy('employee.id', 'ASC')
            .getMany();

        for (let i = 0; i < employees.length; i++) {
            const number = String(i + 1).padStart(3, '0');
            employees[i].employeeNumber = `LL-${number}`;
        }

        await this.employeeRepo.save(employees);
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
