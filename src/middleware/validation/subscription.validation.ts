import { NextFunction, Request, Response } from "express";
import Joi from "joi";

export const validateCreateCheckoutSessionRequest = (
  request: Request,
  response: Response,
  next: NextFunction
) => {
  const schema = Joi.object({
    planId: Joi.string().required(),
  });

  const { error } = schema.validate(request.body);
  if (error) {
    return next(error);
  }
  next();
};
