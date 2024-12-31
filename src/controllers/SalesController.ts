import { Request, Response } from "express";
import { ClientService } from "../services/SalesService";

export class SalesController {
  async createClient(request: Request, response: Response) {
    const clientService = new ClientService();
    return response.send(await clientService.createClient(request));
  }
  async getAllClients(request: Request, response: Response) {
    const automatedMessageService = new ClientService();
    return response.json({
      data: await automatedMessageService.getAllClients(),
    });
  }
}
