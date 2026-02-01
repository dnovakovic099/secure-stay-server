import { Router } from "express";
import { PhotographerRequestController } from "../controllers/PhotographerRequestController";
import verifySession from "../middleware/verifySession";
import { validateCreatePhotographerRequest, validateUpdatePhotographerRequest } from "../middleware/validation/photographerRequest.validation";

const router = Router();
const controller = new PhotographerRequestController();

// Get photographer request for a property
router.get('/property/:propertyId', verifySession, controller.getByProperty.bind(controller));

// Create/submit photographer request for a property
router.post('/property/:propertyId', verifySession, validateCreatePhotographerRequest, controller.create.bind(controller));

// Update photographer request
router.put('/:id', verifySession, validateUpdatePhotographerRequest, controller.update.bind(controller));

// Get distinct onboarding reps for dropdown
router.get('/onboarding-reps', verifySession, controller.getDistinctOnboardingReps.bind(controller));

export default router;
