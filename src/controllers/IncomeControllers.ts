import { Request, Response } from "express";
import { IncomeService } from "../services/IncomeService";

interface CustomRequest extends Request {
    user?: any;
}

export class IncomeController {
    async generateIncomeStatement(request: CustomRequest, response: Response) {
        const incomeService = new IncomeService();
        const userId = request.user.id;
        return response.send(await incomeService.generateIncomeStatement(request, userId));
    }
}
