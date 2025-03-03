import { NextFunction, Request, Response } from "express";
import Joi, { custom } from "joi";

export const validateGetReviewRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        fromDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .messages({ 'string.pattern.base': 'fromDate must be in the format "yyyy-mm-dd"' }).optional(),
        toDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .messages({ 'string.pattern.base': 'toDate must be in the format "yyyy-mm-dd"' }).optional(),
        listingId: Joi.number().optional(),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        rating: Joi.number().max(10).min(0).optional(),
        owner: Joi.string().required().optional(),
        claimResolutionStatus: Joi.string().optional().valid("N/A", "Pending", "Completed", "Denied"),
        isClaimOnly: Joi.boolean().optional(),
        status: Joi.string().required().valid("active", "hidden"),
        reviewerNameHeaderSort: Joi.string().valid('ASC', 'DESC', null).optional(),
        listingHeaderSort: Joi.string().valid('ASC', 'DESC', null).optional(),
        arrivalDateHeaderSort: Joi.string().valid('ASC', 'DESC', null).optional(),
        departureDateHeaderSort: Joi.string().valid('ASC', 'DESC', null).optional(),
        guestNameHeaderSort: Joi.string().valid('ASC', 'DESC', null).optional(),
        channelHeaderSort: Joi.string().valid('ASC', 'DESC', null).optional(),
        ratingHeaderSort: Joi.string().valid('ASC', 'DESC', null).optional(),
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

export const validateUpdateReviewVisibilityStatusRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        reviewVisibility: Joi.string().required().valid("Visible", "Hidden"),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};