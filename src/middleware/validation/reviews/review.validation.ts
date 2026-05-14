import { NextFunction, Request, Response } from "express";
import Joi, { custom } from "joi";
import { BadReviewStatus } from "../../../services/ReviewService";
import { LiveIssueStatus } from "../../../entity/LiveIssue";

enum ReviewCheckoutStatus {
    NEW = "New",
    IN_PROGRESS = "In Progress",
    COMPLETED = "Completed",
    ARCHIVED = "Archived",
}


export const validateGetReviewRequest = (request: Request, response: Response, next: NextFunction) => {
    const arrayOrSingle = (schema: Joi.Schema) =>
        Joi.alternatives().try(
            Joi.array().items(schema).min(1),
            schema
        ).optional().allow(null, "");

    const schema = Joi.object({
        dateType: Joi.string().required().valid("arrivalDate", "departureDate", "submittedAt"),
        fromDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .messages({ 'string.pattern.base': 'fromDate must be in the format "yyyy-mm-dd"' }).optional(),
        toDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .messages({ 'string.pattern.base': 'toDate must be in the format "yyyy-mm-dd"' }).optional(),
        startDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .messages({ 'string.pattern.base': 'startDate must be in the format "yyyy-mm-dd"' }).optional().allow(null, ""),
        endDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .messages({ 'string.pattern.base': 'endDate must be in the format "yyyy-mm-dd"' }).optional().allow(null, ""),
        listingId: arrayOrSingle(Joi.number().required()).required(),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        rating: arrayOrSingle(Joi.number().max(10).min(0).required()),
        owner: arrayOrSingle(Joi.string().required()).required(),
        claimResolutionStatus: Joi.string().optional().valid("N/A", "Pending", "Completed", "Denied"),
        isClaimOnly: Joi.boolean().optional(),
        status: arrayOrSingle(Joi.string().valid("active", "hidden", "Awaiting Review", "Submitted", "Visible", "No Review", "Keep", "Removed", "Archived").required()).allow(null, ""),
        keyword: Joi.string().optional(),
        propertyType: arrayOrSingle(Joi.string().required()),
        serviceType: arrayOrSingle(Joi.string().required()),
        channel: arrayOrSingle(Joi.number()),
        integration: arrayOrSingle(Joi.string().required()),
        currentlyStaying: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')).optional(),
        sortField: Joi.string().optional().valid(
            'rating',
            'submittedAt',
            'arrivalDate',
            'departureDate',
            'guestName',
            'channelName',
            'listingName',
            'integration',
            'propertyType',
            'createdAt',
            'updatedAt'
        ),
        sortDir: Joi.string().optional().valid('ASC', 'DESC'),
        assignee: Joi.alternatives().try(
            Joi.string(),
            Joi.array().items(Joi.string())
        ).optional().allow(null, ""),
        latestUpdate: Joi.alternatives().try(
            Joi.string().valid('with-updates', 'no-updates', ''),
            Joi.array().items(Joi.string().valid('with-updates', 'no-updates'))
        ).optional().allow(null, ""),
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
        reviewVisibility: Joi.string().required().valid("Awaiting Review", "Submitted", "Visible", "No Review", "Keep", "Removed", "Archived"),
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
        listingMapId: Joi.alternatives().try(
            Joi.array().items(Joi.string()),
            Joi.string()
        ).optional(),
        guestName: Joi.string().allow(''),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        propertyType: Joi.alternatives().try(
            Joi.array().items(Joi.string()),
            Joi.string()
        ).optional(),
        serviceType: Joi.alternatives().try(
            Joi.array().items(Joi.string()),
            Joi.string()
        ).optional(),
        actionItems: Joi.alternatives().try(
            Joi.array().items(Joi.string()),
            Joi.string()
        ).optional(),
        issues: Joi.alternatives().try(
            Joi.array().items(Joi.string()),
            Joi.string()
        ).optional(),
        channel: Joi.alternatives().try(
            Joi.array().items(Joi.string()),
            Joi.string()
        ).optional(),
        keyword: Joi.string().optional(),
        status: Joi.alternatives().try(
            Joi.array().items(Joi.string()),
            Joi.string()
        ).optional(),
        isActive: Joi.boolean().optional(),
        tab: Joi.string().optional().valid("today", "active", "closed", "all"),
        integration: Joi.alternatives().try(
            Joi.array().items(Joi.string()),
            Joi.string()
        ).optional(),
        fromDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
        toDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dateType: Joi.string().optional().valid("submittedAt", "updatedAt", "arrivalDate", "departureDate", "refundedAt"),
        sentiment: Joi.alternatives().try(
            Joi.string(),
            Joi.array().items(Joi.string())
        ).optional(),
        latestUpdate: Joi.alternatives().try(
            Joi.string(),
            Joi.array().items(Joi.string().valid('with-updates', 'no-updates'))
        ).optional(),
        visibility: Joi.alternatives().try(
            Joi.string(),
            Joi.array().items(Joi.string())
        ).optional(),
        refundStatus: Joi.alternatives().try(
            Joi.string(),
            Joi.array().items(Joi.string())
        ).optional(),
        operationalFlags: Joi.alternatives().try(
            Joi.string(),
            Joi.array().items(Joi.string())
        ).optional(),
        owner: Joi.alternatives().try(
            Joi.string(),
            Joi.array().items(Joi.string())
        ).optional(),
        isClaimOnly: Joi.boolean().optional(),
        rating: Joi.alternatives().try(
            Joi.number(),
            Joi.array().items(Joi.number())
        ).optional(),
        tags: Joi.alternatives().try(
            Joi.string(),
            Joi.array().items(Joi.string())
        ).optional(),
        assignee: Joi.alternatives().try(
            Joi.string(),
            Joi.array().items(Joi.string())
        ).optional().allow(null, ""),
        currentlyStaying: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')).optional(),
        reservationId: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
        confirmationCode: Joi.string().allow('').optional(),
        totalPaidOperator: Joi.string().valid('gt', 'lt', 'between', 'eq', '').optional(),
        totalPaidMin: Joi.alternatives().try(Joi.number(), Joi.string().allow('')).optional(),
        totalPaidMax: Joi.alternatives().try(Joi.number(), Joi.string().allow('')).optional(),
        ownerPayoutOperator: Joi.string().valid('gt', 'lt', 'between', 'eq', '').optional(),
        ownerPayoutMin: Joi.alternatives().try(Joi.number(), Joi.string().allow('')).optional(),
        ownerPayoutMax: Joi.alternatives().try(Joi.number(), Joi.string().allow('')).optional(),
        latestUpdateSearch: Joi.string().allow('').optional(),
        resolutionNotes: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional(),
        resolutionNotesSearch: Joi.string().allow('').optional(),
        issuesEntry: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional(),
        issueCategory: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional(),
        issueDescriptionSearch: Joi.string().allow('').optional(),
        aiRedFlag: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional(),
        aiGreenFlag: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional(),
        aiAnalysis: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional(),
        aiAnalysisSearch: Joi.string().allow('').optional(),
        publicReviewSearch: Joi.string().allow('').optional(),
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateReviewForCheckout = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        status: Joi.string().optional(),
        comments: Joi.string().allow('', null),
        assignee: Joi.string().allow('', null).optional(),
        isActive: Joi.boolean().optional(),
        visibility: Joi.string().optional(),
    }).or('status', 'comments', 'assignee', 'isActive', 'visibility');

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
        propertyType: Joi.array().items(Joi.string().required()).min(1).optional(),
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

export const validateBackfillReviewCheckout = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        startDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .required()
            .messages({ 'string.pattern.base': 'startDate must be in the format "yyyy-mm-dd"' }),
        endDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .required()
            .messages({ 'string.pattern.base': 'endDate must be in the format "yyyy-mm-dd"' }),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateFixReviewCheckoutCreatedAt = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        startDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .messages({ 'string.pattern.base': 'startDate must be in the format "yyyy-mm-dd"' }),
        endDate: Joi.string()
            .pattern(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .messages({ 'string.pattern.base': 'endDate must be in the format "yyyy-mm-dd"' }),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};
