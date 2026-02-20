import { NextFunction, Request, Response } from "express";
import { itemSupplyRequestService } from "../services/ItemSupplyRequestService";

interface CustomRequest extends Request {
    user?: any;
}

export class ItemSupplyRequestController {
    async getAll(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const page = parseInt(request.query.page as string) || 1;
            const limit = parseInt(request.query.limit as string) || 10;
            const status = request.query.status as string[] | undefined;
            const propertyId = request.query.propertyId
                ? (Array.isArray(request.query.propertyId)
                    ? (request.query.propertyId as string[]).map(Number)
                    : [Number(request.query.propertyId)])
                : undefined;

            const result = await itemSupplyRequestService.getAll({ page, limit, status, propertyId });

            response.json({
                success: true,
                data: result.data,
                pagination: {
                    page: result.page,
                    limit: result.limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / result.limit),
                },
            });
        } catch (error: any) {
            response.status(500).json({
                success: false,
                message: error.message,
            });
        }
    }

    async getByProperty(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { propertyId } = request.params;
            const result = await itemSupplyRequestService.getByProperty(Number(propertyId));

            response.json({
                success: true,
                data: result.data,
                property: result.property,
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
            const createdBy = request.user?.email || null;
            const authenticatedUserId = request.user?.id;

            const result = await itemSupplyRequestService.create(Number(propertyId), data, createdBy, authenticatedUserId);

            response.status(201).json({
                success: true,
                message: "Item/supply request submitted successfully",
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

            const result = await itemSupplyRequestService.update(Number(id), data, userId);

            response.json({
                success: true,
                message: "Item/supply request updated successfully",
                data: result,
            });
        } catch (error: any) {
            response.status(error.message === "Item supply request not found" ? 404 : 500).json({
                success: false,
                message: error.message,
            });
        }
    }
}
