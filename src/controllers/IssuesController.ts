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
            const reservationId = request.query.reservationId as string;

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
                issueIds,
                reservationId
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

    async getUnresolvedIssues(request: Request, response: Response) {
        const issuesService = new IssuesService();
        const listingId = request.query.listingId as string || '';
        const issues = await issuesService.getIssuesByListingId(listingId);
        return response.json({
            status: true,
            data: issues
        });
    }

    async createIssue(request: any, response: Response) {
        const issuesService = new IssuesService();
        try {
            const userId = request.user.id;

            let fileInfo: { fileName: string, filePath: string, mimeType: string; originalName: string; }[] | null = null;

            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                fileInfo = (request.files['attachments'] as Express.Multer.File[]).map(file => {
                    return {
                        fileName: file.filename,
                        filePath: file.path,
                        mimeType: file.mimetype,
                        originalName: file.originalname
                    };
                }
                );
            }

            const result = await issuesService.createIssue(request.body, userId, fileInfo);
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

            let fileInfo: { fileName: string, filePath: string, mimeType: string; originalName: string; }[] | null = null;

            if (Array.isArray(request.files['attachments']) && request.files['attachments'].length > 0) {
                fileInfo = (request.files['attachments'] as Express.Multer.File[]).map(file => {
                    return {
                        fileName: file.filename,
                        filePath: file.path,
                        mimeType: file.mimetype,
                        originalName: file.originalname
                    };
                }
                );
            }
            // Combine existing and new files
            const finalFileNames = [...updatedFiles, ...(fileInfo ? fileInfo.map(file => file.fileName) : [])];
            // Update issue data with new file list
            const result = await issuesService.updateIssue(id, {
                ...request.body,
                fileNames: JSON.stringify(finalFileNames)
            }, userId, fileInfo);

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

    async deleteIssue(request: any, response: Response, next: NextFunction) {
        try {
            const { id } = request.params;
            const userId = request.user.id;

            const issuesService = new IssuesService();
            await issuesService.deleteIssue(Number(id), userId);

            return response.send({
                status: true,
                message: "Issue deleted successfully"
            });
        } catch (error) {
            next(error);
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

    async migrateIssuesToActionItems(request: any, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const issuesService = new IssuesService();
            const result = await issuesService.migrateIssueToActionItems(request.body, userId);
            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async createIssueUpdates(request: any, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const issuesService = new IssuesService();
            const result = await issuesService.createIssueUpdates(request.body, userId);
            return response.status(201).json({
                status: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async updateIssueUpdates(request: any, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const issuesService = new IssuesService();
            const result = await issuesService.updateIssueUpdates(request.body, userId);
            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async deleteIssueUpdates(request: any, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const issuesService = new IssuesService();
            const result = await issuesService.deleteIssueUpdates(request.params.id, userId);
            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async getGuestIssues(request: any, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const issuesService = new IssuesService();
            const { issues, total } = await issuesService.getGuestIssues(request.query, userId);
            return response.status(200).json({
                status: true,
                data: issues,
                total
            })
        } catch (error) {
            next(error);
        }
    }

    async bulkUpdateIssues(request: any, response: Response, next: NextFunction) {
        try {
            const { ids, updateData } = request.body;
            const userId = request.user.id;

            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return response.status(400).json({ 
                    status: false,
                    message: "IDs array is required and must not be empty" 
                });
            }

            if (!updateData || Object.keys(updateData).length === 0) {
                return response.status(400).json({ 
                    status: false,
                    message: "Update data is required and must not be empty" 
                });
            }

            const issuesService = new IssuesService();
            const result = await issuesService.bulkUpdateIssues(ids, updateData, userId);

            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async migrateFilesToDrive(request: any, response: Response, next: NextFunction) {
        try {
            const issuesService = new IssuesService();
            const result = await issuesService.migrateFilesToDrive();
            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async updateAssignee(request: any, response: Response, next: NextFunction) {
        try {
            const { id, assignee } = request.body;
            const userId = request.user.id;

            const issuesService = new IssuesService();
            const result = await issuesService.updateAssignee(id, assignee, userId);

            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async updateUrgency(request: any, response: Response, next: NextFunction) {
        try {
            const { id, urgency } = request.body;
            const userId = request.user.id;

            const issuesService = new IssuesService();
            const result = await issuesService.updateUrgency(id, urgency, userId);

            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async updateMistake(request: any, response: Response, next: NextFunction) {
        try {
            const { id, mistake } = request.body;
            const userId = request.user.id;

            const issuesService = new IssuesService();
            const result = await issuesService.updateMistake(id, mistake, userId);

            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async updateStatus(request: any, response: Response, next: NextFunction) {
        try {
            const { id, status } = request.body;
            const userId = request.user.id;

            const issuesService = new IssuesService();
            const result = await issuesService.updateStatus(id, status, userId);

            return response.status(200).json({
                status: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }
} 