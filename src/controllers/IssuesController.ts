import { NextFunction, Request, Response } from "express";
import { IssuesService } from "../services/IssuesService";
import path from 'path';
import fs from 'fs';

const UPLOADS_PATH = path.join(process.cwd(), 'public/issues'); 

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
            const issueIds = request.query.issueIds as string;

            const result = await issuesService.getIssues(
                page, 
                limit, 
                fromDate, 
                toDate, 
                status, 
                listingId,
                isClaimOnly,
                claimAmount,
                guestName,
                issueIds
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
            
            // Get current issue
            const currentIssue = await issuesService.getIssueById(id);
            const currentFiles = JSON.parse(currentIssue.fileNames || '[]');
            
            // Process deleted files
            const deletedFiles = JSON.parse(request.body.deletedFiles || '[]');
            
            // Delete files physically
            for (const fileName of deletedFiles) {
                const filePath = path.join(UPLOADS_PATH, fileName);
                try {
                    await fs.promises.unlink(filePath);
                } catch (err) {
                    console.error(`Failed to delete file ${fileName}:`, err);
                }
            }
            
            // Update file list, removing deleted files
            const updatedFiles = currentFiles.filter(file => !deletedFiles.includes(file));
            
            // Add new files if they exist
            let newFiles: string[] = [];
            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                newFiles = (request.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }
            // Combine existing and new files
            const finalFileNames = [...updatedFiles, ...newFiles];
            // Update issue data with new file list
            const result = await issuesService.updateIssue(id, {
                ...request.body,
                fileNames: JSON.stringify(finalFileNames)
            }, userId, newFiles);

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

    async getIssuesByReservationId(request: Request, response: Response, next: NextFunction) {
        try {
            const reservationId = request.params.reservationId;
            const issuesService = new IssuesService();
            const issues = await issuesService.getIssuesByReservationId(reservationId);
            return response.json({
                status: true,
                data: issues
            });

        } catch (error) {
            return next(error);
        }
    }

    async getAttachment(request: any, response: Response) {
        try {
            const fileName = request.params.fileName;
            const filePath = path.join(process.cwd(), 'public/issues', fileName);
            
            // Check if file exists
            try {
                await fs.promises.access(filePath);
            } catch {
                return response.status(404).json({
                    status: false,
                    message: 'File not found'
                });
            }

            // Send file
            return response.sendFile(filePath);
        } catch (error) {
            return response.status(400).json({
                status: false,
                message: error.message
            });
        }
    }
} 