import { NextFunction, Request, Response } from "express";
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

    async updateReservationStatusForStatement(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationInfoService = new ReservationInfoService();
            const { id, isProcessedInStatement } = request.body;
            const result = await reservationInfoService.updateReservationStatusForStatement(id, isProcessedInStatement);
            return response.status(200).json(result);
        } catch (error) {
            return next(error);
        }
    }
}
