import { NextFunction, Request, Response } from "express";
import { ReservationInfoService } from "../services/ReservationInfoService";

export class ReservationInfoController {
    async getAllReservations(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationInfoService = new ReservationInfoService();
            const result = await reservationInfoService.getReservationInfo(request);
            if (result.status === "error") {
                return response.status(500).send(result);
            }
            return response.send(result);
        } catch (error) {
            return next(error);
        }
    }

    async getReservation(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationInfoService = new ReservationInfoService();
            const reservationId = Number(request.params.reservationId);
            const result = await reservationInfoService.getReservationById(reservationId);
            return response.send(result);
        } catch (error) {
            return next(error);
        }
    }

    async exportReservationToExcel(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationInfoService = new ReservationInfoService();
            return response.send(await reservationInfoService.exportReservationToExcel(request));
        } catch (error) {
            return next(error);
        }
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

    async syncReservationById(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationInfoService = new ReservationInfoService();
            const reservationId = request.body.reservationId;
            if (!reservationId) {
                return response.status(400).json({ error: 'Reservation ID is required' });
            }
            const result = await reservationInfoService.syncReservationById(reservationId);
            return response.status(200).json(result);
        } catch (error) {
            return next(error);
        }
    }

    async getReservationGenericReport(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationInfoService = new ReservationInfoService();
            const result = await reservationInfoService.getReservationGenericReport(request.body);
            return response.status(200).json(result);
        } catch (error) {
            return next(error);
        }
    }
}
