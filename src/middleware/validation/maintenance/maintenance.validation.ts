import { Request, Response, NextFunction } from "express";
import Joi from "joi";

const maintenanceStatusSchema = Joi.string().valid(
    "Not scheduled",
    "Coordinating",
    "Scheduled",
    "Cancelled",
    "Postponed"
);

export const validateCreateMaintenance = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        listingId: Joi.string().required(),
        workCategory: Joi.string().required(),
        nextSchedule: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'nextSchedule must be in the format "yyyy-mm-dd"',
        }).required(),
        status: maintenanceStatusSchema.optional(),
        contactId: Joi.number().required().allow(null),
        issueId: Joi.number().optional().allow(null),
        issueIds: Joi.array().items(Joi.number()).optional()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateUpdateMaintenance = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        listingId: Joi.string().required(),
        workCategory: Joi.string().required(),
        nextSchedule: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'nextSchedule must be in the format "yyyy-mm-dd"',
        }).required(),
        status: maintenanceStatusSchema.optional(),
        contactId: Joi.number().required().allow(null),
        issueId: Joi.number().optional().allow(null),
        issueIds: Joi.array().items(Joi.number()).optional(),
        notes: Joi.string().allow(null, '')
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateGetMaintenance = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        listingId: Joi.array().items(Joi.string()).optional(),
        workCategory: Joi.array().items(Joi.string()).optional(),
        contactId: Joi.array().items(Joi.number()).optional(),
        fromDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'nextSchedule must be in the format "yyyy-mm-dd"',
        }).optional(),
        toDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'nextSchedule must be in the format "yyyy-mm-dd"',
        }).optional(),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        propertyType: Joi.array().items(Joi.string()).min(1).optional(),
        workType: Joi.array().items(Joi.string().valid("regular", "one-time", "issue-related")).optional(),
        status: Joi.array().items(maintenanceStatusSchema).optional(),
        keyword: Joi.string().optional(),
        type: Joi.string().valid("unassigned", "today", "upcoming", "past").optional(),
        currentDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'nextSchedule must be in the format "yyyy-mm-dd"',
        }).required()
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
