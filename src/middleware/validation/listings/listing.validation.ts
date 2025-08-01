import { NextFunction, Request, Response } from "express";
import Joi from "joi";

export const validateSaveListingScore = (request: Request, response: Response, next: NextFunction) => {

  const schema = Joi.object({
    listingId: Joi.number().required(),

    revenuePotential: Joi.number().min(0).required(),
    marketRevenue: Joi.number().min(0).required(),
    cleaningFee: Joi.number().min(0).required(),
    potentialCleaningFee: Joi.number().min(0).required(),
    marketCleaningFee: Joi.number().min(0).required(),
    revenueSharing: Joi.number().min(0).required(),

    photographyScore: Joi.number().integer().min(0).required(),
    photographyAnalysis: Joi.string().allow('').optional(),

    designScore: Joi.number().integer().min(0).required(),
    designAnalysis: Joi.string().allow('').optional(),

    amenitiesScore: Joi.number().integer().min(0).required(),
    amenitiesAnalysis: Joi.string().allow('').optional(),

    sleepingCount: Joi.number().integer().min(0).required(),
    sleepingCountScore: Joi.number().integer().min(0).required(),
    sleepingCountAnalysis: Joi.string().allow('').optional(),

    reviewScore: Joi.number().integer().min(0).required(),
    reviewAnalysis: Joi.string().allow('').optional(),
    pmFee: Joi.number().min(0).required(),
  });


  const { error } = schema.validate(request.body);
  if (error) {
    return next(error);
  }

  next();
};


export const validateGetListingScore = (request: Request, response: Response, next: NextFunction) => {

  const schema = Joi.object({
    listingId: Joi.number().required(),
  });

  const { error } = schema.validate(request.query);
  if (error) {
    return next(error);
  }

  next();
};


export const validateSaveListingUpdate = (request: Request, response: Response, next: NextFunction) => {
  const schema = Joi.object({
    listingId: Joi.number().required(),
    date: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
      'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
    }).required(),
    action: Joi.string().required(),
  });

  const { error } = schema.validate(request.body);
  if (error) {
    return next(error);
  }

  next();
};

export const validateSaveListingDetail = (request: Request, response: Response, next: NextFunction) => {
  const schema = Joi.object({
    listingId: Joi.number().required(),
    propertyOwnershipType: Joi.string().required().valid("Property Management", "Arbitrage", "Luxury Lodging Owned"),
    statementDurationType: Joi.string().required().valid("Monthly", "Weekly & Bi-weekly").allow(null, ""),
    claimProtection: Joi.boolean().required(),
    hidePetFee: Joi.boolean().required(),
    scheduleType: Joi.string().required().valid(
      "weekly", "bi-weekly", "monthly", "quarterly", "annually", "check-out basis", "as required"
    ).allow(null),
    intervalMonth: Joi.number().integer().min(1).max(12).required().allow(null),
    dayOfWeek: Joi.array().items(Joi.number().integer().min(0).max(6).required()).allow(null),
    weekOfMonth: Joi.number().integer().min(1).max(5).required().allow(null),
    dayOfMonth: Joi.number().integer().min(1).max(32).required().allow(null),
    scheduling: Joi.string().valid("LL", "LL-auto", "Client", "NA").required().allow(null),
  });

  const { error } = schema.validate(request.body);
  if (error) {
    return next(error);
  }

  next();
};
