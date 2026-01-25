import { Router } from "express";
import { ReportsController } from "../controllers/ReportsController";
import { OccupancyPerformanceController } from "../controllers/OccupancyPerformanceController";
import verifySession from "../middleware/verifySession";

const router = Router();
const reportsController = new ReportsController();
const occupancyPerformanceController = new OccupancyPerformanceController();

router.route('/').get(verifySession, reportsController.getReports);
router.route('/occupancy-performance').get(verifySession, occupancyPerformanceController.getReport);
router.route('/occupancy-performance/tags').get(verifySession, occupancyPerformanceController.getTags);

export default router;