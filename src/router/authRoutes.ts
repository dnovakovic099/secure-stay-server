import { AuthController } from "../controllers/AuthController";
import { Router } from "express";
import { validateSignin } from "../middleware/validation/auth/auth.validation";

const router = Router();

const authController = new AuthController();

router
    .route('/signin')
    .post(
        validateSignin,
        authController.signin
    );

export default router;