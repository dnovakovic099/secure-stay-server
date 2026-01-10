import { NextFunction, Request, Response } from "express";
import { OvertimeRequestService } from "../services/OvertimeRequestService";
import { TimeEntryService } from "../services/TimeEntryService";
import { appDatabase } from "../utils/database.util";
import { UsersEntity } from "../entity/Users";

interface CustomRequest extends Request {
    user?: any;
}

export class OvertimeRequestController {
    private overtimeRequestService = new OvertimeRequestService();
    private timeEntryService = new TimeEntryService();
    private usersRepository = appDatabase.getRepository(UsersEntity);

    /**
     * Get all overtime requests (admin only)
     */
    getOvertimeRequests = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { page, limit, status, userId, search, startDate, endDate } = req.query;
            const result = await this.overtimeRequestService.getOvertimeRequests({
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 10,
                status: status as 'pending' | 'approved' | 'rejected' | undefined,
                userId: userId ? parseInt(userId as string) : undefined,
                search: search as string,
                startDate: startDate as string,
                endDate: endDate as string
            });
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get pending overtime requests (admin only)
     */
    getPendingRequests = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const result = await this.overtimeRequestService.getOvertimeRequests({
                status: 'pending',
                page: req.query.page ? parseInt(req.query.page as string) : 1,
                limit: req.query.limit ? parseInt(req.query.limit as string) : 50
            });
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Approve an overtime request (admin only)
     */
    approveRequest = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            const uid = req.user?.id;
            const { notes } = req.body;

            if (!uid) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            // Get user by uid to get the numeric ID
            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any },
            });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const result = await this.overtimeRequestService.approveRequest(requestId, user.id, notes);
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Reject an overtime request (admin only)
     */
    rejectRequest = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            const uid = req.user?.id;
            const { notes } = req.body;

            if (!uid) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            // Get user by uid to get the numeric ID
            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any },
            });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const result = await this.overtimeRequestService.rejectRequest(requestId, user.id, notes);
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get overtime request stats (admin only)
     */
    getStats = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const result = await this.overtimeRequestService.getStats();
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get notification counts for admin badge
     */
    getNotificationCounts = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const result = await this.timeEntryService.getAdminNotificationCounts();
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get single overtime request by ID
     */
    getById = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            const result = await this.overtimeRequestService.getById(requestId);

            if (!result) {
                return res.status(404).json({ error: "Overtime request not found" });
            }

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };
}
