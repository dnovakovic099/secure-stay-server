import { Request, Response, NextFunction } from 'express';
import { EmployeeScheduleService } from '../services/EmployeeScheduleService';
import { ShiftType } from '../entity/EmployeeSchedule';

interface CustomRequest extends Request {
    user?: {
        id: any;
        uid: string;
        email: string;
        userType: string;
    };
}

export class EmployeeScheduleController {
    private scheduleService = new EmployeeScheduleService();

    /**
     * Get schedules with filters
     */
    getSchedules = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { page, limit, employeeId, startDate, endDate, department, shiftType } = req.query;

            const result = await this.scheduleService.getSchedules({
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 50,
                employeeId: employeeId ? parseInt(employeeId as string) : undefined,
                startDate: startDate as string,
                endDate: endDate as string,
                department: department as string,
                shiftType: shiftType as string,
            });

            return res.json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get schedules for a specific employee
     */
    getSchedulesByEmployee = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { employeeId } = req.params;
            const { startDate, endDate } = req.query;

            const schedules = await this.scheduleService.getSchedulesByEmployee(
                parseInt(employeeId),
                startDate as string,
                endDate as string
            );

            return res.json(schedules);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Create a single schedule
     */
    createSchedule = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { employeeId, date, shiftStart, shiftEnd, breakDuration, shiftType, notes } = req.body;

            if (!employeeId || !date || !shiftStart || !shiftEnd) {
                return res.status(400).json({
                    error: 'Missing required fields',
                    required: ['employeeId', 'date', 'shiftStart', 'shiftEnd'],
                });
            }

            // Validate shift type
            if (shiftType && !Object.values(ShiftType).includes(shiftType)) {
                return res.status(400).json({ error: 'Invalid shift type' });
            }

            const userUid = typeof req.user?.id === 'string' ? req.user.id : req.user?.uid;

            const schedule = await this.scheduleService.createSchedule({
                employeeId,
                date,
                shiftStart,
                shiftEnd,
                breakDuration,
                shiftType,
                notes,
                createdBy: userUid || undefined,
            });

            return res.status(201).json(schedule);
        } catch (error: any) {
            if (error.message.includes('already exists') || error.message === 'Employee not found') {
                return res.status(400).json({ error: error.message });
            }
            next(error);
        }
    };

    /**
     * Create weekly recurring schedules
     */
    createRecurring = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { employeeId, startDate, endDate, daysOfWeek, shiftStart, shiftEnd, breakDuration, shiftType, notes } = req.body;

            if (!employeeId || !startDate || !endDate || !daysOfWeek || !shiftStart || !shiftEnd) {
                return res.status(400).json({
                    error: 'Missing required fields',
                    required: ['employeeId', 'startDate', 'endDate', 'daysOfWeek', 'shiftStart', 'shiftEnd'],
                });
            }

            if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
                return res.status(400).json({ error: 'daysOfWeek must be a non-empty array' });
            }

            if (shiftType && !Object.values(ShiftType).includes(shiftType)) {
                return res.status(400).json({ error: 'Invalid shift type' });
            }

            const userUid = typeof req.user?.id === 'string' ? req.user.id : req.user?.uid;

            const result = await this.scheduleService.createWeeklyRecurring({
                employeeId,
                startDate,
                endDate,
                daysOfWeek,
                shiftStart,
                shiftEnd,
                breakDuration,
                shiftType,
                notes,
                createdBy: userUid || undefined,
            });

            return res.status(201).json(result);
        } catch (error: any) {
            if (error.message === 'Employee not found') {
                return res.status(400).json({ error: error.message });
            }
            next(error);
        }
    };

    /**
     * Update a schedule
     */
    updateSchedule = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const { date, shiftStart, shiftEnd, breakDuration, shiftType, notes } = req.body;

            if (shiftType && !Object.values(ShiftType).includes(shiftType)) {
                return res.status(400).json({ error: 'Invalid shift type' });
            }

            const schedule = await this.scheduleService.updateSchedule(parseInt(id), {
                date,
                shiftStart,
                shiftEnd,
                breakDuration,
                shiftType,
                notes,
            });

            return res.json(schedule);
        } catch (error: any) {
            if (error.message === 'Schedule not found') {
                return res.status(404).json({ error: error.message });
            }
            next(error);
        }
    };

    /**
     * Delete a schedule
     */
    deleteSchedule = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const result = await this.scheduleService.deleteSchedule(parseInt(id));
            return res.json(result);
        } catch (error: any) {
            if (error.message === 'Schedule not found') {
                return res.status(404).json({ error: error.message });
            }
            next(error);
        }
    };

    /**
     * Get shift types
     */
    getShiftTypes = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const types = this.scheduleService.getShiftTypes();
            return res.json(types);
        } catch (error) {
            next(error);
        }
    };
}
