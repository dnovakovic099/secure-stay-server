import { Router } from "express";
import hostifyController from "../controllers/HostifyController";
import verifySession from "../middleware/verifySession";

const router = Router();

// All routes require authentication
router.use(verifySession);

// GET /hostify/users - Get cached users
router.get("/users", hostifyController.getUsers);

// POST /hostify/users/sync - Sync users from Hostify API
router.post("/users/sync", hostifyController.syncUsers);

export default router;
