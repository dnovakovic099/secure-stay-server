import { Router } from 'express';
import { EmployeeScheduleController } from '../controllers/EmployeeScheduleController';
import verifySession from '../middleware/verifySession';

const router = Router();
const scheduleController = new EmployeeScheduleController();

// Get shift types
router.get('/shift-types', verifySession, scheduleController.getShiftTypes);

// Get all schedules with filters
router.get('/', verifySession, scheduleController.getSchedules);

// Get schedules for a specific employee
router.get('/employee/:employeeId', verifySession, scheduleController.getSchedulesByEmployee);

// Create single schedule
router.post('/', verifySession, scheduleController.createSchedule);

// Create weekly recurring schedules
router.post('/recurring', verifySession, scheduleController.createRecurring);

// Update schedule
router.put('/:id', verifySession, scheduleController.updateSchedule);

// Delete schedule
router.delete('/:id', verifySession, scheduleController.deleteSchedule);

export default router;
