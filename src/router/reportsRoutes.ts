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
router.route('/reviews/templates').get(verifySession, reportsController.getReviewReportTemplates.bind(reportsController));
router.route('/reviews')
    .get(verifySession, reportsController.listReviewReports.bind(reportsController))
    .post(verifySession, reportsController.createReviewReport.bind(reportsController));
router.route('/reviews/:reportId').get(verifySession, reportsController.getReviewReport.bind(reportsController));
router.route('/reviews/:reportId/revise').post(verifySession, reportsController.reviseReviewReport.bind(reportsController));
router.route('/reviews/:reportId/regenerate').post(verifySession, reportsController.regenerateReviewReport.bind(reportsController));
router.route('/reviews/:reportId/sections/:sectionKey').patch(verifySession, reportsController.updateReviewReportSection.bind(reportsController));

export default router;
