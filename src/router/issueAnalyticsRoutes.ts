import { Router } from "express";
import { IssueAnalyticsController } from "../controllers/IssueAnalyticsController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new IssueAnalyticsController();

router.use((request, response, next) => {
    delete request.headers["if-none-match"];
    delete request.headers["if-modified-since"];
    response.set("Cache-Control", "no-store");
    next();
});

router.get("/", verifySession, controller.report);
router.get("/queue", verifySession, controller.queue);
router.get("/feedback-log", verifySession, controller.feedbackLog);
router.get("/listings", verifySession, controller.listings);
router.get("/reviewers", verifySession, controller.reviewers);
router.get("/categories", verifySession, controller.categories);
router.post("/feedback", verifySession, controller.submitFeedback);

export default router;
