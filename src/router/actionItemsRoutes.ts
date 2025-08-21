
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { ActionItemsController } from "../controllers/ActionItemsController";
import { getActionItemsValidation, validateActionItemMigrationToIssue, validateCreateActionItems, validateCreateLatestUpdate, validateUpdateActionItems, validateUpdateLatestUpdate, validateBulkUpdateActionItems } from "../middleware/validation/actionItems/actionItems.validation";

const router = Router();
const categoryController = new ActionItemsController();

router.route('/items')
    .get(verifySession, getActionItemsValidation, categoryController.getActionItems);

router.route('/create')
    .post(verifySession, validateCreateActionItems, categoryController.createActionItem);

router.route('/update')
    .put(verifySession, validateUpdateActionItems, categoryController.updateActionItem);

router.route('/bulk-update')
    .put(verifySession, validateBulkUpdateActionItems, categoryController.bulkUpdateActionItems);

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

router
    .route('/migrate-action-items-to-issues/:actionItemId')
    .post(verifySession, validateActionItemMigrationToIssue, categoryController.migrateActionItemsToIssues);

export default router;
