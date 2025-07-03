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
                limit: Number(limit)
            };
            const actionItems = await actionItemsService.getActionItems(filter);
            return response.status(200).json(actionItems);
        } catch (error) {
            next(error);
        }
    }

}
