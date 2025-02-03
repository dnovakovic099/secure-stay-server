import { NextFunction, Request, Response } from "express";
import { ReservationInfoService } from "../services/ReservationInfoService";

export class ReservationInfoController {
    async syncReservations(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationInfoService = new ReservationInfoService();
            const { startingDate } = request.body;
            if (!startingDate) {
                return response.status(400).json({ error: 'Starting date is required' });
            }
            
            const result = await reservationInfoService.syncReservations(startingDate);
            return response.status(200).json(result);
        } catch (error) {
            return next(error);
        }
    }
}
