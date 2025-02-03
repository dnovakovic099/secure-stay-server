import { appDatabase } from "../utils/database.util";
import { FAQ } from "../entity/Faq";
import { ReservationEntity } from "../entity/Reservation";
import { Request } from "express";

export class FaqService {
  private faqRepository = appDatabase.getRepository(FAQ);

  private reservationRepository = appDatabase.getRepository(ReservationEntity);

  // async getAllFaqByReservation(request: Request) {
  //   const reservationLink = String(request.params.reservationLink);
  //   const reservation = await this.reservationRepository.findOne({
  //     where: { reservationLink },
  //   });
  //   const listing_id = reservation?.reservationInfo?.listingMapId;
  //   if (listing_id === null) {
  //     throw new Error("FaqService: Listing id is null");
  //   }
  //   return this.faqRepository.find({ where: { listing_id } });
  // }
}
