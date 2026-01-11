import { Router } from 'express';
import { LeaveRequestController } from '../controllers/LeaveRequestController';
import verifySession from '../middleware/verifySession';
import verifyAdmin from '../middleware/verifyAdmin';

const router = Router();
const controller = new LeaveRequestController();

// Employee routes (require session only)
router.post('/', [verifySession], controller.createLeaveRequest);
router.get('/my', [verifySession], controller.getMyLeaveRequests);
router.post('/:id/cancel', [verifySession], controller.cancelPendingRequest);
router.post('/:id/request-cancellation', [verifySession], controller.requestCancellation);

// Admin routes (require session + admin)
router.get('/', [verifySession, verifyAdmin], controller.getAllLeaveRequests);
router.get('/pending', [verifySession, verifyAdmin], controller.getPendingRequests);
router.get('/stats', [verifySession, verifyAdmin], controller.getStats);
router.get('/pending-count', [verifySession, verifyAdmin], controller.getPendingCount);
router.post('/:id/approve', [verifySession, verifyAdmin], controller.approveRequest);
router.post('/:id/reject', [verifySession, verifyAdmin], controller.rejectRequest);
router.post('/:id/approve-cancellation', [verifySession, verifyAdmin], controller.approveCancellation);
router.post('/:id/reject-cancellation', [verifySession, verifyAdmin], controller.rejectCancellation);

// Shared route (accessible by employee for own requests, admin for all)
router.get('/:id', [verifySession], controller.getById);

export default router;
