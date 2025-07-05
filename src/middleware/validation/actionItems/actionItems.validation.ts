import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreateActionItems = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        listingId: Joi.string().required(),
        guestName: Joi.string().required(),
        item: Joi.string().required(),
        category: Joi.string().required()
            .valid("RESERVATION CHANGES", "GUEST REQUESTS", "KNOWLEDGE BASE SUGGESTIONS", "OTHER"),
        status: Joi.string().valid('incomplete', 'completed', 'expired','in progress').required(),
        listingName: Joi.string().required(),
        reservationId: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateActionItems = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        listingId: Joi.string().required(),
        guestName: Joi.string().required(),
        item: Joi.string().required(),
        category: Joi.string().required()
            .valid("RESERVATION CHANGES", "GUEST REQUESTS", "KNOWLEDGE BASE SUGGESTIONS", "OTHER"),
        status: Joi.string().valid('incomplete', 'completed', 'expired', 'in progress').required(),
        listingName: Joi.string().required(),
        reservationId: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const getActionItemsValidation = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        category: Joi.array().items(Joi.string().valid("RESERVATION CHANGES", "GUEST REQUESTS", "KNOWLEDGE BASE SUGGESTIONS", "OTHER")).min(1).optional(),
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).default(10),
        listingId: Joi.array().items(Joi.string()).min(1).optional(),
        guestName: Joi.string().optional(),
        status: Joi.array().items(Joi.string().valid('incomplete', 'completed', 'expired', 'in progress')).min(1).optional(),
        fromDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).optional(),
        toDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).optional(),
    }).custom((value, helpers) => {
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
}

export const validateCreateLatestUpdate = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        actionItemId: Joi.number().required(),
        updates: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateLatestUpdate = (request: Request, response: Response, next: NextFunction) => {
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

export const validateActionItemMigrationToIssue = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        status: Joi.string().valid("In Progress", "Overdue", "Completed", "Need Help", "New").required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
}

