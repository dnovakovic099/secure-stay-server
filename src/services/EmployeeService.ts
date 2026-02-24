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

export class EmployeeService {
    private employeeRepo = appDatabase.getRepository(Employee);
    private noteRepo = appDatabase.getRepository(EmployeeNote);
    private usersRepo = appDatabase.getRepository(UsersEntity);

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
        // Check if user is already an employee
        const existing = await this.employeeRepo.findOne({
            where: { userId: dto.userId, deletedAt: IsNull() },
        });

        if (existing) {
            throw new Error('This user is already assigned as an employee');
        }

        // Create employee
        const employee = this.employeeRepo.create({
            userId: dto.userId,
            department: dto.department,
            jobTitle: dto.jobTitle,
            hourlyRate: dto.hourlyRate,
            startDate: dto.startDate,
            createdBy: dto.createdBy,
        });

        const saved = await this.employeeRepo.save(employee);

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
