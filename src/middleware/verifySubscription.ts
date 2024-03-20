import { NextFunction, Request, Response } from "express";
import { UserSubscriptionService } from "../services/userSubscriptionService";
import CustomErrorHandler from "./customError.middleware";

interface CustomRequest extends Request {
    user?: any;
}

interface SubscriptionInfo {
    isExpired: boolean,
    subscription: null | object;
}

const verifySubscription = async (request: CustomRequest, response: Response, next: NextFunction) => {
    const userId = request.user.id;
    const userSubscriptionService = new UserSubscriptionService();

    const subscriptionInfo = await userSubscriptionService.getUserSubscriptionInfo(userId) as SubscriptionInfo;
    if (subscriptionInfo.isExpired) {
        return next(CustomErrorHandler.forbidden('Your subscription is expired'));
    }
    next();
};

export default verifySubscription;