import { Request, Response } from 'express';
import { ReservationDetailService } from '../services/ReservationDetailService';
import { photoUpload } from '../utils/photoUpload.util';
import { ReviewMediationStatus } from '../entity/ReservationDetail';

export class ReservationDetailController {
    private reservationDetailService: ReservationDetailService;

    constructor() {
        // Initialize the service in constructor
        this.reservationDetailService = new ReservationDetailService();
        // Bind the method to this instance
        this.createWithPhotos = this.createWithPhotos.bind(this);
        this.getReservationDetail = this.getReservationDetail.bind(this);
        this.updateReservationDetail = this.updateReservationDetail.bind(this);
    }

    async createWithPhotos(req: Request, res: Response) {
        try {
            const data = {
                reservationId: Number(req.params.reservationId),
                additionalNotes: req.body.additionalNotes || '',
                specialRequest: req.body.specialRequest || '',
                reviewMediationStatus: req.body.reviewMediationStatus || ReviewMediationStatus.UNSET,
                photos: req.files as Express.Multer.File[]
            };
            const result = await this.reservationDetailService.createReservationDetailWithPhotos(data);

            return res.status(201).json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    async getReservationDetail(req: Request, res: Response) {
        const reservationId = Number(req.params.reservationId);
        const result = await this.reservationDetailService.getReservationDetail(reservationId);
        return res.status(200).json({
            success: true,
            data: result
        });
    }

    async updateReservationDetail(req: Request, res: Response) {
        try {
            const reservationId = Number(req.params.reservationId);
            const data = {
                ...req.body,
                photos: req.files as Express.Multer.File[],
                photoIdsToRemove: req.body.photoIdsToRemove || [] // Array of photo IDs to remove
            };
            
            const result = await this.reservationDetailService.updateReservationDetail(reservationId, data);
            return res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
} 