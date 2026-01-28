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

    async updateReservationRiskStatus(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationInfoService = new ReservationInfoService();
            const { id, atRisk } = request.body;
            const result = await reservationInfoService.updateReservationRiskStatus(id, atRisk);
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

    async getReservationsByListingId(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationInfoService = new ReservationInfoService();
            const listingId = Number(request.params.listingId);

            if (!listingId || isNaN(listingId)) {
                return response.status(400).json({
                    status: false,
                    message: 'Valid listing ID is required'
                });
            }

            const result = await reservationInfoService.getReservationsByListingId(listingId);
            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            return next(error);
        }
    }

    async getPastReservationsByListingId(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationInfoService = new ReservationInfoService();
            const listingIdParam = request.query.listingId as string | undefined;
            const limitParam = request.query.limit as string | undefined;

            // listingId is optional - if provided, validate it
            let listingId: number | undefined;
            if (listingIdParam) {
                listingId = Number(listingIdParam);
                if (isNaN(listingId)) {
                    return response.status(400).json({
                        status: false,
                        message: 'listingId must be a valid number'
                    });
                }
            }

            // limit defaults to 10
            let limit = 10;
            if (limitParam) {
                limit = Number(limitParam);
                if (isNaN(limit) || limit < 1) {
                    return response.status(400).json({
                        status: false,
                        message: 'limit must be a positive number'
                    });
                }
            }

            const result = await reservationInfoService.getPastReservationsByListingId(listingId, limit);
            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            return next(error);
        }
    }
}

