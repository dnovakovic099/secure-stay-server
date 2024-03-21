import { NextFunction, Request, Response } from "express";
import { UserSubscriptionService } from "../services/userSubscriptionService";
import { dataSaved, successDataFetch } from "../helpers/response";

interface CustomRequest extends Request {
  user?: any;
}
export class UserSubscriptionController {
  async createUserSubscriptionCheckoutSession(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userSubscriptionService = new UserSubscriptionService();

      const { planId } = request.body;

      const userId = request.user.id;
      const session =
        await userSubscriptionService.createUserSubscriptionCheckoutSession(
          planId,
          userId
        );

      return response.status(201).json({
        success: true,
        message: "Checkout session created successfully",
        session,
      });
    } catch (error) {
      return next(error);
    }
  }

  async saveUserSubscriptionInfo(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userSubscriptionService = new UserSubscriptionService();
      const userId = request.user.id;

      await userSubscriptionService.saveUserSubscriptionInfo(userId);

      return response
        .status(201)
        .json(dataSaved("Subscription info saved successfully"));
    } catch (error) {
      return next(error);
    }
  }

  async getUserSubscriptionInfo(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userSubscriptionService = new UserSubscriptionService();
      const userId = request.user.id;

      const userSubscriptionInfo =
        await userSubscriptionService.getUserSubscriptionInfo(userId);

      return response.status(200).json(successDataFetch(userSubscriptionInfo));
    } catch (error) {
      return next(error);
    }
  }

  async getUserInvoices(
    request: CustomRequest,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userSubscriptionService = new UserSubscriptionService();
      const userId = request.user.id;

      const invoices = await userSubscriptionService.getUserInvoices(userId);

      return response.status(200).json(successDataFetch(invoices));
    } catch (error) {
      return next(error);
    }
  }
}
