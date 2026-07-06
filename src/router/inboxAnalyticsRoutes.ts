import { Router } from "express";
import { InboxAnalyticsController } from "../controllers/InboxAnalyticsController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new InboxAnalyticsController();

router.use((request, response, next) => {
    delete request.headers["if-none-match"];
    delete request.headers["if-modified-since"];
    response.set("Cache-Control", "no-store");
    next();
});

router.get("/", verifySession, controller.report);
router.post("/backfill", verifySession, controller.backfill);

export default router;
