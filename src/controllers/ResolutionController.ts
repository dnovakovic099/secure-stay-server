import { NextFunction, Request, Response } from "express";
import { ResolutionService } from '../services/ResolutionService';
import { unparse } from "papaparse";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: {
        id: string;
    };
}

export class ResolutionController {
    private resolutionService: ResolutionService;

    constructor() {
        this.resolutionService = new ResolutionService();
    }

    createResolution = async (request: CustomRequest, response: Response, next: NextFunction) => {
        try {
            const userId = request.user.id;
            const resolutionData = await this.resolutionService.createResolution(request.body, userId);
            return response.send(resolutionData);
        } catch (error) {
            return next(error);
        }
    }

    getResolutions = async (request: CustomRequest, response: Response, next: NextFunction) => {
        try {
            const resolutions = await this.resolutionService.getResolutions(request.query);
            return response.send(resolutions);
        } catch (error) {
            return next(error);
        }
    }

    getResolutionById = async (request: CustomRequest, response: Response, next: NextFunction) => {
        try {
            const userId = request.user.id;
            const resolutionId = parseInt(request.params.resolutionId);
            const resolution = await this.resolutionService.getResolutionById(resolutionId, userId);
            return response.send(resolution);
        } catch (error) {
            return next(error);
        }
    }

    deleteResolution = async (request: CustomRequest, response: Response, next: NextFunction) => {
        try {
            const userId = request.user.id;
            const resolutionId = parseInt(request.params.resolutionId);
            await this.resolutionService.deleteResolution(resolutionId, userId);
            return response.send({ message: 'Resolution deleted successfully' });
        } catch (error) {
            return next(error);
        }
    }

    async updateResolution(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const resolutionService=new ResolutionService();
            const resolution = await resolutionService.updateResolution(request.body, userId);
            return response.status(200).json(resolution);
        } catch (error) {
            next(error);
        }
    }

    bulkUpdateResolutions = async (request: CustomRequest, response: Response, next: NextFunction) => {
        try {
            const userId = request.user.id;
            const { ids, updateData } = request.body;
            
            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return response.status(400).json({ error: 'IDs array is required and must not be empty' });
            }
            
            if (!updateData || typeof updateData !== 'object') {
                return response.status(400).json({ error: 'Update data is required' });
            }
            
            const result = await this.resolutionService.bulkUpdateResolutions(ids, updateData, userId);
            return response.status(200).json(result);
        } catch (error) {
            return next(error);
        }
    }

    getResolutionCategories = async (_request: CustomRequest, response: Response, next: NextFunction) => {
        try {
            return response.send(await this.resolutionService.getResolutionCategories());
        } catch (error) {
            return next(error);
        }
    }

    createResolutionCategory = async (request: CustomRequest, response: Response, next: NextFunction) => {
        try {
            return response.send(await this.resolutionService.createResolutionCategory(request.body));
        } catch (error) {
            return next(error);
        }
    }

    updateResolutionCategory = async (request: CustomRequest, response: Response, next: NextFunction) => {
        try {
            return response.send(await this.resolutionService.updateResolutionCategory(request.params.categoryId, request.body));
        } catch (error) {
            return next(error);
        }
    }

    reorderResolutionCategories = async (request: CustomRequest, response: Response, next: NextFunction) => {
        try {
            return response.send(await this.resolutionService.reorderResolutionCategories(request.body));
        } catch (error) {
            return next(error);
        }
    }

    getResolutionCategoryUsage = async (request: CustomRequest, response: Response, next: NextFunction) => {
        try {
            return response.send(await this.resolutionService.getResolutionCategoryUsage(request.params.categoryId));
        } catch (error) {
            return next(error);
        }
    }

    deleteResolutionCategory = async (request: CustomRequest, response: Response, next: NextFunction) => {
        try {
            return response.send(await this.resolutionService.deleteResolutionCategory(request.params.categoryId, request.body));
        } catch (error) {
            return next(error);
        }
    }

    async processCSVForResolution(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const resolutionService = new ResolutionService();
            if (!request.file) {
                return response.status(400).json({ message: "No file uploaded" });
            }

            const { failedToProcessData, successfullyProcessedData } = await resolutionService.processCSVFileForResolution(request.file.path, userId);
            
            if (failedToProcessData.length > 0) {
                const csv = unparse(failedToProcessData);

                response.setHeader("Content-Disposition", "attachment; filename=failed_resolutions.csv");
                response.setHeader("Content-Type", "text/csv");
                response.status(200).send(csv);
            } else {
                response.status(200).json({
                    success: true,
                    message: successfullyProcessedData.length > 0 ? `${successfullyProcessedData.length} records processed successfully` : "No records to process",
                    successfullyProcessedData,
                    failedToProcessData
                });
            }
        } catch (error) {
            next(error);
        }
    }

    async checkMultipleCSVForMissingResolutions(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const resolutionService = new ResolutionService();
            const files = request.files as Express.Multer.File[];

            if (!files || files.length === 0) {
                return response.status(400).json({ message: "No files uploaded" });
            }

            const fromDate = typeof request.body?.fromDate === "string" && request.body.fromDate.trim() ? request.body.fromDate.trim() : undefined;
            const toDate = typeof request.body?.toDate === "string" && request.body.toDate.trim() ? request.body.toDate.trim() : undefined;

            logger.info(`Checking ${files.length} CSV file(s) for missing resolutions${fromDate && toDate ? ` from ${fromDate} to ${toDate}` : ""}`);

            let allMissingRows: any[] = [];
            let allPresentRows: any[] = [];

            for (const file of files) {
                try {
                    const { missingRows, presentRows } = await resolutionService.checkCSVFileForMissingResolutions(file.path, fromDate, toDate);
                    allMissingRows = [...allMissingRows, ...missingRows];
                    allPresentRows = [...allPresentRows, ...presentRows];
                } catch (fileError) {
                    logger.error(`Failed to check file ${file.originalname}: ${fileError.message}`);
                }
            }

            if (allMissingRows.length > 0) {
                const csv = unparse(allMissingRows);

                response.setHeader("Content-Disposition", "attachment; filename=missing_resolutions.csv");
                response.setHeader("Content-Type", "text/csv");
                response.status(200).send(csv);
            } else {
                response.status(200).json({
                    success: true,
                    message: "No missing resolutions found",
                    filesProcessed: files.length,
                    missingCount: 0,
                    presentCount: allPresentRows.length
                });
            }
        } catch (error) {
            next(error);
        }
    }

    checkMultipleCSVForCancellationFeesWithoutRefunds = async (request: CustomRequest, response: Response, next: NextFunction) => {
        try {
            const files = request.files as Express.Multer.File[];

            if (!files || files.length === 0) {
                return response.status(400).json({ message: "No files uploaded" });
            }

            const fromDate = typeof request.body?.fromDate === "string" && request.body.fromDate.trim() ? request.body.fromDate.trim() : undefined;
            const toDate = typeof request.body?.toDate === "string" && request.body.toDate.trim() ? request.body.toDate.trim() : undefined;

            logger.info(`Checking ${files.length} CSV file(s) for cancellation fees without refunds${fromDate && toDate ? ` from ${fromDate} to ${toDate}` : ""}`);

            let allUnpairedRows: any[] = [];

            for (const file of files) {
                try {
                    const rows = await this.resolutionService.checkCancellationFeesWithoutRefunds(file.path, fromDate, toDate);
                    allUnpairedRows = [...allUnpairedRows, ...rows];
                } catch (fileError) {
                    logger.error(`Failed to process ${file.originalname}: ${fileError.message}`);
                }
            }

            if (allUnpairedRows.length > 0) {
                const csv = unparse(allUnpairedRows);
                response.setHeader("Content-Disposition", "attachment; filename=cancellation_fees_without_refunds.csv");
                response.setHeader("Content-Type", "text/csv");
                return response.status(200).send(csv);
            }

            return response.status(200).json({
                success: true,
                message: "No unpaired cancellation fees found",
                filesProcessed: files.length,
                unpairedCount: 0,
            });
        } catch (error) {
            next(error);
        }
    }

    async processMultipleCSVForResolution(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const resolutionService = new ResolutionService();
            const files = request.files as Express.Multer.File[];

            if (!files || files.length === 0) {
                return response.status(400).json({ message: "No files uploaded" });
            }

            logger.info(`Processing ${files.length} CSV file(s) for resolution`);

            let allFailedData: any[] = [];
            let allSuccessData: any[] = [];

            // Process each file sequentially
            for (const file of files) {
                try {
                    const { failedToProcessData, successfullyProcessedData } = await resolutionService.processCSVFileForResolution(file.path, userId);
                    allFailedData = [...allFailedData, ...failedToProcessData];
                    allSuccessData = [...allSuccessData, ...successfullyProcessedData];
                } catch (fileError) {
                    logger.error(`Failed to process file ${file.originalname}: ${fileError.message}`);
                    // Continue with other files even if one fails
                }
            }

            if (allFailedData.length > 0) {
                const csv = unparse(allFailedData);

                response.setHeader("Content-Disposition", "attachment; filename=failed_resolutions.csv");
                response.setHeader("Content-Type", "text/csv");
                response.status(200).send(csv);
            } else {
                response.status(200).json({
                    success: true,
                    message: allSuccessData.length > 0
                        ? `${allSuccessData.length} records processed successfully from ${files.length} file(s)`
                        : "No records to process",
                    successfullyProcessedData: allSuccessData,
                    failedToProcessData: allFailedData,
                    filesProcessed: files.length
                });
            }
        } catch (error) {
            next(error);
        }
    }
}
