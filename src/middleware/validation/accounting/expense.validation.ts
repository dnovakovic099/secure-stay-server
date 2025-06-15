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
        }).required().allow(null, "")
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
        oldFiles: Joi.string().required().allow(null, ""),
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
        // listingId: Joi.number().required().allow(''),
        listingId: Joi.array().items(Joi.number().required()).min(1).required().allow("", null),
        listingGroup: Joi.string().required().valid("Property Management", "Arbitrage", "Luxury Lodging Owned").allow(null, ""),
        fromDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required(),
        toDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required(),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        status: Joi.string().required()
            .valid(ExpenseStatus.PENDING, ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE)
            .allow(''),
        categories: Joi.string().required().allow(''),
        contractorName: Joi.array().items(Joi.string().required()).min(1).required().allow("", null),
        dateType: Joi.string().required().allow('expenseDate', 'dateAdded', 'datePaid'),
        expenseState: Joi.string().required().valid("active", "deleted"),
        paymentMethod: Joi.string().required().valid("Venmo", "Credit Card", "ACH", "Zelle", "PayPal").allow(''),
        // tags: Joi.array().items(Joi.number().required()).min(1).required().allow("", null)
    });

    const { error } = schema.validate(request.query);
    if (error) {
        next(error);
    }
    next();
};