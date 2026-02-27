import { Request, Response, NextFunction } from 'express';
import { EmployeeService } from '../services/EmployeeService';
import { EmployeeDepartment } from '../entity/Employee';
import { appDatabase } from '../utils/database.util';
import { UsersEntity } from '../entity/Users';
import { FileInfo } from '../entity/FileInfo';
import { deleteFromDrive } from '../utils/drive';
import path from 'path';
import fs from 'fs';

interface CustomRequest extends Request {
    user?: {
        id: any;
        uid: string;
        email: string;
        userType: string;
    };
}

export class EmployeeController {
    private employeeService = new EmployeeService();

    private async getInternalUserId(reqUser?: any): Promise<number | undefined> {
        if (!reqUser) return undefined;
        if (typeof reqUser.id === 'number') {
            return reqUser.id;
        }
        if (typeof reqUser.id === 'string') {
            const userRepo = appDatabase.getRepository(UsersEntity);
            const user = await userRepo.findOne({ where: { uid: reqUser.id } });
            return user?.id;
        }
        return undefined;
    }

    /**
     * Get all employees with filters
     */
    getAllEmployees = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { page, limit, department, search, isActive, sortField, sortDir } = req.query;

            const result = await this.employeeService.getAllEmployees({
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 20,
                department: department as string,
                search: search as string,
                isActive: isActive !== undefined ? isActive === 'true' : undefined,
                sortField: sortField as string,
                sortDir: (sortDir as string)?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
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
            console.log('=== CREATE EMPLOYEE REQUEST ===');
            console.log('Body:', JSON.stringify(req.body));
            console.log('User:', req.user?.id);
            
            const { userId, department, jobTitle, hourlyRate, startDate, slackUserId } = req.body;

            if (!userId || !department || !jobTitle || !startDate) {
                console.log('Missing fields:', { userId, department, jobTitle, startDate });
                return res.status(400).json({ error: 'Missing required fields', missing: { userId: !userId, department: !department, jobTitle: !jobTitle, startDate: !startDate } });
            }

            // Validate department
            if (!Object.values(EmployeeDepartment).includes(department)) {
                return res.status(400).json({ error: 'Invalid department' });
            }

            const creatorId = await this.getInternalUserId(req.user);

            const employee = await this.employeeService.createEmployee({
                userId,
                department,
                jobTitle,
                hourlyRate: hourlyRate || 0,
                startDate: new Date(startDate),
                slackUserId: slackUserId || undefined,
                createdBy: creatorId,
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
            const { department, jobTitle, hourlyRate, startDate, overtimeHours, bonuses, slackUserId, profilePhoto, isActive,
                phone, birthday, schedule, slackId, paymentMethod, paymentMethodOther, paymentSchedule, paymentInfo } = req.body;

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
                slackUserId,
                profilePhoto,
                isActive,
                phone,
                birthday: birthday ? new Date(birthday) : birthday,
                schedule,
                slackId,
                paymentMethod,
                paymentMethodOther,
                paymentSchedule,
                paymentInfo,
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

            const creatorId = await this.getInternalUserId(req.user);
            if (!creatorId) {
                return res.status(401).json({ error: 'User not found' });
            }

            const note = await this.employeeService.addNote(
                parseInt(id),
                content,
                creatorId
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

    /**
     * Upload employee profile photo
     */
    uploadPhoto = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const file = req.file;

            if (!file) {
                return res.status(400).json({ error: 'No photo file provided' });
            }

            const fileInfoRepo = appDatabase.getRepository(FileInfo);

            // Delete old FileInfo record if employee already has a photo
            const existingEmployee = await this.employeeService.getEmployeeById(parseInt(id));
            if (existingEmployee?.profilePhoto) {
                const oldFileInfo = await fileInfoRepo.findOne({ where: { id: parseInt(existingEmployee.profilePhoto) } });
                if (oldFileInfo) {
                    if (oldFileInfo.driveFileId) {
                        await deleteFromDrive(oldFileInfo.driveFileId, oldFileInfo.fileName);
                    }
                    if (oldFileInfo.localPath && fs.existsSync(oldFileInfo.localPath)) {
                        fs.unlinkSync(oldFileInfo.localPath);
                    }
                    await fileInfoRepo.softRemove(oldFileInfo);
                }
            }

            // Create FileInfo record — this auto-triggers FileInfoSubscriber → Google Drive upload queue
            const fileRecord = new FileInfo();
            fileRecord.entityType = 'employees';
            fileRecord.entityId = parseInt(id);
            fileRecord.fileName = file.filename;
            fileRecord.originalName = file.originalname;
            fileRecord.localPath = file.path;
            fileRecord.mimetype = file.mimetype;
            fileRecord.status = 'pending';

            const savedFileInfo = await fileInfoRepo.save(fileRecord);

            // Store fileInfo.id in employee.profilePhoto
            const employee = await this.employeeService.updateEmployee(parseInt(id), {
                profilePhoto: String(savedFileInfo.id),
            });

            return res.json({ profilePhoto: String(savedFileInfo.id), employee });
        } catch (error: any) {
            if (error.message === 'Employee not found') {
                return res.status(404).json({ error: error.message });
            }
            next(error);
        }
    };

    /**
     * Delete employee profile photo
     */
    deletePhoto = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const employee = await this.employeeService.getEmployeeById(parseInt(id));
            if (!employee) {
                return res.status(404).json({ error: 'Employee not found' });
            }

            if (employee.profilePhoto) {
                const fileInfoRepo = appDatabase.getRepository(FileInfo);
                const fileInfo = await fileInfoRepo.findOne({ where: { id: parseInt(employee.profilePhoto) } });

                if (fileInfo) {
                    // Delete from Google Drive if uploaded
                    if (fileInfo.driveFileId) {
                        await deleteFromDrive(fileInfo.driveFileId, fileInfo.fileName);
                    }
                    // Delete local file if still exists
                    if (fileInfo.localPath && fs.existsSync(fileInfo.localPath)) {
                        fs.unlinkSync(fileInfo.localPath);
                    }
                    // Soft delete the FileInfo record
                    await fileInfoRepo.softRemove(fileInfo);
                }
            }

            const updated = await this.employeeService.updateEmployee(parseInt(id), {
                profilePhoto: null as any,
            });

            return res.json({ message: 'Photo deleted', employee: updated });
        } catch (error: any) {
            if (error.message === 'Employee not found') {
                return res.status(404).json({ error: error.message });
            }
            next(error);
        }
    };
}
