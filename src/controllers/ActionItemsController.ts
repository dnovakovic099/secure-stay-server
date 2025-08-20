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
            const filter: any = {
                category: category || undefined,
                page: Number(page),
                limit: Number(limit),
                listingId: request.query.listingId || undefined,
                guestName: request.query.guestName || undefined,
                status: request.query.status || undefined,
                fromDate: request.query.fromDate || undefined,
                toDate: request.query.toDate || undefined,
                ids: request.query.ids || undefined,
                propertyType: request.query.propertyType || undefined,
                keyword: request.query.keyword || undefined,
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

    async createActionItemsUpdates(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const body = request.body;
            const userId = request.user?.id;

            const actionItemsService = new ActionItemsService();
            const updates = await actionItemsService.createActionItemsUpdates(body, userId);

            return response.status(201).json(updates);
        } catch (error) {
            next(error);
        }
    }

    async updateActionItemsUpdates(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const body = request.body;
            const userId = request.user?.id;

            const actionItemsService = new ActionItemsService();
            const updatedUpdates = await actionItemsService.updateActionItemsUpdates(body, userId);

            return response.status(200).json(updatedUpdates);
        } catch (error) {
            next(error);
        }
    }

    async deleteActionItemsUpdates(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { id } = request.params;
            const userId = request.user?.id;

            const actionItemsService = new ActionItemsService();
            await actionItemsService.deleteActionItemsUpdates(Number(id), userId);

            return response.status(200).json({ message: "Action item updates deleted successfully" });
        } catch (error) {
            next(error);
        }
    }

    async migrateActionItemsToIssues(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user?.id;

            const actionItemsService = new ActionItemsService();
            const migratedIssue = await actionItemsService.migrateActionItemsToIssues(request.body, userId);

            if (!migratedIssue) {
                return response.status(404).json({ message: "Migration Failed" });
            }

            return response.status(200).json(migratedIssue);
        } catch (error) {
            next(error);
        }
    }

    async bulkUpdateActionItems(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { ids, updateData } = request.body;
            const userId = request.user?.id;

            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return response.status(400).json({ message: "IDs array is required and must not be empty" });
            }

            if (!updateData || Object.keys(updateData).length === 0) {
                return response.status(400).json({ message: "Update data is required and must not be empty" });
            }

            const actionItemsService = new ActionItemsService();
            const result = await actionItemsService.bulkUpdateActionItems(ids, updateData, userId);

            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

}
