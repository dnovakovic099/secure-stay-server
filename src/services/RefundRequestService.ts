import { appDatabase } from "../utils/database.util";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { Request } from "express";
import { EntityManager } from "typeorm";
import { format } from "date-fns";
import { formatCurrency } from "../helpers/helpers";
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
        newRefundRequest.status = "Pending";
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
        refundRequest.status = "Pending";
        refundRequest.notes = body.notes;
        refundRequest.createdBy = userId;
        if (attachments.length > 0) {
            refundRequest.attachments = JSON.stringify(attachments);
        }
        return await transactionalEntityManager.save(refundRequest);
    }

    async saveRefundRequest(body: Partial<RefundRequestEntity>, userId: string, attachments: string[], refundRequest?: RefundRequestEntity) {
        return await appDatabase.transaction(async (transactionalEntityManager) => {

            if (refundRequest) {
                //case 1: if the status is Pending and the updated status is Approved.
                if (refundRequest.status == "Pending" && body.status == "Approved") {
                    await this.updateRefundRequest(transactionalEntityManager, refundRequest, body, userId, attachments);
                    const expense = await this.createExpenseForRefundRequest(body, userId);
                    refundRequest.expenseId = expense.id;
                    await transactionalEntityManager.save(refundRequest);
                }

                //case 2: if the status is Pending and the updated status is Denied.
                if (refundRequest.status == "Pending" && body.status == "Denied") {
                    await this.updateRefundRequest(transactionalEntityManager, refundRequest, body, userId, attachments);
                }

                //case 3: if the status is Approved and the updated status is Denied or Pending.
                if (refundRequest.status == "Approved" && (body.status == "Denied" || body.status == "Pending")) {
                    await this.updateRefundRequest(transactionalEntityManager, refundRequest, body, userId, attachments);
                    //delete the expense
                    const expenseService = new ExpenseService();
                    const expense = await expenseService.getExpense(refundRequest.expenseId);
                    await expenseService.deleteExpense(expense.expenseId, userId);

                    refundRequest.expenseId = null;
                    await transactionalEntityManager.save(refundRequest);
                }

            } else {
                //save the refund request 
                const newRefundRequest = await this.createRefundRequest(transactionalEntityManager, body, userId, attachments);
                if (body.status == "Approved") {
                    const expense = await this.createExpenseForRefundRequest(body, userId);
                    newRefundRequest.expenseId = expense.id;
                    await transactionalEntityManager.save(newRefundRequest);
                }
                return newRefundRequest;
            }
        });

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
