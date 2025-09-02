import { NextFunction, Request, Response } from "express";
import { ClientService } from "../services/ClientService";

interface CustomRequest extends Request {
  user?: any;
}

export class ClientController {
  async createClient(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const createdClient = await clientService.createClient(request.body, request.user.id);
      return response.status(201).json(createdClient);
    } catch (error) {
      next(error);
    }
  }

  async updateClient(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const updatedClient = await clientService.updateClient(
        request.params.id,
        request.body,
        request.user.id
      );
      return response.status(200).json(updatedClient);
    } catch (error) {
      next(error);
    }
  }

  async deleteClient(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      await clientService.deleteClient(request.params.id, request.user.id);
      return response.status(200).json({ message: "Client deleted successfully." });
    } catch (error) {
      next(error);
    }
  }

  async getClients(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const clients = await clientService.getClients(
        {
          page: Number(request.query.page) || 1,
          limit: Number(request.query.limit) || 10,
          search: request.query.search as string,
          status: request.query.status ? (Array.isArray(request.query.status) ? request.query.status : [request.query.status]) as string[] : undefined,
          clientType: request.query.clientType ? (Array.isArray(request.query.clientType) ? request.query.clientType : [request.query.clientType]) as string[] : undefined,
          source: request.query.source ? (Array.isArray(request.query.source) ? request.query.source : [request.query.source]) as string[] : undefined,
          city: request.query.city ? (Array.isArray(request.query.city) ? request.query.city : [request.query.city]) as string[] : undefined,
          state: request.query.state ? (Array.isArray(request.query.state) ? request.query.state : [request.query.state]) as string[] : undefined,
          country: request.query.country ? (Array.isArray(request.query.country) ? request.query.country : [request.query.country]) as string[] : undefined,
          tags: request.query.tags ? (Array.isArray(request.query.tags) ? request.query.tags : [request.query.tags]) as string[] : undefined,
          minTotalSpent: request.query.minTotalSpent ? Number(request.query.minTotalSpent) : undefined,
          maxTotalSpent: request.query.maxTotalSpent ? Number(request.query.maxTotalSpent) : undefined,
          minTotalBookings: request.query.minTotalBookings ? Number(request.query.minTotalBookings) : undefined,
          maxTotalBookings: request.query.maxTotalBookings ? Number(request.query.maxTotalBookings) : undefined,
          startDate: request.query.startDate ? new Date(request.query.startDate as string) : undefined,
          endDate: request.query.endDate ? new Date(request.query.endDate as string) : undefined,
        },
        request.user.id
      );
      return response.status(200).json(clients);
    } catch (error) {
      next(error);
    }
  }

  async getClientsByIds(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const ids = request.query.ids ? (request.query.ids as string).split(',') : [];
      const clients = await clientService.getClientsByIds(ids);
      return response.status(200).json(clients);
    } catch (error) {
      next(error);
    }
  }

  async getClientById(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const client = await clientService.getClientById(request.params.id);
      return response.status(200).json(client);
    } catch (error) {
      next(error);
    }
  }

  async searchClients(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const searchTerm = request.query.search as string;
      const filters = {
        status: request.query.status ? (Array.isArray(request.query.status) ? request.query.status : [request.query.status]) as string[] : undefined,
        clientType: request.query.clientType ? (Array.isArray(request.query.clientType) ? request.query.clientType : [request.query.clientType]) as string[] : undefined,
        source: request.query.source ? (Array.isArray(request.query.source) ? request.query.source : [request.query.source]) as string[] : undefined,
      };
      const clients = await clientService.searchClients(searchTerm, filters);
      return response.status(200).json(clients);
    } catch (error) {
      next(error);
    }
  }

  async getClientStats(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const stats = await clientService.getClientStats();
      return response.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  }

  async updateClientStats(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const updatedClient = await clientService.updateClientStats(
        request.params.id,
        request.body
      );
      return response.status(200).json(updatedClient);
    } catch (error) {
      next(error);
    }
  }
}
