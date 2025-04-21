import { Request, NextFunction, Response } from "express";
import Joi from "joi";

export const validateCreateIssue = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string()
            .valid("In Progress", "Overdue", "Completed", "Need Help")
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
        payment_information: Joi.string().allow(null, '')
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
            .valid("In Progress", "Overdue", "Completed", "Need Help"),
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
        deletedFiles: Joi.string().allow(null, '')
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};