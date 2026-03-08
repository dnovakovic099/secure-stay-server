import { Request, Response, NextFunction } from "express";
import { Hostify, HostifyUser } from "../client/Hostify";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    userId?: number;
}

interface HFUser {
    id: number;
    hostifyId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    role: string;
    status: string;
    timezone?: string;
    language?: string;
    avatar?: string;
    permissions?: string[];
    lastLogin: string | null;
    createdAt: string;
    updatedAt: string;
}

class HostifyController {
    private hostify: Hostify;
    private cachedUsers: HFUser[] = [];
    private lastSync: string | null = null;

    constructor() {
        this.hostify = new Hostify();
    }

    /**
     * GET /hostify/users
     * Get cached Hostify users
     */
    getUsers = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            return res.status(200).json({
                success: true,
                data: this.cachedUsers,
                lastSync: this.lastSync,
                count: this.cachedUsers.length
            });
        } catch (error: any) {
            logger.error("[HostifyController] Error getting users:", error.message);
            return next(error);
        }
    };

    /**
     * POST /hostify/users/sync
     * Sync users from Hostify API
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

            logger.info("[HostifyController] Syncing users from Hostify...");

            const hostifyUsers = await this.hostify.getUsers(apiKey);

            // Transform to our format
            this.cachedUsers = hostifyUsers.map((user: HostifyUser, index: number) => ({
                id: user.id || index + 1,
                hostifyId: String(user.id || index + 1),
                firstName: user.first_name || '',
                lastName: user.last_name || '',
                email: user.email || '',
                phone: user.phone || '',
                role: user.role || 'staff',
                status: user.status || 'active',
                timezone: user.timezone,
                language: user.language,
                avatar: user.avatar,
                permissions: user.permissions || [],
                lastLogin: user.last_login_at || null,
                createdAt: user.created_at || new Date().toISOString(),
                updatedAt: user.updated_at || new Date().toISOString()
            }));

            this.lastSync = new Date().toISOString();

            logger.info(`[HostifyController] Synced ${this.cachedUsers.length} users from Hostify`);

            return res.status(200).json({
                success: true,
                data: this.cachedUsers,
                lastSync: this.lastSync,
                count: this.cachedUsers.length
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
