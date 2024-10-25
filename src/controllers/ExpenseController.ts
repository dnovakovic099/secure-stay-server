import { Request, Response } from "express";
import { ExpenseService } from "../services/ExpenseService";

interface CustomRequest extends Request {
    user?: any;
}

export class ExpenseController {
    async createExpense(request: CustomRequest, response: Response) {
        const expenseService = new ExpenseService();
        const userId = request.user.id;
        return response.send(await expenseService.createExpense(request, userId));
    }
}
