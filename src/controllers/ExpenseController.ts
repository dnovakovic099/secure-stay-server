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
            let newFiles: string[] = [];
            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                newFiles = (request.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }

            // Parse oldFiles safely
            const oldFiles: string[] = JSON.parse(request.body.oldFiles) || [];

            fileNames = [...oldFiles, ...newFiles];

            const expenseData = await expenseService.updateExpense(request, userId, fileNames);

            return response.send(expenseData);
        } catch (error) {
            return next(error);
        }
    }

    async deleteExpense(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;
            const expenseId = parseInt(request.params.expenseId);

            await expenseService.deleteExpense(expenseId, userId);

            return response.send({ message: 'Expense deleted successfully' });
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

    async migrateExpenseCatgory(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const fromId = request.body.fromId || 1; // Default to 1 if not provided
            const toId = request.body.toId;
            const result = await expenseService.migrateExpenseCategoryIdsInRange(fromId, toId);
            return response.status(200).json({ message: 'Expense categories migrated successfully', result });
        } catch (error) {
            return next(error);
        }
    }


    async fixPositiveExpensesAndSync(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;
            const limit = request.query.limit;
            const result = await expenseService.fixPositiveExpensesAndSync(userId, Number(limit));
            return response.status(200).json({ message: 'Positive expenses fixed and synced successfully', result });
        } catch (error) {
            return next(error);
        }
    }

    async bulkUpdateExpenses(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const expenseService = new ExpenseService();
            const userId = request.user.id;
            const result = await expenseService.bulkUpdateExpense(request.body, userId);
            return response.status(200).json(result);
        } catch (error) {
            return next(error);
        }
    }
}
