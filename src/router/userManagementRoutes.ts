import { Router } from 'express';
import { UserManagementController } from '../controllers/UserManagementController';
import verifySession from '../middleware/verifySession';
import verifyAdmin from '../middleware/verifyAdmin';

const router = Router();
const controller = new UserManagementController();

// Public routes (only require session, not admin)
// Must be before admin routes to avoid conflicts
router.post('/update-last-login', verifySession, controller.updateLastLogin);

// All other user management routes require admin privileges
// Department routes (must be before /:id routes to avoid conflicts)
router.get('/departments', verifySession, verifyAdmin, controller.getAllDepartments);
router.post('/departments', verifySession, verifyAdmin, controller.createDepartment);

// User routes
router.get('/', verifySession, verifyAdmin, controller.getAllUsers);
router.get('/:id', verifySession, verifyAdmin, controller.getUserById);
router.put('/:id', verifySession, verifyAdmin, controller.updateUser);
router.patch('/:id/toggle-status', verifySession, verifyAdmin, controller.toggleUserStatus);
router.patch('/:id/user-type', verifySession, verifyAdmin, controller.setUserType);
router.put('/:id/departments', verifySession, verifyAdmin, controller.assignDepartments);

export default router;
