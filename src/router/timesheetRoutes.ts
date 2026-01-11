import { Router } from "express";
import { TimesheetController } from "../controllers/TimesheetController";
import verifySession from "../middleware/verifySession";
import verifySuperAdmin from "../middleware/verifySuperAdmin";

const router = Router();

// All timesheet routes require super admin access
router.get("/timesheets", verifySession, verifySuperAdmin, TimesheetController.getTimesheets);
router.get("/timesheets/summary", verifySession, verifySuperAdmin, TimesheetController.getSummary);
router.get("/timesheets/employees", verifySession, verifySuperAdmin, TimesheetController.getEmployees);

export default router;
