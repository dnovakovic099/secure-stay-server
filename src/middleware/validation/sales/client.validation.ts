import { NextFunction, Request, Response } from "express";
import Joi from "joi";

export const validateCreateClientRequest = (
  request: Request,
  response: Response,
  next: NextFunction
) => {
  const schema = Joi.object({
    leadStatus: Joi.string().valid("Active", "Inactive").required().messages({
      "any.only": "leadStatus must be either 'Active' or 'Inactive'",
      "any.required": "leadStatus is required",
    }),
    propertyAddress: Joi.string().required().messages({
      "string.base": "propertyAddress must be a string",
      "any.required": "propertyAddress is required",
    }),
    city: Joi.string().required().messages({
      "string.base": "city must be a string",
      "any.required": "city is required",
    }),
    state: Joi.string().required().messages({
      "string.base": "state must be a string",
      "any.required": "state is required",
    }),
    country: Joi.string().required().messages({
      "string.base": "country must be a string",
      "any.required": "country is required",
    }),
    ownerName: Joi.string().required().messages({
      "string.base": "ownerName must be a string",
      "any.required": "ownerName is required",
    }),
    salesCloser: Joi.string().required().messages({
      "string.base": "salesCloser must be a string",
      "any.required": "salesCloser is required",
    }),
    airDnaRevenue: Joi.number().required().messages({
      "number.base": "airDnaRevenue must be a number",
    }),
    commissionAmount: Joi.number().required().messages({
      "number.base": "commissionAmount must be a number",
    }),
    commissionStatus: Joi.string()
      .valid("Paid", "Pending")
      .required()
      .messages({
        "any.only": "commissionStatus must be either 'Paid' or 'Pending'",
        "any.required": "commissionStatus is required",
      }),
  });

  const { error } = schema.validate(request.body);
  if (error) {
    return next(error);
  }

  next();
};
