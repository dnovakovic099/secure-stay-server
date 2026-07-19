import { Router } from "express";
import { AIActionItemsTestingController } from "../controllers/AIActionItemsTestingController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new AIActionItemsTestingController();

// Always return a full 200 body (no conditional 304) for this polled endpoint.
router.use((request, response, next) => {
    delete request.headers["if-none-match"];
    delete request.headers["if-modified-since"];
    response.set("Cache-Control", "no-store");
    next();
});

// List action items proposed by the new inbox-v2 AI chatbot (testing).
router.get("/", verifySession, controller.list);

// Promote a detected proposal into a real Guest Issue row. Returns the created
// (or already-linked) Issue so the frontend can hand it to IssueEditModal —
// which unlocks vendor threads, expenses, Slack integration, activity timeline,
// etc., with zero UI duplication.
router.post("/:id/convert-to-issue", verifySession, controller.convertToIssue);

export default router;
