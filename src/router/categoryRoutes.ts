import { CategoryController } from "../controllers/CategoryController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import verifyAdmin from "../middleware/verifyAdmin";

const router = Router();
const categoryController = new CategoryController();

router.route('/createCategory').post(verifySession, verifyAdmin, categoryController.createCategory);

router.route('/getcategorylist').get(verifySession, categoryController.getAllCategories);

router.route('/reorder').put(verifySession, verifyAdmin, categoryController.reorderCategories);

router.route('/:id/usage').get(verifySession, verifyAdmin, categoryController.getCategoryUsage);

router.route('/:id').put(verifySession, verifyAdmin, categoryController.updateCategory);

router.route('/:id').delete(verifySession, verifyAdmin, categoryController.deleteCategory);

export default router;
