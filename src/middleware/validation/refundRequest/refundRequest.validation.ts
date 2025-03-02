import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateSaveRefundRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        reservationId: Joi.number().required(),
        listingId: Joi.number().required(),
        guestName: Joi.string().required(),
        listingName: Joi.string().required(),
        checkIn: Joi.date().required(),
        checkOut: Joi.date().required(),
        issueId: Joi.number().required(),
        explaination: Joi.string().required(),
        refundAmount: Joi.number().min(0).required(),
        requestedBy: Joi.string().required(),
        status: Joi.string().required().valid("Pending", "Approved", "Denied"),
        notes: Joi.string().required().allow(null, '')
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateUpdateRefundRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        reservationId: Joi.number().required(),
        listingId: Joi.number().required(),
        guestName: Joi.string().required(),
        listingName: Joi.string().required(),
        checkIn: Joi.date().required(),
        checkOut: Joi.date().required(),
        issueId: Joi.number().required(),
        explaination: Joi.string().required(),
        refundAmount: Joi.number().min(0).required(),
        requestedBy: Joi.string().required(),
        status: Joi.string().required().valid("Pending", "Approved", "Denied"),
        notes: Joi.string().required().allow(null,'')
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};