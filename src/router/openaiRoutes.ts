import { Router } from "express";
import { OpenAIController } from "../controllers/OpenAIController";

const router = Router();
const openAIController = new OpenAIController();

/**
 * OpenAI Listing Description Generation Routes
 * 
 * POST /generate-listing-descriptions/:propertyId - Generate full listing descriptions
 * POST /generate-titles/:propertyId - Generate only title options
 * GET /property-data/:propertyId - Get property data for preview/debugging
 */

// Generate full listing descriptions for a property
router.post(
    "/generate-listing-descriptions/:propertyId",
    openAIController.generateListingDescriptions.bind(openAIController)
);

// Generate only titles for a property
router.post(
    "/generate-titles/:propertyId",
    openAIController.generateTitles.bind(openAIController)
);

// Get property data that will be used for generation (preview/debugging)
router.get(
    "/property-data/:propertyId",
    openAIController.getPropertyDataForGeneration.bind(openAIController)
);

// Generate "The Space" section for a property
router.post(
    "/generate-the-space/:propertyId",
    openAIController.generateTheSpace.bind(openAIController)
);

export default router;
