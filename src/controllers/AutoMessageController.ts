import { Request, Response } from "express";
import { AutomatedMessageService } from "../services/AutomatedMessageService";

export class AutomatedMessageController {
  async createAutomatedMessage(request: Request, response: Response) {
    const automatedMessageService = new AutomatedMessageService();
    return response.json(
      await automatedMessageService.createAutomatedMessage(request)
    );
  }

  async getAllAutomatedMessages(request: Request, response: Response) {
    const automatedMessageService = new AutomatedMessageService();
    return response.json({
      data: await automatedMessageService.getAllAutomatedMessages(),
    });
  }

  async getAutomatedMessageById(request: Request, response: Response) {
    const automatedMessageService = new AutomatedMessageService();
    return response.json({
      data: await automatedMessageService.getAutomatedMessageById(request),
    });
  }

  async updateAutomatedMessage(request: Request, response: Response) {
    const automatedMessageService = new AutomatedMessageService();
    return response.json({
      data: await automatedMessageService.updateAutomatedMessage(request),
    });
  }

  async deleteAutomatedMessage(request: Request, response: Response) {
    const automatedMessageService = new AutomatedMessageService();
    return response.json(
      await automatedMessageService.deleteAutomatedMessage(request)
    );
  }
}
