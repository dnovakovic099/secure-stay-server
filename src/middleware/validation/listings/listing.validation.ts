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
