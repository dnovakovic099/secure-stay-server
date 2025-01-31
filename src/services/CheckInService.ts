import {Request} from "express";
import {appDatabase} from "../utils/database.util";
import {ReservationEntity} from "../entity/Reservation";
import {CheckIn} from "../entity/CheckIn";
import {PaymentEntity} from "../entity/Payment";
import {Item} from "../entity/Item";

export class CheckInService {

    private checkInRepository = appDatabase
        .getRepository(CheckIn);
    private reservationRepository = appDatabase
        .getRepository(ReservationEntity);
    private paymentRepository = appDatabase
        .getRepository(PaymentEntity);

    // async getAllByReservation(request: Request) {
    //     const reservationLink = String(request.params.reservationLink);
    //     const reservation = await this.reservationRepository
    //         .findOne({where: {reservationLink}});
    //     const listing_id = reservation?.reservationInfo?.listingMapId;
    //     if (listing_id === null) {
    //         throw new Error("CheckInService: Listing id is null")
    //     }
    //     return this.checkInRepository.find({where: {listing_id}})
    // }

    // async checkIn(request: Request) {
    //     const reservationLink = String(request.params.reservationLink);
    //     const reservation = await this.reservationRepository
    //         .findOne({where: {reservationLink}});
    //     const listing_id = reservation?.reservationInfo?.listingMapId;
    //     if (listing_id === null) {
    //         throw new Error("ItemService: Listing id is null")
    //     }

    //     if (reservation.earlyCheckIn) {
    //         let paidEarlyReservation = false;

    //         await this.paymentRepository.find({where: {reservation}}).then(payments => {
    //             payments.forEach(payment => {
    //                 if (payment.name == "checkin") {
    //                     paidEarlyReservation = true;
    //                 }
    //             })
    //         })

    //         if (!paidEarlyReservation) {
    //             throw new Error("CheckInService: You did not pay reservation");
    //         }
    //     }

    //     reservation.checkedIn = 1;
    //     return this.reservationRepository.save(reservation);
    // }
}