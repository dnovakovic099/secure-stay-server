import { Between, LessThanOrEqual, MoreThanOrEqual } from "typeorm";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { appDatabase } from "../utils/database.util";
import { HostAwayClient } from "../client/HostAwayClient";
import logger from "../utils/logger.utils";

export class ReservationInfoService {
  private reservationInfoRepository = appDatabase.getRepository(ReservationInfoEntity);
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

    return await this.reservationInfoRepository.save(reservation);
  }

  async getReservations(fromDate: string, toDate: string, listingId: number, dateType: string, channelId?: number) {
    const searchCondition: any = { listingMapId: listingId };

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

}
