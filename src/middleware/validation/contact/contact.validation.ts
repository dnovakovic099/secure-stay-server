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
        isAutoPay: Joi.string().required().valid("true", "false"),
        email: Joi.string().email().required().allow(null),
        source: Joi.string().required().allow(null).valid("Owner", "Turno", "LL"),
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
        isAutoPay: Joi.string().valid("true", "false").required(),
        email: Joi.string().email().required().allow(null),
        source: Joi.string().required().allow(null).valid("Owner", "Turno", "LL"),
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
        isAutoPay: Joi.string().valid("true", "false").optional(),
        propertyType: Joi.array().items(Joi.number().required()).min(1).optional(),
        email: Joi.string().email().optional().allow(null),
        source: Joi.string().optional().allow(null).valid("Owner", "Turno", "LL"),
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

