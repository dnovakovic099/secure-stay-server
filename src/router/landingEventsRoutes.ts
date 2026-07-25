import { Router } from "express";
import { LandingEventsController } from "../controllers/LandingEventsController";

const router = Router();
const controller = new LandingEventsController();

router.post("/", controller.create);
router.get("/summary", controller.summary);

export default router;
