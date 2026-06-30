import { Router } from "express";
import { InboxV2Controller } from "../controllers/InboxV2Controller";
import verifySession from "../middleware/verifySession";

const router = Router();
const inboxV2Controller = new InboxV2Controller();

// Conversation list + thread detail (read from local DB)
router.get("/conversations", verifySession, inboxV2Controller.listConversations);
router.get("/conversations/:threadId", verifySession, inboxV2Controller.getConversation);

// Send a reply (delivers to Hostify + records local attribution)
router.post("/conversations/:threadId/reply", verifySession, inboxV2Controller.reply);

// Reservation details panel
router.get("/reservation/:reservationId/details", verifySession, inboxV2Controller.reservationDetails);

// Backfill / sync from Hostify into local tables
router.post("/sync", verifySession, inboxV2Controller.sync);

export default router;
