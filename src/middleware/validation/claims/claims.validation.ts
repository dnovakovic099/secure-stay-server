import { Request, NextFunction, Response } from "express";
import Joi from "joi";

export const validateCreateClaim = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string()
            .valid("Not Submitted", "In Progress", "Submitted", "Resolved")
            .default("Not Submitted")
            .required(),
        listing_id: Joi.string().required(),
        listing_name: Joi.string().allow(null, ''),
        description: Joi.string().allow(null, ''),
        reservation_id: Joi.string().allow(null, ''),
        check_out_date: Joi.date().allow(null),
        reservation_amount: Joi.number().precision(2).allow(null),
        channel: Joi.string().allow(null, ''),
        guest_name: Joi.string().allow(null, ''),
        guest_contact_number: Joi.string().allow(null, ''),
        date_time_contractor_contacted: Joi.date().allow(null),
        date_time_work_finished: Joi.date().allow(null),
        quote_1: Joi.string().allow(null, ''),
        quote_2: Joi.string().allow(null, ''),
        quote_3: Joi.string().allow(null, ''),
        estimated_reasonable_price: Joi.number().precision(2).allow(null),
        final_price: Joi.number().precision(2).allow(null),
        claim_resolution_amount: Joi.number().precision(2).allow(null),
        payment_information: Joi.string().allow(null, ''),
        reporter: Joi.string().allow(null, ''),
        created_by: Joi.string().allow(null, ''),
        updated_by: Joi.string().allow(null, ''),
        fileNames: Joi.string().allow(null, '')
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateUpdateClaim = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string()
            .valid("Not Submitted", "In Progress", "Submitted", "Resolved"),
        listing_id: Joi.string(),
        listing_name: Joi.string().allow(null, ''),
        description: Joi.string().allow(null, ''),
        reservation_id: Joi.string().allow(null, ''),
        check_out_date: Joi.date().allow(null),
        reservation_amount: Joi.number().precision(2).allow(null),
        channel: Joi.string().allow(null, ''),
        guest_name: Joi.string().allow(null, ''),
        guest_contact_number: Joi.string().allow(null, ''),
        date_time_contractor_contacted: Joi.date().allow(null),
        date_time_work_finished: Joi.date().allow(null),
        quote_1: Joi.string().allow(null, ''),
        quote_2: Joi.string().allow(null, ''),
        quote_3: Joi.string().allow(null, ''),
        estimated_reasonable_price: Joi.number().precision(2).allow(null),
        final_price: Joi.number().precision(2).allow(null),
        claim_resolution_amount: Joi.number().precision(2).allow(null),
        payment_information: Joi.string().allow(null, ''),
        reporter: Joi.string().allow(null, ''),
        created_by: Joi.string().allow(null, ''),
        updated_by: Joi.string().allow(null, ''),
        fileNames: Joi.string().allow(null, '')
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};