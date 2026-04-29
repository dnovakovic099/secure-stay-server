import { NextFunction, Request, Response } from "express";
import { ClaimsService } from "../services/ClaimsService";
import { ClaimWorkspaceService } from "../services/ClaimWorkspaceService";
import path from "path";
import fs from "fs";

const UPLOADS_PATH = path.join(process.cwd(), 'public/claims'); 

export class ClaimsController {
    async getReportMetadata(request: any, response: Response) {
        const service = new ClaimWorkspaceService();
        try {
            const data = await service.getReportMetadata(request.user);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return response.status(400).json({ status: false, message: error.message });
        }
    }

    async getReservationCandidates(request: any, response: Response) {
        const service = new ClaimWorkspaceService();
        try {
            const listingId = request.query.listingId ? Number(request.query.listingId) : null;
            const windowOffset = request.query.windowOffset ? Number(request.query.windowOffset) : 0;
            const data = await service.getReservationCandidates(listingId, windowOffset);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return response.status(400).json({ status: false, message: error.message });
        }
    }

    async getClaims(request: Request, response: Response) {
        const claimsService = new ClaimsService();
        try {   
            const page = parseInt(request.query.page as string) || 1;
            const limit = parseInt(request.query.limit as string) || 10;
            const fromDate = request.query.fromDate as string || '';
            const toDate = request.query.toDate as string || '';
            const status = request.query.status as string || ''; 
            const listingId = request.query.listingId as string || '';
            const claimAmount = request.query.claimAmount as string;
            const guestName = request.query.guestName as string;
            const claimIds = request.query.claimIds as string;
            const propertyType = request.query.propertyType as string[];
            const keyword = request.query.keyword as string;

            const result = await claimsService.getClaims(
                page, 
                limit, 
                fromDate, 
                toDate, 
                status, 
                listingId,
                claimAmount,
                guestName,
                claimIds,
                propertyType,
                keyword
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

    async createClaim(request: any, response: Response) {
        const claimsService = new ClaimsService();
        const workspaceService = new ClaimWorkspaceService();
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

            if (request.body?.workspaceMode === "report-claim") {
                const result = await workspaceService.createReportClaim(request.body, request.user, request.files?.['attachments'] || []);
                return response.status(201).json({ status: true, data: result });
            }

            const result = await claimsService.createClaim(request.body, userId, fileInfo);
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

    async updateClaim(request: any, response: Response) {
        const claimsService = new ClaimsService();
        const workspaceService = new ClaimWorkspaceService();
        try {
            const id = parseInt(request.params.id);
            const userId = request.user.id;

            if (request.body?.workspaceMode === "claim-detail") {
                const result = await workspaceService.updateClaimDetail(id, request.body, request.user, request.files?.['attachments'] || []);
                return response.status(200).json({ status: true, data: result });
            }

            const currentClaim = await claimsService.getClaimById(id);
            console.log(currentClaim);
            const currentFiles = JSON.parse(currentClaim.fileNames || '[]');

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

            const updatedFiles = currentFiles.filter(file => !deletedFiles.includes(file));
            console.log({updatedFiles});

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

            const finalFileNames = [...updatedFiles, ...(fileInfo ? fileInfo.map(file => file.fileName) : [])];

            const result = await claimsService.updateClaim(id, {
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

    async deleteClaim(request: any, response: Response) {
        const claimsService = new ClaimsService();
        try {
            const { id } = request.params;
            const userId = request.user.id;
            await claimsService.deleteClaim(Number(id), userId);
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

    async exportClaimsToExcel(request: Request, response: Response) {
        const claimsService = new ClaimsService();
        const result = await claimsService.exportClaimsToExcel();
        return response.send(result);
    }

    async getAttachment(request: any, response: Response) {
        try {
            const fileName = request.params.fileName;
            const filePath = path.join(process.cwd(), 'public/claims', fileName);
            
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

    async bulkUpdateClaims(request: any, response: Response) {
        const claimsService = new ClaimsService();
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

            const result = await claimsService.bulkUpdateClaims(ids, updateData, userId);

            return response.status(200).json({
                status: true,
                ...result
            });
        } catch (error) {
            return response.status(400).json({
                status: false,
                message: error.message
            });
        }
    }

    async migrateFilesToDrive(request: Request, response: Response, next: NextFunction) {
        try {
            const claimsService = new ClaimsService();
            await claimsService.migrateFilesToDrive();
            return response.status(200).json({
                status: true,
                message: "Migration completed",
            });
        } catch (error) {
            return next(error);
        }
    }

    async getClaimDetail(request: any, response: Response) {
        const service = new ClaimWorkspaceService();
        try {
            const id = Number(request.params.id);
            const data = await service.getClaimDetail(id);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return response.status(400).json({ status: false, message: error.message });
        }
    }

    async getClaimDiscussion(request: any, response: Response) {
        const service = new ClaimWorkspaceService();
        try {
            const claimId = Number(request.params.id);
            const data = await service.getClaimDiscussionFeed(claimId);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return response.status(400).json({ status: false, message: error.message });
        }
    }

    async postClaimDiscussion(request: any, response: Response) {
        const service = new ClaimWorkspaceService();
        try {
            const claimId = Number(request.params.id);
            const content = String(request.body?.content || "").trim();
            const data = await service.postClaimDiscussionMessage(claimId, content, request.user, request.files?.["attachments"] || []);
            return response.status(201).json({ status: true, data });
        } catch (error) {
            return response.status(400).json({ status: false, message: error.message });
        }
    }

    async getClaimThreadInfo(request: any, response: Response) {
        const service = new ClaimWorkspaceService();
        try {
            const claimId = Number(request.params.id);
            const data = await service.getClaimThreadInfo(claimId);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return response.status(400).json({ status: false, message: error.message });
        }
    }

    async ensureClaimThread(request: any, response: Response) {
        const service = new ClaimWorkspaceService();
        try {
            const claimId = Number(request.params.id);
            const data = await service.ensureThreadForClaim(claimId, request.user);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return response.status(400).json({ status: false, message: error.message });
        }
    }

    async suggestClaimEntries(request: any, response: Response) {
        const service = new ClaimWorkspaceService();
        try {
            const descriptions = request.body?.descriptions ? String(request.body.descriptions) : null;
            const categories = request.body?.categories ? JSON.parse(String(request.body.categories)) : null;
            const data = await service.suggestClaimEntries(descriptions, categories, request.files?.["attachments"] || []);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return response.status(400).json({ status: false, message: error.message });
        }
    }
}
