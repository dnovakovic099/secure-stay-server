import { NextFunction, Request, Response } from "express";
import Joi from "joi";

/**
 * Validate search properties request body
 */
export const validateMapsSearch = (
  request: Request,
  response: Response,
  next: NextFunction
) => {
  const schema = Joi.object({
    state: Joi.string().optional(),
    city: Joi.string().optional(),
    propertyId: Joi.number().optional(),
    startDate: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .messages({
        "string.pattern.base": 'startDate must be in the format "yyyy-mm-dd"',
      })
      .optional(),
    endDate: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .messages({
        "string.pattern.base": 'endDate must be in the format "yyyy-mm-dd"',
      })
      .optional(),
    guests: Joi.number().min(1).optional(),
  }).custom((value, helpers) => {
    // If one date is provided, the other must be too
    if ((value.startDate && !value.endDate) || (!value.startDate && value.endDate)) {
      return helpers.error("custom.dateRange", {
        message: "Both startDate and endDate must be provided together",
      });
    }
    // Validate endDate is after startDate
    if (value.startDate && value.endDate) {
      const start = new Date(value.startDate);
      const end = new Date(value.endDate);
      if (end < start) {
        return helpers.error("custom.dateOrder", {
          message: "endDate must be on or after startDate",
        });
      }
    }
    return value;
  });

  const { error } = schema.validate(request.body);
  if (error) {
    return response.status(400).json({
      success: false,
      message: error.message,
    });
  }

  next();
};
