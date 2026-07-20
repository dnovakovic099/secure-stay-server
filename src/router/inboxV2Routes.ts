import { Router } from "express";
import { InboxV2Controller } from "../controllers/InboxV2Controller";
import { AutoMessageRuleController } from "../controllers/AutoMessageRuleController";
import verifySession from "../middleware/verifySession";
import fileUpload from "../utils/upload.util";

const router = Router();
const inboxV2Controller = new InboxV2Controller();
const autoMessageController = new AutoMessageRuleController();

/**
 * Never return a conditional 304 for these dynamic, authenticated endpoints.
 * Express auto-generates an ETag for JSON responses; on a repeat/polled fetch of
 * an *unchanged* (older) conversation the browser sends If-None-Match, Express
 * replies 304 with an empty body, and the frontend's axios rejects any status
 * outside 200–299 — surfacing as "Failed to load conversation". Stripping the
 * conditional request headers forces a full 200 body every time.
 */
router.use((request, response, next) => {
    delete request.headers["if-none-match"];
    delete request.headers["if-modified-since"];
    response.set("Cache-Control", "no-store");
    next();
});

// Conversation list + thread detail (read from local DB)
router.get("/conversations", verifySession, inboxV2Controller.listConversations);
router.get("/conversations/:threadId", verifySession, inboxV2Controller.getConversation);

// Send a reply (delivers to Hostify + records local attribution)
router.post("/conversations/:threadId/reply", verifySession, inboxV2Controller.reply);
router.post("/conversations/:threadId/internal-note", verifySession, inboxV2Controller.internalNote);
router.post(
    "/conversations/:threadId/upload",
    verifySession,
    fileUpload("inbox-v2").single("file"),
    inboxV2Controller.uploadAttachment
);

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

// AI proposed actions — one-click operations the AI detected; humans approve.
router.get("/conversations/:threadId/ai/actions", verifySession, inboxV2Controller.aiListActions);
router.post("/ai/actions/:id/execute", verifySession, inboxV2Controller.aiExecuteAction);
router.post("/ai/actions/:id/dismiss", verifySession, inboxV2Controller.aiDismissAction);
// Veto a queued delayed auto-send before its window elapses.
router.post("/ai/suggestions/:id/veto-autosend", verifySession, inboxV2Controller.aiVetoDelayedSend);

// -------------------------------------------------------------------------
// Automated messages (rule-based scheduled sends: winback, reminders,
// day-of-week notes, one-off follow-ups). Engine gated by AUTO_MESSAGES_ENABLED;
// every rule starts disabled.
// -------------------------------------------------------------------------
router.get("/auto-messages/rules", verifySession, autoMessageController.listRules);
router.post("/auto-messages/rules", verifySession, autoMessageController.createRule);
router.put("/auto-messages/rules/:id", verifySession, autoMessageController.updateRule);
router.delete("/auto-messages/rules/:id", verifySession, autoMessageController.deleteRule);
router.get("/auto-messages/logs", verifySession, autoMessageController.listLogs);
router.post("/auto-messages/run", verifySession, autoMessageController.runNow);

// Learning prompts (bot-raised knowledge-gap questions for staff to answer)
router.get("/conversations/:threadId/learning-prompt", verifySession, inboxV2Controller.getLearningPrompt);
router.post("/learning-prompt/:id/answer", verifySession, inboxV2Controller.answerLearningPrompt);
router.post("/learning-prompt/:id/recommend-answer", verifySession, inboxV2Controller.recommendLearningPromptAnswer);
router.post("/learning-prompt/:id/dismiss", verifySession, inboxV2Controller.dismissLearningPrompt);

export default router;
