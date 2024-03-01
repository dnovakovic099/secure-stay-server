import { Request, Response } from "express";
import { ReservationInfoService } from "../services/ReservationInfoService";

export class ReservationInfoController {
  async saveReservation(request: Request, response: Response) {
    const reservationInfoService = new ReservationInfoService();
    return response.send(
      await reservationInfoService.saveReservationInfo(request, response)
    );
  }
}
