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
} 