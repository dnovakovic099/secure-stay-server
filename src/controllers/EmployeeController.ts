import { Request, Response, NextFunction } from 'express';
import { EmployeeService } from '../services/EmployeeService';
import { EmployeeDepartment } from '../entity/Employee';

interface CustomRequest extends Request {
    user?: {
        id: number;
        uid: string;
        email: string;
        userType: string;
    };
}

export class EmployeeController {
    private employeeService = new EmployeeService();

    /**
     * Get all employees with filters
     */
    getAllEmployees = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { page, limit, department, search, isActive } = req.query;

            const result = await this.employeeService.getAllEmployees({
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 20,
                department: department as string,
                search: search as string,
                isActive: isActive !== undefined ? isActive === 'true' : undefined,
            });

            return res.json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get single employee by ID
     */
    getEmployeeById = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const employee = await this.employeeService.getEmployeeById(parseInt(id));

            if (!employee) {
                return res.status(404).json({ error: 'Employee not found' });
            }

            return res.json(employee);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get available users (not yet employees)
     */
    getAvailableUsers = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const users = await this.employeeService.getAvailableUsers();
            return res.json(users);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Create new employee
     */
    createEmployee = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { userId, department, jobTitle, hourlyRate, startDate } = req.body;

            if (!userId || !department || !jobTitle || !startDate) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // Validate department
            if (!Object.values(EmployeeDepartment).includes(department)) {
                return res.status(400).json({ error: 'Invalid department' });
            }

            const employee = await this.employeeService.createEmployee({
                userId,
                department,
                jobTitle,
                hourlyRate: hourlyRate || 0,
                startDate: new Date(startDate),
                createdBy: req.user?.id,
            });

            return res.status(201).json(employee);
        } catch (error: any) {
            console.error('Error creating employee:', error);
            if (error.message === 'This user is already assigned as an employee') {
                return res.status(400).json({ error: error.message });
            }
            // Return detailed error for debugging
            return res.status(500).json({ 
                error: error.message || 'Failed to create employee',
                details: error.code || error.sqlMessage || null
            });
        }
    };

    /**
     * Update employee
     */
    updateEmployee = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const { department, jobTitle, hourlyRate, startDate, overtimeHours, bonuses, isActive } = req.body;

            // Validate department if provided
            if (department && !Object.values(EmployeeDepartment).includes(department)) {
                return res.status(400).json({ error: 'Invalid department' });
            }

            const employee = await this.employeeService.updateEmployee(parseInt(id), {
                department,
                jobTitle,
                hourlyRate,
                startDate: startDate ? new Date(startDate) : undefined,
                overtimeHours,
                bonuses,
                isActive,
            });

            return res.json(employee);
        } catch (error: any) {
            if (error.message === 'Employee not found') {
                return res.status(404).json({ error: error.message });
            }
            next(error);
        }
    };

    /**
     * Delete employee
     */
    deleteEmployee = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const result = await this.employeeService.deleteEmployee(parseInt(id));
            return res.json(result);
        } catch (error: any) {
            if (error.message === 'Employee not found') {
                return res.status(404).json({ error: error.message });
            }
            next(error);
        }
    };

    /**
     * Get departments list
     */
    getDepartments = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const departments = this.employeeService.getDepartments();
            return res.json(departments);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Add note to employee
     */
    addNote = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const { content } = req.body;

            if (!content) {
                return res.status(400).json({ error: 'Note content is required' });
            }

            const note = await this.employeeService.addNote(
                parseInt(id),
                content,
                req.user?.id!
            );

            return res.status(201).json(note);
        } catch (error: any) {
            if (error.message === 'Employee not found') {
                return res.status(404).json({ error: error.message });
            }
            next(error);
        }
    };

    /**
     * Get notes for employee
     */
    getNotes = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const notes = await this.employeeService.getNotes(parseInt(id));
            return res.json(notes);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Delete note
     */
    deleteNote = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { noteId } = req.params;
            const result = await this.employeeService.deleteNote(parseInt(noteId));
            return res.json(result);
        } catch (error: any) {
            if (error.message === 'Note not found') {
                return res.status(404).json({ error: error.message });
            }
            next(error);
        }
    };
}
