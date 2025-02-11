import { Between, LessThanOrEqual, MoreThanOrEqual } from "typeorm";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { appDatabase } from "../utils/database.util";
import { Request } from "express";
import { ReservationDetailPostStayAuditService } from "./ReservationDetailPostStayAuditService";
import { ReservationDetailPreStayAuditService } from "./ReservationDetailPreStayAuditService";
import * as XLSX from 'xlsx';
import { HostAwayClient } from "../client/HostAwayClient";
import logger from "../utils/logger.utils";

export class ReservationInfoService {
  private reservationInfoRepository = appDatabase.getRepository(ReservationInfoEntity);

  private preStayAuditService = new ReservationDetailPreStayAuditService();
  private postStayAuditService = new ReservationDetailPostStayAuditService();
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
        arrivalStartDate: arrivalStartDateStr,
        arrivalEndDate: arrivalEndDateStr,
        listingMapId,
        guestName,
        page,
        limit
      } = request.query as {
        arrivalStartDate?: string;
        arrivalEndDate?: string;
        listingMapId?: string;
        guestName?: string;
        page?: string;
        limit?: string;
      };

      // Convert page/limit to numbers with defaults
      const pageNumber = page ? parseInt(page, 10) : 1;
      const pageSize = limit ? parseInt(limit, 10) : 10;

      // Convert start/end dates to Date objects (if provided)
      let arrivalStartDate: Date | undefined;
      let arrivalEndDate: Date | undefined;

      // check also if it is a valid date
      if (arrivalStartDateStr && !isNaN(new Date(arrivalStartDateStr).getTime())) {
        arrivalStartDate = new Date(arrivalStartDateStr);
      }
      if (arrivalEndDateStr && !isNaN(new Date(arrivalEndDateStr).getTime())) {
        arrivalEndDate = new Date(arrivalEndDateStr);
      }

      // 2. Determine which case to handle
      // CASE 2: startDate AND endDate
      if (arrivalStartDate && arrivalEndDate) {
        return await this.getCase2(arrivalStartDate, arrivalEndDate, listingMapId, guestName, pageNumber, pageSize);
      }
      // CASE 4: Only startDate
      if (arrivalStartDate && !arrivalEndDate) {
        return await this.getCase4(arrivalStartDate, listingMapId, guestName, pageNumber, pageSize);
      }
      // CASE 3: Only endDate
      if (!arrivalStartDate && arrivalEndDate) {
        return await this.getCase3(arrivalEndDate, listingMapId, guestName, pageNumber, pageSize);
      }
      // CASE 1 (and 5 with filters): No start/end date
      return await this.getCase1Default(listingMapId, guestName, pageNumber, pageSize);

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
   *  - Today's records (arrivalDate = today) at the top, excluded from pagination
   *  - Future (arrivalDate > today) ascending
   *  - Past (arrivalDate < today) descending
   *  - Merge future + past, apply offset/limit, then prepend today's records
   *  - listingMapId & guestName filters are applied in *all* queries, including today's.
   */
  private async getCase1Default(
    listingMapId: string | undefined,
    guestName: string | undefined,
    page: number,
    limit: number
  ) {
    // "Today" boundaries in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    
    // 1) Query for today's records
    const qbToday = this.buildBaseQuery(listingMapId, guestName);
    qbToday.andWhere("DATE(reservation.arrivalDate) = :today", { today });
    const todaysReservations = await qbToday.getMany();

    // 2) Future records (arrivalDate > today), ascending
    const qbFuture = this.buildBaseQuery(listingMapId, guestName);
    qbFuture.andWhere("DATE(reservation.arrivalDate) > :today", { today });
    qbFuture.orderBy("reservation.arrivalDate", "ASC");
    const futureReservations = await qbFuture.getMany();

    // 3) Past records (arrivalDate < today), descending
    const qbPast = this.buildBaseQuery(listingMapId, guestName);
    qbPast.andWhere("DATE(reservation.arrivalDate) < :today", { today });
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
      const reservationWithAuditStatus = {
        ...reservation,
        preStayAuditStatus: preStayStatus,
        postStayAuditStatus: postStayStatus
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
   *  - Fetch reservations where arrivalDate matches startDate and departureDate matches endDate
   *  - Sort ascending by arrivalDate
   *  - Apply normal pagination
   */
  private async getCase2(
    startDate: Date,
    endDate: Date,
    listingMapId: string | undefined,
    guestName: string | undefined,
    page: number,
    limit: number
  ) {
    const qb = this.buildBaseQuery(listingMapId, guestName);

    const formattedStartDate = startDate.toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];

    qb.andWhere("DATE(reservation.arrivalDate) = :start", { start: formattedStartDate });
    qb.andWhere("DATE(reservation.departureDate) = :end", { end: formattedEndDate });
    qb.orderBy("reservation.arrivalDate", "ASC");

    // Use skip/take for pagination
    const [results, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    for (const reservation of results) {
      const preStayStatus = await this.preStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const postStayStatus = await this.postStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const reservationWithAuditStatus = {
        ...reservation,
        preStayAuditStatus: preStayStatus,
        postStayAuditStatus: postStayStatus
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
   * CASE 3: Only endDate
   *  - Today: arrivalDate = today && departureDate = endDate
   *  - Future: arrivalDate > today && departureDate = endDate, ascending
   *  - Past: arrivalDate < today && departureDate = endDate, descending
   *  - Merge and then apply offset/limit
   */
  private async getCase3(
    endDate: Date,
    listingMapId: string | undefined,
    guestName: string | undefined,
    page: number,
    limit: number
  ) {
    const today = new Date().toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];

    // 1) Query for today's records
    const qbToday = this.buildBaseQuery(listingMapId, guestName);
    qbToday.andWhere("DATE(reservation.arrivalDate) = :today", { today });
    qbToday.andWhere("DATE(reservation.departureDate) = :endDate", { endDate: formattedEndDate });
    const todaysReservations = await qbToday.getMany();

    // 2) Future reservations: arrival > today & departureDate = endDate
    const qbFuture = this.buildBaseQuery(listingMapId, guestName);
    qbFuture.andWhere("DATE(reservation.arrivalDate) > :today", { today });
    qbFuture.andWhere("DATE(reservation.departureDate) = :endDate", { endDate: formattedEndDate });
    qbFuture.orderBy("reservation.arrivalDate", "ASC");
    const future = await qbFuture.getMany();

    // 3) Past reservations: arrival < today & departureDate = endDate
    const qbPast = this.buildBaseQuery(listingMapId, guestName);
    qbPast.andWhere("DATE(reservation.arrivalDate) < :today", { today });
    qbPast.andWhere("DATE(reservation.departureDate) = :endDate", { endDate: formattedEndDate });
    qbPast.orderBy("reservation.arrivalDate", "DESC");
    const past = await qbPast.getMany();

    // Merge future + past
    const merged = [...future, ...past];
    const totalCount = merged.length;

    // Apply pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginated = merged.slice(startIndex, endIndex);

    // Final results => today first, then paginated future/past
    const finalResults = [...todaysReservations, ...paginated];

    for (const reservation of finalResults) {
      const preStayStatus = await this.preStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const postStayStatus = await this.postStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const reservationWithAuditStatus = {
        ...reservation,
        preStayAuditStatus: preStayStatus,
        postStayAuditStatus: postStayStatus
      };
      Object.assign(reservation, reservationWithAuditStatus);
    }
    return {
      status: "success",
      result: finalResults,
      count: totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * CASE 4: Only startDate
   *  - Fetch all arrivalDate >= startDate, ascending
   */
  private async getCase4(
    startDate: Date,
    listingMapId: string | undefined,
    guestName: string | undefined,
    page: number,
    limit: number
  ) {
    const formattedStartDate = startDate.toISOString().split('T')[0];
    const qb = this.buildBaseQuery(listingMapId, guestName);
    qb.andWhere("DATE(reservation.arrivalDate) = :startDate", { startDate: formattedStartDate });
    qb.orderBy("reservation.arrivalDate", "ASC");

    const allReservations = await qb.getMany();

    const totalCount = allReservations.length;

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginated = allReservations.slice(startIndex, endIndex);

    for (const reservation of paginated) {
      const preStayStatus = await this.preStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const postStayStatus = await this.postStayAuditService.fetchCompletionStatusByReservationId(reservation.id);
      const reservationWithAuditStatus = {
        ...reservation,
        preStayAuditStatus: preStayStatus,
        postStayAuditStatus: postStayStatus
      };
      Object.assign(reservation, reservationWithAuditStatus);
    }

    return {
      status: "success",
      result: paginated,
      count: totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
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
