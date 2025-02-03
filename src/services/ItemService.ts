import {appDatabase} from "../utils/database.util";
import {Item} from "../entity/Item";
import {ReservationEntity} from "../entity/Reservation";
import {Request} from "express";

export class ItemService {

    private itemRepository = appDatabase
        .getRepository(Item);

    private reservationRepository = appDatabase
        .getRepository(ReservationEntity);

    // async getAllItemByReservation(request: Request) {
    //     const reservationLink = String(request.params.reservationLink);
    //     const reservation = await this.reservationRepository
    //         .findOne({where: {reservationLink}});
    //     const listing_id = reservation?.reservationInfo?.listingMapId;
    //     if (listing_id === null) {
    //         throw new Error("ItemService: Listing id is null")
    //     }

    //     return this.itemRepository.find({where: {listing_id}});
    // }

}