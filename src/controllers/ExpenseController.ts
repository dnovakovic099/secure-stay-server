import { NextFunction, Request, Response } from "express";
import { ExpenseService } from "../services/ExpenseService";

interface CustomRequest extends Request {
    user?: any;
}

export class ExpenseController {
    async createExpense(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;

            //check either attachments are present or not
            let fileNames: string[] = [];
            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                fileNames = (request.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }
            const expenseData = await expenseService.createExpense(request, userId, fileNames);

            return response.send(expenseData);
        } catch (error) {
            return next(error);
        }
    }

    async updateExpense(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;

            //check either attachments are present or not
            let fileNames: string[] = [];
            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                fileNames = (request.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }
            const expenseData = await expenseService.updateExpense(request, userId, fileNames);

            return response.send(expenseData);
        } catch (error) {
            return next(error);
        }
    }

    async updateExpenseStatus(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;

            const expenseData = await expenseService.updateExpenseStatus(request, userId);

            return response.send(expenseData);
        } catch (error) {
            return next(error);
        }
    }

    async getExpenseList(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;
            return response.send(await expenseService.getExpenseList(request, userId));
        } catch (error) {
            return next(error);
        }
    };

    async getExpenseById(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;
            const expenseId = parseInt(request.params.expenseId);
            return response.send(await expenseService.getExpenseById(expenseId, userId));
        } catch (error) {
            return next(error);
        }
    }

    async getTotalExpenseByUserId(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.userId;
            const listingId = parseInt(request.params.listingId) || null;
            return response.send(await expenseService.getTotalExpenseByUserId(userId, listingId));
        } catch (error) {
            return next(error);
        }
    }
}
