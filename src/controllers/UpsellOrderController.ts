import { Request, Response } from "express";
import { UpsellOrderService } from "../services/UpsellOrderService";

interface CustomRequest extends Request {
    user?: any;
}
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
            const frontendDateType = request.query.dateType as string || 'purchase';
            const keyword = request.query.keyword as string || '';
            const propertyType = request.query.propertyType as string || '';

            const dateTypeMapping: { [key: string]: string } = {
                'purchase': 'order_date',
                'arrival': 'arrival_date',
                'departure': 'departure_date'
            };

            const dateType = dateTypeMapping[frontendDateType] || 'order_date';

            const result = await upsellOrderService.getOrders(page, limit, fromDate, toDate, status, listingId, dateType, keyword, propertyType);
            
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

    async createOrder(request: CustomRequest, response: Response) {
        const upsellOrderService = new UpsellOrderService();
        const userId = request.user.id;
        try {

            if (!request.body || Object.keys(request.body).length === 0) {
                return response.status(400).json({
                    status: false,
                    message: 'Request body is empty'
                });
            }

            const result = await upsellOrderService.createOrder(request.body, userId);
            return response.status(201).json({
                status: true,
                data: result
            });
        } catch (error) {
            return response.status(400).json({
                status: false,
                message: error.message
            });
        }
    }

    async updateOrder(request: CustomRequest, response: Response) {
        const upsellOrderService = new UpsellOrderService();
        const userId = request.user.id;
        try {
            const { id } = request.params;

            if (!id || isNaN(Number(id))) {
                return response.status(400).json({
                    status: false,
                    message: 'Invalid order ID'
                });
            }

            const result = await upsellOrderService.updateOrder(Number(id), request.body, userId);

            if (!result) {
                return response.status(404).json({
                    status: false,
                    message: 'Order not found'
                });
            }

            return response.send({
                status: true,
                data: result
            });
        } catch (error) {
              return response.status(400).json({
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

    // async processCheckoutDateUpsells(request: Request, response: Response) {
    //     try {
    //         const { date } = request.body;
    //         const upsellOrderService = new UpsellOrderService();
    //         await upsellOrderService.processCheckoutDateUpsells(date);
    //         return response.send({
    //             status: true,
    //             message: 'Processed checkout date upsells successfully.'
    //         });
    //     } catch (error) {
    //         return response.status(500).json({
    //             status: false,
    //             message: error.message
    //         });
    //     }
    // }
} 