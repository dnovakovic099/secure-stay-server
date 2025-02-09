import { NextFunction, Request, Response } from "express";
import Joi, { custom } from "joi";

export const validateReviewDetailsRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string().required().valid("active", "hidden"),
        date: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .messages({ 'string.pattern.base': 'date must be in the format "yyyy-mm-dd"' }),
        lastContactDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .messages({ 'string.pattern.base': 'lastContactDate must be in the format "yyyy-mm-dd"' }).allow(null, ""),
        methodsTried: Joi.string().required().allow("", null),
        methodsLeft: Joi.string().required().allow("", null),
        notes: Joi.string().required().allow("", null),
        claimResolutionStatus: Joi.string().required().valid('N/A', 'Pending', 'Completed', 'Denied')
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};
