import { Request, NextFunction, Response } from "express";
import Joi from "joi";
import { ExpenseStatus } from "../../../entity/Expense";

export const validateCreateExpense = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        listingMapId: Joi.number().required().allow(''),
        expenseDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required(),
        concept: Joi.string().required(),
        amount: Joi.number().required(),
        categories: Joi.alternatives().try(
            Joi.array().items(Joi.number().required()).min(1),
            Joi.string().custom((value, helpers) => {
                try {
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'number')) {
                        return parsed;
                    } else {
                        throw new Error();
                    }
                } catch (err) {
                    return helpers.error("any.invalid");
                }
            })
        ).required(),
        dateOfWork: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required().allow(null, ""),
        contractorName: Joi.string().required(),
        contractorNumber: Joi.string().required().allow(null),
        findings: Joi.string().required().allow(null, ""),
        status: Joi.string().required()
            .valid(ExpenseStatus.PENDING, ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE),
        paymentMethod: Joi.string().required().allow(null, "")
            .valid("Venmo", "Credit Card", "ACH", "Zelle", "PayPal"),
        datePaid: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required().allow(null, ""),
        issues: Joi.alternatives().try(
            Joi.array().items(Joi.number().required()).min(1),
            Joi.string().custom((value, helpers) => {
                try {
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'number')) {
                        return parsed;
                    } else {
                        throw new Error();
                    }
                } catch (err) {
                    return helpers.error("any.invalid");
                }
            })
        ).optional().allow(null, ""),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};


export const validateUpdateExpense = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        expenseId: Joi.number().required(),
        listingMapId: Joi.number().required().allow(''),
        expenseDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required(),
        concept: Joi.string().required(),
        amount: Joi.number().required(),
        categories: Joi.alternatives().try(
            Joi.array().items(Joi.number().required()).min(1),
            Joi.string().custom((value, helpers) => {
                try {
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'number')) {
                        return parsed;
                    } else {
                        throw new Error();
                    }
                } catch (err) {
                    return helpers.error("any.invalid");
                }
            })
        ).required(),
        dateOfWork: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required().allow(null, ""),
        contractorName: Joi.string().required().allow(null, ""),
        contractorNumber: Joi.string().required().allow(null, ""),
        findings: Joi.string().required().allow(null, ""),
        status: Joi.string().required()
            .valid(ExpenseStatus.PENDING, ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE),
        paymentMethod: Joi.string().required().allow(null, "")
            .valid("Venmo", "Credit Card", "ACH", "Zelle", "PayPal"),
        datePaid: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required().allow(null, ""),
        oldFiles: Joi.string().required().allow(null, ""),
        issues: Joi.alternatives().try(
            Joi.array().items(Joi.number().required()).min(1),
            Joi.string().custom((value, helpers) => {
                try {
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'number')) {
                        return parsed;
                    } else {
                        throw new Error();
                    }
                } catch (err) {
                    return helpers.error("any.invalid");
                }
            })
        ).optional().allow(null, ""),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateUpdateExpenseStatus = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        expenseId: Joi.array().items(Joi.number().required()).min(1).required(),
        status: Joi.string().required()
            .valid(ExpenseStatus.PENDING, ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE),
        datePaid: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required().allow(null, "")
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateGetExpenseList = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        listingId: Joi.array().items(Joi.number().required()).min(1).required().allow("", null),

        fromDate: Joi.string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .messages({
                'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
            })
            .allow("", null),

        toDate: Joi.string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .messages({
                'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
            })
            .allow("", null),

        page: Joi.number().required(),
        limit: Joi.number().required(),

        status: Joi.array()
            .items(
                Joi.string().valid(ExpenseStatus.PENDING, ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE)
            )
            .min(1)
            .required()
            .allow('', null),

        categories: Joi.string().required().allow(''),
        contractorName: Joi.array().items(Joi.string().required()).min(1).required().allow("", null),

        dateType: Joi.string().required().valid('expenseDate', 'dateOfWork', 'datePaid'),
        expenseState: Joi.string().required().valid("active", "deleted").allow(null, ""),

        paymentMethod: Joi.array()
            .items(
                Joi.string().valid("Venmo", "Credit Card", "ACH", "Zelle", "PayPal")
            )
            .min(1)
            .required()
            .allow('', null),

        tags: Joi.array().items(Joi.number().required()).min(1).required().allow("", null),
        propertyType: Joi.array().items(Joi.number().required()).min(1).optional(),
        keyword: Joi.string().optional(),
        expenseId: Joi.array().items(Joi.number()).optional()
    })
        // enforce fromDate <-> toDate dependency
        .with("fromDate", "toDate")
        .with("toDate", "fromDate");

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }
    next();
};

export const validateBulkUpdateExpense = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        expenseId: Joi.array().items(Joi.number().required()).min(1).required(),
        expenseDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required().allow(null),
        dateOfWork: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required().allow(null),
        status: Joi.string().required()
            .valid(ExpenseStatus.PENDING, ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE).allow(null),
        paymentMethod: Joi.string().required().allow(null)
            .valid("Venmo", "Credit Card", "ACH", "Zelle", "PayPal"),
        categories: Joi.alternatives().try(
            Joi.array().items(Joi.number().required()).min(1),
            Joi.string().custom((value, helpers) => {
                try {
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'number')) {
                        return parsed;
                    } else {
                        throw new Error();
                    }
                } catch (err) {
                    return helpers.error("any.invalid");
                }
            })
        ).required().allow(null),
        concept: Joi.string().required().allow(null),
        listingMapId: Joi.number().required().allow(null),
        amount: Joi.number().required().allow(null),
        contractorName: Joi.string().required().allow(null),
        contractorNumber: Joi.string().required().allow(null),
        findings: Joi.string().required().allow(null),
        datePaid: Joi.string().required().allow(null),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};