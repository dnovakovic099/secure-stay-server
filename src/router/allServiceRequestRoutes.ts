import { Router } from "express";
import { AllServiceRequestController } from "../controllers/AllServiceRequestController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new AllServiceRequestController();

router.route("/").get(verifySession, controller.getAll.bind(controller));

export default router;
