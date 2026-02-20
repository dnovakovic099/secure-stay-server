import { Router } from "express";
import { ItemSupplyRequestController } from "../controllers/ItemSupplyRequestController";
import verifySession from "../middleware/verifySession";
import { validateCreateItemSupplyRequest, validateUpdateItemSupplyRequest } from "../middleware/validation/itemSupplyRequest.validation";

const router = Router();
const controller = new ItemSupplyRequestController();

// Get all item/supply requests with pagination and filtering
router.get('/', verifySession, controller.getAll.bind(controller));

// Get item/supply request for a property
router.get('/property/:propertyId', verifySession, controller.getByProperty.bind(controller));

// Create/submit item/supply request for a property
router.post('/property/:propertyId', verifySession, validateCreateItemSupplyRequest, controller.create.bind(controller));

// Update item/supply request
router.put('/:id', verifySession, validateUpdateItemSupplyRequest, controller.update.bind(controller));

export default router;
