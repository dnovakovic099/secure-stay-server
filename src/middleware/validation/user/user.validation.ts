import { NextFunction, Request, Response } from "express";
import Joi from "joi";

export const validateEmailForForgetPassword = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        email: Joi.string().email().required(),
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }

    next();
};

export const validateUserForGoogleLogin = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        email: Joi.string().email().required(),
        uid: Joi.string().required()
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }

    next();
};

export const validationForGoogleSignUp = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        email: Joi.string().email().required(),
        uid: Joi.string().required(),
        firstName: Joi.string().required(),
        lastName: Joi.string().allow('', null),
        companyName: Joi.string().allow('', null),
        numberofProperties: Joi.string().allow('', null),
        message: Joi.string().allow('', null)
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();

};
