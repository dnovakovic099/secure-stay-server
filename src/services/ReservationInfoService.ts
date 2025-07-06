import { Between, LessThanOrEqual, MoreThanOrEqual } from "typeorm";
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
import { format } from "date-fns";
import { ListingDetail } from "../entity/ListingDetails";
import { getLast7DaysDate, getPreviousMonthRange } from "../helpers/date";
import { Resolution } from "../entity/Resolution";

export class ReservationInfoService {
  private reservationInfoRepository = appDatabase.getRepository(ReservationInfoEntity);
  private listingInfoRepository = appDatabase.getRepository(Listing)
  private reservationInfoLogsRepo = appDatabase.getRepository(ReservationInfoLog);
  private listingDetailRepo = appDatabase.getRepository(ListingDetail);
  private resolutionRepo = appDatabase.getRepository(Resolution);

  private preStayAuditService = new ReservationDetailPreStayAuditService();
  private postStayAuditService = new ReservationDetailPostStayAuditService();
  private upsellOrderService = new UpsellOrderService();
  private hostAwayClient = new HostAwayClient();

  async saveReservationInfo(reservation: Partial<ReservationInfoEntity>) {
    const isExist = await this.reservationInfoRepository.findOne({ where: { id: reservation.id } });
    if (isExist) {
      return await this.updateReservationInfo(reservation.id, reservation);
    }

    const validReservationStatuses = ["new", "modified", "ownerStay"];
    const isValidReservationStatus = validReservationStatuses.includes(reservation.status);
    if (isValidReservationStatus) {
      runAsync(this.notifyMobileUser(reservation), "notifyMobileUser");
    }

    if (reservation.status == "inquiry" && reservation.channelId == 2018) {
      setTimeout(() => {
        runAsync(this.notifyNewInquiryReservation(reservation), "notifyNewInquiryReservation");
      }, 5 * 60 * 1000);  //delay the notification by 5 min 
    }

    const newReservation = this.reservationInfoRepository.create(reservation);
    logger.info(`[saveReservationInfo] Reservation saved successfully.`);
    logger.info(`[saveReservationInfo] ${reservation.guestName} booked ${reservation.listingMapId} from ${reservation.arrivalDate} to ${reservation.departureDate}`);
    return await this.reservationInfoRepository.save(newReservation);
  }

  async updateReservationInfo(id: number, updateData: Partial<ReservationInfoEntity>) {
    const reservation = await this.reservationInfoRepository.findOne({ where: { id } });
    if (!reservation) {
      return null;
    }

    const validReservationStatuses = ["new", "modified", "ownerStay"];

    const isCurrentStatusValid = validReservationStatuses.includes(reservation.status);
    const isUpdatedStatusValid = validReservationStatuses.includes(updateData.status);

    if (!isCurrentStatusValid && isUpdatedStatusValid) {
      // send Notification
      runAsync(this.notifyMobileUser(updateData), "notifyMobileUser");
    }

    if (reservation.status !== "inquiryPreapproved" && updateData.status == "inquiryPreapproved" && updateData.channelId == 2018) {
      runAsync(this.notifyPreApprovedInquiryReservation(updateData), "notifyPreApprovedInquiryReservation");
    }

    reservation.listingMapId = updateData.listingMapId;
    reservation.listingName = updateData.listingName;
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
    reservation.guestLastName = updateData.guestLastName;
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
  public async getReservationInfo(request: Request) {
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
        limit
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
      };

      // Convert page/limit to numbers with defaults
      const pageNumber = page ? parseInt(page, 10) : 1;
      const pageSize = limit ? parseInt(limit, 10) : 10;
      // 2. Determine which case to handle
      if ((checkInStartDateStr && checkInEndDateStr) || (checkOutStartDateStr && checkOutEndDateStr)) {
        return await this.getReservationByDateRange(checkInStartDateStr, checkInEndDateStr, checkOutStartDateStr, checkOutEndDateStr, listingMapId, guestName, pageNumber, pageSize);
      }
      return await this.getCase1Default(todayDateStr, listingMapId, guestName, pageNumber, pageSize);

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
    limit: number
  ) {


    // 1) Query for today's records
    const qbToday = this.buildBaseQuery(guestName);
    if (listingMapId && listingMapId.length > 0) {
      qbToday.andWhere("reservation.listingMapId IN (:...listingMapIds)", { listingMapIds: listingMapId });
    }
    qbToday.andWhere("DATE(reservation.arrivalDate) = :today", { today: todayDateStr });
    qbToday.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
      excludedStatuses: ["cancelled", "pending", "awaitingPayment", "declined", "expired", "inquiry", "inquiryPreapproved", "inquiryDenied", "inquiryTimedout", "inquiryNotPossible"]
    });
    const todaysReservations = await qbToday.getMany();
    // 2) Future records (arrivalDate > today), ascending
    const qbFuture = this.buildBaseQuery(guestName);
    if (listingMapId && listingMapId.length > 0) {
      qbFuture.andWhere("reservation.listingMapId IN (:...listingMapIds)", { listingMapIds: listingMapId });
    }
    qbFuture.andWhere("DATE(reservation.arrivalDate) > :today", { today: todayDateStr });
    qbFuture.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
      excludedStatuses: ["cancelled", "pending", "awaitingPayment", "declined", "expired", "inquiry", "inquiryPreapproved", "inquiryDenied", "inquiryTimedout", "inquiryNotPossible"]
    });
    qbFuture.orderBy("reservation.arrivalDate", "ASC");
    const futureReservations = await qbFuture.getMany();

    // 3) Past records (arrivalDate < today), descending
    const qbPast = this.buildBaseQuery(guestName);
    if (listingMapId && listingMapId.length > 0) {
      qbPast.andWhere("reservation.listingMapId IN (:...listingMapIds)", { listingMapIds: listingMapId });
    }
    qbPast.andWhere("DATE(reservation.arrivalDate) < :today", { today: todayDateStr });
    qbPast.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
      excludedStatuses: ["cancelled", "pending", "awaitingPayment", "declined", "expired", "inquiry", "inquiryPreapproved", "inquiryDenied", "inquiryTimedout", "inquiryNotPossible"]
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
    const finalResults = [...todaysReservations, ...paginated];

    for (const reservation of finalResults) {
      const preStayStatus = await this.preStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const postStayStatus = await this.postStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const upsells = await this.upsellOrderService.getUpsellsByReservationId(reservation.id);
      const reservationWithAuditStatus = {
        ...reservation,
        preStayAuditStatus: preStayStatus,
        postStayAuditStatus: postStayStatus,
        upsells: upsells
      };
      Object.assign(reservation, reservationWithAuditStatus);
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
  private async getReservationByDateRange(checkInStartDate: string, checkInEndDate: string, checkOutStartDate: string, checkOutEndDate: string, listingMapId: string[] | undefined, guestName: string | undefined, page: number, limit: number) {
    const qb = this.buildBaseQuery(guestName);
    if (listingMapId && listingMapId.length > 0) {
      qb.andWhere("reservation.listingMapId IN (:...listingMapIds)", { listingMapIds: listingMapId });
    }
    if (checkInStartDate && checkInEndDate) {
      qb.andWhere("DATE(reservation.arrivalDate) BETWEEN :start AND :end", {
        start: checkInStartDate,
        end: checkInEndDate
      });

      qb.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
        excludedStatuses: ["cancelled", "pending", "awaitingPayment", "declined", "expired", "inquiry", "inquiryPreapproved", "inquiryDenied", "inquiryTimedout", "inquiryNotPossible"]
      });

      qb.orderBy("reservation.arrivalDate", "ASC");
    }
    if (checkOutStartDate && checkOutEndDate) {
      qb.andWhere("DATE(reservation.departureDate) BETWEEN :start AND :end", {
        start: checkOutStartDate,
        end: checkOutEndDate
      });

      qb.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
        excludedStatuses: ["cancelled", "pending", "awaitingPayment", "declined", "expired", "inquiry", "inquiryPreapproved", "inquiryDenied", "inquiryTimedout", "inquiryNotPossible"]
      });

      qb.orderBy("reservation.departureDate", "ASC");
    }
    // Use skip/take for pagination
    const [results, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    for (const reservation of results) {
      const preStayStatus = await this.preStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const postStayStatus = await this.postStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const upsells = await this.upsellOrderService.getUpsellsByReservationId(reservation.id);
      const reservationWithAuditStatus = {
        ...reservation,
        preStayAuditStatus: preStayStatus,
        postStayAuditStatus: postStayStatus,
        upsells: upsells
      };
      Object.assign(reservation, reservationWithAuditStatus);
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
   * Builds a QueryBuilder applying listingMapId/guestName filters if provided.
   * This method is used for each scenario (today, future, past, etc.).
   */
  private buildBaseQuery(
    listingMapId?: string,
    guestName?: string
  ) {
    const qb = this.reservationInfoRepository.createQueryBuilder("reservation");

    // If listingMapId provided, exact match
    if (listingMapId) {
      qb.andWhere("reservation.listingMapId = :listingMapId", { listingMapId: +listingMapId });
    }

    // If guestName provided, match against guestName/firstName/lastName
    if (guestName) {
      qb.andWhere(
        "(LOWER(reservation.guestName) LIKE :gn OR LOWER(reservation.guestFirstName) LIKE :gn OR LOWER(reservation.guestLastName) LIKE :gn)",
        { gn: `%${guestName.trim().toLowerCase()}%` }
      );
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
    const validReservationStatus = ["new", "modified", "ownerStay"];

    const filteredReservations = reservations.filter((reservation) => {
      // Filter by status and exclude reservations ending on the `fromDate`
      return validReservationStatus.includes(reservation.status) && reservation.departureDate !== new Date(fromDate);
    });

    return filteredReservations;
  }


  async syncReservations(startingDate: string) {
    const reservations = await this.hostAwayClient.syncReservations(startingDate);
    for (const reservation of reservations) {
      // logger.info(`ReservationID: ${reservation.id}`);
      await this.saveReservationInfo(reservation);
    }
    return {
      success: true,
      message: `Reservations synced successfully. No. of reservation: ${reservations.length}`
    };
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
        await this.resolutionRepo.save(existingResolution);
        await this.notifyAboutAirbnbClosedResolutionSum(reservation, true); // notify about update
      }
      return;
    } else {
      await this.createResolution(reservation); // actual resolution logic
      logger.info(`[ReservationInfoService] Resolution created for reservation ${reservation?.id}`);
      await this.notifyAboutAirbnbClosedResolutionSum(reservation); // notify
    }
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
    JSON_CONTAINS_PATH(log.diff, 'one', '$.nights')
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
      const subject = `Extended Reservation Report - ${format(fromDate, 'MMM dd, yyyy')} to ${format(toDate, 'MMM dd, yyyy')}`;
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



}
