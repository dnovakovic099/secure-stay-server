import { appDatabase } from "../utils/database.util";
import { OvertimeRequestEntity } from "../entity/OvertimeRequest";
import { TimeEntryEntity } from "../entity/TimeEntry";
import { UsersEntity } from "../entity/Users";
import logger from "../utils/logger.utils";

interface OvertimeRequestFilters {
    page?: number;
    limit?: number;
    status?: 'pending' | 'approved' | 'rejected';
    userId?: number;
    search?: string;
    startDate?: string;
    endDate?: string;
}

export class OvertimeRequestService {
    private overtimeRequestRepository = appDatabase.getRepository(OvertimeRequestEntity);
    private timeEntryRepository = appDatabase.getRepository(TimeEntryEntity);
    private usersRepository = appDatabase.getRepository(UsersEntity);

    /**
     * Get all overtime requests with pagination and filters
     */
    async getOvertimeRequests(filters: OvertimeRequestFilters) {
        const page = filters.page || 1;
        const limit = filters.limit || 10;
        const offset = (page - 1) * limit;

        const queryBuilder = this.overtimeRequestRepository
            .createQueryBuilder("request")
            .leftJoinAndSelect("request.user", "user")
            .leftJoinAndSelect("request.timeEntry", "timeEntry")
            .leftJoinAndSelect("request.approver", "approver");

        // Apply status filter
        if (filters.status) {
            queryBuilder.andWhere("request.status = :status", { status: filters.status });
        }

        // Apply user filter
        if (filters.userId) {
            queryBuilder.andWhere("request.userId = :userId", { userId: filters.userId });
        }

        // Apply search filter (Employee name)
        if (filters.search) {
            queryBuilder.andWhere(
                "(user.firstName LIKE :search OR user.lastName LIKE :search OR user.email LIKE :search)",
                { search: `%${filters.search}%` }
            );
        }

        // Apply date range filter (based on timeEntry.clockInAt)
        if (filters.startDate) {
            queryBuilder.andWhere("timeEntry.clockInAt >= :startDate", { startDate: filters.startDate });
        }
        if (filters.endDate) {
            // Include the entire end day
            const end = new Date(filters.endDate);
            end.setHours(23, 59, 59, 999);
            queryBuilder.andWhere("timeEntry.clockInAt <= :endDate", { endDate: end });
        }

        const [requests, total] = await queryBuilder
            .orderBy("request.createdAt", "DESC")
            .skip(offset)
            .take(limit)
            .getManyAndCount();

        // Format response
        const formattedRequests = requests.map(request => ({
            ...request,
            userName: `${request.user?.firstName || ''} ${request.user?.lastName || ''}`.trim(),
            userEmail: request.user?.email,
            actualDurationFormatted: this.formatDuration(request.actualDurationSeconds),
            cappedDurationFormatted: this.formatDuration(request.cappedDurationSeconds),
            overtimeFormatted: this.formatDuration(request.overtimeSeconds),
            approverName: request.approver 
                ? `${request.approver.firstName || ''} ${request.approver.lastName || ''}`.trim() 
                : null
        }));

        return {
            data: formattedRequests,
            total,
            page,
            limit,
        };
    }

    /**
     * Get pending overtime requests count for admin badge
     */
    async getPendingCount() {
        const count = await this.overtimeRequestRepository.count({
            where: { status: 'pending' }
        });
        return { pendingCount: count };
    }

    /**
     * Approve an overtime request - adds overtime to computedDuration
     */
    async approveRequest(requestId: number, adminUserId: number, notes?: string) {
        const request = await this.overtimeRequestRepository.findOne({ 
            where: { id: requestId },
            relations: ['user']
        });

        if (!request) {
            return { success: false, message: 'Overtime request not found' };
        }

        if (request.status !== 'pending') {
            return { success: false, message: `Request is already ${request.status}` };
        }

        // Update request status
        await this.overtimeRequestRepository.update(requestId, {
            status: 'approved',
            approvedBy: adminUserId,
            approvedAt: new Date(),
            notes: notes || null
        });

        // Update time entry's computedDuration to include overtime
        const newComputedDuration = request.cappedDurationSeconds + request.overtimeSeconds;
        await this.timeEntryRepository.update(request.timeEntryId, {
            computedDuration: newComputedDuration
        });

        logger.info(`Overtime request ${requestId} approved by admin ${adminUserId}. New computed duration: ${this.formatDuration(newComputedDuration)}`);

        return { 
            success: true, 
            message: 'Overtime approved successfully',
            newComputedDuration: this.formatDuration(newComputedDuration)
        };
    }

    /**
     * Reject an overtime request - keeps capped duration
     */
    async rejectRequest(requestId: number, adminUserId: number, notes?: string) {
        const request = await this.overtimeRequestRepository.findOne({ 
            where: { id: requestId } 
        });

        if (!request) {
            return { success: false, message: 'Overtime request not found' };
        }

        if (request.status !== 'pending') {
            return { success: false, message: `Request is already ${request.status}` };
        }

        // Update request status
        await this.overtimeRequestRepository.update(requestId, {
            status: 'rejected',
            approvedBy: adminUserId,
            approvedAt: new Date(),
            notes: notes || null
        });

        logger.info(`Overtime request ${requestId} rejected by admin ${adminUserId}`);

        return { 
            success: true, 
            message: 'Overtime request rejected' 
        };
    }

    /**
     * Get overtime request stats
     */
    async getStats() {
        const [pending, approved, rejected] = await Promise.all([
            this.overtimeRequestRepository.count({ where: { status: 'pending' } }),
            this.overtimeRequestRepository.count({ where: { status: 'approved' } }),
            this.overtimeRequestRepository.count({ where: { status: 'rejected' } })
        ]);

        return {
            pending,
            approved,
            rejected,
            total: pending + approved + rejected
        };
    }

    /**
     * Get a single overtime request by ID
     */
    async getById(requestId: number) {
        const request = await this.overtimeRequestRepository.findOne({
            where: { id: requestId },
            relations: ['user', 'timeEntry', 'approver']
        });

        if (!request) {
            return null;
        }

        return {
            ...request,
            userName: `${request.user?.firstName || ''} ${request.user?.lastName || ''}`.trim(),
            userEmail: request.user?.email,
            actualDurationFormatted: this.formatDuration(request.actualDurationSeconds),
            cappedDurationFormatted: this.formatDuration(request.cappedDurationSeconds),
            overtimeFormatted: this.formatDuration(request.overtimeSeconds)
        };
    }

    /**
     * Format duration in seconds to human-readable format
     */
    private formatDuration(totalSeconds: number): string {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }
}
