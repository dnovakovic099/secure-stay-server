import { NextFunction, Request, Response } from "express";
import { PublishedStatementService } from "../services/PublishedStatementService";

export class PublishedStatementController {
  async savePublishedStatementFromHA(
    request: Request,
    response: Response,
    next: NextFunction
  ) {
    try {
      const publishedStatementService = new PublishedStatementService();
      const result = await publishedStatementService.savePublishedStatement();
      return response.status(200).json({
        message: "Published statements saved successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getPublishedStatements(
    request: Request,
    response: Response,
    next: NextFunction
  ) {
    try {
      const publishedStatementService = new PublishedStatementService();
      const statements = await publishedStatementService.getPublishedStatements(
        request
      );
      return response.status(200).json({ data: statements });
    } catch (error) {
      next(error);
    }
  }
}
