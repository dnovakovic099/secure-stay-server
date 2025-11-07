import { NextFunction, Request, Response } from "express";
import Joi, { custom } from "joi";
import { BadReviewStatus } from "../../../services/ReviewService";
import { LiveIssueStatus } from "../../../entity/LiveIssue";

enum ReviewCheckoutStatus {
    TO_CALL = "To Call",
    FOLLOW_UP_NO_ANSWER = "Follow up (No answer)",
    FOLLOW_UP_REVIEW_CHECK = "Follow up (Review check)",
    NO_FURTHER_ACTION_REQUIRED = "No further action required",
    ISSUE = "Issue",
    CLOSED_FIVE_STAR = "Closed - 5 Star",
    CLOSED_BAD_REVIEW = "Closed - Bad Review",
    CLOSED_NO_REVIEW = "Closed - No Review",
    CLOSED_TRAPPED = "Closed - Trapped",
    LAUNCH = "Launch"
}


export const validateGetReviewRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        dateType: Joi.string().required().valid("arrivalDate", "departureDate", "submittedAt"),
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
        channel: Joi.array().items(Joi.number()).optional(),
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
        todayDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().messages({
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
        status: Joi.array().items(Joi.string().required().valid(...Object.values(ReviewCheckoutStatus))).min(1).allow("", null),
        isActive: Joi.boolean().optional(),
        tab: Joi.string().required().valid("today", "active", "closed"),
    });

    const { error } = schema.validate(request.query);
    if (error) {
        next(error);
    }
    next();
};

export const validateUpdateReviewForCheckout = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        status: Joi.string().required().valid(...Object.values(ReviewCheckoutStatus)),
        comments: Joi.string().allow('', null),
        isActive: Joi.boolean().optional(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateCreateLatestUpdate = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        reviewCheckoutId: Joi.number().required(),
        updates: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateBadReviewUpdateStatus = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        badReviewId: Joi.number().required(),
        status: Joi.string().required().valid(...Object.values(BadReviewStatus)),
    });
    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateBadReviewLatestUpdate = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        badReviewId: Joi.number().required(),
        updates: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateGetBadReview = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        todayDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().messages({
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
        status: Joi.array().items(Joi.string().required().valid(...Object.values(BadReviewStatus))).min(1).allow("", null),
        isActive: Joi.boolean().optional(),
        tab: Joi.string().required().valid("today", "active", "closed"),
    });

    const { error } = schema.validate(request.query);
    if (error) {
        next(error);
    }
    next();
};

export const validateGetLiveIssues = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        page: Joi.number().required(),
        limit: Joi.number().required(),
        propertyId: Joi.alternatives().try(
            Joi.number(),
            Joi.array().items(Joi.number())
        ).optional(),
        keyword: Joi.string().optional(),
        status: Joi.alternatives().try(
            Joi.string().valid(...Object.values(LiveIssueStatus)),
            Joi.array().items(Joi.string().valid(...Object.values(LiveIssueStatus)))
        ).optional(),
        tab: Joi.string().required().valid("new", "active", "closed"),
        assignee: Joi.string().optional(),
        guestName: Joi.string().optional(),
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }
    next();
};

export const validateCreateLiveIssue = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string().required().valid(...Object.values(LiveIssueStatus)),
        assignee: Joi.string().allow('', null).optional(),
        propertyId: Joi.number().required(),
        summary: Joi.string().required(),
        guestName: Joi.string().required(),
        reservationId: Joi.number().required(),
        followUp: Joi.alternatives().try(
            Joi.string().isoDate(),
            Joi.date(),
            Joi.allow(null)
        ).optional(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateLiveIssue = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        status: Joi.string().valid(...Object.values(LiveIssueStatus)).optional(),
        assignee: Joi.string().allow('', null).optional(),
        propertyId: Joi.number().optional(),
        summary: Joi.string().optional(),
        guestName: Joi.string().optional(),
        reservationId: Joi.number().optional(),
        followUp: Joi.alternatives().try(
            Joi.string().isoDate(),
            Joi.date(),
            Joi.allow(null)
        ).optional(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateCreateLiveIssueUpdate = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        liveIssueId: Joi.number().required(),
        updates: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};