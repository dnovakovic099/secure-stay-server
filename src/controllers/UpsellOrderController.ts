import { Request, Response } from "express";
import { UpsellOrderService } from "../services/UpsellOrderService";
import hostifyExtrasService from "../services/HostifyExtrasService";

interface CustomRequest extends Request {
    user?: any;
}
export class UpsellOrderController {
    async getHostifyExtras(request: Request, response: Response) {
        try {
            const extras = await hostifyExtrasService.getHostifyExtras();
            return response.status(200).json({
                status: true,
                data: extras,
                total: extras.length,
            });
        } catch (error: any) {
            return response.status(500).json({
                status: false,
                message: error?.message || "Failed to fetch Hostify extras",
            });
        }
    }

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
            const keywordField = request.query.keywordField as string || '';
            const propertyType = request.query.propertyType as string[] || [];
            const upsellType = request.query.upsellType as string[] || [];

            const dateTypeMapping: { [key: string]: string } = {
                'purchase': 'order_date',
                'arrival': 'arrival_date',
                'departure': 'departure_date',
                'requested': 'order_date',
            };

            const dateType = dateTypeMapping[frontendDateType] || 'order_date';

            const result = await upsellOrderService.getOrders(page, limit, fromDate, toDate, status, listingId, dateType, keyword, propertyType, upsellType, keywordField);
            
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

            const { status, cost, type } = request.body;

            // Validate required fields
            const missingFields: string[] = [];
            if (!status) missingFields.push('status');
            if (!type) missingFields.push('type (Upsell)');

            if (missingFields.length > 0) {
                return response.status(400).json({
                    status: false,
                    message: `Missing required fields: ${missingFields.join(', ')}`
                });
            }

            // Validate cost is a positive number (handle string input)
            const costValue = cost === undefined || cost === null || cost === ''
                ? 0
                : typeof cost === 'string' ? parseFloat(cost) : cost;
            if (isNaN(costValue) || costValue < 0) {
                return response.status(400).json({
                    status: false,
                    message: 'Upsell Fee must be a valid positive number'
                });
            }

            // Update cost in request body to be a number
            request.body.cost = costValue;
            request.body.listing_id = request.body.listing_id || '';
            request.body.client_name = request.body.client_name || '';
            request.body.description = request.body.description || '';
            request.body.order_date = request.body.order_date || null;

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
