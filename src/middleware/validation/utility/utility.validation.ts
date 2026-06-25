import { NextFunction, Request, Response } from "express";
import Joi from "joi";

const propertyLinkSchema = Joi.object({
    propertyId: Joi.number().integer().positive().required(),
    accountNumber: Joi.string().allow(null, ""),
    propertyNotes: Joi.string().allow(null, ""),
    source: Joi.string().allow(null, ""),
    managedBy: Joi.string().allow(null, ""),
    workSchedule: Joi.string().allow(null, ""),
    workScheduleDays: Joi.string().allow(null, ""),
    workScheduleIntervalWeeks: Joi.number().integer().positive().allow(null),
    workScheduleDayOfMonth: Joi.number().integer().min(1).max(31).allow(null),
    workScheduleQuarter: Joi.string().allow(null, ""),
    workScheduleMonth: Joi.string().allow(null, ""),
    workScheduleCheckoutTiming: Joi.string().allow(null, ""),
    autopay: Joi.boolean().optional(),
    paymentMethod: Joi.string().allow(null, ""),
    paymentScheduleType: Joi.string().allow(null, ""),
    paidBy: Joi.string().allow(null, ""),
    rate: Joi.string().allow(null, ""),
    rateType: Joi.string().allow(null, ""),
    customRateDescription: Joi.string().allow(null, ""),
    payoutDetails: Joi.string().allow(null, ""),
    paymentIntervalMonth: Joi.number().integer().positive().allow(null),
    paymentDayOfWeek: Joi.string().allow(null, ""),
    paymentWeekOfMonth: Joi.number().integer().min(1).max(5).allow(null),
    paymentDayOfMonth: Joi.number().integer().min(1).max(31).allow(null),
    nextServiceDate: Joi.string().allow(null, ""),
});

const baseSchema = Joi.object({
    providerType: Joi.string().required(),
    customProviderLabel: Joi.string().allow(null, ""),
    providerName: Joi.string().allow(null, ""),
    accountName: Joi.string().allow(null, ""),
    username: Joi.string().allow(null, ""),
    website: Joi.string().allow(null, ""),
    password: Joi.string().allow(null, ""),
    lastpass: Joi.boolean().optional(),
    notes: Joi.string().allow(null, ""),
    propertyIds: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
    propertyLinks: Joi.array().items(propertyLinkSchema).min(1).optional(),
});

const managedOptionKindSchema = Joi.string().valid("providerName", "accountName", "username").required();

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
        propertyLinks: Joi.array().items(propertyLinkSchema).min(1).optional(),
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

export const validateUtilityManagedOption = (request: Request, response: Response, next: NextFunction) => {
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

export const validateGetUtilityManagedOptions = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        kind: managedOptionKindSchema,
    });

    const { error } = schema.validate(request.params);
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
