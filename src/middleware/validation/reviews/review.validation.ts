import { NextFunction, Request, Response } from "express";
import Joi, { custom } from "joi";

export const validateGetReviewRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        fromDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .messages({ 'string.pattern.base': 'fromDate must be in the format "yyyy-mm-dd"' }),
        toDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .messages({ 'string.pattern.base': 'toDate must be in the format "yyyy-mm-dd"' }),
        listingId: Joi.number().optional(),
        page: Joi.number().required(),
        limit: Joi.number().required()
    }).custom((value, helpers) => {
        if ((value?.fromDate && !value?.toDate) || (!value?.fromDate && value?.toDate)) {
            return helpers.message({ custom: 'Both fromDate and toDate must be provided together' });
        }
        return value;
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }
    next();
};