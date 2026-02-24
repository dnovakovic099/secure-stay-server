import { Router } from 'express';
import { EmployeeController } from '../controllers/EmployeeController';
import verifySession from '../middleware/verifySession';

const router = Router();
const employeeController = new EmployeeController();

// Get all employees
router.get('/', verifySession, employeeController.getAllEmployees);

// Get departments list
router.get('/departments', verifySession, employeeController.getDepartments);

// Get available users (not yet employees)
router.get('/available-users', verifySession, employeeController.getAvailableUsers);

// Get single employee
router.get('/:id', verifySession, employeeController.getEmployeeById);

// Create employee
router.post('/', verifySession, employeeController.createEmployee);

// Update employee
router.put('/:id', verifySession, employeeController.updateEmployee);
router.patch('/:id', verifySession, employeeController.updateEmployee);

// Delete employee
router.delete('/:id', verifySession, employeeController.deleteEmployee);

// Notes
router.get('/:id/notes', verifySession, employeeController.getNotes);
router.post('/:id/notes', verifySession, employeeController.addNote);
router.delete('/notes/:noteId', verifySession, employeeController.deleteNote);

export default router;
