import { Between, In, LessThanOrEqual, Like, MoreThanOrEqual } from "typeorm";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { appDatabase } from "../utils/database.util";
import { Request } from "express";
import { ReservationDetailPostStayAuditService } from "./ReservationDetailPostStayAuditService";
import { ReservationDetailPreStayAuditService } from "./ReservationDetailPreStayAuditService";
import * as XLSX from 'xlsx';
import { HostAwayClient } from "../client/HostAwayClient";
import logger from "../utils/logger.utils";
import { UpsellOrderService } from "./UpsellOrderService";
import sendEmail from "../utils/sendEmai";
import { ResolutionService } from "./ResolutionService";
import axios from "axios";
import { Listing } from "../entity/Listing";
import { runAsync } from "../utils/asyncUtils";
import { ReservationInfoLog } from "../entity/ReservationInfologs";
import { endOfDay, format, startOfDay } from "date-fns";
import { ListingDetail } from "../entity/ListingDetails";
import { convertLocalHourToUTC, getLast7DaysDate, getPreviousMonthRange, getStartOfThreeMonthsAgo } from "../helpers/date";
import { Resolution } from "../entity/Resolution";
import { Issue } from "../entity/Issue";
import { ActionItems } from "../entity/ActionItems";
import { ListingService } from "./ListingService";
import { IssuesService } from "./IssuesService";
import { ActionItemsService } from "./ActionItemsService";
import { GenericReport } from "../entity/GenericReport";
import { Hostify } from "../client/Hostify";
import { ReservationService } from "./ReservationService";

export class ReservationInfoService {
  private reservationInfoRepository = appDatabase.getRepository(ReservationInfoEntity);
  private listingInfoRepository = appDatabase.getRepository(Listing)
  private reservationInfoLogsRepo = appDatabase.getRepository(ReservationInfoLog);
  private listingDetailRepo = appDatabase.getRepository(ListingDetail);
  private resolutionRepo = appDatabase.getRepository(Resolution);
  private genericReportRepo = appDatabase.getRepository(GenericReport);

  private preStayAuditService = new ReservationDetailPreStayAuditService();
  private postStayAuditService = new ReservationDetailPostStayAuditService();
  private upsellOrderService = new UpsellOrderService();
  private hostAwayClient = new HostAwayClient();
  private hostifyClient = new Hostify();

  private clientId: string = process.env.HOST_AWAY_CLIENT_ID;
  private clientSecret: string = process.env.HOST_AWAY_CLIENT_SECRET;

  private excludedStatus = [
    "cancelled", "pending", "awaitingPayment",
    "declined", "expired", "inquiry",
    "inquiryPreapproved", "inquiryDenied",
    "inquiryTimedout", "inquiryNotPossible",
    "denied", "no_show", "awaiting_payment",
    "declined_inq", "preapproved", "offer",
    "withdrawn", "timedout", "not_possible", "deleted"
  ];

  private validStatus = ["new", "accepted", "modified", "ownerStay", "moved"]

  async saveReservationInfo(reservation: Partial<ReservationInfoEntity>, source: string) {
    let isExist = await this.reservationInfoRepository.findOne({ where: { id: reservation.id } });
    if (!isExist) {
      isExist = await this.reservationInfoRepository.findOne({
        where: {
          guestName: reservation.guestName,
          arrivalDate: reservation.arrivalDate,
          departureDate: reservation.departureDate,
          listingMapId: reservation.listingMapId,
        },
      });
    }

    if (isExist) {
      return await this.updateReservationInfo(isExist.id, reservation, source);
    }

    const validReservationStatuses = this.validStatus;
    const isValidReservationStatus = validReservationStatuses.includes(reservation.status);
    if (isValidReservationStatus && source == "webhook") {
      runAsync(this.notifyMobileUser(reservation), "notifyMobileUser");
    }

    if (reservation.status == "inquiry" && reservation.channelId == 2018 && source == "webhook") {
      setTimeout(() => {
        runAsync(this.notifyNewInquiryReservation(reservation), "notifyNewInquiryReservation");
      }, 5 * 60 * 1000);  //delay the notification by 5 min 
    }

    const lastName = (reservation.guestLastName && reservation.guestLastName.length > 50) ? reservation.guestLastName.slice(0, 50) : reservation.guestLastName;
    const listing = await this.listingInfoRepository.findOne({ where: { id: reservation.listingMapId } });
    const listingName = listing ? listing.internalListingName : "";
    const newReservation = this.reservationInfoRepository.create({ ...reservation, guestLastName: lastName, listingName: listingName });
    logger.info(`[saveReservationInfo] Reservation saved successfully.`);
    logger.info(`[saveReservationInfo] ${reservation.guestName} booked ${reservation.listingMapId} from ${reservation.arrivalDate} to ${reservation.departureDate}`);
    return await this.reservationInfoRepository.save(newReservation);
  }

  async updateReservationInfo(id: number, updateData: Partial<ReservationInfoEntity>, source: string) {
    const reservation = await this.reservationInfoRepository.findOne({ where: { id } });
    if (!reservation) {
      return null;
    }

    const validReservationStatuses = this.validStatus;

    const isCurrentStatusValid = validReservationStatuses.includes(reservation.status);
    const isUpdatedStatusValid = validReservationStatuses.includes(updateData.status);

    if (!isCurrentStatusValid && isUpdatedStatusValid && source == "webhook") {
      // send Notification
      runAsync(this.notifyMobileUser(updateData), "notifyMobileUser");
    }

    if (reservation.status !== "preapproved" && updateData.status == "preapproved" && updateData.channelId == 2018 && source == "webhook") {
      runAsync(this.notifyPreApprovedInquiryReservation(updateData), "notifyPreApprovedInquiryReservation");
    }
    
    const lastName = (reservation.guestLastName && reservation.guestLastName.length > 50) ? reservation.guestLastName.slice(0, 50) : reservation.guestLastName;
    const listing = await this.listingInfoRepository.findOne({ where: { id: updateData.listingMapId } });
    const listingName = listing ? listing.internalListingName : "";

    reservation.listingMapId = updateData.listingMapId;
    reservation.listingName = listingName;
    reservation.channelId = updateData.channelId;
    reservation.source = updateData.source;
    reservation.channelName = updateData.channelName;
    reservation.reservationId = updateData.reservationId;
    reservation.hostawayReservationId = updateData.hostawayReservationId;
    reservation.channelReservationId = updateData.channelReservationId;
    reservation.externalPropertyId = updateData.externalPropertyId;
    reservation.isProcessed = updateData.isProcessed;
    reservation.reservationDate = updateData.reservationDate;
    reservation.guestName = updateData.guestName;
    reservation.guestFirstName = updateData.guestFirstName;
    reservation.guestLastName = lastName;
    reservation.guestExternalAccountId = updateData.guestExternalAccountId;
    reservation.guestZipCode = updateData.guestZipCode;
    reservation.guestAddress = updateData.guestAddress;
    reservation.guestCity = updateData.guestCity;
    reservation.guestCountry = updateData.guestCountry;
    reservation.guestEmail = updateData.guestEmail;
    reservation.guestPicture = updateData.guestPicture;
    reservation.numberOfGuests = updateData.numberOfGuests;
    reservation.adults = updateData.adults;
    reservation.children = updateData.children;
    reservation.infants = updateData.infants;
    reservation.pets = updateData.pets;
    reservation.arrivalDate = updateData.arrivalDate;
    reservation.departureDate = updateData.departureDate;
    reservation.checkInTime = updateData.checkInTime;
    reservation.checkOutTime = updateData.checkOutTime;
    reservation.nights = updateData.nights;
    reservation.phone = updateData.phone;
    reservation.totalPrice = updateData.totalPrice;
    reservation.taxAmount = updateData.taxAmount;
    reservation.channelCommissionAmount = updateData.channelCommissionAmount;
    reservation.hostawayCommissionAmount = updateData.hostawayCommissionAmount;
    reservation.cleaningFee = updateData.cleaningFee;
    reservation.securityDepositFee = updateData.securityDepositFee;
    reservation.isPaid = updateData.isPaid;
    reservation.currency = updateData.currency;
    reservation.status = updateData.status;
    reservation.hostNote = updateData.hostNote;
    reservation.airbnbExpectedPayoutAmount = updateData.airbnbExpectedPayoutAmount;
    reservation.airbnbListingBasePrice = updateData.airbnbListingBasePrice;
    reservation.airbnbListingCancellationHostFee = updateData.airbnbListingCancellationHostFee;
    reservation.airbnbListingCancellationPayout = updateData.airbnbListingCancellationPayout;
    reservation.airbnbListingCleaningFee = updateData.airbnbListingCleaningFee;
    reservation.airbnbListingHostFee = updateData.airbnbListingHostFee;
    reservation.airbnbListingSecurityPrice = updateData.airbnbListingSecurityPrice;
    reservation.airbnbOccupancyTaxAmountPaidToHost = updateData.airbnbOccupancyTaxAmountPaidToHost;
    reservation.airbnbTotalPaidAmount = updateData.airbnbTotalPaidAmount;
    reservation.airbnbTransientOccupancyTaxPaidAmount = updateData.airbnbTransientOccupancyTaxPaidAmount;
    reservation.airbnbCancellationPolicy = updateData.airbnbCancellationPolicy;
    reservation.paymentStatus = updateData.paymentStatus;

    return await this.reservationInfoRepository.save(reservation);
  }

  /**
   * getReservationInfo
   * Implements the 5 main scenarios + filtering (listingMapId, guestName).
   * Also applies the filters to the "today" query in the default scenario.
   */
  public async getReservationInfo(request: any) {
    try {
      // 1. Parse Query Params
      const {
        checkInStartDate: checkInStartDateStr,
        checkInEndDate: checkInEndDateStr,
        checkOutStartDate: checkOutStartDateStr,
        checkOutEndDate: checkOutEndDateStr,
        todayDate: todayDateStr,
        listingMapId,
        guestName,
        page,
        limit,
        currentHour,
        propertyType,
        actionItems,
        issues,
        channel,
        payment,
        keyword,
      } = request.query as {
        checkInStartDate?: string;
        checkInEndDate?: string;
        checkOutStartDate?: string;
        checkOutEndDate?: string;
        todayDate?: string;
          listingMapId?: string[];
        guestName?: string;
        page?: string;
        limit?: string;
          currentHour: string;
          propertyType: any;
          actionItems?: string[];
          issues?: string[],
          channel?: string[],
          payment?: string[],
          keyword?: string,
      };

      // Convert page/limit to numbers with defaults
      const pageNumber = page ? parseInt(page, 10) : 1;
      const pageSize = limit ? parseInt(limit, 10) : 10;

      const userId = request.user.id;

      let listingIds = [];
      if (propertyType && propertyType.length > 0) {
        const listingService = new ListingService();
        listingIds = (await listingService.getListingsByTagIds(propertyType)).map(l => l.id);
      } else {
        listingIds = listingMapId;
      }

      // 2. Determine which case to handle
      if ((checkInStartDateStr && checkInEndDateStr) || (checkOutStartDateStr && checkOutEndDateStr)) {
        return await this.getReservationByDateRange(checkInStartDateStr, checkInEndDateStr, checkOutStartDateStr, checkOutEndDateStr, listingIds, guestName, pageNumber, pageSize, userId, actionItems, issues, channel, payment, keyword);
      }

      if (currentHour) {
        return await this.getCurrentlyStayingReservations(todayDateStr, listingIds, guestName, pageNumber, pageSize, currentHour, userId, actionItems, issues, channel, payment, keyword);
      }

      return await this.getCase1Default(todayDateStr, listingIds, guestName, pageNumber, pageSize, userId, actionItems, issues, channel, payment, keyword);

    } catch (error) {
      console.error("getReservationInfo Error", error);
      return {
        status: "error",
        message: "Error fetching reservations" + error.message
      };
    }
  }

  /**
   * CASE 1: Default (no start/end date).
   */
  private async getCase1Default(
    todayDateStr: string,
    listingMapId: string[] | undefined,
    guestName: string | undefined,
    page: number,
    limit: number,
    userId: string,
    actionItemsStatus: string[] | null | undefined,
    issuesStatus: string[] | null | undefined,
    channel: string[] | null | undefined,
    payment: string[] | null | undefined,
    keyword: string | undefined
  ) {


    // 1) Query for today's records
    const qbToday = this.buildBaseQuery(listingMapId, guestName, channel, payment, keyword);
    if (listingMapId && listingMapId.length > 0) {
      qbToday.andWhere("reservation.listingMapId IN (:...listingMapIds)", { listingMapIds: listingMapId });
    }
    qbToday.andWhere("DATE(reservation.arrivalDate) = :today", { today: todayDateStr });
    qbToday.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
      excludedStatuses: this.excludedStatus
    });
    const todaysReservations = await qbToday.getMany();
    // 2) Future records (arrivalDate > today), ascending
    const qbFuture = this.buildBaseQuery(listingMapId, guestName, channel, payment, keyword);
    if (listingMapId && listingMapId.length > 0) {
      qbFuture.andWhere("reservation.listingMapId IN (:...listingMapIds)", { listingMapIds: listingMapId });
    }
    qbFuture.andWhere("DATE(reservation.arrivalDate) > :today", { today: todayDateStr });
    qbFuture.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
      excludedStatuses: this.excludedStatus
    });
    qbFuture.orderBy("reservation.arrivalDate", "ASC");
    const futureReservations = await qbFuture.getMany();

    // 3) Past records (arrivalDate < today), descending
    const qbPast = this.buildBaseQuery(listingMapId, guestName, channel, payment, keyword);
    if (listingMapId && listingMapId.length > 0) {
      qbPast.andWhere("reservation.listingMapId IN (:...listingMapIds)", { listingMapIds: listingMapId });
    }
    qbPast.andWhere("DATE(reservation.arrivalDate) < :today", { today: todayDateStr });
    qbPast.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
      excludedStatuses: this.excludedStatus
    });
    qbPast.orderBy("reservation.arrivalDate", "DESC");
    const pastReservations = await qbPast.getMany();

    // Merge future + past
    const merged = [...futureReservations, ...pastReservations];

    // Total count for pagination excludes today's
    const totalCount = merged.length;

    // Apply pagination to merged array
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginated = merged.slice(startIndex, endIndex);

    // Final results => today first, then paginated future/past
    let finalResults = [...todaysReservations, ...paginated];

    for (const reservation of finalResults) {
      const preStayStatus = await this.preStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const postStayStatus = await this.postStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const upsells = await this.upsellOrderService.getUpsellsByReservationId(reservation.id);
      const issueServices = new IssuesService();
      const actionItemServices = new ActionItemsService();
      const issues = (await issueServices.getGuestIssues({ page: 1, limit: 50, reservationId: [reservation.id], status: issuesStatus }, userId)).issues;
      const nextReservation = await this.getNextReservation(reservation.id, reservation.listingMapId);
      const nextReservationIssues = nextReservation ? (await issueServices.getGuestIssues({ page: 1, limit: 50, reservationId: [nextReservation.id], status: issuesStatus }, userId)).issues : [];
      const actionItems = (await actionItemServices.getActionItems({ page: 1, limit: 50, reservationId: [reservation.id], status: actionItemsStatus })).actionItems;

      const reservationWithAuditStatus = {
        ...reservation,
        preStayAuditStatus: preStayStatus,
        postStayAuditStatus: postStayStatus == "Completed" ? ([...issues, ...nextReservationIssues].filter(issue => issue.status != "Completed").length > 0 ? "In Progress" : postStayStatus) : postStayStatus,
        upsells: upsells,
        issues,
        nextReservationIssues,
        allIssues: [...issues, ...nextReservationIssues],
        actionItems
      };
      Object.assign(reservation, reservationWithAuditStatus);
    }

    if (actionItemsStatus && actionItemsStatus.length > 0) {
      finalResults = finalResults.filter((r: any) => r.actionItems && r.actionItems.length > 0);
    }

    if (issuesStatus && issuesStatus.length > 0) {
      finalResults = finalResults.filter((r: any) => r.issues && r.issues.length > 0);
    }



    return {
      status: "success",
      result: finalResults,
      count: totalCount, // not counting today's in pagination
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * CASE 2: startDate & endDate provided
   */
  public async getReservationByDateRange(checkInStartDate: string, checkInEndDate: string, checkOutStartDate: string, checkOutEndDate: string, listingMapId: string[] | undefined, guestName: string | undefined, page: number, limit: number, userId: string, actionItemsStatus: string[] | null | undefined, issuesStatus: string[] | null | undefined, channel: string[] | null | undefined, payment: string[] | null | undefined, keyword: string | undefined) {
    const qb = this.buildBaseQuery(listingMapId, guestName, channel, payment, keyword);
    if (listingMapId && listingMapId.length > 0) {
      qb.andWhere("reservation.listingMapId IN (:...listingMapIds)", { listingMapIds: listingMapId });
    }
    if (checkInStartDate && checkInEndDate) {
      qb.andWhere("DATE(reservation.arrivalDate) BETWEEN :start AND :end", {
        start: checkInStartDate,
        end: checkInEndDate
      });

      qb.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
        excludedStatuses: this.excludedStatus
      });

      qb.orderBy("reservation.arrivalDate", "ASC");
    }
    if (checkOutStartDate && checkOutEndDate) {
      qb.andWhere("DATE(reservation.departureDate) BETWEEN :start AND :end", {
        start: checkOutStartDate,
        end: checkOutEndDate
      });

      qb.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
        excludedStatuses: this.excludedStatus
      });

      qb.orderBy("reservation.departureDate", "ASC");
    }
    // Use skip/take for pagination
    let [results, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    for (const reservation of results) {
      const preStayStatus = await this.preStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const postStayStatus = await this.postStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const upsells = await this.upsellOrderService.getUpsellsByReservationId(reservation.id);
      const issueServices = new IssuesService();
      const actionItemServices = new ActionItemsService();
      const issues = (await issueServices.getGuestIssues({ page: 1, limit: 50, reservationId: [reservation.id], status: issuesStatus }, userId)).issues;
      const nextReservation = await this.getNextReservation(reservation.id, reservation.listingMapId);
      const nextReservationIssues = nextReservation ? (await issueServices.getGuestIssues({ page: 1, limit: 50, reservationId: [nextReservation.id], status: issuesStatus }, userId)).issues : [];
      const actionItems = (await actionItemServices.getActionItems({ page: 1, limit: 50, reservationId: [reservation.id], status: actionItemsStatus })).actionItems;

      const reservationWithAuditStatus = {
        ...reservation,
        preStayAuditStatus: preStayStatus,
        postStayAuditStatus: postStayStatus == "Completed" ? ([...issues, ...nextReservationIssues].filter(issue => issue.status != "Completed").length > 0 ? "In Progress" : postStayStatus) : postStayStatus,
        upsells: upsells,
        issues,
        nextReservationIssues,
        allIssues: [...issues, ...nextReservationIssues],
        actionItems
      };
      Object.assign(reservation, reservationWithAuditStatus);
    }

    if (actionItemsStatus && actionItemsStatus.length > 0) {
      results = results.filter((r: any) => r.actionItems && r.actionItems.length > 0);
    }

    if (issuesStatus && issuesStatus.length > 0) {
      results = results.filter((r: any) => r.issues && r.issues.length > 0);
    }


    return {
      status: "success",
      result: results,
      count: total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
 * CASE 2: currentlyStaying
 */
  private async getCurrentlyStayingReservations(
    todayDateStr: string,
    listingMapId: string[] | undefined,
    guestName: string | undefined,
    page: number,
    limit: number,
    currentTime: string,
    userId: string,
    actionItemsStatus: string[] | null | undefined,
    issuesStatus: string[] | null | undefined,
    channel: string[] | null | undefined,
    payment: string[] | null | undefined,
    keyword: string | undefined
  ) {
    // 1) Query for currently staying reservation's records
    const qbCurrentlyStaying = this.buildBaseQuery(listingMapId, guestName, channel, payment, keyword);
    if (listingMapId && listingMapId.length > 0) {
      qbCurrentlyStaying.andWhere("reservation.listingMapId IN (:...listingMapIds)", { listingMapIds: listingMapId });
    }
    qbCurrentlyStaying.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
      excludedStatuses: this.excludedStatus
    });

    // Main condition
    qbCurrentlyStaying.andWhere(" (DATE(reservation.arrivalDate) <= :today AND DATE(reservation.departureDate) >= :today)", { today: todayDateStr });

    // Use skip/take for pagination
    const [results, total] = await qbCurrentlyStaying
      .skip((page - 1) * limit)
      .take(limit)
      .addOrderBy("arrivalDate", "DESC")
      .getManyAndCount();

    const listings = await appDatabase.getRepository(Listing).find();
    const listingTimeZoneMap = new Map(
      listings.map(listing => [listing.id, listing.timeZoneName])
    );

    //transform the checkIn and CheckOut reservations based on time
    const transformedReservation = results.map((reservation) => {
      const timeZone = listingTimeZoneMap.get(reservation.listingMapId);
      if (timeZone) {
        const checkInTimeUTC = convertLocalHourToUTC(reservation.checkInTime, timeZone);
        const checkOutTimeUTC = convertLocalHourToUTC(reservation.checkOutTime, timeZone);
        reservation.checkInTime = checkInTimeUTC;
        reservation.checkOutTime = checkOutTimeUTC;
      }

      return reservation;
    });

    let filteredReservations = transformedReservation.filter(reservation => {
      const arrivalDateStr = format(reservation.arrivalDate, "yyyy-MM-dd");
      const departureDateStr = format(reservation.departureDate, "yyyy-MM-dd");

      const currentTimeNum = Number(currentTime);

      if (arrivalDateStr === todayDateStr) {
        return reservation.checkInTime <= currentTimeNum;
      }

      if (departureDateStr === todayDateStr) {
        return reservation.checkOutTime > currentTimeNum;
      }

      // Middle of stay
      return todayDateStr > arrivalDateStr && todayDateStr < departureDateStr;
    });




    for (const reservation of filteredReservations) {
      const preStayStatus = await this.preStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const postStayStatus = await this.postStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const upsells = await this.upsellOrderService.getUpsellsByReservationId(reservation.id);

      const issueServices = new IssuesService();
      const actionItemServices = new ActionItemsService();
      const issues = (await issueServices.getGuestIssues({ page: 1, limit: 50, reservationId: [reservation.id], status: issuesStatus }, userId)).issues;
      const nextReservation = await this.getNextReservation(reservation.id, reservation.listingMapId);
      const nextReservationIssues = nextReservation ? (await issueServices.getGuestIssues({ page: 1, limit: 50, reservationId: [nextReservation.id], status: issuesStatus }, userId)).issues : [];
      const actionItems = (await actionItemServices.getActionItems({ page: 1, limit: 50, reservationId: [reservation.id], status: actionItemsStatus })).actionItems;
      const reservationWithAuditStatus = {
        ...reservation,
        preStayAuditStatus: preStayStatus,
        postStayAuditStatus: postStayStatus=="Completed" ? ([...issues, ...nextReservationIssues].filter(issue => issue.status != "Completed").length > 0 ? "In Progress" : postStayStatus): postStayStatus,
        upsells: upsells,
        issues,
        nextReservationIssues,
        allIssues: [...issues, ...nextReservationIssues],
        actionItems
      };
      Object.assign(reservation, reservationWithAuditStatus);
    }

    if (actionItemsStatus && actionItemsStatus.length > 0) {
      filteredReservations = filteredReservations.filter((r: any) => r.actionItems && r.actionItems.length > 0);
    }

    if (issuesStatus && issuesStatus.length > 0) {
      filteredReservations = filteredReservations.filter((r: any) => r.issues && r.issues.length > 0);
    }


    return {
      status: "success",
      result: filteredReservations,
      count: total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Builds a QueryBuilder applying listingMapId/guestName filters if provided.
   * This method is used for each scenario (today, future, past, etc.).
   */
  private buildBaseQuery(
    listingMapId?: string[],
    guestName?: string,
    channel?: string[],
    payment?: string[],
    keyword?: string
  ) {
    const qb = this.reservationInfoRepository.createQueryBuilder("reservation");

    // If listingMapId provided, exact match
    if (listingMapId) {
      qb.andWhere("reservation.listingMapId IN (:...listingMapId)", { listingMapId: listingMapId });
    }

    // If guestName provided, match against guestName/firstName/lastName
    if (guestName) {
      qb.andWhere(
        "(LOWER(reservation.guestName) LIKE :gn OR LOWER(reservation.guestFirstName) LIKE :gn OR LOWER(reservation.guestLastName) LIKE :gn)",
        { gn: `%${guestName.trim().toLowerCase()}%` }
      );
    }

    if (channel) {
      qb.andWhere("reservation.channelId IN (:...channel)", { channel });
    }

    if(payment){
      qb.andWhere("reservation.paymentStatus IN (:...payment)", { payment });
    }

    if(keyword){
      qb.andWhere("reservation.guestName LIKE :keyword", { keyword: `%${keyword}%` });
    }

    return qb;
  }

  async exportReservationToExcel(request: Request): Promise<Buffer> {
    const reservations = await this.reservationInfoRepository.find();
    const formattedData = reservations?.map(reservation => ({
      GuestName: reservation.guestName,
      ChannelName: reservation.channelName,
      CheckInDate: reservation.arrivalDate,
      Amount: reservation.totalPrice,
      Status: reservation.status,
      ListingId: reservation.listingMapId
    }));

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const csv = XLSX.utils.sheet_to_csv(worksheet);

    return Buffer.from(csv, 'utf-8');

  }


  async getReservations(fromDate: string, toDate: string, listingId: number, dateType: string, channelId?: number) {
    const searchCondition: any = {
      listingMapId: listingId,
      isProcessedInStatement: false
    };

    switch (dateType) {
      case "arrival":
        searchCondition.arrivalDate = Between(new Date(fromDate), new Date(toDate));
        break;
      case "departure":
        searchCondition.departureDate = Between(new Date(fromDate), new Date(toDate));
        break;
      default:
        searchCondition.arrivalDate = LessThanOrEqual(new Date(toDate));
        searchCondition.departureDate = MoreThanOrEqual(new Date(fromDate));
    }

    if (channelId) {
      searchCondition.channelId = channelId;
    }

    const reservations = await this.reservationInfoRepository.find({
      where: searchCondition,
      order: { arrivalDate: "ASC" },
    });

    const filteredReservations = this.filterValidReservation(reservations, fromDate);
    return filteredReservations;
  }

  private filterValidReservation(reservations: ReservationInfoEntity[], fromDate: string): Object[] {
    const validReservationStatus = this.validStatus;

    const filteredReservations = reservations.filter((reservation) => {
      // Filter by status and exclude reservations ending on the `fromDate`
      return validReservationStatus.includes(reservation.status) && reservation.departureDate !== new Date(fromDate);
    });

    return filteredReservations;
  }


  async syncReservations(start_date: string) {
    // const reservations = await this.hostAwayClient.syncReservations(startingDate);
    const apiKey = process.env.HOSTIFY_API_KEY || "";
    const reservations = await this.hostifyClient.getReservations({ start_date }, apiKey);

    for (const reservation of reservations) {

      const guestInfo = {
        name: reservation?.guest_name || "",
        zip_code: reservation?.zip_code || "",
        address: reservation?.address || "",
        city: reservation?.city || "",
        country: reservation?.country || "",
        email: reservation?.guest_email || "",
        phones: reservation?.guest_phone || "",
        state: reservation?.state || "",

      };
      const reservationObj = await this.createReservationObjectFromHostify(reservation, guestInfo);
      await this.saveReservationInfo(reservationObj, "internal");
    }
    return {
      success: true,
      message: `Reservations synced successfully. No. of reservation: ${reservations.length}`
    };
  }

  async syncCurrentlyStayingReservations() {
    const currentDate = format(new Date(), "yyyy-MM-dd");
    const currentUTCHour = format(new Date(), "HH");
    logger.info(`[syncCurrentlyStayingReservations] Syncing currently staying reservations for date: ${currentDate} and current hour: ${currentUTCHour}`);

    const qb = this.reservationInfoRepository.createQueryBuilder("reservation");
    qb.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
      excludedStatuses: this.excludedStatus
    });
    qb.andWhere(" (DATE(reservation.arrivalDate) <= :today AND DATE(reservation.departureDate) >= :today)", { today: currentDate });
    const [result, total] = await qb.addOrderBy("arrivalDate", "DESC").getManyAndCount();

    const reservationIds = result.map((reservation: ReservationInfoEntity) => reservation.id);
    logger.info(`[syncCurrentlyStayingReservations] Currently staying reservations count: ${result.length}`);
    if (result.length === 0) {
      logger.info(`[syncCurrentlyStayingReservations] No currently staying reservations found.`);
      return;
    }

    const date = getStartOfThreeMonthsAgo();
    const reservations = await this.hostAwayClient.syncReservations(date);
    logger.info(`[syncCurrentlyStayingReservations] Syncing reservations from HostAway...`);
    for (const reservation of reservations) {
      if (reservationIds.includes(reservation.id)) {
        await this.saveReservationInfo(reservation, "internal");
      }
    }
    logger.info(`[syncCurrentlyStayingReservations] Successfully synced currently staying reservations.`);
    return;
  }

  async getReservationById(reservationId: number): Promise<ReservationInfoEntity> {
    return await this.reservationInfoRepository.findOne({ where: { id: reservationId } });
  }

  async updateReservationStatusForStatement(id: number, isProcessedInStatement: boolean) {
    const reservation = await this.reservationInfoRepository.findOne({ where: { id: id } });
    if (!reservation) {
      throw new Error(`Reservation not found with ID: ${id}`);
    }

    reservation.isProcessedInStatement = isProcessedInStatement;
    return await this.reservationInfoRepository.save(reservation);
  }

  async updateReservationRiskStatus(id: number, atRisk: boolean) {
    const reservation = await this.reservationInfoRepository.findOne({ where: { id: id } });
    if (!reservation) {
      throw new Error(`Reservation not found with ID: ${id}`);
    }

    reservation.atRisk = atRisk;
    return await this.reservationInfoRepository.save(reservation);
  }

  private async checkAirbnbClosedResoultionSum(reservation: any) {
    if (!reservation) {
      logger.info('[ReservationInfoService] [checkAirbnbClosedResolutionSum] No reservation object found.')
      return false;
    }

    const financeField = reservation.financeField;
    if (!financeField) {
      logger.info(`[ReservationInfoService] [checkAirbnbClosedResolutionSum] No reservation finance field found for reservation ${reservation?.id}.`)
      return false;
    }

    const isAirbnbClosedResolutionSumExists = financeField.some((data: any) => data.name == "airbnbClosedResolutionsSum");
    logger.info(`[ReservationInfoService] [checkAirbnbClosedResolutionSum]  isAirbnbClosedResolutionSumExists for reservation[${reservation?.id}] is ${isAirbnbClosedResolutionSumExists ? "true" : "false"}`);
    return isAirbnbClosedResolutionSumExists;
  }

  async handleAirbnbClosedResolution(reservation: any) {
    const exists = await this.checkAirbnbClosedResoultionSum(reservation);
    logger.info(`[ReservationInfoService][handleAirbnbClosedResolution] handling AirbnbClosedResolutionSum for reservation: ${reservation?.id}`)
    if (!exists) return;

    //check if the resolution is already present in the db
    const resolutionService = new ResolutionService();
    const existingResolution = await resolutionService.getResolutionByReservationId(reservation.id);
    
    if (existingResolution) {
      logger.info(`[ReservationInfoService] Resolution already exists for reservation ${reservation?.id}, skipping creation.`);
      const airbnbClosedResolutionSumAmount = reservation.financeField.find((data: any) => data.name == "airbnbClosedResolutionsSum")?.value || 0;

      if (existingResolution.amount !== airbnbClosedResolutionSumAmount) {
        logger.info(`[ReservationInfoService] Updating resolution for reservation ${reservation?.id} from $${existingResolution.amount} to $${airbnbClosedResolutionSumAmount}`);
        existingResolution.amount = airbnbClosedResolutionSumAmount;
        await resolutionService.updateResolution(existingResolution, null)
        await this.notifyAboutAirbnbClosedResolutionSum(reservation, true); // notify about update
      }
    } else {
      await this.createResolution(reservation); // actual resolution logic
      logger.info(`[ReservationInfoService] Resolution created for reservation ${reservation?.id}`);
      await this.notifyAboutAirbnbClosedResolutionSum(reservation); // notify
    }
    return;
  }

  private async createResolution(reservation: any) {
    const resolutionObj = this.prepareResolutionObject(reservation);
    if (!resolutionObj) return;
    const resolutionService = new ResolutionService();
    await resolutionService.createResolution(resolutionObj, null);
  }

  private prepareResolutionObject(reservation: any) {
    const financeField = reservation?.financeField;
    if (!financeField) return null;

    const airbnbClosedResolutionSumAmount = financeField.find((data: any) => data.name == "airbnbClosedResolutionsSum")?.value || 0;

    return {
      category: "resolution",
      description: "",
      listingMapId: reservation?.listingMapId,
      reservationId: reservation?.id,
      guestName: reservation.guestName,
      claimDate: reservation.updatedOn,
      amount: airbnbClosedResolutionSumAmount,
      arrivalDate: reservation.arrivalDate,
      departureDate: reservation.departureDate
    };

  }


  async notifyAboutAirbnbClosedResolutionSum(reservation: any, isUpdated: boolean = false) {

    const listingInfo = await this.listingInfoRepository.findOne({ where: { id: reservation.listingMapId } });

    let searchKey = "";
    const channelReservationId = reservation?.channelReservationId;
    const searchKeys = channelReservationId.split('-');
    if (searchKeys && searchKeys.length > 0) {
      searchKey = searchKeys[searchKeys.length - 1];
    }

    let subject = `Airbnb Closed Resolution Sum - ${reservation?.guestName} - ${searchKey}`;
    if(isUpdated){
      subject = `Updated: Airbnb Closed Resolution Sum - ${reservation?.guestName} - ${searchKey}`;
    }
    const html = `
                <html>
                  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); padding: 20px;">
                      <h2 style="color: #007BFF; border-bottom: 2px solid #007BFF; padding-bottom: 10px;">Airbnb Closed Resolution Sum</h2>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Guest Name:</strong> ${reservation?.guestName}
                      </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Check-In:</strong> ${reservation?.arrivalDate}
                      </p>
                                           <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Check-Out:</strong> ${reservation?.departureDate}
                      </p>
                                           <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Listing:</strong> ${listingInfo?.internalListingName}
                      </p>
                                           <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Airbnb Closed Resolution Amount:</strong> ${reservation?.financeField?.find((data: any) => data.name == "airbnbClosedResolutionsSum")?.value}
                      </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Updated On:</strong> ${reservation?.updatedOn}
                      </p>
                      <p style="margin: 30px 0 0; font-size: 14px; color: #777;">Thank you!</p>
                    </div>
                  </body>
                </html>

        `;

    const receipientsList = [
      "ferdinand@luxurylodgingpm.com",
      "receipts@luxurylodgingstr.com"
    ];

    const results = await Promise.allSettled(
      receipientsList.map(receipient =>
        sendEmail(subject, html, process.env.EMAIL_FROM, receipient)
      )
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.error(`Failed to send email to recipient #${index}`, result?.reason);
      }
    });

  }

  async notifyMobileUser(reservation: any) {
    try {
      const url = `${process.env.OWNER_PORTAL_API_BASE_URL}/new-reservation`;
      const listingInfo = await this.listingInfoRepository.findOne({ where: { id: reservation.listingMapId } })
      const body = {
        guestName: reservation?.guestName,
        arrivalDate: reservation?.arrivalDate,
        departureDate: reservation?.departureDate,
        totalPrice: reservation?.totalPrice,
        guestFirstName: reservation?.guestFirstName,
        listingName: listingInfo.externalListingName,
        listingMapId: reservation?.listingMapId,
        id: reservation?.id
      };
      const response = await axios.post(url, body, {
        headers: {
          "x-internal-source": "securestay.ai"
        }
      });
      
      if (response.status !== 200) {
        logger.error(`[notifyMobileUser] Response status: ${response.status}`)
        logger.error('[notifyMobileUser] Failed to send notification to mobile user for new reservation');
      }

      logger.info('[notifyMobileUser] Processed notification to mobile user for new reservation');
      return response.data;
    } catch (error) {
      logger.error(error);
      logger.error('[notifyMobileUser] Failed to send notification to mobile user for new reservation');
      return null;
    }
  }

  async notifyNewInquiryReservation(reservation: any) {
    const listingInfo = await this.listingInfoRepository.findOne({ where: { id: reservation.listingMapId } });
    const ha_reservation_msg_link = `https://dashboard.hostaway.com/v3/messages/inbox/${reservation.id}`;

    const subject = `URGENT! Pre-approve Airbnb Inquiry - ${reservation.id}`;
    const html = `
                <html>
                  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); padding: 20px;">
                      <h2 style="color: #007BFF; border-bottom: 2px solid #007BFF; padding-bottom: 10px;">URGENT! Pre-approve Airbnb Inquiry</h2>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Guest Name:</strong> ${reservation?.guestName}
                      </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Check-In:</strong> ${reservation?.arrivalDate}
                      </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Listing:</strong> ${listingInfo?.internalListingName}
                      </p>
                        <p style="margin: 20px 0; font-size: 16px;">
                        <strong>HA Inquiry Message Link:</strong> ${ha_reservation_msg_link}
                      </p>
                      <p style="margin: 30px 0 0; font-size: 14px; color: #777;">Thank you!</p>
                    </div>
                  </body>
                </html>

        `;

    const receipientsList = [
      "ferdinand@luxurylodgingpm.com",
      "operations@luxurylodgingpm.com"
    ];

    const results = await Promise.allSettled(
      receipientsList.map(receipient =>
        sendEmail(subject, html, process.env.EMAIL_FROM, receipient)
      )
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.error(`Failed to send email to recipient #${index}`, result?.reason);
      }
    });
  }


  async notifyPreApprovedInquiryReservation(reservation: any) {
    const listingInfo = await this.listingInfoRepository.findOne({ where: { id: reservation.listingMapId } });
    const ha_reservation_msg_link = `https://dashboard.hostaway.com/v3/messages/inbox/${reservation.id}`;

    const subject = `URGENT! Pre-approve Airbnb Inquiry - ${reservation.id}`;
    const html = `
                <html>
                  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); padding: 20px;">
                      <h2 style="color: #007BFF; border-bottom: 2px solid #007BFF; padding-bottom: 10px;">Inquiry Pre-approved!</h2>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Guest Name:</strong> ${reservation?.guestName}
                      </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Check-In:</strong> ${reservation?.arrivalDate}
                      </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Listing:</strong> ${listingInfo?.internalListingName}
                      </p>
                        <p style="margin: 20px 0; font-size: 16px;">
                        <strong>HA Inquiry Message Link:</strong> ${ha_reservation_msg_link}
                      </p>
                      <p style="margin: 30px 0 0; font-size: 14px; color: #777;">Thank you!</p>
                    </div>
                  </body>
                </html>

        `;

    const receipientsList = [
      "ferdinand@luxurylodgingpm.com",
      "operations@luxurylodgingpm.com"
    ];

    const results = await Promise.allSettled(
      receipientsList.map(receipient =>
        sendEmail(subject, html, process.env.EMAIL_FROM, receipient)
      )
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.error(`Failed to send email to recipient #${index}`, result?.reason);
      }
    });
  }


  async getExtendedReservations(fromDate: string, toDate: string) {
    const reservationLogs = await this.reservationInfoLogsRepo
      .createQueryBuilder("log")
      .where("log.changedAt BETWEEN :from AND :to", {
        from: `${fromDate} 00:00:00.000000`,
        to: `${toDate} 23:59:59.999999`,
      })
      .andWhere("log.action = :action", { action: 'UPDATE' })
      .andWhere(`
    JSON_CONTAINS_PATH(log.diff, 'one', '$.nights', '$.totalPrice')
  `)
      .orderBy("log.changedAt", "DESC")
      .getMany();

    return reservationLogs;
  }

  async getListingIdsByStatementDurationType(durationType: string): Promise<number[]> {
    const listings = await this.listingDetailRepo.find({
      where: {
        statementDurationType: durationType == "monthly" ? "Monthly" : "Weekly & Bi-weekly"
      }
    });

    if (!listings || listings.length === 0) {
      logger.info(`[getListingIdsByStatementDurationType] No listings found for duration type: ${durationType}`);
      return [];
    }

    return listings.map(listing => listing.listingId);
  }

  async getDateRangeByStatementDurationType(durationType: string): Promise<{ fromDate: string, toDate: string; }> {
    let fromDate = "";
    let toDate = "";

    if (durationType === "weekly") {
      fromDate = getLast7DaysDate(format(new Date(), 'yyyy-MM-dd'));
      toDate = format(new Date(), 'yyyy-MM-dd');
    } else if (durationType === "monthly") {
      const { firstDate, lastDate } = getPreviousMonthRange(format(new Date(), 'yyyy-MM-dd'));
      fromDate = firstDate;
      toDate = lastDate;
    }

    return { fromDate, toDate };
  }

  async processExtendedReservations(duration: string) {
    const listingIds = await this.getListingIdsByStatementDurationType(duration);
    const { fromDate, toDate } = await this.getDateRangeByStatementDurationType(duration);

    if (!listingIds || listingIds.length === 0) {
      logger.info(`[processExtendedReservations] No listings found for duration: ${duration}`);
      return [];
    }

    logger.info(`[processExtendedReservations] Processing extended reservations from ${fromDate} to ${toDate}`);
    const extendedReservations = await this.getExtendedReservations(fromDate, toDate);
    logger.info(`[processExtendedReservations] Found ${extendedReservations.length} extended reservations between ${fromDate} and ${toDate}`);
    if (!extendedReservations || extendedReservations.length === 0) {
      logger.info(`[processExtendedReservations] No extended reservations found between ${fromDate} and ${toDate}`);
      return [];
    }

    const processedReservations = [];
    for (const log of extendedReservations) {
      const oldData = log.oldData;
      const newData = log.newData;
      const listingId = oldData.listingMapId;
      const changedAt = log.changedAt;

      listingIds.includes(listingId) && processedReservations.push({
        reservationId: log.reservationInfoId,
        listingName: oldData.listingName,
        guestName: oldData.guestName,
        oldArrivalDate: format(oldData.arrivalDate, 'MMM dd'),
        oldDepartureDate: format(oldData.departureDate, 'MMM dd'),
        newArrivalDate: format(newData.arrivalDate, 'MMM dd'),
        newDepartureDate: format(newData.departureDate, 'MMM dd'),
        oldTotalPrice: oldData.totalPrice,
        newTotalPrice: newData.totalPrice,
        changedAt: changedAt,
        status: oldData.status
      });
    }

    logger.info(`[processExtendedReservations] Processed ${processedReservations.length} extended reservations.`);
    if (processedReservations.length > 0) {
      const subject = `Updated Reservation Report - ${format(fromDate, 'MMM dd, yyyy')} to ${format(toDate, 'MMM dd, yyyy')}`;
      const filteredReservations = processedReservations.filter(reservation => reservation.status !== "ownerStay");
      await this.sendEmailForExtendedReservations(filteredReservations, subject);
    } else {
      logger.info(`[processExtendedReservations] No processed reservations to send email.`);
    }
  }

  async sendEmailForExtendedReservations(processedReservations: {
    listingName: string;
    guestName: string;
    oldArrivalDate: string;
    oldDepartureDate: string;
    newArrivalDate: string;
    newDepartureDate: string;
    oldTotalPrice: number;
    newTotalPrice: number;
    changedAt: Date;
    reservationId: number;
  }[], subject: string) {

    // Generate table rows dynamically
    const rowsHtml = processedReservations.map(reservation => {
      return `
      <tr style="background-color: #fff; border-bottom: 1px solid #ddd;">
        <td style="padding: 12px 16px; vertical-align: middle;"><a href="https://dashboard.hostaway.com/reservations/${reservation.reservationId}"  target="_blank" style="color: #007bff; text-decoration: none;">${reservation.guestName}</a></td>
        <td style="padding: 12px 16px; vertical-align: middle;">${reservation.listingName}</td>

        <td style="padding: 12px 16px; vertical-align: middle; font-size: 14px; color: #444;">
          <span style="color: #999;">${reservation.oldArrivalDate}</span> &nbsp;➟&nbsp; <span style="font-weight: 600; color: #2a71d0;">${reservation.newArrivalDate}</span>
        </td>

        <td style="padding: 12px 16px; vertical-align: middle; font-size: 14px; color: #444;">
          <span style="color: #999;">${reservation.oldDepartureDate}</span> &nbsp;➟&nbsp; <span style="font-weight: 600; color: #2a71d0;">${reservation.newDepartureDate}</span>
        </td>

        <td style="padding: 12px 16px; vertical-align: middle; font-size: 14px; color: #444;">
          <span style="color: #999;">$${reservation.oldTotalPrice}</span> &nbsp;➟&nbsp; <span style="font-weight: 600; color: #2a71d0;">$${reservation.newTotalPrice.toFixed(2)}</span>
        </td>
      </tr>
    `;
    }).join("");

    const html = `
                   <!DOCTYPE html>
                   <html>
                   <head>
                   <title>Extended Reservation Report</title>
                   </head>
                   <body>
                   
                   <table
                     role="table"
                     width="100%"
                     cellspacing="0"
                     cellpadding="8"
                     border="0"
                     style="border-collapse: collapse; font-family: Arial, sans-serif; color: #333;"
                   >
                     <thead>
                       <tr style="background-color: #2a71d0; color: #fff; font-weight: bold; text-align: left;">
                         <th style="padding: 12px 16px; border-bottom: 3px solid #1c4fa0;">Guest Name</th>
                         <th style="padding: 12px 16px; border-bottom: 3px solid #1c4fa0;">Listing</th>
                         <th style="padding: 12px 16px; border-bottom: 3px solid #1c4fa0;">Check-in Date</th>
                         <th style="padding: 12px 16px; border-bottom: 3px solid #1c4fa0;">Check-out Date</th>
                         <th style="padding: 12px 16px; border-bottom: 3px solid #1c4fa0;">Total Paid Amount</th>
                       </tr>
                     </thead>
                     <tbody>
                       ${rowsHtml}
                     </tbody>
                   </table>
                   
                   </body>
                   </html>
                 `;

    const receipientsList = [
      "ferdinand@luxurylodgingpm.com",
      "admin@luxurylodgingpm.com",
    ];

    const results = await Promise.allSettled(
      receipientsList.map(receipient =>
        sendEmail(subject, html, process.env.EMAIL_FROM, receipient)
      )
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.error(`Failed to send email to recipient #${index}`, result?.reason);
      }
    });
  }


  async getReservationInfoByGuestName(guestName: string) {
    if (!guestName) {
      return null;
    }
    const reservationInfo = await this.reservationInfoRepository.findOne({ where: { guestName } });
    return reservationInfo;
  }

  async syncReservationById(reservationId: number) {
    const reservation = await this.hostAwayClient.getReservation(reservationId);
    if (!reservation) {
      throw new Error(`Reservation not found with ID: ${reservationId}`);
    }
    return await this.saveReservationInfo(reservation, "internal");
  }

  async getReservationGenericReport(body: {
    year: string,
    month: string;
  }) {
    const { year, month } = body;
    const reportType = "reservationStatusReport";

    logger.info(`
      ReportType: ${reportType}
      Year: ${year},
      Month: ${month ? month : "-"}
      `);

    let result = [];
    result = await this.genericReportRepo.find({
      where: {
        reportType: reportType,
        year: year,
        ...(month && { month: month })
      },
    });


    if (!result || result.length === 0) {
      logger.info(`Data does not exists in database.`);
      logger.info(`Fetching reservation data from Hostaway and processing it`);
      await this.generateReservationStatusReportFromHA(year);
    } 

    return await this.getReportData(reportType, year, month);
  }

  async getReportData(reportType: string, year: string, month: string | null) {
    const qb = this.genericReportRepo
      .createQueryBuilder("gr")
      .select("gr.dimension2", "status") // dimension2 holds the status value
      .addSelect("SUM(gr.value)", "count") // value holds the count for each record
      .where("gr.reportType = :reportType", { reportType })
      .andWhere("gr.year = :year", { year })

    // Only apply month filter if provided
    if (month) {
      qb.andWhere("gr.month = :month", { month });
    }

    qb.groupBy("gr.dimension2")
      .orderBy(`
      CASE
        WHEN gr.dimension2 = 'new' THEN 1
        WHEN gr.dimension2 = 'modified' THEN 2
        WHEN gr.dimension2 = 'ownerStay' THEN 3
        ELSE 4
      END
    `)
      .addOrderBy("gr.dimension2", "ASC"); // secondary order for the rest

    const data = await qb.getRawMany();

    return data.map(r => ({
      status: r.status,
      count: Number(r.count)
    }));
  }

  async generateReservationStatusReportFromHA(year: string) {
    let result = [];

    //fetch reservationInfo from hostaway and generate the report
    const clientId = this.clientId;
    const clientSecret = this.clientSecret;
    if (!clientId || !clientSecret) {
      logger.info(`Credentials for hostaway not found`);
      throw new Error("Hostaway client ID and secret are not configured.");
    }

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    let limit = 500;
    let offset = 0;
    let hasMoreData = true;

    logger.info(`Fetching reservation data from Hostaway. This might take a while to process`);
    while (hasMoreData) {
      const reservations = await this.hostAwayClient.getReservations(clientId, clientSecret, "", "arrival", startDate, endDate, limit, offset, "");
      if (!reservations || reservations.length === 0) {
        hasMoreData = false; // No more data to process
        break;
      }

      result = result.concat(reservations);

      // Check if there is more data
      if (reservations.length < limit) {
        hasMoreData = false; // No more data if the last page contains less than `limit`
      } else {
        offset += limit; // Update offset for the next page
      }
    }
    logger.info(`Reservation data fetched from hostaway`);
    //process the reservations for each month and save the data
    await this.processReservationStatusReport(result, year);
  }

  async processReservationStatusReport(reservations: any[], year: string) {
    const reportType = "reservationStatusReport";
    const statuses = [
      "new",
      "modified",
      "cancelled",
      "ownerStay",
      "pending",
      "awaitingPayment",
      "declined",
      "expired",
      "inquiry",
      "inquiryPreapproved",
      "inquiryDenied",
      "inquiryTimedout",
      "inquiryNotPossible",
      "accepted",
      "no_show",
      "awaiting_payment",
      "moved",
      "extended",
      "edited",
      "retracted",
      "declined_inq",
      "preapproved",
      "offer",
      "withdrawn",
      "timedout",
      "not_possible",
      "deleted"
    ];
    const dimension1 = "status";

    const reportsToSave = [];

    logger.info(`Processing the reservation data based on month, year, status and listingId`);

    // Loop through each month (1 to 12)
    for (let month = 1; month <= 12; month++) {
      const monthStr = month.toString().padStart(2, "0");

      // Filter reservations for this month
      const monthReservations = reservations.filter(res => {
        const arrivalDate = new Date(res.arrivalDate);
        return arrivalDate.getFullYear() === Number(year) && (arrivalDate.getMonth() + 1) == month;
      });

      // Group by listingId
      const listings = [...new Set(monthReservations.map(r => r.listingMapId))];

      for (const listingId of listings) {
        const listingReservations = monthReservations.filter(r => r.listingMapId === listingId);

        // Count per status
        for (const status of statuses) {
          const statusCount = listingReservations.filter(r => r.status === status).length;
          reportsToSave.push({
            reportType,
            listingId,
            year: year.toString(),
            month: monthStr,
            dimension1,        // grouping dimension
            dimension2: status, // actual status value
            value: statusCount,
            createdBy: "system",
            updatedBy: "system"
          });
        }

      }
    }

    logger.info(`Completed processing the reservation data based on month, year, status and listingId`);

    if (reportsToSave.length > 0) {
      await this.genericReportRepo.save(reportsToSave);
      logger.info(`Report Data saved successfully`);
    }
    return;
  }

  async refreshCurrentYearReservationStatusReport() {
    const currentYear = new Date().getFullYear().toString();
    const reportType = "reservationStatusReport";

    logger.info(`Refreshing reservation status report for year: ${currentYear}`);

    // Step 1: Delete existing data for this year
    logger.info(`Deleting existing ${reportType} data for year ${currentYear}...`);
    await this.genericReportRepo
      .createQueryBuilder()
      .delete()
      .where("reportType = :reportType", { reportType })
      .andWhere("year = :year", { year: currentYear })
      .execute();
    logger.info(`Old report data deleted.`);

    // Step 2: Generate fresh report from Hostaway
    logger.info(`Fetching updated data from Hostaway for ${currentYear}...`);
    await this.generateReservationStatusReportFromHA(currentYear);

    logger.info(`Reservation status report for ${currentYear} refreshed successfully.`);
  }

  async getNextReservation(id: number, listingMapId: number) {
    const reservation = await this.reservationInfoRepository.findOne({ where: { id, listingMapId } });
    if (!reservation) {
      throw new Error(`Reservation not found with ID: ${id} and ListingMapId: ${listingMapId}`);
    }

    const nextReservation = await this.reservationInfoRepository.createQueryBuilder("reservation")
      .where("reservation.listingMapId = :listingMapId", { listingMapId })
      .andWhere("reservation.arrivalDate > :arrivalDate", { arrivalDate: reservation.arrivalDate })
      .orderBy("reservation.arrivalDate", "ASC")
      .getOne();

    return nextReservation;
  }

  async deleteReservationLogsOlderThanlastMonth() {
    const now = new Date();
    const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const firstDayString = firstDayOfLastMonth.toISOString().split("T")[0];

    logger.info(`[deleteReservationLogsOlderThanlastMonth] Deleting reservation logs older than ${firstDayString}`);
    const deleteResult = await this.reservationInfoLogsRepo.createQueryBuilder()
      .delete()
      .where("changedAt < :lastMonthDate", { lastMonthDate: firstDayString })
      .execute();

    logger.info(`[deleteReservationLogsOlderThanlastMonth] Deleted ${deleteResult.affected} reservation logs older than ${firstDayString}`);
    return deleteResult;
  }

  async getCheckoutReservations() {
    const today = format(new Date(), 'yyyy-MM-dd');
    const [reservations, total] = await this.reservationInfoRepository.findAndCount({
      where: {
        departureDate: Between(startOfDay(today), endOfDay(today)),
        status: In(this.validStatus),
        // channelId: In([2018, 2013, 2010, 2000, 2002]), // VRBO, Airbnb, Hostaway bookings
      },
      relations: ["reviewCheckout"],
      order: { departureDate: "ASC" },
    });

    return { reservations, total };
  }


  async handleHostifyReservationEvent(event: any, reservationId: number) {
    if (!reservationId) {
      logger.info(`[handleHostifyReservationEvent] No reservationId found in the event payload.`);
      return;
    }

    logger.info(`[handleHostifyReservationEvent] Processing Hostify reservation event for reservationId: ${reservationId}`);

    const apiKey = process.env.HOSTIFY_API_KEY || "";
    const hostifyReservationObj = await this.hostifyClient.getReservationInfo(apiKey, reservationId);
    if (!hostifyReservationObj) {
      logger.info(`[handleHostifyReservationEvent] No reservation info found for reservationId: ${reservationId}`);
      return;
    }

    const reservationInfo = hostifyReservationObj.reservation;
    const guestInfo = hostifyReservationObj.guest;
    const reservationObj = await this.createReservationObjectFromHostify(reservationInfo, guestInfo);
    await this.saveReservationInfo(reservationObj, "webhook");
  }

  async createReservationObjectFromHostify(reservation: any, guest: any) {
    const reservationService = new ReservationService();
    const channelList = await reservationService.getChannelList();
    const channel = channelList.find(c => c.channelName?.toLowerCase() == reservation?.source?.toLowerCase());

    return {
      id: reservation.id,
      listingMapId: reservation.listing_id,
      channelId: channel ? channel.channelId : null,
      source: reservation.source,
      channelName: channel ? channel.channelName : reservation.source,
      reservationId: null,
      hostawayReservationId: null,
      channelReservationId: reservation.channel_reservation_id,
      externalPropertyId: reservation.channel_listing_id,
      isProcessed: null,
      reservationDate: reservation.created_at,
      guestName: guest.name?.length > 100
        ? guest.name.substring(0, 100)
        : guest.name,
      guestFirstName: guest.name ? guest.name.split(' ')[0] : '',
      guestLastName: guest.name ? guest.name.split(' ').slice(1).join(' ') : '',
      guestExternalAccountId: null,
      guestZipCode: guest.zip_code,
      guestAddress: guest.address,
      guestCity: guest.city,
      guestCountry: guest.country,
      guestEmail: guest.email,
      numberOfGuests: reservation.guests,
      adults: reservation.adults,
      children: reservation.children,
      infants: reservation.infants,
      pets: reservation.pets,
      arrivalDate: reservation.checkIn,
      departureDate: reservation.checkOut,
      checkInTime: null,
      checkOutTime: null,
      nights: reservation.nights,
      //guest.phones can be either string or array of phones so handle both case
      phone: Array.isArray(guest.phones) ? guest.phones.join(', ') : guest.phones,
      totalPrice: reservation.subtotal + reservation.tax_amount, //subtotal + tax_amount gives the totalPrice
      taxAmount: reservation.tax_amount,
      channelCommissionAmount: reservation.channel_commission,
      hostawayCommissionAmount: null,
      cleaningFee: reservation.cleaning_fee,
      securityDepositFee: null,
      isPaid: null,
      currency: reservation.currency,
      status: reservation.status,
      hostNote: null,
      airbnbExpectedPayoutAmount: null,
      airbnbListingBasePrice: null,
      airbnbListingCancellationHostFee: null,
      airbnbListingCancellationPayout: null,
      airbnbListingCleaningFee: null,
      airbnbListingHostFee: null,
      airbnbListingSecurityPrice: null,
      airbnbOccupancyTaxAmountPaidToHost: null,
      airbnbTotalPaidAmount: null,
      airbnbTransientOccupancyTaxPaidAmount: null,
      airbnbCancellationPolicy: null,
      paymentStatus: null,
    };
  }


}
