
import { Router } from 'express';
import { validateCreateMobileUser, validateEmailForForgetPassword, validateGetMobileUsersList, validateUserForGoogleLogin, validationForGoogleSignUp } from '../middleware/validation/user/user.validation';
import { UsersController } from '../controllers/UsersController';
import verifySession from '../middleware/verifySession';

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

router
    .route('/getapikey')
    .get(
        verifySession,
        usersController.getApiKey
);

router
    .route('/gethostawayuser')
    .get(
        verifySession,
        usersController.getHostawayUsersList
    );

router
    .route('/createmobileuser')
    .post(
        verifySession,
        validateCreateMobileUser,
        usersController.createMobileUser
    );

router
    .route('/getmobileusers')
    .get(
        verifySession,
        validateGetMobileUsersList,
        usersController.getMobileUsersList
    );

export default router

