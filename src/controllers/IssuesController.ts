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

    async createIssue(request: any, response: Response) {
        const issuesService = new IssuesService();
        try {
            const userId = request.user.id;

            let fileNames: string[] = [];
            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                fileNames = (request.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }

            const result = await issuesService.createIssue(request.body, userId, fileNames);
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

    async updateIssue(request: any, response: Response) {
        const issuesService = new IssuesService();
        try {
            const id = parseInt(request.params.id);
            const userId = request.user.id;

            let fileNames: string[] = [];
            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                fileNames = (request.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }

            const result = await issuesService.updateIssue(id, request.body, userId, fileNames);
            return response.status(200).json({
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