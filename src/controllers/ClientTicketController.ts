import { NextFunction, Request, Response } from "express";
import { ClientTicketService } from "../services/ClientTicketServices";

interface CustomRequest extends Request {
    user?: any;
}

export class ClientTicketController {
    async createClientTicket(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user?.id;
            const ticketService = new ClientTicketService();
            const result = await ticketService.saveClientTicketWithUpdates(request.body, userId);

            return response.status(201).json({
                success: true,
                message: "Client ticket created successfully",
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async getClientTickets(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const filter = request.query as any; // Assuming filter is passed as query parameters
            const ticketService = new ClientTicketService();
            const result = await ticketService.getClientTicket(filter, request.user?.id);

            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async getClientTicketById(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { id } = request.params;
            const ticketService = new ClientTicketService();
            const result = await ticketService.getClientTicketById(Number(id));

            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async updateClientTicket(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user?.id;

            const ticketService = new ClientTicketService();
            const result = await ticketService.updateClientTicketWithUpdates(request.body, userId);

            return response.status(200).json({
                success: true,
                message: "Client ticket updated successfully",
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async deleteClientTicket(request: CustomRequest, response: Response, next: NextFunction) {
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

    async updateClientTicketStatus(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user?.id;
            const { id, status } = request.body;

            const ticketService = new ClientTicketService();
            const result = await ticketService.updateClientTicketStatus(id, status, userId);

            return response.status(200).json({
                success: true,
                message: "Client ticket status updated successfully",
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async saveClientTicketUpdates(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user?.id;
            const ticketService = new ClientTicketService();
            const result = await ticketService.saveClientTicketUpdates(request.body, userId);

            return response.status(201).json({
                success: true,
                message: "Ticket updates created successfully",
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async updateClientTicketUpdates(request: CustomRequest, response: Response, next: NextFunction){
        try {
            const userId = request.user?.id;
            const ticketService = new ClientTicketService();
            const result = await ticketService.updateTicketUpdates(request.body, userId);

            return response.status(201).json({
                success: true,
                message: "Ticket updates updated successfully",
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async deleteClientTicketUpdate(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { id } = request.params;
            const userId = request.user?.id;

            const ticketService = new ClientTicketService();
            const result = await ticketService.deleteClientTicketUpdate(Number(id), userId);

            return response.status(200).json({
                success: true,
                message: "Client ticket deleted successfully",
            });
        } catch (error) {
            next(error);
        }
    }
}