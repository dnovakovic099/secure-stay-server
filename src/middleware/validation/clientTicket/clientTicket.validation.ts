import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreateClientTicket = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string().required().valid("New", "In Progress", "Completed")
            .messages({
                'any.required': 'Status is required',
                'any.only': 'Status must be one of New, In Progress, or Completed'
            }),
        listingId: Joi.string().required(),
        category: Joi.array().items(Joi.string()
            .valid("Pricing", "Statement", "Reservation", "Listing", "Maintenance", "Other", "Onboarding")).min(1).required(),
        description: Joi.string().required(),
        resolution: Joi.string().required().allow(null),
        latestUpdates: Joi.array().items(
            Joi.object({
                updates: Joi.string().required()
            }).required()
        ).min(1).required().allow(null),
        mentions: Joi.array().items(Joi.string().optional()).optional()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateClientTicket = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        status: Joi.string().required().valid("New", "In Progress", "Completed")
            .messages({
                'any.required': 'Status is required',
                'any.only': 'Status must be one of New, In Progress, or Completed'
            }),
        listingId: Joi.string().required(),
        category: Joi.array().items(Joi.string()
            .valid("Pricing", "Statement", "Reservation", "Listing", "Maintenance", "Other", "Onboarding")).min(1).required(),
        description: Joi.string().required(),
        resolution: Joi.string().required().allow(null),
        latestUpdates: Joi.array().items(
            Joi.object({
                id: Joi.number().optional(),
                updates: Joi.string().required(),
                isDeleted: Joi.boolean().optional()
            }).required()
        ).min(1).required().allow(null),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateGetClientTicket = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.array().items(Joi.string().valid("New", "In Progress", "Completed")).optional(),
        listingId: Joi.array().items(Joi.string()).optional(),
        category: Joi.array().items(Joi.string().valid("Pricing", "Statement", "Reservation", "Listing", "Maintenance", "Other", "Onboarding")).optional(),
        fromDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional()
            .messages({ 'string.pattern.base': 'fromDate must be in the format "yyyy-mm-dd"' }),
        toDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional()
            .messages({ 'string.pattern.base': 'toDate must be in the format "yyyy-mm-dd"' }),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        ids: Joi.array().items(Joi.number().required()).min(1).optional()
    }).custom((value, helpers) => {
        if (value.fromDate && value.toDate && new Date(value.fromDate) > new Date(value.toDate)) {
            return helpers.error('any.invalid', { message: 'fromDate must be before toDate' });
        }
        if (value.fromDate && !value.toDate) {
            return helpers.error('any.required', { message: 'toDate is required when fromDate is provided' });
        }
        if (!value.fromDate && value.toDate) {
            return helpers.error('any.required', { message: 'fromDate is required when toDate is provided' });
        }
        return value;
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }
    next();
};


export const validateUpdateStatus = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        status: Joi.string().required().valid("New", "In Progress", "Completed")
            .messages({
                'any.required': 'Status is required',
                'any.only': 'Status must be one of New, In Progress, or Completed'
            }),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
}

export const validateCreateLatestUpdates = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        ticketId: Joi.number().required(),
        updates: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateLatestUpdates = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        updates: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};
