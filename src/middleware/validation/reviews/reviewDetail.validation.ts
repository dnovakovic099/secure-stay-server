import { NextFunction, Request, Response } from "express";
import Joi from "joi";

export const validateReviewDetailsRequest = (request: Request, response: Response, next: NextFunction) => {
    const removalAttemptSchema = Joi.object({
        dateAttempted: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .required()
            .messages({ 'string.pattern.base': 'dateAttempted must be in the format "yyyy-mm-dd"' }),
        details: Joi.string().required(),
        result: Joi.string().required().valid('Removed', 'Denied', 'Pending')
    });

    const schema = Joi.object({
        date: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .required()
            .messages({ 'string.pattern.base': 'date must be in the format "yyyy-mm-dd"' }),
        claimResolutionStatus: Joi.string().valid('N/A', 'Pending', 'Completed', 'Denied').allow(null, ''),
        whoUpdated: Joi.string().allow(null, ''),
        removalAttempts: Joi.array().items(removalAttemptSchema).max(3)
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};
