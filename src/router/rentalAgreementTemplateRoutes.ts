import { Router } from "express";
import { RentalAgreementTemplateController } from "../controllers/RentalAgreementTemplateController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new RentalAgreementTemplateController();

router.get("/", verifySession, controller.getAll.bind(controller));
router.get("/:id", verifySession, controller.getById.bind(controller));
router.post("/", verifySession, controller.create.bind(controller));
router.put("/:id", verifySession, controller.update.bind(controller));
router.delete("/:id", verifySession, controller.delete.bind(controller));

export default router;
