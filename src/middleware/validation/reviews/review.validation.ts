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
        listingId: Joi.array().items(
            Joi.number().required()
        ).min(1).required().allow(null, ""),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        rating: Joi.number().max(10).min(0).optional(),
        owner: Joi.array().items(Joi.string().required()).min(1).required().allow(null, ""),
        claimResolutionStatus: Joi.string().optional().valid("N/A", "Pending", "Completed", "Denied"),
        isClaimOnly: Joi.boolean().optional(),
        status: Joi.string().required().valid("active", "hidden").allow(null, ""),
        keyword: Joi.string().optional(),
        propertyType: Joi.array().items(Joi.number().required()).min(1).optional(),
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


export const validateSaveReview = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        reservationId: Joi.number().required(),
        reviewerName: Joi.string().required(),
        rating: Joi.number().required(),
        publicReview: Joi.string().required(),
        status: Joi.string().required().valid("active", "hidden"),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateGetReviewForCheckout = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        todayDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).required().messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
            'any.required': 'todayDate is required'
        }),
        listingMapId: Joi.array().items(Joi.number()).min(1).allow("", null),
        guestName: Joi.string().allow(''),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        propertyType: Joi.array().items(Joi.number().required()).min(1).optional(),
        actionItems: Joi.array().items(
            Joi.string().valid('incomplete', 'completed', 'expired', 'in progress').required()
        ).optional(),
        issues: Joi.array().items(
            Joi.string().required().valid("In Progress", "Overdue", "Completed", "Need Help", "New")
        ).optional(),
        channel: Joi.array().items(Joi.string()).optional(),
        keyword: Joi.string().optional(),
    });

    const { error } = schema.validate(request.query);
    if (error) {
        next(error);
    }
    next();
};
