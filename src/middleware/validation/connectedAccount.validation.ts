import { NextFunction, Request, Response } from "express";
import Joi from "joi";

export const validateSavePmAccountInfoRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientSecret: Joi.string().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateSaveSeamAccountInfoRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        apiKey: Joi.string().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateSaveSifelyAccountInfoRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientSecret: Joi.string().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateSaveStripeAccountInfoRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        apiKey: Joi.string().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

