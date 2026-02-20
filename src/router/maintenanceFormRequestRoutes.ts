import { Router } from "express";
import { MaintenanceFormRequestController } from "../controllers/MaintenanceFormRequestController";
import verifySession from "../middleware/verifySession";
import { validateCreateMaintenanceFormRequest, validateUpdateMaintenanceFormRequest } from "../middleware/validation/maintenanceFormRequest.validation";

const router = Router();
const controller = new MaintenanceFormRequestController();

// Get all maintenance form requests with pagination and filtering
router.get('/', verifySession, controller.getAll.bind(controller));

// Get maintenance form request for a property
router.get('/property/:propertyId', verifySession, controller.getByProperty.bind(controller));

// Create/submit maintenance form request for a property
router.post('/property/:propertyId', verifySession, validateCreateMaintenanceFormRequest, controller.create.bind(controller));

// Update maintenance form request
router.put('/:id', verifySession, validateUpdateMaintenanceFormRequest, controller.update.bind(controller));

export default router;
