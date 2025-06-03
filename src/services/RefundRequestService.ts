import { appDatabase } from "../utils/database.util";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { EntityManager } from "typeorm";
import { format } from "date-fns";
import { ExpenseService } from "./ExpenseService";
import CustomErrorHandler from "../middleware/customError.middleware";
import sendEmail from "../utils/sendEmai";
import { formatCurrency } from "../helpers/helpers";
import logger from "../utils/logger.utils";
import { UsersEntity } from "../entity/Users";
import { buildRefundRequestMessage } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";

export class RefundRequestService {
    private refundRequestRepo = appDatabase.getRepository(RefundRequestEntity);
    private usersRepo = appDatabase.getRepository(UsersEntity);

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
                  // await this.handleExpense(body.status, refundRequest, userId, transactionalEntityManager, refundRequest.id);
                }

              await this.sendEmailForUpdatedRefundRequest(refundRequest);

                return refundRequest;
            }

            const newRefundRequest = await this.createRefundRequest(transactionalEntityManager, body, userId, attachments);
            if (body.status === "Approved") {
              await this.handleExpense(body.status, newRefundRequest, userId, transactionalEntityManager, refundRequest.id);
            }

          //send slack message for Approval or Rejection
          const slackMessage = buildRefundRequestMessage(newRefundRequest);
          await sendSlackMessage(slackMessage);

            //send email notfication
            await this.sendEmailForNewRefundRequest(newRefundRequest)

            return newRefundRequest;
        });
    }

    private async handleExpense(
        status: string,
        request: RefundRequestEntity,
        userId: string,
      transactionalEntityManager: EntityManager,
      id: number
    ) {
        const expenseService = new ExpenseService();

        if (status === "Approved") {
          const expense = await this.createExpenseForRefundRequest(request, userId, id);
            request.expenseId = expense.id;
        } else if (request.expenseId) {
            const expense = await expenseService.getExpense(request.expenseId);
            await expenseService.deleteExpense(expense.expenseId, userId);
            request.expenseId = null;
        }
        await transactionalEntityManager.save(request);
    }


  private async createExpenseForRefundRequest(body: Partial<RefundRequestEntity>, userId: string, id: number) {
        //create expense object
        const expenseObj = {
            body: {
                listingMapId: body.listingId,
                expenseDate: format(new Date(), 'yyyy-MM-dd'),
                concept: body.notes,
                amount: body.refundAmount,
                categories: JSON.stringify([12]),
                dateOfWork: null,
                contractorName: " ",
                contractorNumber: null,
                findings: `${body.guestName} - <a href="https://securestay.ai/luxury-lodging/refund-requests?id=${id}" target="_blank" style="color: blue; text-decoration: underline;">Refund Request Link</a>`,
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

    async getRefundRequestList(query: { page: number, limit: number, status?: string, reservationId?: number, listingId?: number; }) {
        const { page, limit, status, reservationId, listingId } = query;
        const offset = (page - 1) * limit;
        const whereConditions: any = {};
        if (status) {
            whereConditions.status = status;
        }
        if (reservationId) {
            whereConditions.reservationId = reservationId;
        }
        if (listingId) {
            whereConditions.listingId = listingId;
        }
        const [data, total] = await this.refundRequestRepo.findAndCount({
            where: whereConditions,
            order: { createdAt: "DESC" },
            take: limit,
            skip: offset,
        });

        return { data, total };
    }

    async updateRefundRequestStatus(id: number, status: string, userId: string) {
        const refundRequest = await this.refundRequestRepo.findOne({ where: { id } });
        if (!refundRequest) {
            throw CustomErrorHandler.notFound('Refund request not found');
        }

        const isStatusChanged = refundRequest && refundRequest.status !== status;
        if (isStatusChanged) {
            const expenseService = new ExpenseService();

            if (status === "Approved") {
              const expense = await this.createExpenseForRefundRequest(refundRequest, userId, refundRequest.id);
                refundRequest.expenseId = expense.id;
            } else if (refundRequest.expenseId) {
                const expense = await expenseService.getExpense(refundRequest.expenseId);
                await expenseService.deleteExpense(expense.expenseId, userId);
                refundRequest.expenseId = null;
            }
            refundRequest.status = status;
        }

      await this.refundRequestRepo.save(refundRequest);
      await this.sendEmailForUpdatedRefundRequest(refundRequest);
      return refundRequest
    }


    async sendEmailForNewRefundRequest(refundRequest: RefundRequestEntity) {
        const subject = `New Refund Request Received - ${refundRequest.guestName}`;
        const html = `
               <html>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); padding: 30px; border: 1px solid #ddd;">
      <h2 style="color: #0056b3; font-size: 20px; margin-bottom: 20px; text-align: center; border-bottom: 2px solid #0056b3; padding-bottom: 10px;">
        Notification: New Refund Request from ${refundRequest.guestName}
      </h2>
      <p style="margin: 20px 0; font-size: 16px; color: #555; text-align: center;">
       A new refund request has been created in Secure Stay. Please review the details below and take the necessary action.
      </p>

      <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Reservation ID:</strong> ${refundRequest.reservationId}
      </p>
    <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Listing:</strong> ${refundRequest.listingName}
      </p>
    <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Guest Name:</strong> ${refundRequest.guestName}
      </p>
            <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Amount:</strong> ${formatCurrency(refundRequest.refundAmount)}
      </p>
            <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Status:</strong> ${refundRequest.status.toUpperCase()}
      </p>
      <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Requested By:</strong> ${refundRequest.requestedBy}
      </p>
            <div style="background-color: #f9f9fc; border-left: 5px solid #0056b3; padding: 15px; margin: 20px 0; border-radius: 6px;">
        <p style="font-size: 18px; color: #333; margin: 0;">
          <strong>Explaination:</strong>
        </p>
        <p style="font-size: 15px; color: #000; margin: 10px 0; font-weight: normal;">
           ${refundRequest.explaination}
        </p>
      </div>
    </div>
  </body>
</html>

        `;

        await sendEmail(subject, html, process.env.EMAIL_FROM, process.env.EMAIL_TO);
    }


  async sendEmailForUpdatedRefundRequest(refundRequest: RefundRequestEntity) {
    const subject = `Refund Request Updated - ${refundRequest.guestName}`;
    const html = `
               <html>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); padding: 30px; border: 1px solid #ddd;">
      <h2 style="color: #0056b3; font-size: 20px; margin-bottom: 20px; text-align: center; border-bottom: 2px solid #0056b3; padding-bottom: 10px;">
        Notification: Updated Refund Request from ${refundRequest.guestName}
      </h2>
      <p style="margin: 20px 0; font-size: 16px; color: #555; text-align: center;">
       Refund request has been updated in Secure Stay. Please review the details below and take the necessary action.
      </p>

      <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Reservation ID:</strong> ${refundRequest.reservationId}
      </p>
    <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Listing:</strong> ${refundRequest.listingName}
      </p>
    <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Guest Name:</strong> ${refundRequest.guestName}
      </p>
            <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Amount:</strong> ${formatCurrency(refundRequest.refundAmount)}
      </p>
            <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Status:</strong> ${refundRequest.status.toUpperCase()}
      </p>
      <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Requested By:</strong> ${refundRequest.requestedBy}
      </p>
            <div style="background-color: #f9f9fc; border-left: 5px solid #0056b3; padding: 15px; margin: 20px 0; border-radius: 6px;">
        <p style="font-size: 18px; color: #333; margin: 0;">
          <strong>Explaination:</strong>
        </p>
        <p style="font-size: 15px; color: #000; margin: 10px 0; font-weight: normal;">
           ${refundRequest.explaination}
        </p>
      </div>
    </div>
  </body>
</html>

        `;

    await sendEmail(subject, html, process.env.EMAIL_FROM, process.env.EMAIL_TO);
  }




    public async checkForPendingRefundRequest() {
        const currentTimeStamp = new Date().getTime();
        const refundRequests = await this.refundRequestRepo.find({ where: { status: "Pending" } });

        if (refundRequests.length === 0) {
            logger.info('No pending refund requests found');
            return;
        }

        const requestByUsers: Record<string, any[]> = {}; // Group requests by user email

        for (const request of refundRequests) {
            const user = await this.usersRepo.findOne({ where: { uid: request.createdBy } });
            if (user) {
                if (!requestByUsers[user.email]) {
                    requestByUsers[user.email] = [];
                }
                requestByUsers[user.email].push(request);
            }
        }

        // Send email to admin for all refund requests
        if (refundRequests.length == 1) {
          await this.sendSingleRefundRequestEmail(process.env.EMAIL_TO, refundRequests[0], currentTimeStamp); // Call function for a single request
        } else {
          await this.sendMultipleRefundRequestsEmail(process.env.EMAIL_TO, refundRequests, currentTimeStamp);
        }

        // Send email to users based on the number of requests they have
        for (const [email, requests] of Object.entries(requestByUsers)) {
            console.log(email, requests);
            if (requests.length === 1) {
                await this.sendSingleRefundRequestEmail(email, requests[0], currentTimeStamp); // Call function for a single request
            } else {
                await this.sendMultipleRefundRequestsEmail(email, requests, currentTimeStamp); // Call function for multiple requests
            }
        }
    }

    async sendSingleRefundRequestEmail(email: string, refundRequest: RefundRequestEntity, currentTimeStamp: number) {
        const subject = `Pending Refund Request - #${currentTimeStamp}`;
        const html = `
               <html>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); padding: 30px; border: 1px solid #ddd;">
      <h2 style="color: #0056b3; font-size: 20px; margin-bottom: 20px; text-align: center; border-bottom: 2px solid #0056b3; padding-bottom: 10px;">
       Action Required: Pending Refund Requests - ${refundRequest.guestName}
      </h2>
      <p style="margin: 20px 0; font-size: 16px; color: #555; text-align: center;">
        Please review the details below and take the necessary action.
      </p>

      <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Reservation ID:</strong> ${refundRequest.reservationId}
      </p>
    <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Listing:</strong> ${refundRequest.listingName}
      </p>
    <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Guest Name:</strong> ${refundRequest.guestName}
      </p>
            <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Amount:</strong> ${formatCurrency(refundRequest.refundAmount)}
      </p>
            <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Status:</strong> ${refundRequest.status.toUpperCase()}
      </p>
      <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Requested By:</strong> ${refundRequest.requestedBy}
      </p>
            <div style="background-color: #f9f9fc; border-left: 5px solid #0056b3; padding: 15px; margin: 20px 0; border-radius: 6px;">
        <p style="font-size: 18px; color: #333; margin: 0;">
          <strong>Explaination:</strong>
        </p>
        <p style="font-size: 15px; color: #000; margin: 10px 0; font-weight: normal;">
           ${refundRequest.explaination}
        </p>
      </div>
    </div>
  </body>
</html>

        `;

        await sendEmail(subject, html, process.env.EMAIL_FROM, email);
    }

    async sendMultipleRefundRequestsEmail(email: string, refundRequest: RefundRequestEntity[], currentTimeStamp: number) {
        const subject = `Pending Refund Request - #${currentTimeStamp}`;
        const html = `
               <html>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
    <div style="width: 100%; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); padding: 30px; border: 1px solid #ddd;">
      <h2 style="color: #0056b3; font-size: 20px; margin-bottom: 20px; text-align: center; border-bottom: 2px solid #0056b3; padding-bottom: 10px;">
        Action Required: ${refundRequest.length} Pending Refund Requests
      </h2>
      <p style="margin: 20px 0; font-size: 16px; color: #555; text-align: center;">
        Please review the details below and take the necessary action.
      </p>

 <!-- Scrollable Table Wrapper (Full Width) -->
      <div style="overflow-x: auto; width: 100%;">
        <table style="min-width: 1000px; border-collapse: collapse; width: 100%;">
          <thead>
            <tr>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">ReservationId</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Listing</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">GuestName</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Amount</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Status</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Requested By</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Explaination</th>
            </tr>
          </thead>
          <tbody>
            ${refundRequest.map(request => `
              <tr>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${request.reservationId}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${request.listingName}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${request.guestName}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${request.refundAmount}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${request.status}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${request.requestedBy}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${request.explaination}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  </body>
</html>

        `;

        await sendEmail(subject, html, process.env.EMAIL_FROM, email);
    }

}