import { CategoryController } from "../controllers/CategoryController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";

const router = Router();
const categoryController = new CategoryController();

router.route('/createCategory').post(verifySession, categoryController.createCategory);

router.route('/getcategorylist').get(verifySession, categoryController.getAllCategories);

export default router;
