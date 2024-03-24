
import { Router } from 'express';
import { validateEmailForForgetPassword, validateUserForGoogleLogin, validationForGoogleSignUp } from '../middleware/validation/user/user.validation';
import { UsersController } from '../controllers/UsersController';

const router = Router();

const usersController = new UsersController();

router
    .route('/check_user_email')
    .get(
        validateEmailForForgetPassword,
        usersController.checkUserEmail
    );

router
    .route('/check_user_google_login')
    .get(
        validateUserForGoogleLogin,
        usersController.checkUserForGoogleLogin
    );

router
    .route('/create_user_with_google')
    .get(
        validationForGoogleSignUp,
        usersController.googleSignup
    );
export default router

