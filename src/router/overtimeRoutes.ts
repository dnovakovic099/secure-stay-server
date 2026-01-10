import { Router } from 'express';
import { OvertimeRequestController } from '../controllers/OvertimeRequestController';
import verifySession from '../middleware/verifySession';
import verifySuperAdmin from '../middleware/verifySuperAdmin';

const router = Router();
const controller = new OvertimeRequestController();

// All routes require super admin authentication
router.get('/', [verifySession, verifySuperAdmin], controller.getOvertimeRequests);
router.get('/pending', [verifySession, verifySuperAdmin], controller.getPendingRequests);
router.get('/stats', [verifySession, verifySuperAdmin], controller.getStats);
router.get('/notifications', [verifySession, verifySuperAdmin], controller.getNotificationCounts);
router.get('/:id', [verifySession, verifySuperAdmin], controller.getById);
router.post('/:id/approve', [verifySession, verifySuperAdmin], controller.approveRequest);
router.post('/:id/reject', [verifySession, verifySuperAdmin], controller.rejectRequest);

export default router;

