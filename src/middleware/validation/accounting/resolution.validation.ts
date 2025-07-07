import { Request, NextFunction, Response } from "express";
import Joi from "joi";

export const validateCreateResolution = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        category: Joi.string()
            .required()
            .valid("claim", "security_deposit", "pet_fee", "extra_cleaning", "others", "resolution", "review_removal")
            .messages({
                'any.required': 'Category is required',
                'any.only': 'Category must be one of: claim, security_deposit, pet_fee, extra_cleaning, others, resolution, review_removal'
            }),

        description: Joi.string().allow(null, '').required(),

        listingMapId: Joi.number()
            .required()
            .messages({
                'number.base': 'Listing Map ID must be a number',
                'any.required': 'Listing Map ID is required'
            }),
            
        reservationId: Joi.number()
        .required()
        .messages({
            'number.base': 'reservationId must be a number',
            'any.required': 'reservationId is required'
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
            .required()
            .messages({
                'number.base': 'Amount must be a number',
                'any.required': 'Amount is required'
            }),

        arrivalDate: Joi.string().required().messages({
            'string.empty': 'Arrival date is required',
            'any.required': 'Arrival date is required'
        }),
        
        departureDate: Joi.string().required().messages({
            'string.empty': 'Departure date is required',
            'any.required': 'Departure date is required'
        }),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
}; 


export const validateGetResolutions = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        listingId: Joi.array().items(Joi.number().required()).min(1).optional(),
        fromDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).optional(),
        toDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).optional(),
        reservationId: Joi.number().optional(),
        page: Joi.number().required(),
        limit: Joi.number().required(),
        category: Joi.array().items(Joi.string().required()).min(1).optional(),
        dateType: Joi.string().required().valid('claimDate', 'arrivalDate', 'departureDate', 'createdAt').optional(),

    });
    const { error } = schema.validate(request.query);
    if (error) {
        next(error);
    }
    next();
};


export const validateUpdateResolution = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        category: Joi.string()
            .required()
            .valid("claim", "security_deposit", "pet_fee", "extra_cleaning", "others", "resolution", "review_removal")
            .messages({
                'any.required': 'Category is required',
                'any.only': 'Category must be one of: claim, security_deposit, pet_fee, extra_cleaning, others, resolution, review_removal'
            }),

        description: Joi.string().allow(null, '').required(),

        listingMapId: Joi.number()
            .required()
            .messages({
                'number.base': 'Listing Map ID must be a number',
                'any.required': 'Listing Map ID is required'
            }),

        reservationId: Joi.number()
            .required()
            .messages({
                'number.base': 'reservationId must be a number',
                'any.required': 'reservationId is required'
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
            .required()
            .messages({
                'number.base': 'Amount must be a number',
                'any.required': 'Amount is required'
            }),

        arrivalDate: Joi.string().required().messages({
            'string.empty': 'Arrival date is required',
            'any.required': 'Arrival date is required'
        }),

        departureDate: Joi.string().required().messages({
            'string.empty': 'Departure date is required',
            'any.required': 'Departure date is required'
        }),

        amountToPayout: Joi.number()
            .required()
            .messages({
                'number.base': 'Amount must be a number',
                'any.required': 'Amount is required'
            })
            .allow(null),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
}; 