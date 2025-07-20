import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreateContact = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string().valid('active', 'active-backup', 'inactive').required(),
        listingId: Joi.string().required(),
        role: Joi.string().required()
            .valid("Cleaner", "Handyman", "Landscaper", "Pool Cleaner", "Pool Repair", "Electrician", "Plumber", "HVAC Technician", "Pest Control", "Snow Remover"),
        name: Joi.string().required(),
        contact: Joi.string().required().allow(null),
        notes: Joi.string().required().allow(null),
        website_name: Joi.string().required().allow(null),
        website_link: Joi.string().required().allow(null),
        rate: Joi.string().required().allow(null),
        paymentScheduleType: Joi.string().required().allow(null),
        paymentIntervalMonth: Joi.number().integer().min(1).max(12).required().allow(null),
        paymentDayOfWeek: Joi.number().integer().min(1).max(7).required().allow(null),
        paymentWeekOfMonth: Joi.number().integer().min(1).max(5).required().allow(null),
        paymentDayOfWeekForMonth: Joi.number().integer().min(1).max(7).required().allow(null),
        paymentDayOfMonth: Joi.number().integer().min(1).max(32).required().allow(null),
        paymentMethod: Joi.array().items(Joi.string().valid("Venmo", "Credit Card", "ACH", "Zelle", "PayPal"),).required().allow(null),
        isAutoPay: Joi.string().required().valid("true", "false")
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateContact = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().integer().required(),
        status: Joi.string().valid('active', 'active-backup', 'inactive').required(),
        listingId: Joi.string().required(),
        role: Joi.string().required()
            .valid("Cleaner", "Handyman", "Landscaper", "Pool Cleaner", "Pool Repair", "Electrician", "Plumber", "HVAC Technician", "Pest Control", "Snow Remover"),
        name: Joi.string().required(),
        contact: Joi.string().required().allow(null),
        notes: Joi.string().required().allow(null),
        website_name: Joi.string().required().allow(null),
        website_link: Joi.string().required().allow(null),
        rate: Joi.string().required().allow(null),
        paymentScheduleType: Joi.string().required().allow(null),
        paymentIntervalMonth: Joi.number().integer().min(1).max(12).required().allow(null),
        paymentDayOfWeek: Joi.number().integer().min(1).max(7).required().allow(null),
        paymentWeekOfMonth: Joi.number().integer().min(1).max(5).required().allow(null),
        paymentDayOfWeekForMonth: Joi.number().integer().min(1).max(7).required().allow(null),
        paymentDayOfMonth: Joi.number().integer().min(1).max(32).required().allow(null),
        paymentMethod: Joi.array().items(Joi.string().valid("Venmo", "Credit Card", "ACH", "Zelle", "PayPal"),).required(),
        isAutoPay: Joi.string().valid("true", "false").required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateDeleteContact = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().integer().required()
    });

    const { error } = schema.validate(request.params);
    if (error) {
        return next(error);
    }
    next();
};

export const validateGetContacts = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).default(10),
        status: Joi.array().items(Joi.string().valid('active', 'active-backup', 'inactive')).optional(),
        listingId: Joi.array().items(Joi.string()).optional(),
        role: Joi.array().items(
            Joi.string().valid(
                "Cleaner", "Handyman", "Landscaper", "Pool Cleaner", "Pool Repair", "Electrician", "Plumber",
                "HVAC Technician", "Pest Control", "Snow Remover"
            )
        ).optional(),
        name: Joi.string().optional(),
        contact: Joi.string().optional(),
        website_name: Joi.string().optional(),
        rate: Joi.string().optional(),
        paymentMethod: Joi.array().items(Joi.string().valid("Venmo", "Credit Card", "ACH", "Zelle", "PayPal"),).optional(),
        isAutoPay: Joi.string().valid("true", "false").optional()
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }
    next();
};