import { NextFunction, Request, Response } from "express";
import Joi from "joi";

const baseSchema = Joi.object({
    providerType: Joi.string().required(),
    customProviderLabel: Joi.string().allow(null, ""),
    providerName: Joi.string().allow(null, ""),
    username: Joi.string().allow(null, ""),
    password: Joi.string().allow(null, ""),
    lastpass: Joi.boolean().optional(),
    notes: Joi.string().allow(null, ""),
    propertyIds: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
    propertyLinks: Joi.array().items(
        Joi.object({
            propertyId: Joi.number().integer().positive().required(),
            accountNumber: Joi.string().allow(null, ""),
            propertyNotes: Joi.string().allow(null, ""),
            autopay: Joi.boolean().optional(),
            paymentMethod: Joi.string().allow(null, ""),
        })
    ).min(1).optional(),
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
        propertyLinks: Joi.array().items(
            Joi.object({
                propertyId: Joi.number().integer().positive().required(),
                accountNumber: Joi.string().allow(null, ""),
                propertyNotes: Joi.string().allow(null, ""),
                autopay: Joi.boolean().optional(),
                paymentMethod: Joi.string().allow(null, ""),
            })
        ).min(1).optional(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateUtilityPaymentMethod = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        label: Joi.string().trim().required(),
        sortOrder: Joi.number().integer().min(0).optional(),
        isActive: Joi.boolean().optional(),
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
