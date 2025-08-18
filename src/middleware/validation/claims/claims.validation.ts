import { Request, NextFunction, Response } from "express";
import Joi from "joi";

export const validateCreateClaim = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string()
            .valid("Not Submitted", "In Progress", "Submitted", "Resolved", "Denied")
            .default("Not Submitted")
            .required(),
        listing_id: Joi.string().required(),
        listing_name: Joi.string().allow(null, ''),
        description: Joi.string().allow(null, ''),
        reservation_id: Joi.string().allow(null, ''),
        reservation_amount: Joi.number().precision(2).allow(null),
        channel: Joi.string().allow(null, ''),
        guest_name: Joi.string().allow(null, ''),
        guest_contact_number: Joi.string().allow(null, ''),
        quote_1: Joi.string().allow(null, ''),
        quote_2: Joi.string().allow(null, ''),
        quote_3: Joi.string().allow(null, ''),
        estimated_reasonable_price: Joi.number().precision(2).allow(null),
        final_price: Joi.number().precision(2).allow(null),
        client_paid_amount: Joi.number().precision(2).allow(null),
        claim_resolution_amount: Joi.number().precision(2).allow(null),
        payment_information: Joi.string().allow(null, ''),
        reporter: Joi.string().allow(null, ''),
        created_by: Joi.string().allow(null, ''),
        updated_by: Joi.string().allow(null, ''),
        fileNames: Joi.string().allow(null, ''),
        reservation_link: Joi.string().allow(null, ''),
        client_requested_amount: Joi.number().precision(2).allow(null),
        airbnb_filing_amount: Joi.number().precision(2).allow(null),
        airbnb_resolution: Joi.string().allow(null, ''),
        airbnb_resolution_won_amount: Joi.number().precision(2).allow(null),
        payee: Joi.string().allow(null, ''),
        payment_status: Joi.string()
            .valid("Not Paid", "Paid", "Partially Paid")
            .default("Not Paid")
            .required(),
        due_date: Joi.string().allow(null, ''),
        claim_type: Joi.string()
            .valid("Damages", "House Rule Violation", "Extra Cleaning", "Missing Items", "Others")
            .allow(null, ''),
        reservation_code: Joi.string().allow(null, ''),
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
            .valid("Not Submitted", "In Progress", "Submitted", "Resolved", "Denied"),
        listing_id: Joi.string(),
        listing_name: Joi.string().allow(null, ''),
        description: Joi.string().allow(null, ''),
        reservation_id: Joi.string().allow(null, ''),
        reservation_amount: Joi.number().precision(2).allow(null),
        channel: Joi.string().allow(null, ''),
        guest_name: Joi.string().allow(null, ''),
        guest_contact_number: Joi.string().allow(null, ''),
        quote_1: Joi.string().allow(null, ''),
        quote_2: Joi.string().allow(null, ''),
        quote_3: Joi.string().allow(null, ''),
        estimated_reasonable_price: Joi.number().precision(2).allow(null),
        final_price: Joi.number().precision(2).allow(null),
        client_paid_amount: Joi.number().precision(2).allow(null),
        claim_resolution_amount: Joi.number().precision(2).allow(null),
        payment_information: Joi.string().allow(null, ''),
        reporter: Joi.string().allow(null, ''),
        created_by: Joi.string().allow(null, ''),
        updated_by: Joi.string().allow(null, ''),
        fileNames: Joi.string().allow(null, ''),
        reservation_link: Joi.string().allow(null, ''),
        client_requested_amount: Joi.number().precision(2).allow(null),
        airbnb_filing_amount: Joi.number().precision(2).allow(null),
        airbnb_resolution: Joi.string().allow(null, ''),
        airbnb_resolution_won_amount: Joi.number().precision(2).allow(null),
        payee: Joi.string().allow(null, ''),
        payment_status: Joi.string()
            .valid("Not Paid", "Paid", "Partially Paid")
            .default("Not Paid"),
        due_date: Joi.string().allow(null, ''),
        claim_type: Joi.string()
            .valid("Damages", "House Rule Violation", "Extra Cleaning", "Missing Items", "Others")
            .allow(null, ''),
        reservation_code: Joi.string().allow(null, ''),
        deletedFiles: Joi.string().allow(null, ''),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateBulkUpdateClaims = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        ids: Joi.array().items(Joi.number().required()).min(1).required(),
        updateData: Joi.object({
            status: Joi.string()
                .valid("Not Submitted", "In Progress", "Submitted", "Resolved", "Denied")
                .optional(),
            listing_id: Joi.string().optional(),
            listing_name: Joi.string().allow(null, '').optional(),
            description: Joi.string().allow(null, '').optional(),
            reservation_id: Joi.string().allow(null, '').optional(),
            reservation_amount: Joi.number().precision(2).allow(null).optional(),
            channel: Joi.string().allow(null, '').optional(),
            guest_name: Joi.string().allow(null, '').optional(),
            guest_contact_number: Joi.string().allow(null, '').optional(),
            quote_1: Joi.string().allow(null, '').optional(),
            quote_2: Joi.string().allow(null, '').optional(),
            quote_3: Joi.string().allow(null, '').optional(),
            estimated_reasonable_price: Joi.number().precision(2).allow(null).optional(),
            final_price: Joi.number().precision(2).allow(null).optional(),
            client_paid_amount: Joi.number().precision(2).allow(null).optional(),
            claim_resolution_amount: Joi.number().precision(2).allow(null).optional(),
            payment_information: Joi.string().allow(null, '').optional(),
            reporter: Joi.string().allow(null, '').optional(),
            reservation_link: Joi.string().allow(null, '').optional(),
            client_requested_amount: Joi.number().precision(2).allow(null).optional(),
            airbnb_filing_amount: Joi.number().precision(2).allow(null).optional(),
            airbnb_resolution: Joi.string().allow(null, '').optional(),
            airbnb_resolution_won_amount: Joi.number().precision(2).allow(null).optional(),
            payee: Joi.string().allow(null, '').optional(),
            payment_status: Joi.string()
                .valid("Not Paid", "Paid", "Partially Paid")
                .optional(),
            due_date: Joi.string().allow(null, '').optional(),
            claim_type: Joi.string()
                .valid("Damages", "House Rule Violation", "Extra Cleaning", "Missing Items", "Others")
                .allow(null, '')
                .optional(),
            reservation_code: Joi.string().allow(null, '').optional(),
        }).min(1).required() // At least one field must be provided for update
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};