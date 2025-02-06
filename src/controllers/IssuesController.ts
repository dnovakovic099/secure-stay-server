import { Request, Response } from "express";
import { IssuesService } from "../services/IssuesService";

export class IssuesController {
    async getIssues(request: Request, response: Response) {
        const issuesService = new IssuesService();
        try {   
            const page = parseInt(request.query.page as string) || 1;
            const limit = parseInt(request.query.limit as string) || 10;
            const fromDate = request.query.fromDate as string || '';
            const toDate = request.query.toDate as string || '';
            const status = request.query.status as string || ''; 
            const listingId = request.query.listingId as string || '';
            const isClaimOnly = request.query.isClaimOnly === 'true';
            const claimAmount = request.query.claimAmount as string;
            const guestName = request.query.guestName as string;

            const result = await issuesService.getIssues(
                page, 
                limit, 
                fromDate, 
                toDate, 
                status, 
                listingId,
                isClaimOnly,
                claimAmount,
                guestName
            );
            
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

    async createIssue(request: Request, response: Response) {
        const issuesService = new IssuesService();
        try {

            if (!request.body || Object.keys(request.body).length === 0) {
                return response.status(400).json({
                    status: false,
                    message: 'Request body is empty'
                });
            }

            const result = await issuesService.createIssue(request.body);
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

    async updateIssue(request: Request, response: Response) {
        const issuesService = new IssuesService();
        try {
            const { id } = request.params;

            if (!id || isNaN(Number(id))) {
                return response.status(400).json({
                    status: false,
                    message: 'Invalid order ID'
                });
            }

            const result = await issuesService.updateIssue(Number(id), request.body);

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

    async deleteIssue(request: Request, response: Response) {
        const issuesService = new IssuesService();
        try {
            const { id } = request.params;
            await issuesService.deleteIssue(Number(id));
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

    async exportIssuesToExcel(request: Request, response: Response) {
        const issuesService = new IssuesService();
        const result = await issuesService.exportIssuesToExcel();
        return response.send(result);
    }
} 