import { Router, Request, Response } from "express";

const router = Router();

/**
 * Health check endpoint to verify API is working
 * GET /health
 * Returns: { status: "ok", timestamp: ISO date string }
 */
router.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;
