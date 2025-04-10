import { NextFunction, Request, Response } from "express";
import Joi from "joi";

export const validateSavePartnershipInfo = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        listingId: Joi.number().required(),
        totalEarned: Joi.number().required(),
        pendingCommission: Joi.number().required(),
        activeReferral: Joi.number().required(),
        yearlyProjection: Joi.number().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};
