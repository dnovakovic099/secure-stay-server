import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { OwnerInfoController } from "../controllers/OwnerInfoController";

const router = Router();
const ownerInfoController = new OwnerInfoController();

router.route('/ownerInfo').get(verifySession, ownerInfoController.getOwnerInfo);

export default router;
