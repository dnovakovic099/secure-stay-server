import { Router } from "express";
import { TasksController } from "../controllers/TasksController";
import verifySession from "../middleware/verifySession";
import { validateCreateTask, validateUpdateTask } from "../middleware/validation/tasks/tasks.validation";
import { AssigneeController } from "../controllers/AssigneeController";

const router = Router();
const tasksController = new TasksController();
const assigneeController = new AssigneeController();

router.route('/')
    .get(
        verifySession,
        tasksController.getTasks
    )
    .post(
        verifySession,
        validateCreateTask,
        tasksController.createTask
    );

router.route('/:id')
    .put(
        verifySession,
        validateUpdateTask,
        tasksController.updateTask
    )
    .delete(
        verifySession,
        tasksController.deleteTask
    );

router.route('/assignees')
    .get(
        verifySession,
        assigneeController.getAssignees
    )
    .post(
        verifySession,
        assigneeController.saveAssigneeInfo
    );

export default router;