import { NextFunction, Request, Response } from "express";
import { EscalationSettingsService } from "../services/EscalationSettingsService";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: any;
}

export class EscalationSettingsController {
    private settingsService = new EscalationSettingsService();

    /**
     * GET /escalation-settings
     * Get all escalation settings
     */
    getAllSettings = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const settings = await this.settingsService.getAllSettings();
            return res.status(200).json({ success: true, data: settings });
        } catch (error) {
            logger.error("[EscalationSettingsController] Error fetching settings:", error);
            return next(error);
        }
    };

    /**
     * GET /escalation-settings/:key
     * Get settings for a specific key/channel
     */
    getSettingsByKey = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { key } = req.params;
            const settings = await this.settingsService.getSettingsByKey(key);
            
            if (!settings) {
                return res.status(404).json({ success: false, message: "Settings not found" });
            }

            return res.status(200).json({ success: true, data: settings });
        } catch (error) {
            logger.error("[EscalationSettingsController] Error fetching settings by key:", error);
            return next(error);
        }
    };

    /**
     * PUT /escalation-settings/:key
     * Update settings for a specific key/channel
     */
    updateSettings = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { key } = req.params;
            const updates = req.body;
            const userId = req.user?.db_id;

            const settings = await this.settingsService.updateSettings(key, updates, userId);
            return res.status(200).json({ success: true, data: settings });
        } catch (error) {
            logger.error("[EscalationSettingsController] Error updating settings:", error);
            return next(error);
        }
    };

    /**
     * POST /escalation-settings
     * Create new settings entry
     */
    createSettings = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { settingKey, ...data } = req.body;
            const userId = req.user?.db_id;

            if (!settingKey) {
                return res.status(400).json({ success: false, message: "settingKey is required" });
            }

            const settings = await this.settingsService.createSettings(settingKey, data, userId);
            return res.status(201).json({ success: true, data: settings });
        } catch (error: any) {
            if (error.message?.includes('already exists')) {
                return res.status(409).json({ success: false, message: error.message });
            }
            logger.error("[EscalationSettingsController] Error creating settings:", error);
            return next(error);
        }
    };

    /**
     * DELETE /escalation-settings/:key
     * Delete a settings entry
     */
    deleteSettings = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const { key } = req.params;

            await this.settingsService.deleteSettings(key);
            return res.status(200).json({ success: true, message: "Settings deleted" });
        } catch (error: any) {
            if (error.message?.includes('Cannot delete')) {
                return res.status(400).json({ success: false, message: error.message });
            }
            logger.error("[EscalationSettingsController] Error deleting settings:", error);
            return next(error);
        }
    };

    /**
     * GET /escalation-settings/employees/gr
     * Get list of GR employees for dropdown
     */
    getGREmployees = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const employees = await this.settingsService.getGREmployees();
            return res.status(200).json({ success: true, data: employees });
        } catch (error) {
            logger.error("[EscalationSettingsController] Error fetching GR employees:", error);
            return next(error);
        }
    };
}
