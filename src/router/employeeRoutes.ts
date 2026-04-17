import { Router } from 'express';
import { EmployeeController } from '../controllers/EmployeeController';
import verifySession from '../middleware/verifySession';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
const employeeController = new EmployeeController();

// Multer config for employee photos
const employeePhotoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = path.resolve(__dirname, '../../public/employees');
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

const employeePhotoUpload = multer({
    storage: employeePhotoStorage,
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|webp/;
        if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only image files (jpeg, jpg, png, webp) are allowed'));
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Get all employees
router.get('/', verifySession, employeeController.getAllEmployees);
router.get('/schedule-overrides', verifySession, employeeController.getScheduleOverrides);

// Get departments list
router.get('/departments', verifySession, employeeController.getDepartments);

// Get available users (not yet employees)
router.get('/available-users', verifySession, employeeController.getAvailableUsers);

// Get single employee
router.get('/:id', verifySession, employeeController.getEmployeeById);

// Create employee
router.post('/', verifySession, employeeController.createEmployee);

// Upload employee photo
router.post('/:id/photo', verifySession, employeePhotoUpload.single('photo'), employeeController.uploadPhoto);

// Update employee
router.put('/:id', verifySession, employeeController.updateEmployee);
router.patch('/:id', verifySession, employeeController.updateEmployee);
router.put('/:id/schedule-overrides', verifySession, employeeController.upsertScheduleOverride);
router.delete('/:id/schedule-overrides', verifySession, employeeController.clearScheduleOverride);

// Delete employee
router.delete('/:id', verifySession, employeeController.deleteEmployee);

// Delete employee photo
router.delete('/:id/photo', verifySession, employeeController.deletePhoto);

// Notes
router.get('/:id/notes', verifySession, employeeController.getNotes);
router.post('/:id/notes', verifySession, employeeController.addNote);
router.delete('/notes/:noteId', verifySession, employeeController.deleteNote);

// Regenerate employee numbers (based on start date)
router.post('/regenerate-numbers', verifySession, employeeController.regenerateNumbers);

export default router;
