import { Request, Response, NextFunction } from "express";
import { PartnershipInfoService } from "../services/OwnerPortalService";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: any;
}

export class PartnershipInfoController {

    async savePartnershipInfo(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const partnershipInfoService = new PartnershipInfoService();
            const userId = request.user.id;
            const partnershipInfo = await partnershipInfoService.savePartnershipInfo(request.body, userId);
            return response.status(201).json({
                success: true,
                data: partnershipInfo
            });

        } catch (error) {
            logger.error(`Error saving partnership info`, error);
            return next(error);
        }
    }

    async getPartnershipInfo(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const partnershipInfoService = new PartnershipInfoService();
            const listingId = Number(request.query.listingId);
            const partnershipInfo = await partnershipInfoService.getPartnershipInfo(listingId);
            return response.status(200).json({
                success: true,
                data: partnershipInfo
            });
        } catch (error) {
            return next(error);
        }
    }
}
