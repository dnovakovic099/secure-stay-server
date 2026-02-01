import { Router } from 'express';
import { UserManagementController } from '../controllers/UserManagementController';
import verifySession from '../middleware/verifySession';
import verifyAdmin from '../middleware/verifyAdmin';
import verifySuperAdmin from '../middleware/verifySuperAdmin';

const router = Router();
const controller = new UserManagementController();

// Public routes (only require session, not admin)
// Public routes (only require session, not admin)
router.get('/test-me', (req, res) => res.send("Test Me works"));
router.get('/me', verifySession, controller.getMe);

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

// Employee settings routes (Super Admin only)
router.get('/:id/employee-settings', verifySession, verifySuperAdmin, controller.getEmployeeSettings);
router.put('/:id/employee-settings', verifySession, verifySuperAdmin, controller.updateEmployeeSettings);

export default router;
