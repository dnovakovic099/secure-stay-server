import { Request, Response, NextFunction } from "express";
import { OwnerInfoService } from "../services/OwnerInfoService";

interface CustomRequest extends Request {
    user?: any;
}

export class OwnerInfoController {

    async getOwnerInfo(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const ownerInfoService = new OwnerInfoService();
            const { listingId } = request.query;
            const ownerInfo = await ownerInfoService.getOwnerInfo(listingId);
            return response.status(200).json({
                success: true,
                data: ownerInfo
            });

        } catch (error) {
            return next(error);
        }
    }
}
