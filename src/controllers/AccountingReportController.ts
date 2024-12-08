import { NextFunction, Request, Response } from "express";
import { AccountingReportService } from "../services/AccountingReportService";


interface CustomRequest extends Request {
  user?: any;
}

export class AccountingReportController {

  async printExpenseIncomeStatement(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const accountingReportServicer = new AccountingReportService();
      const userId = request.user.id;
      return response.send(await accountingReportServicer.printExpenseIncomeStatement(request, userId));
    } catch (error) {
      return next(error);
    }
  }
}
