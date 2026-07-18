import { Router } from "express";
import { RedditOAuthController } from "../controllers/RedditOAuthController";

const router = Router();
const redditOAuthController = new RedditOAuthController();

// Public Reddit Ads OAuth endpoints (no session required)
router.get("/reddit/status", redditOAuthController.status);
router.get("/reddit/authorize", redditOAuthController.authorize);
router.get("/reddit/callback", redditOAuthController.callback);

export default router;
