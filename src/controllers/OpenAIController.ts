import { Request, Response, NextFunction } from "express";
import { OpenAIService } from "../services/OpenAIService";

interface CustomRequest extends Request {
    user?: {
        id: string;
    };
}

export class OpenAIController {
    /**
     * Generate full listing descriptions for a property
     * POST /openai/generate-listing-descriptions/:propertyId
     * Body: { additionalNotes?: string }
     */
    public async generateListingDescriptions(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const { propertyId } = req.params;
            const { additionalNotes } = req.body || {};

            if (!propertyId) {
                return res.status(400).json({ error: "Property ID is required" });
            }

            const openAIService = new OpenAIService();
            const descriptions = await openAIService.generateListingDescriptions(propertyId, additionalNotes);

            return res.status(200).json({
                success: true,
                data: descriptions
            });
        } catch (error: any) {
            if (error.message?.includes("not found")) {
                return res.status(404).json({ error: error.message });
            }
            if (error.message?.includes("OPENAI_API_KEY")) {
                return res.status(500).json({ error: "OpenAI API key not configured" });
            }
            next(error);
        }
    }

    /**
     * Generate only titles for a property
     * POST /openai/generate-titles/:propertyId
     * Body: { additionalNotes?: string }
     */
    public async generateTitles(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const { propertyId } = req.params;
            const { additionalNotes } = req.body || {};

            if (!propertyId) {
                return res.status(400).json({ error: "Property ID is required" });
            }

            const openAIService = new OpenAIService();
            const titles = await openAIService.generateTitlesOnly(propertyId, additionalNotes);

            return res.status(200).json({
                success: true,
                data: { titles }
            });
        } catch (error: any) {
            if (error.message?.includes("not found")) {
                return res.status(404).json({ error: error.message });
            }
            if (error.message?.includes("OPENAI_API_KEY")) {
                return res.status(500).json({ error: "OpenAI API key not configured" });
            }
            next(error);
        }
    }

    /**
     * Get property data that will be used for generation (for preview/debugging)
     * GET /openai/property-data/:propertyId
     */
    public async getPropertyDataForGeneration(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const { propertyId } = req.params;

            if (!propertyId) {
                return res.status(400).json({ error: "Property ID is required" });
            }

            const openAIService = new OpenAIService();
            const propertyData = await openAIService.getPropertyDataForGeneration(propertyId);

            if (!propertyData) {
                return res.status(404).json({ error: `Property with ID ${propertyId} not found` });
            }

            return res.status(200).json({
                success: true,
                data: propertyData
            });
        } catch (error: any) {
            if (error.message?.includes("OPENAI_API_KEY")) {
                return res.status(500).json({ error: "OpenAI API key not configured" });
            }
            next(error);
        }
    }
}
