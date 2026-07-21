import { Router } from "express";
import { AICopilotController } from "../controllers/AICopilotController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new AICopilotController();

// Never return a conditional 304 for these dynamic, authenticated endpoints
// (axios rejects any status outside 200–299). See inboxV2Routes for details.
router.use((request, response, next) => {
    delete request.headers["if-none-match"];
    delete request.headers["if-modified-since"];
    response.set("Cache-Control", "no-store");
    next();
});

// AI Copilot Settings (tone / rules / topics-to-avoid / auto-respond toggle).
// Mounted under /ai alongside the AI Escalation Manager routes; paths do not
// collide (/ai/settings, /ai/suggestions, /ai/metrics vs /ai/logs, /ai/assistant).
router.get("/settings", verifySession, controller.getSettings);
router.put("/settings", verifySession, controller.updateSettings);

// Ticket categories resolved from ai_messaging_settings.ticketCategories (falls
// back to hardcoded defaults). Consumed by the Guest Issues page so its
// category dropdown always mirrors what the AI detector is configured to use.
router.get("/issue-categories", verifySession, controller.issueCategories);

// AI Copilot review: recent suggestions across all threads.
router.get("/suggestions", verifySession, controller.listSuggestions);

// AI Manager: aggregate response/suggestion metrics.
router.get("/metrics", verifySession, controller.metrics);

// Detected Action Item / Guest Issue proposals (dormant pipeline review).
router.get("/detected-items", verifySession, controller.detectedItems);

// Learned facts (nightly audit output) — review + approve/reject for the bot.
router.get("/learned-facts", verifySession, controller.listLearnedFacts);
router.post("/learned-facts/approve-all", verifySession, controller.approveAllLearnedFacts);
router.post("/learned-facts/:id/review", verifySession, controller.reviewLearnedFact);
router.put("/learned-facts/:id", verifySession, controller.updateLearnedFact);

// Guest Simulator — act as a guest, see the bot's reply, and teach it.
router.post("/sandbox/reply", verifySession, controller.sandboxReply);
router.post("/sandbox/teach", verifySession, controller.sandboxTeach);
router.post("/sandbox/feedback", verifySession, controller.sandboxFeedback);

// On-demand trigger of the nightly self-improvement audit.
router.post("/audit/run", verifySession, controller.runAudit);

// Ops Radar — the manager's manage-by-exception feed (predictive maintenance,
// root causes, SLA breaches, review risks, turnover risks).
router.get("/ops/alerts", verifySession, controller.opsAlerts);
router.post("/ops/alerts/:id/dismiss", verifySession, controller.opsDismissAlert);
router.post("/ops/alerts/:id/resolve", verifySession, controller.opsResolveAlert);
router.post("/ops/scan", verifySession, controller.opsScan);

// Conflict detector — contradictions between listing data, learned facts and
// KB entries (e.g. listing says 10 AM checkout, a taught fact says 11 AM).
router.get("/conflicts", verifySession, controller.conflicts);
router.post("/conflicts/:id/resolve", verifySession, controller.conflictResolve);
router.post("/conflicts/:id/dismiss", verifySession, controller.conflictDismiss);
router.post("/conflicts/scan", verifySession, controller.conflictScan);

// Seed KB from structured listing data + one-shot full-history learning.
router.post("/kb/seed-from-listings", verifySession, controller.seedKnowledgeFromListings);
// Promote Learned (Q&A) facts into each listing's Knowledge Base tab.
router.post("/kb/promote-learned-facts", verifySession, controller.promoteLearnedFactsToKb);
router.post("/audit/backfill-history", verifySession, controller.backfillHistory);
router.post("/listing-groups/rebuild", verifySession, controller.rebuildListingGroups);
router.post("/embeddings/backfill", verifySession, controller.backfillExemplars);

export default router;
