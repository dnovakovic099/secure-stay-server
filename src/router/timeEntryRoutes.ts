import { Router } from 'express';
import { TimeEntryController } from '../controllers/TimeEntryController';
import verifySession from '../middleware/verifySession';

const router = Router();
const controller = new TimeEntryController();

// All routes require authentication
router.post('/clock-in', verifySession, controller.clockIn);
router.post('/clock-out', verifySession, controller.clockOut);
router.get('/status', verifySession, controller.getStatus);
router.get('/summary', verifySession, controller.getSummary);
router.get('/', verifySession, controller.getTimeEntries);
router.delete('/:id', verifySession, controller.deleteEntry);
router.patch('/:id/notes', verifySession, controller.updateNotes);

export default router;

