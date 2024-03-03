import { Request, NextFunction, Response } from "express";
import Joi from "joi";

export const validateGetAccessTokenRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        username: Joi.string().required(),
        password: Joi.string().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateSaveLockListingRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        deviceId: Joi.string().required(),
        listingId: Joi.number().required().allow(null),
        deviceType: Joi.string().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateGetPasscodeRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        lockId: Joi.string().required(),
        accessToken: Joi.string().required()
    });

    const { error } = schema.validate(request.query);
    if (error) {
        next(error);
    }
    next();
};

export const validateCreatePasscodeRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        accessToken: Joi.string().required(),
        lockId: Joi.string().required(),
        codeName: Joi.string().required(),
        codeValue: Joi.number().required(),
        timingOption: Joi.number().required().valid(2, 3),
        startDate: Joi.when('timingOption', {
            is: 2,
            then: Joi.string().required().allow(''),
            otherwise: Joi.string().required()
        }),
        endDate: Joi.when('timingOption', {
            is: 2,
            then: Joi.string().required().allow(''),
            otherwise: Joi.string().required()
        })
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateDeletePasscodeRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        accessToken: Joi.string().required(),
        lockId: Joi.number().required(),
        keyboardPwdId: Joi.number().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};