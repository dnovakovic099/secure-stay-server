import { Request, Response } from "express";
import { ReservationService } from "../services/ReservationService";

export class ReservationController {
  async getStatusForLink(request: Request, response: Response) {
    const reservationService = new ReservationService();
    response.send(await reservationService.getReservationStatusByLink(request));
  }

  async getReservationListingInfo(request: Request, response: Response) {
    const reservationService = new ReservationService();
    response.send(await reservationService.getReservationListingInfo(request));
  }
}
