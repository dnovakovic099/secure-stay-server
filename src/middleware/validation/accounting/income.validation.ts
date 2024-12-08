import { Request, NextFunction, Response } from "express";
import Joi from "joi";

export const validateGetIncomeStatement = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        listingId: Joi.number().required().allow(''),
        dateType: Joi.string().required().valid("arrival", "departure",),
        fromDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required(),
        toDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required(),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        channelId: Joi.number().required().allow("")
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateRevenueCalculationRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        message: Joi.string().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};