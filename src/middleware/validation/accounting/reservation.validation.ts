import { Request, Response, NextFunction } from 'express';
import * as Joi from 'joi';

export const validateGetReservationList = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        checkInStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).allow(''),
        checkInEndDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).allow(''),
        checkOutStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).allow(''),
        checkOutEndDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).allow(''),
        todayDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).required().messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
            'any.required': 'todayDate is required'
        }),
        listingMapId: Joi.array().items(Joi.number()).min(1).allow("", null),
        guestName: Joi.string().allow(''),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        currentHour: Joi.string(),
        propertyType: Joi.array().items(Joi.string().required()).min(1).optional(),
        actionItems: Joi.array().items(
            Joi.string().valid('incomplete', 'completed', 'expired', 'in progress').required()
        ).optional(),
        issues: Joi.array().items(
            Joi.string().required().valid("In Progress", "Overdue", "Completed", "Need Help", "New")
        ).optional(),
        channel: Joi.array().items(Joi.string()).optional(),
        payment: Joi.array().items(
            Joi.string()
                .valid("Unknown","Paid","Partially paid")
        ).optional(),
        keyword: Joi.string().optional(),
    });

    const { error } = schema.validate(request.query);
    if (error) {
        next(error);
    }
    next();
};


export const validateGetReservationReport = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        year: Joi.number().required(),
        month: Joi.number().optional().allow(null)
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};