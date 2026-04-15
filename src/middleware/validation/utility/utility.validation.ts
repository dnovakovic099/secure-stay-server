import { NextFunction, Request, Response } from "express";
import Joi from "joi";

const baseSchema = Joi.object({
    providerType: Joi.string().required(),
    customProviderLabel: Joi.string().allow(null, ""),
    providerName: Joi.string().allow(null, ""),
    username: Joi.string().allow(null, ""),
    password: Joi.string().allow(null, ""),
    notes: Joi.string().allow(null, ""),
    propertyIds: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
});

export const validateCreateUtilityProvider = (request: Request, response: Response, next: NextFunction) => {
    const { error } = baseSchema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateUpdateUtilityProvider = (request: Request, response: Response, next: NextFunction) => {
    const schema = baseSchema.keys({
        providerType: Joi.string().optional(),
        propertyIds: Joi.array().items(Joi.number().integer().positive()).min(1).optional(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateGetUtilityProviders = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        search: Joi.string().allow("", null),
        providerType: Joi.alternatives().try(
            Joi.string(),
            Joi.array().items(Joi.string())
        ).optional(),
        listingId: Joi.number().integer().positive().optional(),
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }

    next();
};
