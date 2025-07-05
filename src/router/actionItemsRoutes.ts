
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { ActionItemsController } from "../controllers/ActionItemsController";
import { getActionItemsValidation, validateCreateActionItems, validateCreateLatestUpdate, validateUpdateActionItems, validateUpdateLatestUpdate } from "../middleware/validation/actionItems/actionItems.validation";

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

router
    .route('/lastestupdates/create')
    .post(verifySession, validateCreateLatestUpdate, categoryController.createActionItemsUpdates);

router
    .route('/lastestupdates/update')
    .put(verifySession, validateUpdateLatestUpdate, categoryController.updateActionItemsUpdates);

router
    .route('/lastestupdates/delete/:id')
    .delete(verifySession, categoryController.deleteActionItemsUpdates);

export default router;
