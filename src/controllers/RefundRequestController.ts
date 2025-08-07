import { NextFunction, Request, Response } from "express";
import { RefundRequestService } from "../services/RefundRequestService";

interface CustomRequest extends Request {
    user?: any;
}

export class RefundRequestController {
    async saveRefundRequest(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const refundRequestService = new RefundRequestService();
            const userId = request.user.id;
            let fileNames: string[] = [];
            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                fileNames = (request.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }

            return response.send(await refundRequestService.saveRefundRequest(request.body, userId, fileNames));
        } catch (error) {
            return next(error);
        }
    }

    async updateRefundRequest(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const refundRequestService = new RefundRequestService();
            const userId = request.user.id;

            let attachments: string[] = [];
            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                attachments = (request.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }

            const refundRequest = await refundRequestService.getRefundRequestById(request.body.id);
            if (!refundRequest) {
                return response.status(404).json({ status: false, message: 'Refund request not found.' });
            }

            return response.send(await refundRequestService.saveRefundRequest(request.body, userId, attachments, refundRequest));
        } catch (error) {
            return next(error);
        }
    }

    async getRefundRequestByReservationId(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const refundRequestService = new RefundRequestService();
            const reservationId = Number(request.params.reservationId);
            return response.send(await refundRequestService.getRefundRequestByReservationId(reservationId));
        } catch (error) {
            return next(error);
        }
    }

    async getRefundRequestList(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const refundRequestService = new RefundRequestService();
            const { page, limit, status, reservationId, listingId, keyword, propertyType } = request.query;
            return response.send(await refundRequestService.getRefundRequestList({
                page: Number(page) || 1,
                limit: Number(limit) || 10,
                status: status as string,
                reservationId: reservationId as string,
                listingId: listingId as string,
                keyword: keyword as string,
                propertyType: propertyType as string
            }));
        } catch (error) {
            return next(error);
        }
    }

    async updateRefundRequestStatus(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const refundRequestService = new RefundRequestService();
            const userId = request.user.id;
            const { id, status } = request.body;

            await refundRequestService.updateRefundRequestStatus(Number(id), String(status), userId);
            return response.status(200).json({ status: true, message: 'Refund request status updated successfully.' });
        } catch (error) {
            return next(error);
        }
    }

    async getRefundRequestById(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const refundRequestService = new RefundRequestService();
            const id = Number(request.params.id);
            const refundRequest = await refundRequestService.getRefundRequestById(id);
            if (!refundRequest) {
                return response.status(404).json({ status: false, message: 'Refund request not found.' });
            }
            return response.status(200).json(refundRequest);
        } catch (error) {
            return next(error);
        }
    }
}
