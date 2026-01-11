import { appDatabase } from "../utils/database.util";
import { LeaveRequestEntity } from "../entity/LeaveRequest";
import { UsersEntity } from "../entity/Users";
import { LeaveRequestStatus, PaymentType, LeaveRequestStatusType, PaymentTypeValue } from "../constant";
import logger from "../utils/logger.utils";
import { Between, LessThanOrEqual, MoreThanOrEqual, In, IsNull } from "typeorm";

interface LeaveRequestFilters {
    page?: number;
    limit?: number;
    status?: LeaveRequestStatusType;
    userId?: number;
    search?: string;
    startDate?: string;
    endDate?: string;
}

interface CreateLeaveRequestData {
    userId: number;
    leaveType: string;
    startDate: string;
    endDate: string;
    reason?: string;
}

export class LeaveRequestService {
    private leaveRequestRepository = appDatabase.getRepository(LeaveRequestEntity);
    private usersRepository = appDatabase.getRepository(UsersEntity);

    /**
     * Calculate total days between two dates (inclusive)
     */
    calculateTotalDays(startDate: string, endDate: string): number {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
        return diffDays;
    }

    /**
     * Check for overlapping leave requests
     */
    async checkOverlappingLeave(userId: number, startDate: string, endDate: string, excludeId?: number): Promise<LeaveRequestEntity | null> {
        const queryBuilder = this.leaveRequestRepository
            .createQueryBuilder("leave")
            .where("leave.userId = :userId", { userId })
            .andWhere("leave.deletedAt IS NULL")
            .andWhere("leave.status IN (:...statuses)", { 
                statuses: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED, LeaveRequestStatus.CANCELLATION_PENDING] 
            })
            .andWhere(
                "(leave.startDate <= :endDate AND leave.endDate >= :startDate)",
                { startDate, endDate }
            );

        if (excludeId) {
            queryBuilder.andWhere("leave.id != :excludeId", { excludeId });
        }

        return await queryBuilder.getOne();
    }

    /**
     * Validate dates for a leave request
     */
    validateDates(startDate: string, endDate: string): { valid: boolean; message?: string } {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (end < start) {
            return { valid: false, message: "End date cannot be before start date" };
        }

        if (start < today) {
            return { valid: false, message: "Start date cannot be in the past" };
        }

        return { valid: true };
    }

    /**
     * Create a new leave request
     */
    async createLeaveRequest(data: CreateLeaveRequestData) {
        // Validate dates
        const dateValidation = this.validateDates(data.startDate, data.endDate);
        if (!dateValidation.valid) {
            return { success: false, message: dateValidation.message };
        }

        // Check for overlapping leaves
        const overlapping = await this.checkOverlappingLeave(data.userId, data.startDate, data.endDate);
        if (overlapping) {
            return {
                success: false,
                message: `You already have a leave request for overlapping dates (${overlapping.startDate} to ${overlapping.endDate})`
            };
        }

        // Calculate total days
        const totalDays = this.calculateTotalDays(data.startDate, data.endDate);

        // Create leave request
        const leaveRequest = this.leaveRequestRepository.create({
            userId: data.userId,
            leaveType: data.leaveType,
            startDate: new Date(data.startDate),
            endDate: new Date(data.endDate),
            totalDays,
            reason: data.reason || null,
            status: LeaveRequestStatus.PENDING
        });

        await this.leaveRequestRepository.save(leaveRequest);

        logger.info(`Leave request ${leaveRequest.id} created by user ${data.userId}`);

        return {
            success: true,
            message: "Leave request submitted successfully",
            data: leaveRequest
        };
    }

    /**
     * Get all leave requests with pagination and filters (admin)
     */
    async getLeaveRequests(filters: LeaveRequestFilters) {
        const page = filters.page || 1;
        const limit = filters.limit || 10;
        const offset = (page - 1) * limit;

        const queryBuilder = this.leaveRequestRepository
            .createQueryBuilder("leave")
            .leftJoinAndSelect("leave.user", "user")
            .leftJoinAndSelect("leave.actioner", "actioner")
            .leftJoinAndSelect("leave.cancellationActioner", "cancellationActioner")
            .where("leave.deletedAt IS NULL");

        // Apply status filter
        if (filters.status) {
            queryBuilder.andWhere("leave.status = :status", { status: filters.status });
        }

        // Apply user filter
        if (filters.userId) {
            queryBuilder.andWhere("leave.userId = :userId", { userId: filters.userId });
        }

        // Apply search filter (Employee name or email)
        if (filters.search) {
            queryBuilder.andWhere(
                "(user.firstName LIKE :search OR user.lastName LIKE :search OR user.email LIKE :search)",
                { search: `%${filters.search}%` }
            );
        }

        // Apply date range filter
        if (filters.startDate) {
            queryBuilder.andWhere("leave.startDate >= :startDate", { startDate: filters.startDate });
        }
        if (filters.endDate) {
            queryBuilder.andWhere("leave.endDate <= :endDate", { endDate: filters.endDate });
        }

        const [requests, total] = await queryBuilder
            .orderBy("leave.createdAt", "DESC")
            .skip(offset)
            .take(limit)
            .getManyAndCount();

        // Format response
        const formattedRequests = requests.map(request => ({
            ...request,
            userName: `${request.user?.firstName || ''} ${request.user?.lastName || ''}`.trim(),
            userEmail: request.user?.email,
            actionerName: request.actioner
                ? `${request.actioner.firstName || ''} ${request.actioner.lastName || ''}`.trim()
                : null,
            cancellationActionerName: request.cancellationActioner
                ? `${request.cancellationActioner.firstName || ''} ${request.cancellationActioner.lastName || ''}`.trim()
                : null
        }));

        return {
            data: formattedRequests,
            total,
            page,
            limit
        };
    }

    /**
     * Get employee's own leave requests
     */
    async getMyLeaveRequests(userId: number, filters: LeaveRequestFilters) {
        return this.getLeaveRequests({ ...filters, userId });
    }

    /**
     * Get single leave request by ID
     */
    async getById(requestId: number) {
        const request = await this.leaveRequestRepository.findOne({
            where: { id: requestId, deletedAt: IsNull() },
            relations: ['user', 'actioner', 'cancellationActioner']
        });

        if (!request) {
            return null;
        }

        return {
            ...request,
            userName: `${request.user?.firstName || ''} ${request.user?.lastName || ''}`.trim(),
            userEmail: request.user?.email,
            actionerName: request.actioner
                ? `${request.actioner.firstName || ''} ${request.actioner.lastName || ''}`.trim()
                : null,
            cancellationActionerName: request.cancellationActioner
                ? `${request.cancellationActioner.firstName || ''} ${request.cancellationActioner.lastName || ''}`.trim()
                : null
        };
    }

    /**
     * Approve a leave request (admin)
     */
    async approveRequest(requestId: number, adminUserId: number, paymentType: PaymentTypeValue, notes?: string) {
        const request = await this.leaveRequestRepository.findOne({
            where: { id: requestId, deletedAt: IsNull() }
        });

        if (!request) {
            return { success: false, message: "Leave request not found" };
        }

        if (request.status !== LeaveRequestStatus.PENDING) {
            return { success: false, message: `Request is already ${request.status}` };
        }

        // Validate payment type
        if (!Object.values(PaymentType).includes(paymentType)) {
            return { success: false, message: "Invalid payment type. Must be 'paid' or 'unpaid'" };
        }

        await this.leaveRequestRepository.update(requestId, {
            status: LeaveRequestStatus.APPROVED,
            paymentType,
            actionedBy: adminUserId,
            actionedAt: new Date(),
            adminNotes: notes || null
        });

        logger.info(`Leave request ${requestId} approved by admin ${adminUserId} as ${paymentType}`);

        return {
            success: true,
            message: `Leave request approved as ${paymentType}`
        };
    }

    /**
     * Reject a leave request (admin)
     */
    async rejectRequest(requestId: number, adminUserId: number, notes?: string) {
        const request = await this.leaveRequestRepository.findOne({
            where: { id: requestId, deletedAt: IsNull() }
        });

        if (!request) {
            return { success: false, message: "Leave request not found" };
        }

        if (request.status !== LeaveRequestStatus.PENDING) {
            return { success: false, message: `Request is already ${request.status}` };
        }

        await this.leaveRequestRepository.update(requestId, {
            status: LeaveRequestStatus.REJECTED,
            actionedBy: adminUserId,
            actionedAt: new Date(),
            adminNotes: notes || null
        });

        logger.info(`Leave request ${requestId} rejected by admin ${adminUserId}`);

        return {
            success: true,
            message: "Leave request rejected"
        };
    }

    /**
     * Cancel a pending leave request (employee - immediate)
     */
    async cancelPendingRequest(requestId: number, userId: number) {
        const request = await this.leaveRequestRepository.findOne({
            where: { id: requestId, userId, deletedAt: IsNull() }
        });

        if (!request) {
            return { success: false, message: "Leave request not found" };
        }

        if (request.status !== LeaveRequestStatus.PENDING) {
            return { success: false, message: "Only pending requests can be cancelled directly" };
        }

        await this.leaveRequestRepository.update(requestId, {
            status: LeaveRequestStatus.CANCELLED,
            cancellationRequestedAt: new Date(),
            cancellationNotes: "Cancelled by employee"
        });

        logger.info(`Leave request ${requestId} cancelled by employee ${userId}`);

        return {
            success: true,
            message: "Leave request cancelled successfully"
        };
    }

    /**
     * Request cancellation of an approved leave (employee - requires admin approval)
     */
    async requestCancellation(requestId: number, userId: number, notes?: string) {
        const request = await this.leaveRequestRepository.findOne({
            where: { id: requestId, userId, deletedAt: IsNull() }
        });

        if (!request) {
            return { success: false, message: "Leave request not found" };
        }

        if (request.status !== LeaveRequestStatus.APPROVED) {
            return { success: false, message: "Only approved requests can be submitted for cancellation" };
        }

        await this.leaveRequestRepository.update(requestId, {
            status: LeaveRequestStatus.CANCELLATION_PENDING,
            cancellationRequestedAt: new Date(),
            cancellationNotes: notes || null
        });

        logger.info(`Cancellation requested for leave ${requestId} by employee ${userId}`);

        return {
            success: true,
            message: "Cancellation request submitted. Awaiting admin approval."
        };
    }

    /**
     * Approve cancellation request (admin)
     */
    async approveCancellation(requestId: number, adminUserId: number, notes?: string) {
        const request = await this.leaveRequestRepository.findOne({
            where: { id: requestId, deletedAt: IsNull() }
        });

        if (!request) {
            return { success: false, message: "Leave request not found" };
        }

        if (request.status !== LeaveRequestStatus.CANCELLATION_PENDING) {
            return { success: false, message: "No pending cancellation request found" };
        }

        await this.leaveRequestRepository.update(requestId, {
            status: LeaveRequestStatus.CANCELLED,
            cancellationActionedBy: adminUserId,
            cancellationActionedAt: new Date(),
            cancellationNotes: request.cancellationNotes 
                ? `${request.cancellationNotes}\nAdmin: ${notes || 'Approved'}`
                : notes || 'Approved by admin'
        });

        logger.info(`Cancellation approved for leave ${requestId} by admin ${adminUserId}`);

        return {
            success: true,
            message: "Cancellation approved. Leave has been cancelled."
        };
    }

    /**
     * Reject cancellation request (admin - returns leave to approved status)
     */
    async rejectCancellation(requestId: number, adminUserId: number, notes?: string) {
        const request = await this.leaveRequestRepository.findOne({
            where: { id: requestId, deletedAt: IsNull() }
        });

        if (!request) {
            return { success: false, message: "Leave request not found" };
        }

        if (request.status !== LeaveRequestStatus.CANCELLATION_PENDING) {
            return { success: false, message: "No pending cancellation request found" };
        }

        await this.leaveRequestRepository.update(requestId, {
            status: LeaveRequestStatus.APPROVED,
            cancellationActionedBy: adminUserId,
            cancellationActionedAt: new Date(),
            cancellationNotes: request.cancellationNotes 
                ? `${request.cancellationNotes}\nAdmin rejected: ${notes || 'Rejected'}`
                : notes || 'Cancellation rejected by admin'
        });

        logger.info(`Cancellation rejected for leave ${requestId} by admin ${adminUserId}`);

        return {
            success: true,
            message: "Cancellation rejected. Leave remains approved."
        };
    }

    /**
     * Get leave request statistics (admin)
     */
    async getStats() {
        const [pending, cancellationPending, approved, rejected, cancelled] = await Promise.all([
            this.leaveRequestRepository.count({ where: { status: LeaveRequestStatus.PENDING, deletedAt: IsNull() } }),
            this.leaveRequestRepository.count({ where: { status: LeaveRequestStatus.CANCELLATION_PENDING, deletedAt: IsNull() } }),
            this.leaveRequestRepository.count({ where: { status: LeaveRequestStatus.APPROVED, deletedAt: IsNull() } }),
            this.leaveRequestRepository.count({ where: { status: LeaveRequestStatus.REJECTED, deletedAt: IsNull() } }),
            this.leaveRequestRepository.count({ where: { status: LeaveRequestStatus.CANCELLED, deletedAt: IsNull() } })
        ]);

        return {
            pending,
            cancellationPending,
            approved,
            rejected,
            cancelled,
            total: pending + cancellationPending + approved + rejected + cancelled
        };
    }

    /**
     * Get pending count for admin notification badge
     */
    async getPendingCount() {
        const [pendingCount, cancellationPendingCount] = await Promise.all([
            this.leaveRequestRepository.count({ where: { status: LeaveRequestStatus.PENDING, deletedAt: IsNull() } }),
            this.leaveRequestRepository.count({ where: { status: LeaveRequestStatus.CANCELLATION_PENDING, deletedAt: IsNull() } })
        ]);

        return {
            pendingCount,
            cancellationPendingCount,
            totalPending: pendingCount + cancellationPendingCount
        };
    }
}
