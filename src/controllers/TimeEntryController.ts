import { NextFunction, Request, Response } from "express";
import { TimeEntryService } from "../services/TimeEntryService";
import { appDatabase } from "../utils/database.util";
import { UsersEntity } from "../entity/Users";

interface CustomRequest extends Request {
    user?: any;
}

export class TimeEntryController {
    private timeEntryService = new TimeEntryService();
    private usersRepository = appDatabase.getRepository(UsersEntity);

    /**
     * POST /time-entries/clock-in
     * Clock-in for the current user
     */
    clockIn = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const uid = req.user?.id;

            if (!uid) {
                return res.status(400).json({ success: false, message: "User ID not found" });
            }

            // Get user by uid
            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any },
            });

            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const result = await this.timeEntryService.clockIn(user.id);

            if (!result.success) {
                return res.status(400).json(result);
            }

            return res.status(201).json(result);
        } catch (error) {
            console.error("Error clocking in:", error);
            return next(error);
        }
    };

    /**
     * POST /time-entries/clock-out
     * Clock-out for the current user
     */
    clockOut = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const uid = req.user?.id;
            const { notes } = req.body;

            if (!uid) {
                return res.status(400).json({ success: false, message: "User ID not found" });
            }

            // Get user by uid
            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any },
            });

            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const result = await this.timeEntryService.clockOut(user.id, notes);

            if (!result.success) {
                return res.status(400).json(result);
            }

            return res.status(200).json(result);
        } catch (error) {
            console.error("Error clocking out:", error);
            return next(error);
        }
    };

    /**
     * GET /time-entries/status
     * Get current clock-in status for the user
     */
    getStatus = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const uid = req.user?.id;

            if (!uid) {
                return res.status(400).json({ success: false, message: "User ID not found" });
            }

            // Get user by uid
            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any },
            });

            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const status = await this.timeEntryService.getCurrentStatus(user.id);

            return res.status(200).json({ success: true, ...status });
        } catch (error) {
            console.error("Error getting status:", error);
            return next(error);
        }
    };

    /**
     * GET /time-entries
     * Get time entry history for the user (paginated)
     */
    getTimeEntries = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const uid = req.user?.id;

            if (!uid) {
                return res.status(400).json({ success: false, message: "User ID not found" });
            }

            // Get user by uid
            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any },
            });

            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const filters = {
                page: Number(req.query.page) || 1,
                limit: Number(req.query.limit) || 10,
                startDate: req.query.startDate as string,
                endDate: req.query.endDate as string,
            };

            const result = await this.timeEntryService.getTimeEntries(user.id, filters);

            return res.status(200).json(result);
        } catch (error) {
            console.error("Error getting time entries:", error);
            return next(error);
        }
    };

    /**
     * GET /time-entries/summary
     * Get time entry summary for the user
     */
    getSummary = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const uid = req.user?.id;

            if (!uid) {
                return res.status(400).json({ success: false, message: "User ID not found" });
            }

            // Get user by uid
            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any },
            });

            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const startDate = req.query.startDate as string;
            const endDate = req.query.endDate as string;

            // Get summaries for different time periods
            const [today, thisWeek, thisMonth, custom] = await Promise.all([
                this.timeEntryService.getTodaySummary(user.id),
                this.timeEntryService.getWeekSummary(user.id),
                this.timeEntryService.getMonthSummary(user.id),
                startDate && endDate
                    ? this.timeEntryService.getSummary(user.id, startDate, endDate)
                    : null,
            ]);

            return res.status(200).json({
                success: true,
                today,
                thisWeek,
                thisMonth,
                custom,
            });
        } catch (error) {
            console.error("Error getting summary:", error);
            return next(error);
        }
    };

    /**
     * DELETE /time-entries/:id
     * Soft delete a time entry
     */
    deleteEntry = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const uid = req.user?.id;
            const entryId = Number(req.params.id);

            if (!uid) {
                return res.status(400).json({ success: false, message: "User ID not found" });
            }

            if (!entryId || isNaN(entryId)) {
                return res.status(400).json({ success: false, message: "Invalid entry ID" });
            }

            // Get user by uid
            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any },
            });

            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const result = await this.timeEntryService.softDelete(user.id, entryId, user.id);

            if (!result.success) {
                return res.status(404).json(result);
            }

            return res.status(200).json(result);
        } catch (error) {
            console.error("Error deleting entry:", error);
            return next(error);
        }
    };

    /**
     * PATCH /time-entries/:id/notes
     * Update notes for a time entry
     */
    updateNotes = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const uid = req.user?.id;
            const entryId = Number(req.params.id);
            const { notes } = req.body;

            if (!uid) {
                return res.status(400).json({ success: false, message: "User ID not found" });
            }

            if (!entryId || isNaN(entryId)) {
                return res.status(400).json({ success: false, message: "Invalid entry ID" });
            }

            // Get user by uid
            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any },
            });

            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const result = await this.timeEntryService.updateNotes(user.id, entryId, notes || '');

            if (!result.success) {
                return res.status(404).json(result);
            }

            return res.status(200).json(result);
        } catch (error) {
            console.error("Error updating notes:", error);
            return next(error);
        }
    };

    /**
     * GET /time-entries/admin/overview
     * Get admin overview for all users
     */
    getAdminOverview = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const result = await this.timeEntryService.getAdminOverview();
            return res.status(200).json({ success: true, ...result });
        } catch (error) {
            console.error("Error getting admin overview:", error);
            return next(error);
        }
    };

    /**
     * GET /time-entries/admin/entries
     * Get all time entries for all users (admin only)
     */
    getAllEntriesAdmin = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const filters = {
                page: Number(req.query.page) || 1,
                limit: Number(req.query.limit) || 10,
                search: req.query.search as string,
                status: req.query.status as string,
                startDate: req.query.startDate as string,
                endDate: req.query.endDate as string,
            };

            const result = await this.timeEntryService.getAllTimeEntriesAdmin(filters);
            return res.status(200).json(result);
        } catch (error) {
            console.error("Error getting all time entries:", error);
            return next(error);
        }
    };
}


