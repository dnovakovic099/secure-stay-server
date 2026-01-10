import { Router } from 'express';
import { TimeEntryController } from '../controllers/TimeEntryController';
import verifySession from '../middleware/verifySession';
import verifyAdmin from '../middleware/verifyAdmin';
import verifySuperAdmin from '../middleware/verifySuperAdmin';

const router = Router();
const controller = new TimeEntryController();

// Admin routes (should come before generic /:id routes if they conflict, but here they are prefixed with /admin)
router.get('/admin/overview', [verifySession, verifyAdmin], controller.getAdminOverview);
router.get('/admin/entries', [verifySession, verifyAdmin], controller.getAllEntriesAdmin);
// Super admin only routes for testing
router.post('/admin/test-entry', [verifySession, verifySuperAdmin], controller.createTestEntry);
router.post('/admin/process-missed-clockouts', [verifySession, verifySuperAdmin], controller.processMissedClockouts);

// All regular routes require authentication
router.post('/clock-in', verifySession, controller.clockIn);
router.post('/clock-out', verifySession, controller.clockOut);
router.get('/status', verifySession, controller.getStatus);
router.get('/summary', verifySession, controller.getSummary);
router.get('/', verifySession, controller.getTimeEntries);
router.delete('/:id', verifySession, controller.deleteEntry);
router.patch('/:id/notes', verifySession, controller.updateNotes);

export default router;


