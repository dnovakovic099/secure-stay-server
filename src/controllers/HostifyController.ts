import { Request, Response, NextFunction } from "express";
import hostifyService from "../services/HostifyService";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    userId?: number;
}

class HostifyController {

    /**
     * GET /hostify/users
     * Get fetched Hostify users from DB via Service
     */
    getUsers = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const formattedUsers = await hostifyService.getUsers();

            return res.status(200).json({
                success: true,
                data: formattedUsers,
                count: formattedUsers.length
            });
        } catch (error: any) {
            logger.error("[HostifyController] Error getting users:", error.message);
            return next(error);
        }
    };

    /**
     * POST /hostify/users/sync
     * Sync users from Hostify API to DB via Service
     */
    syncUsers = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const apiKey = process.env.HOSTIFY_API_KEY;
            
            if (!apiKey) {
                return res.status(400).json({
                    success: false,
                    message: "Hostify API key not configured"
                });
            }

            const transformedUsers = await hostifyService.syncUsers(apiKey);

            return res.status(200).json({
                success: true,
                data: transformedUsers,
                count: transformedUsers.length
            });
        } catch (error: any) {
            logger.error("[HostifyController] Error syncing users:", error.message);
            return res.status(500).json({
                success: false,
                message: "Failed to sync users from Hostify: " + error.message
            });
        }
    };
}

export default new HostifyController();
