import { Router } from "express";
import { AllServiceRequestController } from "../controllers/AllServiceRequestController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new AllServiceRequestController();

router.route("/export").get(verifySession, controller.exportCSV.bind(controller));
router.route("/:type/:id/thread").get(verifySession, controller.getThread.bind(controller));
router.route("/:type/:id/thread").post(verifySession, controller.postThreadMessage.bind(controller));
router.route("/").get(verifySession, controller.getAll.bind(controller));

export default router;
