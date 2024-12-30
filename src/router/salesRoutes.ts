import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { SalesController } from "../controllers/SalesController";

const router = Router();
const salesController = new SalesController();

router.route("/createClient").post(verifySession, salesController.createClient);
router.route("/getAllClients").get(salesController.getAllClients);

export default router;
