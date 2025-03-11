import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { FileController } from "../controllers/FileController";
const router = Router();

const fileController = new FileController();

router.route('/getfile/:module/:file').get(verifySession,fileController.getFile);
// route to accessing images, only verify for bearer token
router.route('/getimage/:module/:file').get(fileController.getImage);

export default router;