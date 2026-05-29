import { appDatabase } from "../utils/database.util";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { Between, Brackets, EntityManager, ILike, In, IsNull, LessThanOrEqual, MoreThanOrEqual, Not } from "typeorm";
import { format } from "date-fns";
import { ExpenseService } from "./ExpenseService";
import CustomErrorHandler from "../middleware/customError.middleware";
import sendEmail from "../utils/sendEmai";
import { formatCurrency } from "../helpers/helpers";
import logger from "../utils/logger.utils";
import { UsersEntity } from "../entity/Users";
import { buildMitigationRefundRequestMessage, buildMitigationRefundRequestUpdateMessage, buildRefundRequestMessage, buildRefundRequestOriginalMessageForStatus, buildUpdatedRefundRequestMessage, buildUpdatedStatusRefundRequestMessage } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import updateSlackMessage from "../utils/updateSlackMsg";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { SlackMessageService } from "./SlackMessageService";
import { ExpenseEntity, ExpenseStatus } from "../entity/Expense";
import { ListingService } from "./ListingService";
import { FileInfo } from "../entity/FileInfo";
import { categoryIds } from "../constant";
import { RefundRequestSettingsService } from "./RefundRequestSettingsService";
import { ResolutionsTeamSlackService } from "./ResolutionsTeamSlackService";
import { ReviewCheckout } from "../entity/ReviewCheckout";
import { ReservationHistoryService, ReservationHistoryDiff } from "./ReservationHistoryService";
import { ReviewDiscussionService } from "./ReviewDiscussionService";
import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Employee } from "../entity/Employee";

export class RefundRequestService {
    private refundRequestRepo = appDatabase.getRepository(RefundRequestEntity);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
  private expenseRepo = appDatabase.getRepository(ExpenseEntity);
  private listingRepo = appDatabase.getRepository(Listing);
  private reservationInfoRepo = appDatabase.getRepository(ReservationInfoEntity);
  private fileInfoRepo = appDatabase.getRepository(FileInfo);
  private employeeRepo = appDatabase.getRepository(Employee);
  private reservationHistoryService = new ReservationHistoryService();

  private normalizeChargeToClient(value: unknown): number {
    return value === true || value === "true" || value === 1 || value === "1" ? 1 : 0;
  }

  private isRefundTerminalStatus(status?: string | null) {
    return ["Denied", "Declined", "Cancelled", "Canceled"].includes(status || "");
  }

  private getExpenseStatusForRefund(status?: string | null, chargeToClient?: number | boolean | string | null) {
    return status === "Paid" ? ExpenseStatus.PAID : null;
  }

  private getUserDisplayName(user?: UsersEntity | null) {
    if (!user) return null;
    return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || user.uid || null;
  }

  private inferPropertyTypeTag(listing?: Listing | null) {
    const explicit = String(listing?.propertyType || "").trim().toLowerCase();
    if (explicit === "pm") return "PM";
    if (explicit === "arb") return "Arb";
    if (explicit === "own") return "Own";
    const tokens = this.parseListingTags(listing?.tags);
    if (tokens.includes("pm")) return "PM";
    if (tokens.includes("arb")) return "Arb";
    if (tokens.includes("own")) return "Own";
    return null;
  }

  private inferServiceTypeTag(listing?: Listing | null) {
    const tokens = this.parseListingTags(listing?.tags);
    if (tokens.includes("full")) return "Full";
    if (tokens.includes("pro")) return "Pro";
    if (tokens.includes("launch")) return "Launch";
    return null;
  }

  private parseListingTags(tags?: string | null) {
    return String(tags || "")
      .split(/[,;/]+/)
      .map((tag) => tag.trim().toLowerCase().replace(/^["'[\]{}]+|["'[\]{}]+$/g, ""))
      .filter(Boolean);
  }

  private async decorateRefundRequests<T extends RefundRequestEntity | RefundRequestEntity[] | null>(refundRequests: T): Promise<T> {
    const rows = Array.isArray(refundRequests) ? refundRequests : refundRequests ? [refundRequests] : [];
    if (!rows.length) return refundRequests;

    const userIds = Array.from(new Set(
      rows.flatMap((request) => [request.createdBy, request.updatedBy, request.deletedBy]).filter(Boolean)
    ));
    const users = userIds.length
      ? await this.usersRepo.find({ where: { uid: In(userIds) } })
      : [];
    const userMap = new Map(users.map((user) => [user.uid, this.getUserDisplayName(user)]));

    rows.forEach((request: any) => {
      request.createdByName = userMap.get(request.createdBy) || request.requestedBy || request.createdBy || null;
      request.updatedByName = userMap.get(request.updatedBy) || request.updatedBy || null;
      request.deletedByName = userMap.get(request.deletedBy) || request.deletedBy || null;
    });

    const listingIds = Array.from(new Set(rows.map((request) => Number(request.listingId)).filter(Boolean)));
    const reservationIds = Array.from(new Set(rows.map((request) => Number(request.reservationId)).filter(Boolean)));
    const expenseIds = Array.from(new Set(rows.map((request) => Number(request.expenseId)).filter(Boolean)));
    const [listings, reservations, expenses] = await Promise.all([
      listingIds.length ? this.listingRepo.find({ where: { id: In(listingIds) } }) : [],
      reservationIds.length ? this.reservationInfoRepo.find({ where: { id: In(reservationIds) } }) : [],
      expenseIds.length ? this.expenseRepo.find({ where: { id: In(expenseIds) } }) : [],
    ]);
    const listingMap = new Map<number, Listing>(listings.map((listing) => [Number(listing.id), listing] as [number, Listing]));
    const reservationMap = new Map<number, ReservationInfoEntity>(reservations.map((reservation) => [Number(reservation.id), reservation] as [number, ReservationInfoEntity]));
    const expenseMap = new Map<number, ExpenseEntity>(expenses.map((expense) => [Number(expense.id), expense] as [number, ExpenseEntity]));

    rows.forEach((request: any) => {
      const listing = listingMap.get(Number(request.listingId));
      const reservation = reservationMap.get(Number(request.reservationId));
      const expense = expenseMap.get(Number(request.expenseId));
      request.propertyType = this.inferPropertyTypeTag(listing);
      request.serviceType = this.inferServiceTypeTag(listing);
      request.listingTags = listing?.tags || null;
      request.channelName = reservation?.channelName || reservation?.source || null;
      request.expenseStatus = expense?.status || null;
      request.expense = expense
        ? {
          id: expense.id,
          expenseId: expense.expenseId,
          status: expense.status,
        }
        : null;
    });

    return refundRequests;
  }

  private async findMitigationThreadForRefundRequest(refundRequest: Partial<RefundRequestEntity>) {
    if (!refundRequest.reservationId) return null;
    const reviewCheckoutRepo = appDatabase.getRepository(ReviewCheckout);
    return await reviewCheckoutRepo.findOne({
      where: { reservationInfo: { id: Number(refundRequest.reservationId) } },
    });
  }

  private async attachReservationContext(refundRequest: RefundRequestEntity) {
    if (!refundRequest.reservationId) return refundRequest;

    const reservation = await this.reservationInfoRepo.findOne({
      where: { id: Number(refundRequest.reservationId) },
    });

    if (reservation) {
      (refundRequest as any).channelName = reservation.channelName || reservation.source || null;
    }

    return refundRequest;
  }

  private async getUserSlackMention(userId?: string | null) {
    const rawUserId = String(userId || "").trim();
    if (!rawUserId) return null;

    const user = await this.usersRepo.findOne({ where: { uid: rawUserId } });
    if (!user) return null;

    const employee = await this.employeeRepo.findOne({
      where: { userId: user.id, deletedAt: null as any },
      select: ["userId", "slackUserId", "slackId"],
    });
    const slackMemberId = String(employee?.slackUserId || employee?.slackId || "").trim();
    return slackMemberId ? `<@${slackMemberId}>` : null;
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
    const [assigneeMention, submittedByMention] = await Promise.all([
      this.getUserSlackMention(rc.assignee),
      this.getUserSlackMention(refundRequest.createdBy),
    ]);
    const channel = rc.slackChannelId || undefined;
    const msgPayload = buildMitigationRefundRequestMessage(refundRequest, {
      anjSlackId,
      submittedBy: actorName,
      assigneeMention,
      submittedByMention,
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
    updatedBy: string,
    statusChange?: { oldStatus?: string | null; newStatus?: string | null }
  ) {
    const rc = await this.findMitigationThreadForRefundRequest(refundRequest);
    if (!rc?.slackThreadTs) return false;

    const [assigneeMention, anjSlackId] = await Promise.all([
      this.getUserSlackMention(rc.assignee),
      new ResolutionsTeamSlackService().getAnjSlackUserId(),
    ]);
    const msgPayload = buildMitigationRefundRequestUpdateMessage(refundRequest, {
      description,
      updatedBy,
      assigneeMention,
      anjSlackId,
      oldStatus: statusChange?.oldStatus,
      newStatus: statusChange?.newStatus,
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

  private async recordRefundRequestSystemUpdate(
    refundRequest: Partial<RefundRequestEntity>,
    content: string,
    userId: string,
    metadata: Record<string, any> = {}
  ) {
    if (!refundRequest.reservationId) return;

    try {
      await new ReviewDiscussionService().createSystemMessageByReservation(
        Number(refundRequest.reservationId),
        content,
        {
          source: "refund_request",
          eventType: "refund_request",
          actor: userId,
          refundRequestId: refundRequest.id,
          ...metadata,
        }
      );
    } catch (error) {
      logger.error("[RefundRequestService] Review discussion refund request system update failed:", error);
    }
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
        await this.postMitigationRefundUpdate(
          savedRefundRequest,
          description,
          user,
          isStatusChanged ? { oldStatus: previousStatus, newStatus: savedRefundRequest.status } : undefined
        );
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

    await this.recordRefundRequestSystemUpdate(
      savedRefundRequest,
      isStatusChanged
        ? `Refund request status changed from ${previousStatus || "blank"} to ${savedRefundRequest.status || "blank"}.`
        : "Refund request updated.",
      userId,
      {
        oldStatus: previousStatus,
        newStatus: savedRefundRequest.status,
      }
    );

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
        await this.attachReservationContext(newRefundRequest);
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

    await this.recordRefundRequestSystemUpdate(
      newRefundRequest,
      `Refund request added for ${formatCurrency(newRefundRequest.refundAmount)}.`,
      userId,
      {
        amount: newRefundRequest.refundAmount,
        status: newRefundRequest.status,
      }
    );

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
            await expenseService.updateExpenseStatus({
              body: {
                expenseId: [request.expenseId],
                status: ExpenseStatus.CANCELLED,
                datePaid: "",
                skipRefundRequestSync: true,
              }
            } as any, userId);
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
        const today = format(new Date(), 'yyyy-MM-dd');
        return {
            listingMapId: body.listingId,
            expenseDate: today,
            concept: body.explaination,
            amount: body.refundAmount ? -Math.abs(Number(body.refundAmount)) : body.refundAmount,
            categories: JSON.stringify([categoryIds.ReviewMitigation]),
            dateOfWork: null,
            contractorName: " ",
            contractorNumber: null,
            findings: `${body.guestName} - <a href="https://securestay.ai/luxury-lodging/refund-requests?id=${id}" target="_blank" style="color:blue;text-decoration:underline;">Refund Request Link</a>`,
            status,
            datePaid: status === ExpenseStatus.PAID ? today : null,
            paymentMethod: body.paymentMethod || null,
            paymentDetails: body.paymentDetails || null,
            reservationId: body.reservationId ? String(body.reservationId) : null,
            guestName: body.guestName || null,
            comesFrom: "refund_request",
            createdBy: userId,
            llCover: this.normalizeChargeToClient(body.chargeToClient) ? 0 : 1,
            skipRefundRequestSync: true
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
        const refundRequest = await this.refundRequestRepo.findOne({ where: { reservationId } });
        return await this.decorateRefundRequests(refundRequest);
    }

    async getRefundRequestById(id: number) {
        const refundRequest = await this.refundRequestRepo.findOne({ where: { id } });
        return await this.decorateRefundRequests(refundRequest);
    }

    async getRefundRequestList(query: { page: number, limit: number, status: string, reservationId: string, listingId: string; keyword: string; keywordField?: string; propertyType: string; serviceType?: string; chargeToClient?: string; dateType?: string; fromDate?: string; toDate?: string; createdBy?: string; paymentMethod?: string; refundAmountMin?: string; refundAmountMax?: string; expenseEntry?: string; sortRules?: string; }) {
        const { page, limit, status, reservationId, listingId, keyword, keywordField, propertyType, serviceType, chargeToClient, dateType, fromDate, toDate, createdBy, paymentMethod, refundAmountMin, refundAmountMax, expenseEntry, sortRules } = query;
        const offset = (page - 1) * limit;

        const normalizeArray = (value: any): string[] => {
          if (Array.isArray(value)) return value.map(String).filter(Boolean);
          if (value == null || value === "") return [];
          return String(value).split(",").map((item) => item.trim()).filter(Boolean);
        };

        let listingIds: number[] = [];
        const listingService = new ListingService();
        const propertyTypes = normalizeArray(propertyType);
        const serviceTypes = normalizeArray(serviceType);
        const listingIdFilters = normalizeArray(listingId);
        const reservationIdFilters = normalizeArray(reservationId);
        const statusFilters = normalizeArray(status);
        const createdByFilters = normalizeArray(createdBy);
        const paymentMethodFilters = normalizeArray(paymentMethod);
        const minAmount = refundAmountMin !== undefined && refundAmountMin !== null && refundAmountMin !== "" ? Number(refundAmountMin) : null;
        const maxAmount = refundAmountMax !== undefined && refundAmountMax !== null && refundAmountMax !== "" ? Number(refundAmountMax) : null;
        const selectedExpenseEntry = String(expenseEntry || "").trim();
        const keywordFieldOptions = ["guestName", "explaination", "notes", "paymentDetails"];
        const selectedKeywordField = keywordFieldOptions.includes(String(keywordField || "")) ? String(keywordField) : "all";
        const directSortColumns: Record<string, keyof RefundRequestEntity> = {
            status: "status",
            guestName: "guestName",
            createdAt: "createdAt",
            createdByName: "createdBy",
            listingName: "listingName",
            checkIn: "checkIn",
            checkOut: "checkOut",
            refundAmount: "refundAmount",
            paymentMethod: "paymentMethod",
            paymentDetails: "paymentDetails",
            chargeToClient: "chargeToClient",
            explaination: "explaination",
            expenseEntry: "expenseId",
            reviewMitigation: "reservationId",
        };
        const parseSortRules = () => {
            try {
                const parsed = sortRules ? JSON.parse(String(sortRules)) : [];
                if (!Array.isArray(parsed)) return [];
                return parsed
                    .map((rule) => ({
                        field: String(rule?.field || ""),
                        direction: String(rule?.direction || "asc").toLowerCase() === "desc" ? "DESC" as const : "ASC" as const,
                    }))
                    .filter((rule) => Boolean(directSortColumns[rule.field]))
                    .slice(0, 3);
            } catch {
                return [];
            }
        };
        const activeSortRules = parseSortRules();
        const sortOrder = activeSortRules.length
            ? activeSortRules.reduce<Record<string, "ASC" | "DESC">>((order, rule) => {
                order[directSortColumns[rule.field] as string] = rule.direction;
                return order;
            }, {})
            : { createdAt: "DESC" as const };
        const applySortRulesToQuery = (qb: any) => {
            if (!activeSortRules.length) {
                qb.orderBy("refundRequest.createdAt", "DESC");
                return;
            }
            activeSortRules.forEach((rule, index) => {
                const column = directSortColumns[rule.field];
                if (!column) return;
                const expression = `refundRequest.${String(column)}`;
                if (index === 0) qb.orderBy(expression, rule.direction);
                else qb.addOrderBy(expression, rule.direction);
            });
            qb.addOrderBy("refundRequest.createdAt", "DESC");
        };

        const applyKeywordToQuery = (qb: any, keywordValue: string) => {
            const keywordLike = `%${String(keywordValue).toLowerCase()}%`;
            qb.andWhere(new Brackets((subQuery) => {
                if (selectedKeywordField === "guestName") {
                    subQuery.where("LOWER(refundRequest.guestName) LIKE :keyword", { keyword: keywordLike });
                    return;
                }
                if (selectedKeywordField === "explaination") {
                    subQuery.where("LOWER(refundRequest.explaination) LIKE :keyword", { keyword: keywordLike });
                    return;
                }
                if (selectedKeywordField === "notes") {
                    subQuery.where("LOWER(refundRequest.notes) LIKE :keyword", { keyword: keywordLike });
                    return;
                }
                if (selectedKeywordField === "paymentDetails") {
                    subQuery.where("LOWER(refundRequest.paymentDetails) LIKE :keyword", { keyword: keywordLike });
                    return;
                }
                subQuery
                    .where("LOWER(refundRequest.explaination) LIKE :keyword", { keyword: keywordLike })
                    .orWhere("LOWER(refundRequest.guestName) LIKE :keyword", { keyword: keywordLike })
                    .orWhere("LOWER(refundRequest.notes) LIKE :keyword", { keyword: keywordLike })
                    .orWhere("LOWER(refundRequest.paymentDetails) LIKE :keyword", { keyword: keywordLike });
            }));
        };

        if (propertyTypes.length > 0 || serviceTypes.length > 0) {
          const [propertyListings, serviceListings] = await Promise.all([
            propertyTypes.length ? listingService.getListingsByPropertyTypes(propertyTypes as any) : Promise.resolve([]),
            serviceTypes.length ? listingService.getListingsByServiceTypes(serviceTypes as any) : Promise.resolve([]),
          ]);
          const propertyIds = new Set(propertyListings.map((listing) => Number(listing.id)));
          const serviceIds = new Set(serviceListings.map((listing) => Number(listing.id)));
          const ids = propertyTypes.length && serviceTypes.length
            ? Array.from(propertyIds).filter((id) => serviceIds.has(id))
            : Array.from(new Set([...Array.from(propertyIds), ...Array.from(serviceIds)]));
          listingIds = ids.filter(Boolean);
        }
        
        const whereConditions: any = {};

        if (statusFilters.length) {
            whereConditions.status = In(statusFilters);
        }  
        if(reservationIdFilters.length) {
            whereConditions.reservationId = In(reservationIdFilters);
        }
        if (listingIdFilters.length || propertyTypes.length || serviceTypes.length) {
            const explicitListingIds = listingIdFilters.map(Number).filter(Boolean);
            let effectiveListingIds = explicitListingIds;

            if (propertyTypes.length || serviceTypes.length) {
                effectiveListingIds = explicitListingIds.length
                    ? explicitListingIds.filter((id) => listingIds.includes(id))
                    : listingIds;
            }

            whereConditions.listingId = In(effectiveListingIds.length ? effectiveListingIds : [-1]);
        }

        if (chargeToClient === "true" || chargeToClient === "1") {
            whereConditions.chargeToClient = 1;
        } else if (chargeToClient === "false" || chargeToClient === "0") {
            whereConditions.chargeToClient = 0;
        }

        if (createdByFilters.length) {
            whereConditions.createdBy = In(createdByFilters);
        }

        if (paymentMethodFilters.length) {
            whereConditions.paymentMethod = In(paymentMethodFilters);
        }

        if (minAmount !== null && maxAmount !== null && !Number.isNaN(minAmount) && !Number.isNaN(maxAmount)) {
            whereConditions.refundAmount = Between(minAmount, maxAmount);
        } else if (minAmount !== null && !Number.isNaN(minAmount)) {
            whereConditions.refundAmount = MoreThanOrEqual(minAmount);
        } else if (maxAmount !== null && !Number.isNaN(maxAmount)) {
            whereConditions.refundAmount = LessThanOrEqual(maxAmount);
        }

        if (selectedExpenseEntry === "with") {
            whereConditions.expenseId = Not(IsNull());
        } else if (selectedExpenseEntry === "without") {
            whereConditions.expenseId = IsNull();
        }

        const selectedDateField = dateType === "checkIn" ? "checkIn" : dateType === "checkOut" ? "checkOut" : dateType === "updatedAt" ? "updatedAt" : dateType === "datePaid" ? "datePaid" : "createdAt";
        if (selectedDateField === "datePaid") {
            const qb = this.refundRequestRepo
                .createQueryBuilder("refundRequest")
                .leftJoin(ExpenseEntity, "expense", "expense.id = refundRequest.expenseId");

            if (statusFilters.length) {
                qb.andWhere("refundRequest.status IN (:...statusFilters)", { statusFilters });
            }
            if (reservationIdFilters.length) {
                qb.andWhere("refundRequest.reservationId IN (:...reservationIdFilters)", { reservationIdFilters });
            }
            if (listingIdFilters.length || propertyTypes.length || serviceTypes.length) {
                const explicitListingIds = listingIdFilters.map(Number).filter(Boolean);
                let effectiveListingIds = explicitListingIds;

                if (propertyTypes.length || serviceTypes.length) {
                    effectiveListingIds = explicitListingIds.length
                        ? explicitListingIds.filter((id) => listingIds.includes(id))
                        : listingIds;
                }

                qb.andWhere("refundRequest.listingId IN (:...effectiveListingIds)", { effectiveListingIds: effectiveListingIds.length ? effectiveListingIds : [-1] });
            }
            if (chargeToClient === "true" || chargeToClient === "1") {
                qb.andWhere("refundRequest.chargeToClient = :chargeToClient", { chargeToClient: 1 });
            } else if (chargeToClient === "false" || chargeToClient === "0") {
                qb.andWhere("refundRequest.chargeToClient = :chargeToClient", { chargeToClient: 0 });
            }
            if (createdByFilters.length) {
                qb.andWhere("refundRequest.createdBy IN (:...createdByFilters)", { createdByFilters });
            }
            if (paymentMethodFilters.length) {
                qb.andWhere("refundRequest.paymentMethod IN (:...paymentMethodFilters)", { paymentMethodFilters });
            }
            if (minAmount !== null && maxAmount !== null && !Number.isNaN(minAmount) && !Number.isNaN(maxAmount)) {
                qb.andWhere("refundRequest.refundAmount BETWEEN :minAmount AND :maxAmount", { minAmount, maxAmount });
            } else if (minAmount !== null && !Number.isNaN(minAmount)) {
                qb.andWhere("refundRequest.refundAmount >= :minAmount", { minAmount });
            } else if (maxAmount !== null && !Number.isNaN(maxAmount)) {
                qb.andWhere("refundRequest.refundAmount <= :maxAmount", { maxAmount });
            }
            if (selectedExpenseEntry === "with") {
                qb.andWhere("refundRequest.expenseId IS NOT NULL");
            } else if (selectedExpenseEntry === "without") {
                qb.andWhere("refundRequest.expenseId IS NULL");
            }
            if (fromDate || toDate) {
                qb.andWhere("expense.datePaid BETWEEN :fromDate AND :toDate", {
                    fromDate: fromDate || "1970-01-01",
                    toDate: toDate || "2999-12-31",
                });
            }
            if (keyword) {
                applyKeywordToQuery(qb, keyword);
            }

            applySortRulesToQuery(qb);

            const [data, total] = await qb
                .take(limit)
                .skip(offset)
                .getManyAndCount();

            await this.decorateRefundRequests(data);
            return { data, total };
        }

        if (fromDate || toDate) {
            if (selectedDateField === "checkIn" || selectedDateField === "checkOut") {
                whereConditions[selectedDateField] = Between(fromDate || "1970-01-01", toDate || "2999-12-31");
            } else {
                const start = fromDate ? new Date(`${fromDate}T00:00:00`) : new Date("1970-01-01T00:00:00");
                const end = toDate ? new Date(`${toDate}T23:59:59`) : new Date("2999-12-31T23:59:59");
                whereConditions[selectedDateField] = Between(start, end);
            }
        }
        
        const where = keyword
        ? selectedKeywordField === "guestName"
            ? { ...whereConditions, guestName: ILike(`%${keyword}%`) }
            : selectedKeywordField === "explaination"
                ? { ...whereConditions, explaination: ILike(`%${keyword}%`) }
                : selectedKeywordField === "notes"
                    ? { ...whereConditions, notes: ILike(`%${keyword}%`) }
                    : selectedKeywordField === "paymentDetails"
                        ? { ...whereConditions, paymentDetails: ILike(`%${keyword}%`) }
                        : [
                            { ...whereConditions, explaination: ILike(`%${keyword}%`) },
                            { ...whereConditions, guestName: ILike(`%${keyword}%`) },
                            { ...whereConditions, notes: ILike(`%${keyword}%`) },
                            { ...whereConditions, paymentDetails: ILike(`%${keyword}%`) },
                        ]
        : whereConditions;

        const [data, total] = await this.refundRequestRepo.findAndCount({
            where,
            order: sortOrder as any,
            take: limit,
            skip: offset,
        });

        await this.decorateRefundRequests(data);
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
          await this.postMitigationRefundUpdate(
            refundRequest,
            description,
            user,
            isStatusChanged ? { oldStatus: previousStatus, newStatus: status } : undefined
          );
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
      if (isStatusChanged) {
        await this.recordRefundRequestSystemUpdate(
          refundRequest,
          `Refund request status changed from ${previousStatus || "blank"} to ${status || "blank"}.`,
          userId,
          {
            oldStatus: previousStatus,
            newStatus: status,
          }
        );
      }
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

        logger.info('Skipping Slack reminder for pending refund requests');

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
        const saved = await this.refundRequestRepo.save(refundRequest);
        await this.recordRefundRequestSystemUpdate(saved, "Refund request deleted.", userId, {
            deletedAt: saved.deletedAt,
        });
        return saved;
    }

}
