import { Router } from "express";
import { CleanerRequestController } from "../controllers/CleanerRequestController";
import verifySession from "../middleware/verifySession";
import { validateCreateCleanerRequest, validateUpdateCleanerRequest } from "../middleware/validation/cleanerRequest.validation";

const router = Router();
const controller = new CleanerRequestController();

// Get cleaner request for a property
router.get('/property/:propertyId', verifySession, controller.getByProperty.bind(controller));

// Create/submit cleaner request for a property
router.post('/property/:propertyId', verifySession, validateCreateCleanerRequest, controller.create.bind(controller));

// Update cleaner request
router.put('/:id', verifySession, validateUpdateCleanerRequest, controller.update.bind(controller));

export default router;
