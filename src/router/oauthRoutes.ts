import { Router } from "express";
import { RedditOAuthController } from "../controllers/RedditOAuthController";
import { GoogleAdsOAuthController } from "../controllers/GoogleAdsOAuthController";

const router = Router();
const redditOAuthController = new RedditOAuthController();
const googleAdsOAuthController = new GoogleAdsOAuthController();

// Public Reddit Ads OAuth endpoints (no session required)
router.get("/reddit/status", redditOAuthController.status);
router.get("/reddit/authorize", redditOAuthController.authorize);
router.get("/reddit/callback", redditOAuthController.callback);

// Public Google Ads OAuth endpoints (no session required)
router.get("/google-ads/status", googleAdsOAuthController.status);
router.get("/google-ads/authorize", googleAdsOAuthController.authorize);
router.get("/google-ads/callback", googleAdsOAuthController.callback);

export default router;
