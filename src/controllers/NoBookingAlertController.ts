import { Request, Response, NextFunction } from "express";
import { NoBookingAlertService } from "../services/NoBookingAlertService";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: any;
}

export class NoBookingAlertController {
    /**
     * POST /no-booking-alert
     * Trigger a no booking alert check for a custom date
     * Request body: { date: "yyyy-MM-dd" }
     */
    async triggerNoBookingAlert(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { date } = request.body;

            // Validate date is provided
            if (!date) {
                return response.status(400).json({
                    success: false,
                    message: "Date is required. Please provide a date in yyyy-MM-dd format."
                });
            }

            // Validate date format (basic regex check)
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(date)) {
                return response.status(400).json({
                    success: false,
                    message: "Invalid date format. Please use yyyy-MM-dd format."
                });
            }

            logger.info(`[NoBookingAlertController] Received no-booking alert request for date: ${date}`);

            const noBookingAlertService = new NoBookingAlertService();
            const result = await noBookingAlertService.checkAndTriggerAlertsForDate(date);

            return response.json({
                success: true,
                message: result.flaggedListings > 0 
                    ? `No booking alert check completed. Found ${result.flaggedListings} listing(s) without recent bookings.`
                    : "No booking alert check completed. All listings have recent bookings.",
                data: result
            });

        } catch (error: any) {
            logger.error(`[NoBookingAlertController] Error triggering no-booking alert: ${error.message}`);
            
            // Handle specific validation errors
            if (error.message.includes('Invalid date format')) {
                return response.status(400).json({
                    success: false,
                    message: error.message
                });
            }

            return next(error);
        }
    }
}
