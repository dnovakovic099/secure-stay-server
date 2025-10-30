import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreateClientTicket = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string().required().valid("New", "In Progress", "Completed", "Need Help")
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
        mentions: Joi.array().items(Joi.string().optional()).optional(),
        clientSatisfaction: Joi.number().integer().min(1).max(5).required().allow(null),
        assignee: Joi.string().optional().allow(null),
        urgency: Joi.number().optional().allow(null).min(1).max(5),
        mistake: Joi.string().optional().allow(null).valid("Yes", "In Progress", "Need Help", "Resolved"),
        dueDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Due date must be in the format "yyyy-mm-dd"',
        }).optional().allow(null)
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
        status: Joi.string().required().valid("New", "In Progress", "Completed", "Need Help")
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
        clientSatisfaction: Joi.number().integer().min(1).max(5).required().allow(null),
        assignee: Joi.string().optional().allow(null),
        urgency: Joi.number().optional().allow(null).min(1).max(5),
        mistake: Joi.string().optional().allow(null).valid("Yes", "In Progress", "Need Help", "Resolved"),
        dueDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Due date must be in the format "yyyy-mm-dd"',
        }).optional().allow(null)
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateGetClientTicket = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.array().items(Joi.string().valid("New", "In Progress", "Completed", "Need Help")).optional(),
        listingId: Joi.array().items(Joi.string()).optional(),
        category: Joi.array().items(Joi.string().valid("Pricing", "Statement", "Reservation", "Listing", "Maintenance", "Other", "Onboarding")).optional(),
        fromDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional()
            .messages({ 'string.pattern.base': 'fromDate must be in the format "yyyy-mm-dd"' }),
        toDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional()
            .messages({ 'string.pattern.base': 'toDate must be in the format "yyyy-mm-dd"' }),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        ids: Joi.array().items(Joi.number().required()).min(1).optional(),
        propertyType: Joi.array().items(Joi.number()).min(1).optional(),
        keyword: Joi.string().optional()
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
        status: Joi.string().required().valid("New", "In Progress", "Completed", "Need Help")
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

export const validateBulkUpdateClientTicket = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        ids: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
        updateData: Joi.object({
            status: Joi.string().valid("New", "In Progress", "Completed", "Need Help"),
            listingId: Joi.string(),
            category: Joi.array().items(Joi.string()
                .valid("Pricing", "Statement", "Reservation", "Listing", "Maintenance", "Other", "Onboarding")),
            description: Joi.string(),
            resolution: Joi.string().allow(null),
            clientSatisfaction: Joi.number().integer().min(1).max(5).allow(null),
            dueDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                'string.pattern.base': 'Due date must be in the format "yyyy-mm-dd"',
            }).optional().allow(null)
        }).min(1).required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

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

