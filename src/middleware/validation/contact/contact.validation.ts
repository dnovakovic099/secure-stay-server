import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreateContact = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string().valid('active', 'active-backup', 'inactive').required(),
        listingId: Joi.string().required(),
        role: Joi.string().required(),
        name: Joi.string().required(),
        contact: Joi.string().required().allow(null),
        notes: Joi.string().required().allow(null),
        website_name: Joi.string().required().allow(null),
        website_link: Joi.string().required().allow(null),
        rate: Joi.string().required().allow(null),
        paymentScheduleType: Joi.string().required().valid(
            "weekly", "bi-weekly", "monthly", "quarterly", "annually", "check-out basis","as required"
        ).allow(null),
        paymentIntervalMonth: Joi.number().integer().min(1).max(12).required().allow(null),
        paymentDayOfWeek: Joi.array().items(Joi.number().integer().min(0).max(6).required()).allow(null),
        paymentWeekOfMonth: Joi.number().integer().min(1).max(5).required().allow(null),
        // paymentDayOfWeekForMonth: Joi.number().integer().min(1).max(7).required().allow(null),
        paymentDayOfMonth: Joi.number().integer().min(1).max(32).required().allow(null),
        paymentMethod: Joi.string().valid("Venmo", "Credit Card", "ACH", "Zelle", "PayPal").required().allow(null),
        isAutoPay: Joi.boolean().required(),
        email: Joi.string().email().required().allow(null),
        source: Joi.string().required().allow(null).valid("Owner", "Turno", "LL"),
        costRating: Joi.number().integer().min(1).max(5).required().allow(null),
        trustLevel: Joi.number().integer().min(1).max(5).required().allow(null),
        speed: Joi.number().integer().min(1).max(5).required().allow(null),
        paidBy: Joi.string().required().valid("LL", "LL (Charge to Client)", "Client").allow(null)
    }).custom((value, helpers) => {
        switch (value.paymentScheduleType) {
            case "weekly":
            case "bi-weekly": {
                if ((value.paymentDayOfWeek && value.paymentDayOfWeek.length == 0)) {
                    return helpers.message({ custom: '"paymentWeekOfBiWeekly" must be provided when "paymentDayOfWeek" is present' });
                }
                break;
            }
            case "monthly": {
                if ((value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentWeekOfMonth" must be provided when "paymentDayOfWeek" is present' });
                }
                if ((value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && value.paymentDayOfMonth) {
                    return helpers.message({ custom: '"paymentDayOfMonth" should not be provided when "paymentDayOfWeek" is present' });
                }
                break;
            }
            case "quarterly": {
                if (!value.paymentIntervalMonth) {
                    return helpers.message({ custom: '"paymentIntervalMonth" is required for quarterly payments' });
                }
                if (value.paymentIntervalMonth > 3) {
                    return helpers.message({ custom: '"paymentIntervalMonth" must be 3 or less for quarterly payments' });
                }
                if (value.paymentIntervalMonth && (value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentWeekOfMonth" must be provided when "paymentDayOfWeek" is present for quarterly payments' });
                }
                if (value.paymentIntervalMonth && !(value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentDayOfMonth && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentDayOfMonth" or "paymentWeekOfMonth" must be provided for quarterly payments' });
                }
                break;
            }
            case "annually": {
                if (!value.paymentIntervalMonth) {
                    return helpers.message({ custom: '"paymentIntervalMonth" is required for annually payments' });
                }
                if (value.paymentIntervalMonth > 12) {
                    return helpers.message({ custom: '"paymentIntervalMonth" must be 12 or less for annually payments' });
                }
                if (value.paymentIntervalMonth && (value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentWeekOfMonth" must be provided when "paymentDayOfWeek" is present for annually payments' });
                }
                if (value.paymentIntervalMonth && !(value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentDayOfMonth && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentDayOfMonth" or "paymentWeekOfMonth" must be provided for annually payments' });
                }
                break;
            }
            default:
                break;
        }
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
        role: Joi.string().required(),
        name: Joi.string().required(),
        contact: Joi.string().required().allow(null),
        notes: Joi.string().required().allow(null),
        website_name: Joi.string().required().allow(null),
        website_link: Joi.string().required().allow(null),
        rate: Joi.string().required().allow(null),
        paymentScheduleType: Joi.string().required().valid(
            "weekly", "bi-weekly", "monthly", "quarterly", "annually", "check-out basis", "as required"
        ).allow(null),
        paymentIntervalMonth: Joi.number().integer().min(1).max(12).required().allow(null),
        paymentDayOfWeek: Joi.array().items(Joi.number().integer().min(0).max(6).required()).allow(null),
        paymentWeekOfMonth: Joi.number().integer().min(1).max(5).required().allow(null),
        // paymentDayOfWeekForMonth: Joi.number().integer().min(1).max(7).required().allow(null),
        paymentDayOfMonth: Joi.number().integer().min(1).max(32).required().allow(null),
        paymentMethod: Joi.string().valid("Venmo", "Credit Card", "ACH", "Zelle", "PayPal").required().allow(null),
        isAutoPay: Joi.boolean().required(),
        email: Joi.string().email().required().allow(null),
        source: Joi.string().required().allow(null).valid("Owner", "Turno", "LL"),
        costRating: Joi.number().integer().min(1).max(5).required().allow(null),
        trustLevel: Joi.number().integer().min(1).max(5).required().allow(null),
        speed: Joi.number().integer().min(1).max(5).required().allow(null),
        paidBy: Joi.string().required().valid("LL", "LL (Charge to Client)", "Client").allow(null)
    }).custom((value, helpers) => {
        switch (value.paymentScheduleType) {
            case "weekly":
            case "bi-weekly": {
                if ((value.paymentDayOfWeek && value.paymentDayOfWeek.length == 0)) {
                    return helpers.message({ custom: '"paymentWeekOfBiWeekly" must be provided when "paymentDayOfWeek" is present' });
                }
                break;
            }
            case "monthly": {
                if ((value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentWeekOfMonth" must be provided when "paymentDayOfWeek" is present' });
                }
                if ((value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && value.paymentDayOfMonth) {
                    return helpers.message({ custom: '"paymentDayOfMonth" should not be provided when "paymentDayOfWeek" is present' });
                }
                break;
            }
            case "quarterly": {
                if (!value.paymentIntervalMonth) {
                    return helpers.message({ custom: '"paymentIntervalMonth" is required for quarterly payments' });
                }
                if (value.paymentIntervalMonth > 3) {
                    return helpers.message({ custom: '"paymentIntervalMonth" must be 3 or less for quarterly payments' });
                }
                if (value.paymentIntervalMonth && (value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentWeekOfMonth" must be provided when "paymentDayOfWeek" is present for quarterly payments' });
                }
                if (value.paymentIntervalMonth && !(value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentDayOfMonth && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentDayOfMonth" or "paymentWeekOfMonth" must be provided for quarterly payments' });
                }
                break;
            }
            case "annually": {
                if (!value.paymentIntervalMonth) {
                    return helpers.message({ custom: '"paymentIntervalMonth" is required for annually payments' });
                }
                if (value.paymentIntervalMonth > 13) {
                    return helpers.message({ custom: '"paymentIntervalMonth" must be 12 or less for annually payments' });
                }
                if (value.paymentIntervalMonth && (value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentWeekOfMonth" must be provided when "paymentDayOfWeek" is present for annually payments' });
                }
                if (value.paymentIntervalMonth && !(value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentDayOfMonth && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentDayOfMonth" or "paymentWeekOfMonth" must be provided for annually payments' });
                }
                break;
            }
            default:
                break;
        }
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
        role: Joi.array().items(Joi.string()).optional(),
        name: Joi.string().optional(),
        contact: Joi.string().optional(),
        website_name: Joi.string().optional(),
        rate: Joi.string().optional(),
        paymentMethod: Joi.array().items(Joi.string().valid("Venmo", "Credit Card", "ACH", "Zelle", "PayPal"),).optional(),
        isAutoPay: Joi.boolean().optional(),
        propertyType: Joi.array().items(Joi.string().required()).min(1).optional(),
        email: Joi.string().email().optional().allow(null),
        source: Joi.array().items(Joi.string().valid("Owner", "Turno", "LL")).optional().allow(null),
        keyword: Joi.string().optional(),
        state: Joi.array().items(Joi.string()).optional(),
        city: Joi.array().items(Joi.string()).optional(),
        paidBy: Joi.array().items(Joi.string().valid("LL", "LL (Charge to Client)", "Client")).optional()
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }
    next();
};

export const validateCreateContactRole = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        workCategory: Joi.string().required(),
        role: Joi.string().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateContactRole = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().integer().required(),
        workCategory: Joi.string().required(),
        role: Joi.string().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};


export const validateCreateLatestUpdate = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        contactId: Joi.number().required(),
        updates: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateLatestUpdate = (request: Request, response: Response, next: NextFunction) => {
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

export const validateBulkUpdateContacts = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        ids: Joi.array().items(Joi.number().integer().required()).min(1).required(),
        updateData: Joi.object({
            status: Joi.string().valid('active', 'active-backup', 'inactive').optional(),
            listingId: Joi.string().optional(),
            role: Joi.string().optional(),
            name: Joi.string().optional(),
            contact: Joi.string().optional().allow(null),
            notes: Joi.string().optional().allow(null),
            website_name: Joi.string().optional().allow(null),
            website_link: Joi.string().optional().allow(null),
            rate: Joi.string().optional().allow(null),
            paymentScheduleType: Joi.string().valid(
                "weekly", "bi-weekly", "monthly", "quarterly", "annually", "check-out basis", "as required"
            ).optional().allow(null),
            paymentIntervalMonth: Joi.number().integer().min(1).max(12).optional().allow(null),
            paymentDayOfWeek: Joi.array().items(Joi.number().integer().min(0).max(6).required()).optional().allow(null),
            paymentWeekOfMonth: Joi.number().integer().min(1).max(5).optional().allow(null),
            paymentDayOfMonth: Joi.number().integer().min(1).max(32).optional().allow(null),
            paymentMethod: Joi.string().valid("Venmo", "Credit Card", "ACH", "Zelle", "PayPal").optional().allow(null),
            isAutoPay: Joi.boolean().optional(),
            email: Joi.string().email().optional().allow(null),
            source: Joi.string().valid("Owner", "Turno", "LL").optional().allow(null),
            costRating: Joi.number().integer().min(1).max(5).optional().allow(null),
            trustLevel: Joi.number().integer().min(1).max(5).optional().allow(null),
            speed: Joi.number().integer().min(1).max(5).optional().allow(null),
            paidBy: Joi.string().optional().valid("LL", "LL (Charge to Client)", "Client")
        }).min(1).required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

