import { NextFunction, Request, Response } from "express";
import { ClientTicketService } from "../services/ClientTicketServices";

interface CustomRequest extends Request {
  user?: any;
}

export class ClientTicketController {
  async createClientTicket(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userId = request.user?.id;
      const ticketService = new ClientTicketService();
      const result = await ticketService.saveClientTicketWithUpdates(
        request.body,
        userId
      );

      return response.status(201).json({
        success: true,
        message: "Client ticket created successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getClientTickets(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const filter = request.query as any; // Assuming filter is passed as query parameters
      const ticketService = new ClientTicketService();
      const result = await ticketService.getClientTicket(
        filter,
        request.user?.id
      );

      return response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getClientTicketById(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const { id } = request.params;
      const ticketService = new ClientTicketService();
      const { slackLink, clientTicket } = await ticketService.getClientTicketById(Number(id));

      return response.status(200).json({ slackLink, clientTicket });
    } catch (error) {
      next(error);
    }
  }

  async updateClientTicket(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userId = request.user?.id;

      const ticketService = new ClientTicketService();
      const result = await ticketService.updateClientTicketWithUpdates(
        request.body,
        userId
      );

      return response.status(200).json({
        success: true,
        message: "Client ticket updated successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteClientTicket(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const { id } = request.params;
      const userId = request.user?.id;

      const ticketService = new ClientTicketService();
      const result = await ticketService.deleteClientTicket(Number(id), userId);

      return response.status(200).json({
        success: true,
        message: "Client ticket deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  async updateClientTicketStatus(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userId = request.user?.id;
      const { id, status } = request.body;

      const ticketService = new ClientTicketService();
      const result = await ticketService.updateClientTicketStatus(
        id,
        status,
        userId
      );

      return response.status(200).json({
        success: true,
        message: "Client ticket status updated successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async saveClientTicketUpdates(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userId = request.user?.id;
      const ticketService = new ClientTicketService();
      const result = await ticketService.saveClientTicketUpdates(
        request.body,
        userId
      );

      return response.status(201).json({
        success: true,
        message: "Ticket updates created successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateClientTicketUpdates(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userId = request.user?.id;
      const ticketService = new ClientTicketService();
      const result = await ticketService.updateTicketUpdates(
        request.body,
        userId
      );

      return response.status(201).json({
        success: true,
        message: "Ticket updates updated successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteClientTicketUpdate(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const { id } = request.params;
      const userId = request.user?.id;

      const ticketService = new ClientTicketService();
      const result = await ticketService.deleteClientTicketUpdate(
        Number(id),
        userId
      );

      return response.status(200).json({
        success: true,
        message: "Client ticket deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  async bulkUpdateClientTickets(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const { ids, updateData } = request.body;
      const userId = request.user?.id;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return response.status(400).json({
          success: false,
          message: "IDs array is required and must not be empty",
        });
      }

      if (!updateData || typeof updateData !== "object") {
        return response.status(400).json({
          success: false,
          message: "Update data is required and must be an object",
        });
      }

      const ticketService = new ClientTicketService();
      const result = await ticketService.bulkUpdateClientTickets(
        ids,
        updateData,
        userId
      );

      return response.status(200).json({
        success: true,
        message: "Client tickets updated successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateAssignee(request: any, response: Response, next: NextFunction) {
    try {
      const { id, assignee } = request.body;
      const userId = request.user.id;

      const clientTicketService = new ClientTicketService();
      const result = await clientTicketService.updateAssignee(
        id,
        assignee,
        userId
      );

      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateUrgency(request: any, response: Response, next: NextFunction) {
    try {
      const { id, urgency } = request.body;
      const userId = request.user.id;

      const clientTicketService = new ClientTicketService();
      const result = await clientTicketService.updateUrgency(
        id,
        urgency,
        userId
      );

      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateMistake(request: any, response: Response, next: NextFunction) {
    try {
      const { id, mistake } = request.body;
      const userId = request.user.id;

      const clientTicketService = new ClientTicketService();
      const result = await clientTicketService.updateMistake(
        id,
        mistake,
        userId
      );

      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  // У ClientTicketController
  async exportTickets(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userId = request.user?.id;
      const {
        fromDate,
        toDate,
        status,
        listingId,
        category,
        propertyType,
        keyword,
      } = request.query as any;

      const filters = {
        fromDate: fromDate as string,
        toDate: toDate as string,
        status: status
          ? ((Array.isArray(status) ? status : [status]) as string[])
          : undefined,
        listingId: listingId
          ? ((Array.isArray(listingId) ? listingId : [listingId]) as string[])
          : undefined,
        category: category
          ? ((Array.isArray(category) ? category : [category]) as string[])
          : undefined,
        propertyType: propertyType
          ? ((Array.isArray(propertyType)
              ? propertyType
              : [propertyType]) as string[])
          : undefined,
        keyword: keyword as string,
        userId: userId,
      };

      const ticketService = new ClientTicketService();
      const csvBuffer = await ticketService.exportTicketsToExcel(filters);
      response.send(csvBuffer);
    } catch (error) {
      return response
        .status(500)
        .json({ error: "Failed to export client tickets" });
    }
  }
}
