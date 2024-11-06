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
            return response.send(await expenseService.createExpense(request, userId));
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
}
