import { Request, Response } from "express";
import { ClientService } from "../services/SalesService";

interface CustomRequest extends Request {
  user?: any;
}

export class SalesController {
  async createClient(request: CustomRequest, response: Response) {
    const clientService = new ClientService();
    const userId = request.user.id;
    return response.send(await clientService.createClient(request, userId));
  }
  async getAllClients(request: Request, response: Response) {
    const clientService = new ClientService();
    return response.json({
      data: await clientService.getAllClients(),
    });
  }
  async updateClient(request: CustomRequest, response: Response) {
    const clientId = parseInt(request.params.client_id);
    const userId = request.user.id;
    const clientService = new ClientService();
    try {
      const updatedClient = await clientService.updateClient(
        clientId,
        request.body,
        userId
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
