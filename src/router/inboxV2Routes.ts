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

// Update reservation host/cleaning notes (persists locally + syncs to Hostify)
router.patch("/reservation/:reservationId/notes", verifySession, inboxV2Controller.updateReservationNotes);

// Backfill / sync from Hostify into local tables
router.post("/sync", verifySession, inboxV2Controller.sync);

// -------------------------------------------------------------------------
// AI suggested replies (suggestion-only; never auto-sends). Flag-gated by
// AI_MESSAGING_ENABLED inside the controller.
// -------------------------------------------------------------------------
router.get("/ai/config", verifySession, inboxV2Controller.aiConfig);
router.post("/conversations/:threadId/ai/suggest", verifySession, inboxV2Controller.aiSuggest);
router.get("/conversations/:threadId/ai/suggestion", verifySession, inboxV2Controller.aiGetSuggestion);
router.get("/conversations/:threadId/ai/suggestions", verifySession, inboxV2Controller.aiListSuggestions);
router.post("/ai/feedback", verifySession, inboxV2Controller.aiFeedback);
router.patch("/ai/suggestions/:id/status", verifySession, inboxV2Controller.aiUpdateSuggestionStatus);

export default router;
