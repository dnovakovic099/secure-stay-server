import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { FileController } from "../controllers/FileController";
const router = Router();

const fileController = new FileController();

router.route('/getfile/:module/:file').get(verifySession, fileController.getFile);

export default router;