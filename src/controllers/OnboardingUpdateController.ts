import { NextFunction, Request, Response } from "express";
import { OnboardingUpdateService } from "../services/OnboardingUpdateService";

interface CustomRequest extends Request { user?: any; }

export class OnboardingUpdateController {
  async list(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const raw = Array.isArray(request.query.propertyId) ? request.query.propertyId : [request.query.propertyId];
      const propertyIds = raw.flatMap((value) => String(value || "").split(",")).filter(Boolean);
      return response.status(200).json(await new OnboardingUpdateService().list(propertyIds));
    } catch (error) { next(error); }
  }

  async create(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const result = await new OnboardingUpdateService().addUserUpdate(request.params.propertyId, request.body.message, request.user.id);
      return response.status(201).json(result);
    } catch (error) { next(error); }
  }

  async ensureSlackThread(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const result = await new OnboardingUpdateService().ensureSlackThreadForProperty(request.params.propertyId, request.user.id);
      return response.status(200).json(result);
    } catch (error) { next(error); }
  }
}
