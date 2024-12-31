import { Request, Response } from "express";
import { ClientService } from "../services/SalesService";

export class SalesController {
  async createClient(request: Request, response: Response) {
    const clientService = new ClientService();
    return response.send(await clientService.createClient(request));
  }
  async getAllClients(request: Request, response: Response) {
    const clientService = new ClientService();
    return response.json({
      data: await clientService.getAllClients(),
    });
  }
  async updateClient(request: Request, response: Response) {
    const clientId = parseInt(request.params.client_id);
    const clientService = new ClientService();
    try {
      const updatedClient = await clientService.updateClient(
        clientId,
        request.body
      );
      if (updatedClient) {
        return response.json(updatedClient);
      }
      return response.status(404).json({ error: "Client not found" });
    } catch (error) {
      return response.status(500).json({ error: "Unable to update client" });
    }
  }
}
