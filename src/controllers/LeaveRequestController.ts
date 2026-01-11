import { NextFunction, Request, Response } from "express";
import { LeaveRequestService } from "../services/LeaveRequestService";
import { appDatabase } from "../utils/database.util";
import { UsersEntity } from "../entity/Users";
import { PaymentType, PaymentTypeValue } from "../constant";

interface CustomRequest extends Request {
    user?: any;
}

export class LeaveRequestController {
    private leaveRequestService = new LeaveRequestService();
    private usersRepository = appDatabase.getRepository(UsersEntity);

    /**
     * Create a new leave request (employee)
     */
    createLeaveRequest = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const uid = req.user?.id;
            const { leaveType, startDate, endDate, reason } = req.body;

            if (!uid) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            // Get user by uid to get the numeric ID
            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any }
            });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            // Validation
            if (!leaveType || !startDate || !endDate) {
                return res.status(400).json({ error: "Leave type, start date, and end date are required" });
            }

            const result = await this.leaveRequestService.createLeaveRequest({
                userId: user.id,
                leaveType,
                startDate,
                endDate,
                reason
            });

            if (!result.success) {
                return res.status(400).json({ error: result.message });
            }

            return res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get employee's own leave requests
     */
    getMyLeaveRequests = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const uid = req.user?.id;
            const { page, limit, status, startDate, endDate } = req.query;

            if (!uid) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any }
            });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const result = await this.leaveRequestService.getMyLeaveRequests(user.id, {
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 10,
                status: status as any,
                startDate: startDate as string,
                endDate: endDate as string
            });

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get all leave requests with filters (admin)
     */
    getAllLeaveRequests = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { page, limit, status, userId, search, startDate, endDate } = req.query;

            const result = await this.leaveRequestService.getLeaveRequests({
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 10,
                status: status as any,
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
     * Get pending leave requests (admin)
     */
    getPendingRequests = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { page, limit } = req.query;

            const result = await this.leaveRequestService.getLeaveRequests({
                status: 'pending' as any,
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 50
            });

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get leave request stats (admin)
     */
    getStats = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const result = await this.leaveRequestService.getStats();
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get pending count for notification badge (admin)
     */
    getPendingCount = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const result = await this.leaveRequestService.getPendingCount();
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get single leave request by ID
     */
    getById = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            const result = await this.leaveRequestService.getById(requestId);

            if (!result) {
                return res.status(404).json({ error: "Leave request not found" });
            }

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Approve a leave request (admin)
     */
    approveRequest = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            const uid = req.user?.id;
            const { paymentType, notes } = req.body;

            if (!uid) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            // Validate payment type
            if (!paymentType || !Object.values(PaymentType).includes(paymentType)) {
                return res.status(400).json({ error: "Payment type is required. Must be 'paid' or 'unpaid'" });
            }

            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any }
            });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const result = await this.leaveRequestService.approveRequest(
                requestId,
                user.id,
                paymentType as PaymentTypeValue,
                notes
            );

            if (!result.success) {
                return res.status(400).json({ error: result.message });
            }

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Reject a leave request (admin)
     */
    rejectRequest = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            const uid = req.user?.id;
            const { notes } = req.body;

            if (!uid) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any }
            });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const result = await this.leaveRequestService.rejectRequest(requestId, user.id, notes);

            if (!result.success) {
                return res.status(400).json({ error: result.message });
            }

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Cancel a pending leave request (employee - immediate)
     */
    cancelPendingRequest = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            const uid = req.user?.id;

            if (!uid) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any }
            });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const result = await this.leaveRequestService.cancelPendingRequest(requestId, user.id);

            if (!result.success) {
                return res.status(400).json({ error: result.message });
            }

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Request cancellation of approved leave (employee)
     */
    requestCancellation = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            const uid = req.user?.id;
            const { notes } = req.body;

            if (!uid) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any }
            });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const result = await this.leaveRequestService.requestCancellation(requestId, user.id, notes);

            if (!result.success) {
                return res.status(400).json({ error: result.message });
            }

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Approve cancellation request (admin)
     */
    approveCancellation = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            const uid = req.user?.id;
            const { notes } = req.body;

            if (!uid) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any }
            });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const result = await this.leaveRequestService.approveCancellation(requestId, user.id, notes);

            if (!result.success) {
                return res.status(400).json({ error: result.message });
            }

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    /**
     * Reject cancellation request (admin)
     */
    rejectCancellation = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            const uid = req.user?.id;
            const { notes } = req.body;

            if (!uid) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const user = await this.usersRepository.findOne({
                where: { uid, deletedAt: null as any }
            });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const result = await this.leaveRequestService.rejectCancellation(requestId, user.id, notes);

            if (!result.success) {
                return res.status(400).json({ error: result.message });
            }

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };
}
