import { NextFunction, Request, Response } from "express";
import { photographerRequestService } from "../services/PhotographerRequestService";

interface CustomRequest extends Request {
    user?: any;
}

export class PhotographerRequestController {
    async getByProperty(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { propertyId } = request.params;
            const photographerRequest = await photographerRequestService.getByProperty(Number(propertyId));
            const propertyDetails = await photographerRequestService.getPropertyDetails(Number(propertyId));

            response.json({
                success: true,
                data: photographerRequest,
                property: propertyDetails,
            });
        } catch (error: any) {
            response.status(error.message === "Property not found" ? 404 : 500).json({
                success: false,
                message: error.message,
            });
        }
    }

    async create(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { propertyId } = request.params;
            const data = request.body;
            const userId = request.user?.id;

            const result = await photographerRequestService.create(Number(propertyId), data, userId, userId);

            response.status(201).json({
                success: true,
                message: "Photographer request submitted successfully",
                data: result,
            });
        } catch (error: any) {
            response.status(error.message === "Property not found" ? 404 : 500).json({
                success: false,
                message: error.message,
            });
        }
    }

    async update(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { id } = request.params;
            const data = request.body;
            const userId = request.user?.id;

            const result = await photographerRequestService.update(Number(id), data, userId, userId);

            response.json({
                success: true,
                message: "Photographer request updated successfully",
                data: result,
            });
        } catch (error: any) {
            response.status(error.message === "Photographer request not found" ? 404 : 500).json({
                success: false,
                message: error.message,
            });
        }
    }

    async getDistinctOnboardingReps(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const onboardingReps = await photographerRequestService.getDistinctOnboardingReps();

            response.json({
                success: true,
                data: onboardingReps,
            });
        } catch (error: any) {
            response.status(500).json({
                success: false,
                message: error.message,
            });
        }
    }
}
