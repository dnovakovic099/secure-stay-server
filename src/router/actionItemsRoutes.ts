
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { ActionItemsController } from "../controllers/ActionItemsController";
import { getActionItemsValidation, validateCreateActionItems, validateUpdateActionItems } from "../middleware/validation/actionItems/actionItems.validation";

const router = Router();
const categoryController = new ActionItemsController();

router.route('/items')
    .get(verifySession, getActionItemsValidation, categoryController.getActionItems);

router.route('/create')
    .post(verifySession, validateCreateActionItems, categoryController.createActionItem);

router.route('/update')
    .put(verifySession, validateUpdateActionItems, categoryController.updateActionItem);

router.route('/delete/:id')
    .delete(verifySession, categoryController.deleteActionItem);

export default router;
