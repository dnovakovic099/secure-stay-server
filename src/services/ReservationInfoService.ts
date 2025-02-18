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

export class ReservationInfoService {
  private reservationInfoRepository = appDatabase.getRepository(ReservationInfoEntity);

  private preStayAuditService = new ReservationDetailPreStayAuditService();
  private postStayAuditService = new ReservationDetailPostStayAuditService();
  private upsellOrderService = new UpsellOrderService();
  private hostAwayClient = new HostAwayClient();

  async saveReservationInfo(reservation: Partial<ReservationInfoEntity>) {
    const isExist = await this.reservationInfoRepository.findOne({ where: { id: reservation.id } });
    if (isExist) {
      return await this.updateReservationInfo(reservation.id, reservation);
    }

    const newReservation = this.reservationInfoRepository.create(reservation);
    return await this.reservationInfoRepository.save(newReservation);
  }

  async updateReservationInfo(id: number, updateData: Partial<ReservationInfoEntity>) {
    const reservation = await this.reservationInfoRepository.findOne({ where: { id } });
    if (!reservation) {
      return null;
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
        listingMapId?: string;
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
    listingMapId: string | undefined,
    guestName: string | undefined,
    page: number,
    limit: number 
  ) {


    // 1) Query for today's records
    const qbToday = this.buildBaseQuery(listingMapId, guestName);
    qbToday.andWhere("DATE(reservation.arrivalDate) = :today", { today: todayDateStr });
    qbToday.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
      excludedStatuses: ["cancelled", "pending", "awaitingPayment", "declined", "expired", "inquiry", "inquiryPreapproved", "inquiryDenied", "inquiryTimedout", "inquiryNotPossible"]
    });
    const todaysReservations = await qbToday.getMany();
    // 2) Future records (arrivalDate > today), ascending
    const qbFuture = this.buildBaseQuery(listingMapId, guestName);
    qbFuture.andWhere("DATE(reservation.arrivalDate) > :today", { today: todayDateStr });
    qbFuture.andWhere("reservation.status NOT IN (:...excludedStatuses)", {
      excludedStatuses: ["cancelled", "pending", "awaitingPayment", "declined", "expired", "inquiry", "inquiryPreapproved", "inquiryDenied", "inquiryTimedout", "inquiryNotPossible"]
    });
    qbFuture.orderBy("reservation.arrivalDate", "ASC");
    const futureReservations = await qbFuture.getMany();

    // 3) Past records (arrivalDate < today), descending
    const qbPast = this.buildBaseQuery(listingMapId, guestName);
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
  private async getReservationByDateRange(checkInStartDate: string, checkInEndDate: string, checkOutStartDate: string, checkOutEndDate: string, listingMapId: string | undefined, guestName: string | undefined, page: number, limit: number) {
    const qb = this.buildBaseQuery(listingMapId, guestName);
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
        { gn: `%${guestName.toLowerCase()}%` }
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
      logger.info(`ReservationID: ${reservation.id}`);
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


}
