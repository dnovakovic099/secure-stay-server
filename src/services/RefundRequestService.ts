import { appDatabase } from "../utils/database.util";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { EntityManager } from "typeorm";
import { format } from "date-fns";
import { ExpenseService } from "./ExpenseService";

export class RefundRequestService {
    private refundRequestRepo = appDatabase.getRepository(RefundRequestEntity);

    async createRefundRequest(transactionalEntityManager: EntityManager, body: Partial<RefundRequestEntity>, userId: string, attachments: string[]) {
        const newRefundRequest = new RefundRequestEntity();
        newRefundRequest.reservationId = body.reservationId;
        newRefundRequest.listingId = body.listingId;
        newRefundRequest.guestName = body.guestName;
        newRefundRequest.listingName = body.listingName;
        newRefundRequest.checkIn = body.checkIn;
        newRefundRequest.checkOut = body.checkOut;
        newRefundRequest.issueId = body.issueId;
        newRefundRequest.explaination = body.explaination;
        newRefundRequest.refundAmount = body.refundAmount;
        newRefundRequest.requestedBy = body.requestedBy;
        newRefundRequest.status = body.status;
        newRefundRequest.notes = body.notes;
        if (attachments.length > 0) {
            newRefundRequest.attachments = JSON.stringify(attachments);
        }
        newRefundRequest.createdBy = userId;
        return await transactionalEntityManager.save(newRefundRequest);
    }

    async updateRefundRequest(transactionalEntityManager: EntityManager, refundRequest: Partial<RefundRequestEntity>, body: Partial<RefundRequestEntity>, userId: string, attachments: string[]) {
        refundRequest.reservationId = body.reservationId;
        refundRequest.listingId = body.listingId;
        refundRequest.guestName = body.guestName;
        refundRequest.listingName = body.listingName;
        refundRequest.checkIn = body.checkIn;
        refundRequest.checkOut = body.checkOut;
        refundRequest.issueId = body.issueId;
        refundRequest.explaination = body.explaination;
        refundRequest.refundAmount = body.refundAmount;
        refundRequest.requestedBy = body.requestedBy;
        refundRequest.status = body.status;
        refundRequest.notes = body.notes;
        refundRequest.updatedBy = userId;
        if (attachments.length > 0) {
            refundRequest.attachments = JSON.stringify(attachments);
        }
        return await transactionalEntityManager.save(refundRequest);
    }

    async saveRefundRequest(
        body: Partial<RefundRequestEntity>,
        userId: string,
        attachments: string[],
        refundRequest?: RefundRequestEntity
    ) {
        return await appDatabase.transaction(async (transactionalEntityManager) => {
            const isStatusChanged = refundRequest && refundRequest.status !== body.status;
            if (refundRequest) {
                await this.updateRefundRequest(transactionalEntityManager, refundRequest, body, userId, attachments);
                if (isStatusChanged) {
                    await this.handleExpense(body.status, refundRequest, userId, transactionalEntityManager);
                }

                return refundRequest;
            }

            const newRefundRequest = await this.createRefundRequest(transactionalEntityManager, body, userId, attachments);
            if (body.status === "Approved") {
                await this.handleExpense(body.status, newRefundRequest, userId, transactionalEntityManager);
            }

            return newRefundRequest;
        });
    }

    private async handleExpense(
        status: string,
        request: RefundRequestEntity,
        userId: string,
        transactionalEntityManager: EntityManager
    ) {
        const expenseService = new ExpenseService();

        if (status === "Approved") {
            const expense = await this.createExpenseForRefundRequest(request, userId);
            request.expenseId = expense.id;
        } else if (request.expenseId) {
            const expense = await expenseService.getExpense(request.expenseId);
            await expenseService.deleteExpense(expense.expenseId, userId);
            request.expenseId = null;
        }
        await transactionalEntityManager.save(request);
    }


    private async createExpenseForRefundRequest(body: Partial<RefundRequestEntity>, userId: string) {
        //create expense object
        const expenseObj = {
            body: {
                listingMapId: body.listingId,
                expenseDate: format(new Date(), 'yyyy-MM-dd'),
                concept: `Refund Request`,
                amount: body.refundAmount,
                categories: JSON.stringify([12]),
                dateOfWork: null,
                contractorName: " ",
                contractorNumber: null,
                findings: null,
                status: "Pending Approval",
                paymentMethod: null,
                createdBy: userId
            }
        };

        //save the expense
        const expenseService = new ExpenseService();
        return await expenseService.createExpense(expenseObj, userId);
    }

    async getRefundRequestByReservationId(reservationId: number) {
        return await this.refundRequestRepo.findOne({ where: { reservationId } });
    }

    async getRefundRequestById(id: number) {
        return await this.refundRequestRepo.findOne({ where: { id } });
    }

    async getRefundRequestList(query: { page: number, limit: number, status?: string, guestName?: string, listingId?: number; }) {
        const { page, limit, status, guestName, listingId } = query;
        const offset = (page - 1) * limit;
        const whereConditions: any = {};
        if (status) {
            whereConditions.status = status;
        }
        if (guestName) {
            whereConditions.guestName = guestName;
        }
        if (listingId) {
            whereConditions.listingId = listingId;
        }
        return await this.refundRequestRepo.find({
            where: whereConditions,
            order: { createdAt: "DESC" },
            take: limit,
            skip: offset,
        });
    }

}
