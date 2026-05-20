import { Request, Response, NextFunction } from "express";
import Joi from "joi";

const REFUND_REQUEST_STATUS_OPTIONS = ["Pending", "Approved", "For Processing", "Paid", "Denied", "Cancelled"];

export const validateSaveRefundRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        reservationId: Joi.number().required(),
        listingId: Joi.number().required(),
        guestName: Joi.string().required(),
        listingName: Joi.string().required(),
        checkIn: Joi.date().required(),
        checkOut: Joi.date().required(),
        issueId: Joi.string().optional().allow(null, ''),
        explaination: Joi.string().required(),
        refundAmount: Joi.number().min(0).required(),
        requestedBy: Joi.string().optional().allow(null, ''),
        status: Joi.string().required().valid(...REFUND_REQUEST_STATUS_OPTIONS),
        paymentMethod: Joi.string().optional().allow(null, ''),
        paymentDetails: Joi.string().optional().allow(null, ''),
        chargeToClient: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false'), Joi.number().valid(0, 1)).optional(),
        notes: Joi.string().optional().allow(null, '')
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
        issueId: Joi.string().optional().allow(null, ''),
        explaination: Joi.string().required(),
        refundAmount: Joi.number().min(0).required(),
        requestedBy: Joi.string().optional().allow(null, ''),
        status: Joi.string().required().valid(...REFUND_REQUEST_STATUS_OPTIONS),
        paymentMethod: Joi.string().optional().allow(null, ''),
        paymentDetails: Joi.string().optional().allow(null, ''),
        chargeToClient: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false'), Joi.number().valid(0, 1)).optional(),
        notes: Joi.string().optional().allow(null,'')
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};


export const validateRefundRequestStatus = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        status: Joi.string().required().valid(...REFUND_REQUEST_STATUS_OPTIONS),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};
