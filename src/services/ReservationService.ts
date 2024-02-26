import { appDatabase } from "../utils/database.util";
import { ReservationEntity } from "../entity/Reservation";
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { getCurrentDateInUTC } from "../helpers/date";

export class ReservationService {

    private reservationRepository = appDatabase
        .getRepository(ReservationEntity);

    private hostAwayClient = new HostAwayClient();


    async getReservationStatusByLink(request: Request) {
        const reservationLink = String(request.params.reservationLink);
        if (reservationLink === null) {
            throw new Error("ReservationService: ReservationLink is null");
        }
        let status = "CREATED";

        await this.reservationRepository
            .findOne({ where: { reservationLink } })
            .then(reservation => {
                if (reservation === null) {
                    throw new Error("ReservationService: Reservation is null");
                }
                if (new Date(reservation.reservationInfo.departureDate) < new Date()) {
                    status = "FINISHED";
                    //TODO: CHECK BY PRICE
                } else if (reservation?.userVerification?.approved === 1 && reservation.payments.length > 0) {
                    status = "PAID";
                }
            });

        return status;
    }

    async getReservationListingInfo(request: Request) {
        const reservationLink = String(request.params.reservationLink);
        const reservation = await this.reservationRepository
            .findOne({ where: { reservationLink } })

        return this.hostAwayClient.getListingInfo(reservation?.reservationInfo?.listingMapId);
    }

    async getHostawayReservationListStartingToday(){
        const currentDate=getCurrentDateInUTC()
        return await this.hostAwayClient.getReservationList(currentDate)
    }
}