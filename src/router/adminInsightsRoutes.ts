import { Router, NextFunction, Request, Response } from "express";
import verifySession from "../middleware/verifySession";
import { AdminInsightsController } from "../controllers/AdminInsightsController";
import { isAdminEmail } from "../services/AdminInsightsService";

const router = Router();
const controller = new AdminInsightsController();

router.use((request, response, next) => {
    delete request.headers["if-none-match"];
    delete request.headers["if-modified-since"];
    response.set("Cache-Control", "no-store");
    next();
});

/** Everything except /me is hard-gated to the admin allowlist. */
const requireAdmin = (req: Request & { user?: any }, res: Response, next: NextFunction) => {
    if (!isAdminEmail(req.user?.email)) {
        return res.status(403).json({ status: false, message: "Admin access required" });
    }
    return next();
};

router.get("/me", verifySession, controller.me);
router.get("/overview", verifySession, requireAdmin, controller.overview);
router.get("/feedback-log", verifySession, requireAdmin, controller.feedbackLog);
router.get("/workload", verifySession, requireAdmin, controller.workload);
router.get("/workload/status", verifySession, requireAdmin, controller.workloadStatus);
router.post("/workload/refresh", verifySession, requireAdmin, controller.workloadRefresh);

export default router;
