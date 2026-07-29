import { Router } from "express";
import { PropertyFactsController } from "../controllers/PropertyFactsController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new PropertyFactsController();

// Verified Property Facts: preset fields + correction-proposal queue.
router.get("/", verifySession, controller.get);
router.get("/proposals", verifySession, controller.listProposals);
router.post("/proposals/:id/review", verifySession, controller.reviewProposal);
router.post("/:id/verify", verifySession, controller.verify);
router.put("/:listingId/:fieldKey", verifySession, controller.upsert);

export default router;
