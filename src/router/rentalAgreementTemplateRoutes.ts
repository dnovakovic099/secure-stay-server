import { Router } from "express";
import { RentalAgreementTemplateController } from "../controllers/RentalAgreementTemplateController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new RentalAgreementTemplateController();

router.get("/", verifySession, controller.getAll.bind(controller));
router.get("/rules", verifySession, controller.getRules.bind(controller));
router.post("/rules", verifySession, controller.createRules.bind(controller));
router.put("/rules/bulk", verifySession, controller.bulkUpdateRules.bind(controller));
router.put("/rules/:ruleId", verifySession, controller.updateRule.bind(controller));
router.delete("/rules/:ruleId", verifySession, controller.deleteRule.bind(controller));
router.get("/:id", verifySession, controller.getById.bind(controller));
router.post("/", verifySession, controller.create.bind(controller));
router.put("/:id", verifySession, controller.update.bind(controller));
router.delete("/:id", verifySession, controller.delete.bind(controller));

export default router;
