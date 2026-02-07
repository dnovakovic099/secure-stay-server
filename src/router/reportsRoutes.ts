import { Router } from "express";
import { ReportsController } from "../controllers/ReportsController";
import { OccupancyPerformanceController } from "../controllers/OccupancyPerformanceController";
import { NoBookingReportController } from "../controllers/NoBookingReportController";
import verifySession from "../middleware/verifySession";

const router = Router();
const reportsController = new ReportsController();
const occupancyPerformanceController = new OccupancyPerformanceController();
const noBookingReportController = new NoBookingReportController();

router.route('/').get(verifySession, reportsController.getReports);
router.route('/occupancy-performance').get(verifySession, occupancyPerformanceController.getReport);
router.route('/occupancy-performance/tags').get(verifySession, occupancyPerformanceController.getTags);
router.route('/no-booking').get(verifySession, noBookingReportController.getReport);
router.route('/no-booking/tags').get(verifySession, noBookingReportController.getTags);

export default router;