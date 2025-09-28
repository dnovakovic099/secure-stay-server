import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreateActionItems = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        listingId: Joi.string().required(),
        guestName: Joi.string().required(),
        item: Joi.string().required(),
        category: Joi.string().required()
            .valid("RESERVATION CHANGES", "GUEST REQUESTS", "KNOWLEDGE BASE SUGGESTIONS", "OTHER", "PROPERTY ACCESS", "HB NOT RESPONDING"),
        status: Joi.string().valid('incomplete', 'completed', 'expired','in progress').required(),
        listingName: Joi.string().required(),
        reservationId: Joi.string().required(),
        assignee: Joi.string().optional().allow(null),
        urgency: Joi.number().optional().allow(null).min(1).max(5),
        mistake: Joi.string().optional().allow(null).valid("Yes", "In Progress", "Need Help", "Resolved"),
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
            .valid("RESERVATION CHANGES", "GUEST REQUESTS", "KNOWLEDGE BASE SUGGESTIONS", "OTHER", "PROPERTY ACCESS", "HB NOT RESPONDING"),
        status: Joi.string().valid('incomplete', 'completed', 'expired', 'in progress').required(),
        listingName: Joi.string().required(),
        reservationId: Joi.string().required(),
        assignee: Joi.string().optional().allow(null),
        urgency: Joi.number().optional().allow(null).min(1).max(5),
        mistake: Joi.string().optional().allow(null).valid("Yes", "In Progress", "Need Help", "Resolved"),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const getActionItemsValidation = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        category: Joi.array().items(Joi.string().valid("RESERVATION CHANGES", "GUEST REQUESTS", "KNOWLEDGE BASE SUGGESTIONS", "OTHER", "PROPERTY ACCESS", "HB NOT RESPONDING")).min(1).optional(),
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
        ids: Joi.array().items(Joi.number().required()).min(1).optional(),
        propertyType: Joi.array().items(Joi.number()).min(1).optional(),
        keyword: Joi.string().optional(),
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
        category: Joi.string().required().valid("MAINTENANCE", "CLEANLINESS", "HVAC", "LANDSCAPING", "PEST CONTROL", "POOL AND SPA")
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
}

export const validateBulkUpdateActionItems = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        ids: Joi.array().items(Joi.number().required()).min(1).required(),
        updateData: Joi.object({
            listingName: Joi.string().optional(),
            guestName: Joi.string().optional(),
            item: Joi.string().optional(),
            category: Joi.string().valid("RESERVATION CHANGES", "GUEST REQUESTS", "KNOWLEDGE BASE SUGGESTIONS", "OTHER", "PROPERTY ACCESS", "HB NOT RESPONDING").optional(),
            status: Joi.string().valid('incomplete', 'completed', 'expired', 'in progress').optional(),
            listingId: Joi.number().optional(),
            reservationId: Joi.number().optional(),
        }).min(1).required() // At least one field must be provided for update
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
}

export const validateUpdateAssignee = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        assignee: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateUrgency = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        urgency: Joi.number().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};


export const validateUpdateMistake = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        mistake: Joi.string().required().valid('Yes', 'In Progress', 'Need Help', 'Resolved'),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

