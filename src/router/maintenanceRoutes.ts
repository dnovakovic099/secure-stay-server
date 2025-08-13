import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { MaintenanceController } from "../controllers/MaintenanceController";
import { validateCreateMaintenance, validateUpdateMaintenance, validateGetMaintenance } from "../middleware/validation/maintenance/maintenance.validation";

const router = Router();
const maintenanceController = new MaintenanceController();

router.route('/').get(verifySession, validateGetMaintenance, maintenanceController.getMaintenace);
router.route('/create').post(verifySession, validateCreateMaintenance, maintenanceController.createMaintenace);
router.route('/update').put(verifySession, validateUpdateMaintenance, maintenanceController.updateMaintenace);
router.route('/delete/:id').delete(verifySession, maintenanceController.deleteMaintenace);

export default router;
