import { Request, Response } from "express";
import { ReservationInfoService } from "../services/ReservationInfoService";

export class ReservationInfoController {
    async getAllReservations(request: Request, response: Response) {
        const reservationInfoService = new ReservationInfoService();
        const result = await reservationInfoService.getReservationInfo(request);
        if (result.status === "error") {
            return response.status(500).send(result);
        }
        return response.send(result);
    }

    async exportReservationToExcel(request: Request, response: Response) {
        const reservationInfoService = new ReservationInfoService();
        return response.send(await reservationInfoService.exportReservationToExcel(request));
    }
}
