import { NextFunction, Request, Response } from "express";
import Joi from "joi";

export const validateSaveEmailInfoRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        email: Joi.string().email().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateSavePhoneNoInfoRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        countryCode: Joi.string().required(),
        phoneNo: Joi.string().required(),
        supportsSMS: Joi.boolean().required(),
        supportsCalling: Joi.boolean().required(),
        supportsWhatsApp: Joi.boolean().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdatePhoneNoInfoRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        countryCode: Joi.string().required(),
        phoneNo: Joi.string().required(),
        supportsSMS: Joi.boolean().required(),
        supportsCalling: Joi.boolean().required(),
        supportsWhatsApp: Joi.boolean().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
}

