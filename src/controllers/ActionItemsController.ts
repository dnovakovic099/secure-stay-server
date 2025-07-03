import { NextFunction, Request, Response } from "express";
import { ActionItemsService } from "../services/ActionItemsService";

interface CustomRequest extends Request {
    user?: any;
}

export class ActionItemsController {
    async getActionItems(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const actionItemsService = new ActionItemsService();
            const { category, page = 1, limit = 10 } = request.query;
            const filter = {
                category: category ? String(category) : undefined,
                page: Number(page),
                limit: Number(limit),
                listingId: request.query.listingId || undefined,
                guestName: request.query.guestName || undefined,
                status: request.query.status || undefined,
                fromDate: request.query.fromDate || undefined,
                toDate: request.query.toDate || undefined
            };
            const actionItems = await actionItemsService.getActionItems(filter);
            return response.status(200).json(actionItems);
        } catch (error) {
            next(error);
        }
    }

    async createActionItem(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const actionItemData = request.body;
            const userId = request.user?.id;

            const actionItemsService = new ActionItemsService();
            const createdActionItem = await actionItemsService.createActionItem(actionItemData, userId);
            if (!createdActionItem) {
                return response.status(400).json({ message: "Failed to create action item" });
            }

            return response.status(201).json(createdActionItem);
        } catch (error) {
            next(error);
        }
    }

    async updateActionItem(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const actionItemData = request.body;
            const userId = request.user?.id;

            const actionItemsService = new ActionItemsService();
            const updatedActionItem = await actionItemsService.updateActionItem(actionItemData, userId);

            if (!updatedActionItem) {
                return response.status(404).json({ message: "Action item not found" });
            }

            return response.status(200).json(updatedActionItem);
        } catch (error) {
            next(error);
        }
    }

    async deleteActionItem(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { id } = request.params;
            const userId = request.user?.id;

            const actionItemsService = new ActionItemsService();
            await actionItemsService.deleteActionItem(Number(id), userId);

            return response.status(200).json({ message: "Action item deleted successfully" });
        } catch (error) {
            next(error);
        }
    }

}
