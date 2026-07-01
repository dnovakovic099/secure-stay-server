import { Router } from "express";
import { ListingKnowledgeController } from "../controllers/ListingKnowledgeController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new ListingKnowledgeController();

// Per-listing Knowledge Base entries (shared, backend-persisted).
router.get("/", verifySession, controller.list);
router.post("/", verifySession, controller.create);
router.put("/:id", verifySession, controller.update);
router.delete("/:id", verifySession, controller.remove);

export default router;
