import { Request, Response, NextFunction } from 'express';
import * as Joi from 'joi';

export const validateGetReservationList = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        checkInStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).allow(''),
        checkInEndDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).allow(''),
        checkOutStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).allow(''),
        checkOutEndDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
        }).allow(''),
        todayDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).required().messages({
            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
            'any.required': 'todayDate is required'
        }),
        listingMapId: Joi.string().allow(''),
        guestName: Joi.string().allow(''),
        page: Joi.number().required(),
        limit: Joi.number().required()
    });

    const { error } = schema.validate(request.query);
    if (error) {
        next(error);
    }
    next();
};
