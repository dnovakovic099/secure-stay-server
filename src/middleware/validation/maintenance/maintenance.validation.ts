import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreateMaintenance = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        listingId: Joi.string().required(),
        workCategory: Joi.string().required(),
        nextSchedule: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'nextSchedule must be in the format "yyyy-mm-dd"',
        }).required(),
        contactId: Joi.number().required().allow(null)
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
        contactId: Joi.number().required().allow(null)
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};