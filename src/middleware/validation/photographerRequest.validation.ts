import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreatePhotographerRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        ownerNamePropertyInternalName: Joi.string().required(),
        serviceType: Joi.string().required().valid("Launch", "Pro", "Full Service", "Others (Add to Sales Note)"),
        completeAddress: Joi.string().required(),
        numberOfBedrooms: Joi.number().required(),
        numberOfBathrooms: Joi.number().required(),
        sqftOfHouse: Joi.number().required(),
        availability: Joi.string().required(),
        onboardingRep: Joi.string().required(),
        status: Joi.string().optional().valid("new", "in_progress", "completed"),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdatePhotographerRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        ownerNamePropertyInternalName: Joi.string().optional(),
        serviceType: Joi.string().optional().valid("Launch", "Pro", "Full Service", "Others (Add to Sales Note)"),
        completeAddress: Joi.string().optional(),
        numberOfBedrooms: Joi.number().optional().allow(null),
        numberOfBathrooms: Joi.number().optional().allow(null),
        sqftOfHouse: Joi.number().optional().allow(null),
        availability: Joi.string().optional().allow(null, ""),
        onboardingRep: Joi.string().optional().allow(null, ""),
        status: Joi.string().optional().valid("new", "in_progress", "completed"),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};
