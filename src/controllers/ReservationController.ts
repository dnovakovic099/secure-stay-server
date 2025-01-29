import { NextFunction, Request, Response } from "express";
import { ReservationService } from "../services/ReservationService";
interface CustomRequest extends Request {
  user?: any;
}
export class ReservationController {
  async getStatusForLink(request: Request, response: Response) {
    const reservationService = new ReservationService();
    response.send(await reservationService.getReservationStatusByLink(request));
  }

  async getReservationListingInfo(request: Request, response: Response) {
    const reservationService = new ReservationService();
    response.send(await reservationService.getReservationListingInfo(request));
  }

  async getChannelList(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const reservationService = new ReservationService();
      return response.send(await reservationService.getChannelList());
    } catch (error) {
      return next(error);
    }
  }

  async getAllReservations(request: Request, response: Response) {
    const reservationService = new ReservationService();
    return response.send(await reservationService.getReservationInfo(request));
  }
  
  async exportReservationToExcel(request: Request, response: Response) {
    const reservationService = new ReservationService();
    return response.send(await reservationService.exportReservationToExcel(request));
  }
}
