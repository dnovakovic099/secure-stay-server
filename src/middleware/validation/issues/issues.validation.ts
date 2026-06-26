import { Request, NextFunction, Response } from "express";
import Joi from "joi";

const dueDateSchema = Joi.string()
    .regex(/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/)
    .allow(null, "")
    .optional()
    .messages({
        'string.pattern.base': 'Due Date must be in the format "yyyy-mm-dd" or "yyyy-mm-dd hh:mm:ss"',
    });

const ISSUE_STATUS_VALUES = ["In Progress", "Completed", "Need Help", "New", "Scheduled"];
const issueStatusSchema = Joi.string().valid(...ISSUE_STATUS_VALUES);

export const validateCreateIssue = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string()
            .valid(...ISSUE_STATUS_VALUES)
            .default("In Progress")
            .required(),
        gr_status: issueStatusSchema.default("New").optional(),
        listing_id: Joi.number().required(),
        listing_name: Joi.string().allow(null, ''),
        reservation_id: Joi.string().allow(null, ''),
        linked_reservations: Joi.string().allow(null, ''),
        check_in_date: Joi.date().allow(null).empty(''),
        reservation_amount: Joi.number().precision(2).allow(null).empty(''),
        channel: Joi.string().allow(null, ''),
        guest_name: Joi.string().allow(null, ''),
        guest_contact_number: Joi.string().allow(null, ''),
        issue_description: Joi.string().allow(null, ''),
        owner_notes: Joi.string().allow(null, ''),
        creator: Joi.string().allow(null, ''),
        date_time_reported: Joi.date().allow(null).empty(''),
        date_time_contractor_contacted: Joi.date().allow(null).empty(''),
        date_time_contractor_deployed: Joi.date().allow(null).empty(''),
        quote_1: Joi.string().allow(null, ''),
        quote_2: Joi.string().allow(null, ''),
        quote_3: Joi.string().allow(null, ''),
        quote_4: Joi.string().allow(null, ''),
        quote_5: Joi.string().allow(null, ''),
        quote_6: Joi.string().allow(null, ''),
        estimated_reasonable_price: Joi.number().precision(2).allow(null).empty(''),
        final_price: Joi.number().precision(2).allow(null).empty(''),
        date_time_work_finished: Joi.date().allow(null).empty(''),
        final_contractor_name: Joi.string().allow(null, ''),
        issue_reporter: Joi.string().allow(null, ''),
        is_preventable: Joi.string().allow(null, ''),
        completed_by: Joi.string().allow(null, ''),
        completed_at: Joi.date().allow(null).empty(''),
        gr_completed_by: Joi.string().allow(null, ''),
        gr_completed_at: Joi.date().allow(null).empty(''),
        claim_resolution_status: Joi.string()
            .valid('N/A', 'Not Submitted', 'In Progress', 'Submitted', 'Resolved')
            .default('N/A'),
        claim_resolution_amount: Joi.number().precision(2).allow(null).empty(''),
        next_steps: Joi.string().allow(null, ''),
        payment_information: Joi.string().allow(null, ''),
        category: Joi.string().valid("MAINTENANCE", "CLEANLINESS", "HVAC", "LANDSCAPING", "PEST CONTROL", "POOL AND SPA").required(),
        resolution: Joi.string().optional().allow(null, ''),
        guest_relations_resolution: Joi.string().optional().allow(null, ''),
        ai_short_title: Joi.string().optional().allow(null, ''),
        ai_checklist: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string()).optional().allow(null, ''),
        manager_feedback: Joi.string().optional().allow(null, ''),
        manager_ai_feedback: Joi.string().optional().allow(null, ''),
        preventable_flag: Joi.boolean().optional().allow(null).empty(''),
        ai_resolution_status: Joi.string().optional().allow(null, '').valid("Resolved", "Not Resolved", "—", ""),
        ai_guest_sentiment: Joi.string().optional().allow(null, '').valid("Positive", "Mixed", "Neutral", "Negative", "—", ""),
        assignee: Joi.string().optional().allow(null, ''),
        urgency: Joi.number().optional().allow(null).empty('').min(1).max(5),
        mistake: Joi.string().optional().allow(null, '').valid("Yes", "In Progress", "Need Help", "Resolved", ""),
        nextUpdateDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Next Update Date must be in the format "yyyy-mm-dd"',
        }).optional(),
        due_date: dueDateSchema,
    });

    const { error, value } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    request.body = value;
    next();
};

export const validateUpdateIssue = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string()
            .valid(...ISSUE_STATUS_VALUES),
        gr_status: issueStatusSchema.optional(),
        listing_id: Joi.number().empty(''),
        listing_name: Joi.string().allow(null, ''),
        reservation_id: Joi.string().allow(null, ''),
        linked_reservations: Joi.string().allow(null, ''),
        check_in_date: Joi.date().allow(null).empty(''),
        reservation_amount: Joi.number().precision(2).allow(null).empty(''),
        channel: Joi.string().allow(null, ''),
        guest_name: Joi.string().allow(null, ''),
        guest_contact_number: Joi.string().allow(null, ''),
        issue_description: Joi.string().allow(null, ''),
        owner_notes: Joi.string().allow(null, ''),
        creator: Joi.string().allow(null, ''),
        date_time_reported: Joi.date().allow(null).empty(''),
        date_time_contractor_contacted: Joi.date().allow(null).empty(''),
        date_time_contractor_deployed: Joi.date().allow(null).empty(''),
        quote_1: Joi.string().allow(null, ''),
        quote_2: Joi.string().allow(null, ''),
        quote_3: Joi.string().allow(null, ''),
        quote_4: Joi.string().allow(null, ''),
        quote_5: Joi.string().allow(null, ''),
        quote_6: Joi.string().allow(null, ''),
        estimated_reasonable_price: Joi.number().precision(2).allow(null).empty(''),
        final_price: Joi.number().precision(2).allow(null).empty(''),
        date_time_work_finished: Joi.date().allow(null).empty(''),
        final_contractor_name: Joi.string().allow(null, ''),
        issue_reporter: Joi.string().allow(null, ''),
        is_preventable: Joi.string().allow(null, ''),
        completed_by: Joi.string().allow(null, ''),
        completed_at: Joi.date().allow(null).empty(''),
        gr_completed_by: Joi.string().allow(null, ''),
        gr_completed_at: Joi.date().allow(null).empty(''),
        claim_resolution_status: Joi.string()
            .valid('N/A', 'Not Submitted', 'In Progress', 'Submitted', 'Resolved'),
        claim_resolution_amount: Joi.number().precision(2).allow(null).empty(''),
        next_steps: Joi.string().allow(null, ''),
        payment_information: Joi.string().allow(null, ''),
        deletedFiles: Joi.string().allow(null, ''),
        category: Joi.string().valid("MAINTENANCE", "CLEANLINESS", "HVAC", "LANDSCAPING", "PEST CONTROL", "POOL AND SPA").allow(null,""),
        resolution: Joi.string().optional().allow(null, ''),
        guest_relations_resolution: Joi.string().optional().allow(null, ''),
        ai_short_title: Joi.string().optional().allow(null, ''),
        ai_checklist: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string()).optional().allow(null, ''),
        manager_feedback: Joi.string().optional().allow(null, ''),
        manager_ai_feedback: Joi.string().optional().allow(null, ''),
        preventable_flag: Joi.boolean().optional().allow(null).empty(''),
        ai_resolution_status: Joi.string().optional().allow(null, '').valid("Resolved", "Not Resolved", "—", ""),
        ai_guest_sentiment: Joi.string().optional().allow(null, '').valid("Positive", "Mixed", "Neutral", "Negative", "—", ""),
        fileInfo: Joi.any().optional(),
        assignee: Joi.string().optional().allow(null, ''),
        urgency: Joi.number().optional().allow(null).empty('').min(1).max(5),
        mistake: Joi.string().optional().allow(null, '').valid("Yes", "In Progress", "Need Help", "Resolved", ""),
        nextUpdateDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Next Update Date must be in the format "yyyy-mm-dd"',
        }).optional(),
        due_date: dueDateSchema,
    });

    const { error, value } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    request.body = value;
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
    const issueIdValue = Joi.alternatives().try(
        Joi.number(),
        Joi.string().pattern(/^\d+$/)
    );
    const schema = Joi.object({
        issueId: Joi.alternatives().try(
            Joi.number(),
            Joi.string().pattern(/^\d+(,\d+)*$/),
            Joi.array().items(issueIdValue).min(1)
        ).required(),
        updates: Joi.string().allow('').optional(),
        source: Joi.string().valid('securestay', 'system').optional(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    const hasFiles = Array.isArray((request as any).files?.attachments) && (request as any).files.attachments.length > 0;
    if (!String(request.body?.updates || '').trim() && !hasFiles) {
        return next(new Error('Either updates or attachments are required'));
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
        propertyType: Joi.array().items(Joi.string().required()).min(1).optional(),
        serviceType: Joi.array().items(Joi.string().required()).min(1).optional(),
        fromDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).optional(),
        toDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).optional(),
        status: Joi.array().items(issueStatusSchema).min(1).optional(),
        grStatus: Joi.array().items(issueStatusSchema).min(1).optional(),
        guestName: Joi.string().optional(),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        issueId: Joi.array().items(Joi.number()).min(1).optional(),
        reservationId: Joi.array().items(Joi.number()).min(1).optional(),
        keyword: Joi.string().optional(),
        keywordField: Joi.string().valid('all', 'description', 'guestName', 'guestContact', 'property', 'issueNotes', 'latestUpdate', 'resolutionNotes', 'managerNotes').optional(),
        channel: Joi.array().items(Joi.string()).min(1).optional(),
        dateType: Joi.string().valid('created', 'updated', 'last_updated', 'activity_updated', 'completed', 'gr_completed', 'due', 'check_in', 'check_out').optional(),
        stayStatus: Joi.array().items(Joi.string().valid('currently-staying', 'co-today', 'past', 'upcoming')).min(1).optional(),
        assignee: Joi.array().items(Joi.string()).min(1).optional(),
        vendor: Joi.array().items(Joi.string()).min(1).optional(),
        urgency: Joi.array().items(Joi.number()).min(1).optional(),
        activityType: Joi.string().valid('all', 'created', 'updated', 'last_updated', 'completed', 'gr_completed').optional(),
        activityUser: Joi.alternatives().try(
          Joi.string(),
          Joi.array().items(Joi.string()).min(1)
        ).optional(),
        activityFromDate: Joi.date().iso().optional(),
        activityToDate: Joi.date().iso().optional(),
        updateSource: Joi.string().valid('all', 'ticket', 'timeline').optional(),
        activityKeyword: Joi.string().optional(),
        vendorThreadStatus: Joi.string().valid('with-vendor-thread', 'no-vendor-thread').optional(),
        issueResolution: Joi.string().valid('Resolved', 'Not Resolved', '—').optional(),
        guestSentiment: Joi.string().valid('Positive', 'Mixed', 'Neutral', 'Negative', '—').optional(),
        resolutionNotesStatus: Joi.string().valid('with-resolution', 'no-resolution').optional(),
        resolutionNotesKeyword: Joi.string().optional(),
        managerNotesStatus: Joi.string().valid('with-manager-notes', 'no-manager-notes').optional(),
        managerNotesKeyword: Joi.string().optional(),
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
            status: issueStatusSchema.optional(),
            gr_status: issueStatusSchema.optional(),
            category: Joi.string().valid("MAINTENANCE", "CLEANLINESS", "HVAC", "LANDSCAPING", "PEST CONTROL", "POOL AND SPA").optional(),
            urgency: Joi.number().allow(null).optional(),
            assignee: Joi.string().allow('', null).optional(),
            due_date: Joi.string().allow('', null).optional(),
            ai_resolution_status: Joi.string().valid('Resolved', 'Not Resolved', '—').optional(),
            ai_guest_sentiment: Joi.string().valid('Positive', 'Mixed', 'Neutral', 'Negative', '—').optional(),
            issue_description: Joi.string().optional(),
            resolution: Joi.string().optional(),
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

export const validateUpdateAssignee = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        assignee: Joi.string().allow('', null).optional(),
    });
    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateUrgency = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        urgency: Joi.number().required(),
    });
    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateMistake = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        mistake: Joi.string().required().valid('Yes', 'In Progress', 'Need Help', 'Resolved'),
    });
    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateStatus = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        status: issueStatusSchema.required(),
        statusField: Joi.string().valid('ir', 'gr').optional(),
    });
    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateIssueQuickAction = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
        action: Joi.string().required(),
    });
    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};
