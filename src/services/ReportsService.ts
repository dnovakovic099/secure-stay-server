import { Request } from "express";
import { ReservationInfoService } from "./ReservationInfoService";

export class ReportsService {
    private reservationInfoService = new ReservationInfoService();
   

   async getReports(request: Request) {
      const reservationInfo = await this.reservationInfoService.getReservationInfo(request);
      return reservationInfo;
   }
} 