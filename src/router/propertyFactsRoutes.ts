import { Router } from "express";
import { PropertyFactsController } from "../controllers/PropertyFactsController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new PropertyFactsController();

// Verified Property Facts: preset fields + correction-proposal queue.
router.get("/", verifySession, controller.get);
router.get("/proposals", verifySession, controller.listProposals);
router.get("/review-items", verifySession, controller.listReviewItems);
router.get("/properties", verifySession, controller.listProperties);
router.post("/proposals/:id/review", verifySession, controller.reviewProposal);
router.post("/:id/verify", verifySession, controller.verify);
router.post("/:listingId/push-hostify", verifySession, controller.pushHostify);
router.post("/:listingId/:fieldKey/apply-to-properties", verifySession, controller.applyToProperties);
router.put("/:listingId/:fieldKey/upsell-link", verifySession, controller.setLinkedUpsell);
router.put("/:listingId/:fieldKey/upsell", verifySession, controller.updateLinkedUpsell);
router.put("/:listingId/:fieldKey", verifySession, controller.upsert);

export default router;
