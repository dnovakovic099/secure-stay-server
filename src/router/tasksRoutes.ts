import { Router } from "express";
import { TasksController } from "../controllers/TasksController";
import verifySession from "../middleware/verifySession";
import { validateCreateTask, validateUpdateTask, validateBulkUpdateTask } from "../middleware/validation/tasks/tasks.validation";
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

router.route('/bulk-update')
    .put(
        verifySession,
        validateBulkUpdateTask,
        tasksController.bulkUpdateTasks
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

    router.route('/add-to-post-stay/:id')
    .put(
        verifySession,
        tasksController.addToPostStay
    );

export default router;