import { Request, Response } from "express";
import { UpsellOrderService } from "../services/UpsellOrderService";

export class UpsellOrderController {
    async getOrders(request: Request, response: Response) {
        const upsellOrderService = new UpsellOrderService();
        try {
            const page = parseInt(request.query.page as string) || 1;
            const limit = parseInt(request.query.limit as string) || 10;
            const fromDate = request.query.fromDate as string || '';
            const toDate = request.query.toDate as string || '';
            const status = request.query.status as string || ''; 
            const listingId = request.query.listingId as string || ''; 

            const result = await upsellOrderService.getOrders(page, limit, fromDate, toDate, status, listingId);
            
            return response.send({
                status: true,
                ...result
            });
        } catch (error) {
            return response.send({
                status: false,
                message: error.message
            });
        }
    }

    async createOrder(request: Request, response: Response) {
        const upsellOrderService = new UpsellOrderService();
        try {
            const result = await upsellOrderService.createOrder(request.body);
            return response.send({
                status: true,
                data: result
            });
        } catch (error) {
            return response.send({
                status: false,
                message: error.message
            });
        }
    }

    async updateOrder(request: Request, response: Response) {
        const upsellOrderService = new UpsellOrderService();
        try {
            const { id } = request.params;
            const result = await upsellOrderService.updateOrder(Number(id), request.body);
            return response.send({
                status: true,
                data: result
            });
        } catch (error) {
            return response.send({
                status: false,
                message: error.message
            });
        }
    }

    async deleteOrder(request: Request, response: Response) {
        const upsellOrderService = new UpsellOrderService();
        try {
            const { id } = request.params;
            await upsellOrderService.deleteOrder(Number(id));
            return response.send({
                status: true,
                message: "Order deleted successfully"
            });
        } catch (error) {
            return response.send({
                status: false,
                message: error.message
            });
        }
    }
} 