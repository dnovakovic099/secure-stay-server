import { Request, Response } from "express";
import { TimesheetService, TimesheetFilters } from "../services/TimesheetService";
import logger from "../utils/logger.utils";

const timesheetService = new TimesheetService();

export const TimesheetController = {
    /**
     * Get aggregated timesheet data with filters
     */
    getTimesheets: async (req: Request, res: Response) => {
        try {
            const {
                startDate,
                endDate,
                userId,
                hasOvertime,
                hasHourlyRate,
                page,
                limit
            } = req.query;

            // Validate required parameters
            if (!startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    message: "startDate and endDate are required"
                });
            }

            const filters: TimesheetFilters = {
                startDate: startDate as string,
                endDate: endDate as string,
                userId: userId ? parseInt(userId as string) : undefined,
                hasOvertime: hasOvertime as 'all' | 'with' | 'without' | 'pending' | undefined,
                hasHourlyRate: hasHourlyRate as 'all' | 'set' | 'notset' | undefined,
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 50
            };

            const result = await timesheetService.getTimesheets(filters);

            return res.status(200).json({
                success: true,
                ...result
            });
        } catch (error: any) {
            logger.error("Error fetching timesheets:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to fetch timesheet data",
                error: error.message
            });
        }
    },

    /**
     * Get summary statistics for the timesheet
     */
    getSummary: async (req: Request, res: Response) => {
        try {
            const { startDate, endDate, userId } = req.query;

            if (!startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    message: "startDate and endDate are required"
                });
            }

            const summary = await timesheetService.getSummary(
                startDate as string,
                endDate as string,
                userId ? parseInt(userId as string) : undefined
            );

            return res.status(200).json({
                success: true,
                data: summary
            });
        } catch (error: any) {
            logger.error("Error fetching timesheet summary:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to fetch timesheet summary",
                error: error.message
            });
        }
    },

    /**
     * Get list of employees for filter dropdown
     */
    getEmployees: async (req: Request, res: Response) => {
        try {
            const employees = await timesheetService.getEmployees();

            return res.status(200).json({
                success: true,
                data: employees
            });
        } catch (error: any) {
            logger.error("Error fetching employees list:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to fetch employees",
                error: error.message
            });
        }
    }
};
