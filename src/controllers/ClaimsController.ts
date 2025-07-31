import { Request, Response } from "express";
import { ClaimsService } from "../services/ClaimsService";

export class ClaimsController {
    async getClaims(request: Request, response: Response) {
        const claimsService = new ClaimsService();
        try {   
            const page = parseInt(request.query.page as string) || 1;
            const limit = parseInt(request.query.limit as string) || 10;
            const fromDate = request.query.fromDate as string || '';
            const toDate = request.query.toDate as string || '';
            const status = request.query.status as string || ''; 
            const listingId = request.query.listingId as string || '';
            const claimAmount = request.query.claimAmount as string;
            const guestName = request.query.guestName as string;
            const claimIds = request.query.claimIds as string;

            const result = await claimsService.getClaims(
                page, 
                limit, 
                fromDate, 
                toDate, 
                status, 
                listingId,
                claimAmount,
                guestName,
                claimIds
            );
            
            return response.send({
                status: true,
                ...result
            });
        } catch (error) {
            return response.send({
                status: false,
                message: error.message
            });
        }
    }

    async createClaim(request: any, response: Response) {
        const claimsService = new ClaimsService();
        try {
            const userId = request.user.id;

            let fileNames: string[] = [];
            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                fileNames = (request.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }

            const result = await claimsService.createClaim(request.body, userId, fileNames);
            return response.status(201).json({
                status: true,
                data: result
            });
        } catch (error) {
            return response.status(400).json({
                status: false,
                message: error.message
            });
        }
    }

    async updateClaim(request: any, response: Response) {
        const claimsService = new ClaimsService();
        try {
            const id = parseInt(request.params.id);
            const userId = request.user.id;

            let fileNames: string[] = [];
            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                fileNames = (request.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }

            const result = await claimsService.updateClaim(id, request.body, userId, fileNames);
            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            return response.status(400).json({
                status: false,
                message: error.message
            });
        }
    }

    async deleteClaim(request: any, response: Response) {
        const claimsService = new ClaimsService();
        try {
            const { id } = request.params;
            const userId = request.user.id;
            await claimsService.deleteClaim(Number(id), userId);
            return response.send({
                status: true,
                message: "Order deleted successfully"
            });
        } catch (error) {
            return response.send({
                status: false,
                message: error.message
            });
        }
    }

    async exportClaimsToExcel(request: Request, response: Response) {
        const claimsService = new ClaimsService();
        const result = await claimsService.exportClaimsToExcel();
        return response.send(result);
    }
} 