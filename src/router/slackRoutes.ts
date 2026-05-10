
import { Router } from "express";
import { SlackController } from "../controllers/SlackController";

const router = Router();
const slackController = new SlackController();

router.get("/users", slackController.getUsers);
router.get("/usergroups", slackController.getUserGroups);
router.get("/team-info", slackController.getTeamInfo);

export default router;
