import { IncomeService } from "./IncomeService";
import { Request } from "express";

export class ReportsService {
    private incomeService = new IncomeService();

   async getReports(request: Request, userId: string) {

      const incomeStatement = await this.incomeService.generateIncomeStatement(request, userId);
      return incomeStatement;
   }
} 