import { Request, NextFunction, Response } from "express";
import Joi from "joi";

export const validateCreateResolution = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        category: Joi.string()
            .required()
            .valid("full_claim", "partial_claim", "security_deposit")
            .messages({
                'any.required': 'Category is required',
                'any.only': 'Category must be one of: full_claim, partial_claim, security_deposit'
            }),

        listingMapId: Joi.number()
            .required()
            .messages({
                'number.base': 'Listing Map ID must be a number',
                'any.required': 'Listing Map ID is required'
            }),

        guestName: Joi.string()
            .required()
            .messages({
                'string.empty': 'Guest name is required',
                'any.required': 'Guest name is required'
            }),

        claimDate: Joi.string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .required()
            .messages({
                'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                'any.required': 'Claim date is required'
            }),

        amount: Joi.number()
            .min(0)
            .required()
            .messages({
                'number.base': 'Amount must be a number',
                'number.min': 'Amount must be a positive number',
                'any.required': 'Amount is required'
            })
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
}; 