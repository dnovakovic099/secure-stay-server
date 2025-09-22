import { Request, NextFunction, Response } from "express";
import Joi from "joi";

export const validateCreateIssue = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string()
            .valid("In Progress", "Overdue", "Completed", "Need Help", "New", "Scheduled")
            .default("In Progress")
            .required(),
        listing_id: Joi.number().required(),
        listing_name: Joi.string().allow(null, ''),
        reservation_id: Joi.string().allow(null, ''),
        check_in_date: Joi.date().allow(null),
        reservation_amount: Joi.number().precision(2).allow(null),
        channel: Joi.string().allow(null, ''),
        guest_name: Joi.string().allow(null, ''),
        guest_contact_number: Joi.string().allow(null, ''),
        issue_description: Joi.string().allow(null, ''),
        owner_notes: Joi.string().allow(null, ''),
        creator: Joi.string().allow(null, ''),
        date_time_reported: Joi.date().allow(null),
        date_time_contractor_contacted: Joi.date().allow(null),
        date_time_contractor_deployed: Joi.date().allow(null),
        quote_1: Joi.string().allow(null, ''),
        quote_2: Joi.string().allow(null, ''),
        quote_3: Joi.string().allow(null, ''),
        quote_4: Joi.string().allow(null, ''),
        quote_5: Joi.string().allow(null, ''),
        quote_6: Joi.string().allow(null, ''),
        estimated_reasonable_price: Joi.number().precision(2).allow(null),
        final_price: Joi.number().precision(2).allow(null),
        date_time_work_finished: Joi.date().allow(null),
        final_contractor_name: Joi.string().allow(null, ''),
        issue_reporter: Joi.string().allow(null, ''),
        is_preventable: Joi.string().allow(null, ''),
        completed_by: Joi.string().allow(null, ''),
        completed_at: Joi.date().allow(null),
        claim_resolution_status: Joi.string()
            .valid('N/A', 'Not Submitted', 'In Progress', 'Submitted', 'Resolved')
            .default('N/A'),
        claim_resolution_amount: Joi.number().precision(2).allow(null),
        next_steps: Joi.string().allow(null, ''),
        payment_information: Joi.string().allow(null, ''),
        category: Joi.string().valid("MAINTENANCE", "CLEANLINESS", "HVAC", "LANDSCAPING", "PEST CONTROL", "POOL AND SPA").allow(null, ""),
        resolution: Joi.string().optional().allow(null),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateUpdateIssue = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string()
            .valid("In Progress", "Overdue", "Completed", "Need Help", "New", "Scheduled"),
        listing_id: Joi.number(),
        listing_name: Joi.string().allow(null, ''),
        reservation_id: Joi.string().allow(null, ''),
        check_in_date: Joi.date().allow(null),
        reservation_amount: Joi.number().precision(2).allow(null),
        channel: Joi.string().allow(null, ''),
        guest_name: Joi.string().allow(null, ''),
        guest_contact_number: Joi.string().allow(null, ''),
        issue_description: Joi.string().allow(null, ''),
        owner_notes: Joi.string().allow(null, ''),
        creator: Joi.string().allow(null, ''),
        date_time_reported: Joi.date().allow(null),
        date_time_contractor_contacted: Joi.date().allow(null),
        date_time_contractor_deployed: Joi.date().allow(null),
        quote_1: Joi.string().allow(null, ''),
        quote_2: Joi.string().allow(null, ''),
        quote_3: Joi.string().allow(null, ''),
        quote_4: Joi.string().allow(null, ''),
        quote_5: Joi.string().allow(null, ''),
        quote_6: Joi.string().allow(null, ''),
        estimated_reasonable_price: Joi.number().precision(2).allow(null),
        final_price: Joi.number().precision(2).allow(null),
        date_time_work_finished: Joi.date().allow(null),
        final_contractor_name: Joi.string().allow(null, ''),
        issue_reporter: Joi.string().allow(null, ''),
        is_preventable: Joi.string().allow(null, ''),
        completed_by: Joi.string().allow(null, ''),
        completed_at: Joi.date().allow(null),
        claim_resolution_status: Joi.string()
            .valid('N/A', 'Not Submitted', 'In Progress', 'Submitted', 'Resolved'),
        claim_resolution_amount: Joi.number().precision(2).allow(null),
        next_steps: Joi.string().allow(null, ''),
        payment_information: Joi.string().allow(null, ''),
        deletedFiles: Joi.string().allow(null, ''),
        category: Joi.string().valid("MAINTENANCE", "CLEANLINESS", "HVAC", "LANDSCAPING", "PEST CONTROL", "POOL AND SPA").allow(null,""),
        resolution: Joi.string().optional().allow(null),
        fileInfo: Joi.any().optional()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};


export const validateIssueMigrationToActionItem = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        status: Joi.string().valid('incomplete', 'completed', 'expired', 'in progress').required(),
        category: Joi.string().valid("RESERVATION CHANGES", "GUEST REQUESTS", "KNOWLEDGE BASE SUGGESTIONS", "OTHER", "PROPERTY ACCESS", "HB NOT RESPONDING").required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateCreateLatestUpdates = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        issueId: Joi.number().required(),
        updates: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateLatestUpdates = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        updates: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};


export const validateGetIssues = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        category: Joi.array().items(Joi.string().valid("MAINTENANCE", "CLEANLINESS", "HVAC", "LANDSCAPING", "PEST CONTROL", "POOL AND SPA")).min(1).optional(),
        listingId: Joi.array().items(Joi.number()).min(1).optional(),
        propertyType: Joi.array().items(Joi.number().required()).min(1).optional(),
        fromDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).optional(),
        toDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).optional(),
        status: Joi.array().items(Joi.string().valid("New", "In Progress", "Overdue", "Completed", "Need Help", "Scheduled")).min(1).optional(),
        guestName: Joi.string().optional(),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        issueId: Joi.array().items(Joi.number()).min(1).optional(),
        reservationId: Joi.array().items(Joi.number()).min(1).optional(),
        keyword: Joi.string().optional(),
        channel: Joi.array().items(Joi.string()).min(1).optional(),
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }
    next();
};

export const validateBulkUpdateIssues = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        ids: Joi.array().items(Joi.number().required()).min(1).required(),
        updateData: Joi.object({
            status: Joi.string().valid("In Progress", "Overdue", "Completed", "Need Help", "New", "Scheduled").optional(),
            category: Joi.string().valid("MAINTENANCE", "CLEANLINESS", "HVAC", "LANDSCAPING", "PEST CONTROL", "POOL AND SPA").optional(),
            issue_description: Joi.string().optional(),
            claim_resolution_status: Joi.string().valid('N/A', 'Not Submitted', 'In Progress', 'Submitted', 'Resolved').optional(),
            claim_resolution_amount: Joi.number().precision(2).optional(),
            estimated_reasonable_price: Joi.number().precision(2).optional(),
            final_price: Joi.number().precision(2).optional(),
            owner_notes: Joi.string().optional(),
            next_steps: Joi.string().optional(),
            listing_id: Joi.number().optional(),
            guest_name: Joi.string().optional(),
            guest_contact_number: Joi.string().optional(),
            channel: Joi.string().optional(),
            check_in_date: Joi.date().optional(),
            reservation_amount: Joi.number().precision(2).optional(),
            reservation_id: Joi.string().optional(),
            date_time_reported: Joi.date().optional(),
            date_time_contractor_contacted: Joi.date().optional(),
            date_time_contractor_deployed: Joi.date().optional(),
            date_time_work_finished: Joi.date().optional(),
            final_contractor_name: Joi.string().optional(),
        }).min(1).required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};
