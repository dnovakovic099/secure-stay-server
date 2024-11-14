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
        }).required(),
        contractorName: Joi.string().required(),
        contractorNumber: Joi.string().required(),
        findings: Joi.string().required(),
        status: Joi.string().required()
            .valid(ExpenseStatus.PENDING, ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE)
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};


export const validateUpdateExpense = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
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
        }).required(),
        contractorName: Joi.string().required(),
        contractorNumber: Joi.string().required(),
        findings: Joi.string().required(),
        status: Joi.string().required()
            .valid(ExpenseStatus.PENDING, ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE)
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateGetExpenseList = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        listingId: Joi.number().required().allow(''),
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
            .allow('')
    });

    const { error } = schema.validate(request.query);
    if (error) {
        next(error);
    }
    next();
};