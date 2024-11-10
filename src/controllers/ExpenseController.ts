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
