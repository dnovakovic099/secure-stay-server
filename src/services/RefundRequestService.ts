import { appDatabase } from "../utils/database.util";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { EntityManager, ILike, In } from "typeorm";
import { format } from "date-fns";
import { ExpenseService } from "./ExpenseService";
import CustomErrorHandler from "../middleware/customError.middleware";
import sendEmail from "../utils/sendEmai";
import { formatCurrency } from "../helpers/helpers";
import logger from "../utils/logger.utils";
import { UsersEntity } from "../entity/Users";
import { buildMitigationRefundRequestMessage, buildMitigationRefundRequestUpdateMessage, buildRefundRequestMessage, buildRefundRequestOriginalMessageForStatus, buildRefundRequestReminderMessage, buildUpdatedRefundRequestMessage, buildUpdatedStatusRefundRequestMessage } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import updateSlackMessage from "../utils/updateSlackMsg";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { SlackMessageService } from "./SlackMessageService";
import { ExpenseStatus } from "../entity/Expense";
import { ListingService } from "./ListingService";
import { FileInfo } from "../entity/FileInfo";
import { categoryIds } from "../constant";
import { RefundRequestSettingsService } from "./RefundRequestSettingsService";
import { ResolutionsTeamSlackService } from "./ResolutionsTeamSlackService";
import { ReviewCheckout } from "../entity/ReviewCheckout";
import { ReservationHistoryService, ReservationHistoryDiff } from "./ReservationHistoryService";

export class RefundRequestService {
    private refundRequestRepo = appDatabase.getRepository(RefundRequestEntity);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
  private fileInfoRepo = appDatabase.getRepository(FileInfo);
  private reservationHistoryService = new ReservationHistoryService();

  private normalizeChargeToClient(value: unknown): number {
    return value === true || value === "true" || value === 1 || value === "1" ? 1 : 0;
  }

  private isRefundTerminalStatus(status?: string | null) {
    return ["Denied", "Declined", "Cancelled", "Canceled"].includes(status || "");
  }

  private getExpenseStatusForRefund(status?: string | null, chargeToClient?: number | boolean | string | null) {
    if (this.isRefundTerminalStatus(status)) return null;
    if (!this.normalizeChargeToClient(chargeToClient)) return ExpenseStatus.NA;

    switch (status) {
      case "Pending":
        return ExpenseStatus.PENDING;
      case "Approved":
        return ExpenseStatus.APPROVED;
      case "Paid":
        return ExpenseStatus.PAID;
      default:
        return ExpenseStatus.NA;
    }
  }

  private async findMitigationThreadForRefundRequest(refundRequest: Partial<RefundRequestEntity>) {
    if (!refundRequest.reservationId) return null;
    const reviewCheckoutRepo = appDatabase.getRepository(ReviewCheckout);
    return await reviewCheckoutRepo.findOne({
      where: { reservationInfo: { id: Number(refundRequest.reservationId) } },
    });
  }

  private async getMitigationRefundSlackMessage(refundRequestId: number) {
    return await this.slackMessageRepo.findOne({
      where: {
        entityType: "refund_request",
        entityId: refundRequestId,
      },
      order: { createdAt: "DESC" },
    });
  }

  private async postOrUpdateMitigationRefundCard(
    refundRequest: RefundRequestEntity,
    actorName: string,
    slackMessageService: SlackMessageService
  ) {
    const rc = await this.findMitigationThreadForRefundRequest(refundRequest);
    if (!rc?.slackThreadTs) return false;

    const resolutionsService = new ResolutionsTeamSlackService();
    const anjSlackId = await resolutionsService.getAnjSlackUserId();
    const channel = rc.slackChannelId || undefined;
    const msgPayload = buildMitigationRefundRequestMessage(refundRequest, {
      anjSlackId,
      submittedBy: actorName,
    });

    const existing = await this.getMitigationRefundSlackMessage(refundRequest.id);
    if (existing?.messageTs && existing.channel && existing.threadTs === rc.slackThreadTs) {
      await updateSlackMessage(
        { ...msgPayload, channel: existing.channel },
        existing.messageTs,
        existing.channel
      );
      return true;
    }

    const result = await sendSlackMessage(
      { ...msgPayload, channel: channel || "#resolutions-team" },
      rc.slackThreadTs
    );

    if (result?.channel && result?.ts) {
      await slackMessageService.saveSlackMessageInfo({
        channel: result.channel,
        messageTs: result.ts,
        threadTs: rc.slackThreadTs,
        entityType: "refund_request",
        entityId: refundRequest.id,
        originalMessage: JSON.stringify(msgPayload)
      });
      return true;
    }

    return false;
  }

  private async postMitigationRefundUpdate(
    refundRequest: RefundRequestEntity,
    description: string,
    updatedBy: string
  ) {
    const rc = await this.findMitigationThreadForRefundRequest(refundRequest);
    if (!rc?.slackThreadTs) return false;

    const msgPayload = buildMitigationRefundRequestUpdateMessage(refundRequest, {
      description,
      updatedBy,
    });

    await sendSlackMessage(
      { ...msgPayload, channel: rc.slackChannelId || "#resolutions-team" },
      rc.slackThreadTs
    );
    return true;
  }

  private async logRefundRequestChanges(
    reservationInfoId: number | null | undefined,
    changedBy: string,
    diff: ReservationHistoryDiff,
    manager?: EntityManager
  ) {
    if (!reservationInfoId) return;
    await this.reservationHistoryService.logChanges({
      reservationInfoId: Number(reservationInfoId),
      diff,
      changedBy,
      action: "UPDATE",
      manager,
    });
  }

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
        newRefundRequest.paymentMethod = body.paymentMethod;
        newRefundRequest.paymentDetails = body.paymentDetails;
        newRefundRequest.chargeToClient = this.normalizeChargeToClient((body as any).chargeToClient);
        newRefundRequest.notes = body.notes;
        if (attachments.length > 0) {
            newRefundRequest.attachments = JSON.stringify(attachments);
        }
        newRefundRequest.createdBy = userId;
        return await transactionalEntityManager.save(newRefundRequest);
    }

    async updateRefundRequest(transactionalEntityManager: EntityManager, refundRequest: RefundRequestEntity, body: Partial<RefundRequestEntity>, userId: string, attachments: string[]) {
        const previousState = {
            explaination: refundRequest.explaination ?? null,
            refundAmount: refundRequest.refundAmount ?? null,
            requestedBy: refundRequest.requestedBy ?? null,
            status: refundRequest.status ?? null,
            paymentMethod: refundRequest.paymentMethod ?? null,
            paymentDetails: refundRequest.paymentDetails ?? null,
            chargeToClient: refundRequest.chargeToClient ?? 0,
            notes: refundRequest.notes ?? null,
            checkIn: refundRequest.checkIn ?? null,
            checkOut: refundRequest.checkOut ?? null,
        };
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
        refundRequest.paymentMethod = body.paymentMethod;
        refundRequest.paymentDetails = body.paymentDetails;
        refundRequest.chargeToClient = this.normalizeChargeToClient((body as any).chargeToClient);
        refundRequest.notes = body.notes;
        refundRequest.updatedBy = userId;
        if (attachments.length > 0) {
            refundRequest.attachments = JSON.stringify(attachments);
        }
        const saved = await transactionalEntityManager.save(refundRequest);
        await this.logRefundRequestChanges(saved.reservationId, userId, {
            refundExplanation: { old: previousState.explaination, new: saved.explaination ?? null },
            refundAmount: { old: previousState.refundAmount, new: saved.refundAmount ?? null },
            requestedBy: { old: previousState.requestedBy, new: saved.requestedBy ?? null },
            refundStatus: { old: previousState.status, new: saved.status ?? null },
            refundPaymentMethod: { old: previousState.paymentMethod, new: saved.paymentMethod ?? null },
            refundPaymentDetails: { old: previousState.paymentDetails, new: saved.paymentDetails ?? null },
            refundChargeToClient: { old: previousState.chargeToClient, new: saved.chargeToClient ?? 0 },
            refundNotes: { old: previousState.notes, new: saved.notes ?? null },
            refundCheckIn: { old: previousState.checkIn, new: saved.checkIn ?? null },
            refundCheckOut: { old: previousState.checkOut, new: saved.checkOut ?? null },
        }, transactionalEntityManager);
        return saved;
    }

  async saveRefundRequest(
    body: Partial<RefundRequestEntity>,
    userId: string,
    fileInfo?: { fileName: string, filePath: string, mimeType: string; originalName: string; }[],
    refundRequest?: RefundRequestEntity
  ) {
    const slackMessageService = new SlackMessageService();
    const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
    const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";

    return await appDatabase.transaction(async (transactionManager) => {
      if (refundRequest) {
        return this.updateRefundRequestFlow(
          transactionManager,
          body,
          userId,
          fileInfo ? fileInfo.map(file => file.fileName) : [],
          fileInfo,
          refundRequest,
          user,
          slackMessageService
        );
      }

      return this.createRefundRequestFlow(
        transactionManager,
        body,
        userId,
        fileInfo ? fileInfo.map(file => file.fileName) : [],
        fileInfo,
        user,
        slackMessageService
      );
    });
  }

  private async saveFileInfo(fileInfo: { fileName: string, filePath: string, mimeType: string; originalName: string; }[], refundRequest: RefundRequestEntity, userId: string) {
    for (const file of fileInfo) {
      const fileRecord = new FileInfo();
      fileRecord.entityType = 'refundRequest';
      fileRecord.entityId = refundRequest.id;
      fileRecord.fileName = file.fileName;
      fileRecord.createdBy = userId;
      fileRecord.localPath = file.filePath;
      fileRecord.mimetype = file.mimeType;
      fileRecord.originalName = file.originalName;
      await this.fileInfoRepo.save(fileRecord);
    }
  }

    private async updateRefundRequestFlow(
    transactionManager: EntityManager,
    body: Partial<RefundRequestEntity>,
    userId: string,
    attachments: string[],
    fileInfo: { fileName: string, filePath: string, mimeType: string; originalName: string; }[] | null,
    refundRequest: RefundRequestEntity,
    user: string,
    slackMessageService: SlackMessageService
    ) {
        const previousStatus = refundRequest.status;
        const isStatusChanged = previousStatus !== body.status;

        const savedRefundRequest = await this.updateRefundRequest(transactionManager, refundRequest, body, userId, attachments);
        await this.handleExpense(savedRefundRequest.status, savedRefundRequest, userId, transactionManager, savedRefundRequest.id);

    try {
      const mitigationThreadHandled = await this.postOrUpdateMitigationRefundCard(
        savedRefundRequest,
        user,
        slackMessageService
      );
      if (mitigationThreadHandled) {
        const description = isStatusChanged
          ? `Refund status changed from *${previousStatus || "—"}* to *${savedRefundRequest.status || "—"}*`
          : "Refund request updated";
        await this.postMitigationRefundUpdate(savedRefundRequest, description, user);
      } else {
        const slackMessageInfo = await this.slackMessageRepo.findOne({
          where: {
            entityType: "refund_request",
            entityId: savedRefundRequest.id
          }
        });

        if (slackMessageInfo) {
          // 1. Update the original message to reflect the new status/buttons
          await updateSlackMessage(
            buildRefundRequestOriginalMessageForStatus(savedRefundRequest),
            slackMessageInfo.messageTs,
            slackMessageInfo.channel
          );
          // 2. Post a thread reply with the change summary
          const replyMessage = isStatusChanged
            ? buildUpdatedStatusRefundRequestMessage(savedRefundRequest, user)
            : buildUpdatedRefundRequestMessage(savedRefundRequest, user);
          await sendSlackMessage(replyMessage, slackMessageInfo.threadTs || slackMessageInfo.messageTs);
        }
      }
    } catch (error) {
      logger.error("Slack update failed", error);
    }

    try {
      await this.sendEmailForUpdatedRefundRequest(savedRefundRequest);
    } catch (error) {
      logger.error("Email notification failed (update)", error);
    }

    if (fileInfo && fileInfo.length > 0) {
      await this.saveFileInfo(fileInfo, savedRefundRequest, userId);
    }

    return savedRefundRequest;
  }

  private async createRefundRequestFlow(
    transactionManager: EntityManager,
    body: Partial<RefundRequestEntity>,
    userId: string,
    attachments: string[],
    fileInfo: { fileName: string, filePath: string, mimeType: string; originalName: string; }[] | null,
    user: string,
    slackMessageService: SlackMessageService
    ) {
        const newRefundRequest = await this.createRefundRequest(transactionManager, body, userId, attachments);
        await this.handleExpense(newRefundRequest.status, newRefundRequest, userId, transactionManager, newRefundRequest.id);

    const mitigationThreadHandled = await this.postOrUpdateMitigationRefundCard(
      newRefundRequest,
      user,
      slackMessageService
    );

    if (newRefundRequest.status === "Pending" && !mitigationThreadHandled) {
      try {
        const slackTagIds = await this.getSlackTagIds();
        const slackMessage = buildRefundRequestMessage(newRefundRequest, slackTagIds);
        const slackResponse = await sendSlackMessage(slackMessage);

        await slackMessageService.saveSlackMessageInfo({
          channel: slackResponse.channel,
          messageTs: slackResponse.ts,
          threadTs: slackResponse.ts,
          entityType: "refund_request",
          entityId: newRefundRequest.id,
          originalMessage: JSON.stringify(slackMessage)
        });
      } catch (error) {
        logger.error("Slack creation failed", error);
      }
    }

    try {
      await this.sendEmailForNewRefundRequest(newRefundRequest);
    } catch (error) {
      logger.error("Email notification failed (new)", error);
    }

    if (fileInfo && fileInfo.length > 0) {
      await this.saveFileInfo(fileInfo, newRefundRequest, userId);
    }

    return newRefundRequest;
  }


    private async getSlackTagIds(): Promise<string[]> {
        try {
            const settingsService = new RefundRequestSettingsService();
            const settings = await settingsService.getSettings();
            if (settings.slackTagIds) {
                const parsed = JSON.parse(settings.slackTagIds);
                return Array.isArray(parsed) ? parsed : [];
            }
        } catch (e) {
            logger.error("Failed to fetch refund request Slack tag IDs", e);
        }
        return [];
    }

    private async handleExpense(
        status: string,
        request: RefundRequestEntity,
        userId: string,
      transactionalEntityManager: EntityManager,
      id: number
    ) {
        const expenseService = new ExpenseService();
        const expenseStatus = this.getExpenseStatusForRefund(status, request.chargeToClient);

        if (!expenseStatus) {
          if (request.expenseId) {
            await expenseService.deleteExpense(request.expenseId, userId);
            request.expenseId = null;
          }
          await transactionalEntityManager.save(request);
          return;
        }

        if (request.expenseId) {
          await this.updateExpenseForRefundRequest(request, userId, id, expenseStatus);
        } else {
          const expense = await this.createExpenseForRefundRequest(request, userId, id, expenseStatus);
          request.expenseId = expense.id;
        }
        await transactionalEntityManager.save(request);
    }


  private buildExpensePayload(body: Partial<RefundRequestEntity>, userId: string, id: number, status: ExpenseStatus) {
        const category = status === ExpenseStatus.PAID ? categoryIds.ReviewMitigation : categoryIds.Resolutions;
        return {
            listingMapId: body.listingId,
            expenseDate: format(new Date(), 'yyyy-MM-dd'),
            concept: body.explaination,
            amount: body.refundAmount ? -Math.abs(Number(body.refundAmount)) : body.refundAmount,
            categories: JSON.stringify([category]),
            dateOfWork: null,
            contractorName: " ",
            contractorNumber: null,
            findings: `${body.guestName} - <a href="https://securestay.ai/luxury-lodging/refund-requests?id=${id}" target="_blank" style="color:blue;text-decoration:underline;">Refund Request Link</a>`,
            status,
            paymentMethod: body.paymentMethod || null,
            paymentDetails: body.paymentDetails || null,
            reservationId: body.reservationId ? String(body.reservationId) : null,
            guestName: body.guestName || null,
            comesFrom: "refund_request",
            createdBy: userId
        };
    }

  private async updateExpenseForRefundRequest(body: Partial<RefundRequestEntity>, userId: string, id: number, status: ExpenseStatus) {
        const expenseService = new ExpenseService();
        return await expenseService.updateExpense({
            body: {
                expenseId: body.expenseId,
                ...this.buildExpensePayload(body, userId, id, status)
            }
        }, userId);
    }

  private async createExpenseForRefundRequest(body: Partial<RefundRequestEntity>, userId: string, id: number, status: ExpenseStatus) {
        //create expense object
        const expenseObj = {
            body: this.buildExpensePayload(body, userId, id, status)
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

    async getRefundRequestList(query: { page: number, limit: number, status: string, reservationId: string, listingId: string; keyword: string; propertyType: string; }) {
        const { page, limit, status, reservationId, listingId, keyword, propertyType } = query;
        const offset = (page - 1) * limit;


        let listingIds = [];
        const listingService = new ListingService();
        
        if (propertyType && propertyType.length > 0) {
          listingIds = (await listingService.getListingsByPropertyTypes(propertyType as any)).map(l => l.id);
        }
        
        const whereConditions: any = {};

        if (status && Array.isArray(status)) {
            whereConditions.status = In(status);
        }  
        if(reservationId && Array.isArray(reservationId)) {
            whereConditions.reservationId = In(reservationId);
        }
        if (listingId && Array.isArray(listingId)) {
            whereConditions.listingId = In(listingId);
        }

        if (listingIds && listingIds.length > 0) {
            whereConditions.listingId = In(listingIds);
        }
        
        const where = keyword
        ? [
            { ...whereConditions, explaination: ILike(`%${keyword}%`) },
            { ...whereConditions, guestName: ILike(`%${keyword}%`) },
        ]
        : whereConditions;

        const [data, total] = await this.refundRequestRepo.findAndCount({
            where,
            order: { createdAt: "DESC" },
            take: limit,
            skip: offset,
        });

        return { data, total };
    }

    async updateRefundRequestStatus(id: number, status: string, userId: string, isRequestFromSlack?:boolean) {
        const refundRequest = await this.refundRequestRepo.findOne({ where: { id } });
        if (!refundRequest) {
            throw CustomErrorHandler.notFound('Refund request not found');
        }
      const slackMessageInfo = await this.slackMessageRepo.findOne({
        where: {
          entityType: "refund_request",
          entityId: id
        }
      })
      const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
      const user = userInfo ? userInfo.firstName + " " + userInfo.lastName : userId;

        const previousStatus = refundRequest.status;
        const isStatusChanged = refundRequest && refundRequest.status !== status;
        if (isStatusChanged) {
            refundRequest.status = status;
            refundRequest.updatedBy = userId;
            await this.handleExpense(status, refundRequest, userId, appDatabase.manager, refundRequest.id);
        }

      await this.refundRequestRepo.save(refundRequest);
      if (isStatusChanged) {
        await this.logRefundRequestChanges(refundRequest.reservationId, userId, {
          refundStatus: { old: previousStatus, new: status },
        });
      }
      if (!isRequestFromSlack) {
        const mitigationThreadHandled = await this.postOrUpdateMitigationRefundCard(
          refundRequest,
          user,
          new SlackMessageService()
        );

        if (mitigationThreadHandled) {
          const description = isStatusChanged
            ? `Refund status changed from *${previousStatus || "—"}* to *${status || "—"}*`
            : "Refund request updated";
          await this.postMitigationRefundUpdate(refundRequest, description, user);
        } else if (slackMessageInfo) {
          // 1. Update the original message to reflect the new status/buttons
          await updateSlackMessage(
            buildRefundRequestOriginalMessageForStatus(refundRequest),
            slackMessageInfo.messageTs,
            slackMessageInfo.channel
          );
          // 2. Post a thread reply with the change summary
          const replyMessage = isStatusChanged
            ? buildUpdatedStatusRefundRequestMessage(refundRequest, user)
            : buildUpdatedRefundRequestMessage(refundRequest, user);
          await sendSlackMessage(replyMessage, slackMessageInfo.threadTs || slackMessageInfo.messageTs);
        }
      }
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

      await sendSlackMessage(buildRefundRequestReminderMessage(refundRequests));

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

    public async deleteRefundRequest(id: number, userId: string){
        const refundRequest = await this.refundRequestRepo.findOne({ where: { id } });
        if (!refundRequest) {
            throw CustomErrorHandler.notFound('Refund request not found');
        }
        const expenseService = new ExpenseService();
        if (refundRequest.expenseId) {
            const expense = await expenseService.getExpense(refundRequest.expenseId);
            await expenseService.deleteExpense(expense.expenseId, userId);
        }
        refundRequest.deletedBy = userId;
        refundRequest.deletedAt = new Date();
        return await this.refundRequestRepo.save(refundRequest);
    }

}
