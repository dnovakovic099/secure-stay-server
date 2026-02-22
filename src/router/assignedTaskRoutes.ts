import { Router } from "express";
import { assignedTaskController } from "../controllers/AssignedTaskController";
import verifySession from "../middleware/verifySession";

const router = Router();

// --- Columns ---
router.route('/columns')
    .get(verifySession, assignedTaskController.getColumns)
    .post(verifySession, assignedTaskController.addColumn); // Ideally restrict to admin

router.route('/columns/:id')
    .delete(verifySession, assignedTaskController.deleteColumn); // Ideally restrict to admin

// --- Dashboard & Widget Tasks ---
router.route('/')
    .get(verifySession, assignedTaskController.getTasks)
    .post(verifySession, assignedTaskController.createTask);

router.route('/widget')
    .get(verifySession, assignedTaskController.getWidgetTasks);

// --- Task Item Operations ---
router.route('/:id')
    .get(verifySession, assignedTaskController.getTaskById)
    .put(verifySession, assignedTaskController.updateTask)
    .delete(verifySession, assignedTaskController.deleteTask);

// --- Task Updates / Comments ---
router.route('/:id/updates')
    .get(verifySession, assignedTaskController.getTaskUpdates)
    .post(verifySession, assignedTaskController.addTaskUpdate);

export default router;
