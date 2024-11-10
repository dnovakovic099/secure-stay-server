import { Request, NextFunction, Response } from "express";
import Joi from "joi";

export const validateCreateExpense = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        listingMapId: Joi.number().required().allow(''),
        expenseDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required(),
        concept: Joi.string().required(),
        amount: Joi.number().required(),
        categories: Joi.array().items(Joi.number().required()).min(1).required(),
        dateOfWork: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).required(),
        contractorName: Joi.string().required(),
        contractorNumber: Joi.string().required(),
        findings: Joi.string().required(),
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
        limit: Joi.number().required()
    });

    const { error } = schema.validate(request.query);
    if (error) {
        next(error);
    }
    next();
};