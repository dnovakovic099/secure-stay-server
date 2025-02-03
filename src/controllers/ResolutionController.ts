import { NextFunction, Request, Response } from "express";
import { ResolutionService } from '../services/ResolutionService';

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
            const userId = request.user.id;
            const resolutions = await this.resolutionService.getResolutions(request, userId);
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
} 