import { Request, Response } from "express";
import { ClientService } from "../services/SalesService";

export class SalesController {
  async createClient(request: Request, response: Response) {
    const clientService = new ClientService();
    return response.send(await clientService.createClient(request));
  }
}
