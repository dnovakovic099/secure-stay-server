import { Router } from "express";
import verifySession from "../middleware/verifySession";
import verifyAdmin from "../middleware/verifyAdmin";
import { ActionItemsBetaController } from "../controllers/ActionItemsBetaController";

const router = Router();
const controller = new ActionItemsBetaController();

router.use(verifySession);

router.get("/overview", controller.getOverview);
router.get("/items", controller.getItems);
router.get("/items/:id", controller.getItemById);
router.put("/items/:id", controller.updateItem);
router.post("/items/:id/reply", controller.replyToItem);
router.post("/items/:id/approve", controller.approveItem);
router.post("/items/:id/reject", controller.rejectItem);
router.post("/analyze/reservation/:reservationId", controller.analyzeReservation);
router.post("/backfill", verifyAdmin, controller.backfillItems);
router.post("/test", controller.testDetection);

router.get("/categories", controller.getCategories);
router.get("/rules", controller.getRules);
router.get("/settings", controller.getSettings);

router.post("/categories", verifyAdmin, controller.createCategory);
router.put("/categories/:id", verifyAdmin, controller.updateCategory);
router.delete("/categories/:id", verifyAdmin, controller.deleteCategory);

router.post("/rules", verifyAdmin, controller.createRule);
router.put("/rules/:id", verifyAdmin, controller.updateRule);
router.delete("/rules/:id", verifyAdmin, controller.deleteRule);

router.put("/settings", verifyAdmin, controller.updateSettings);

export default router;
