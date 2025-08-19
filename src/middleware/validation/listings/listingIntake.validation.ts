import { NextFunction, Request, Response } from "express";
import Joi from "joi";

export const validateCreateListingIntake = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientName: Joi.string().required(),
        clientContact: Joi.string().required(),
        externalListingName: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateUpdateListingIntake = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.string().required(),
        clientName: Joi.string().required(),
        clientContact: Joi.string().required(),
        externalListingName: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateGetListingIntake = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        page: Joi.number().required(),
        limit: Joi.number().required(),
        clientName: Joi.string().optional(),
        clientContact: Joi.string().optional(),
        status: Joi.array().items(Joi.string().valid('draft', 'ready', 'published')).optional(),
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }

    next();
};

export const validateCreateBedTypes = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.array().items(
        Joi.object({
            bedTypeId: Joi.number().required(),
            quantity: Joi.number().required(),
            bedRoomNumber: Joi.number().required()
        })
    );

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateUpdateBedTypes = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.array().items(
        Joi.object({
            id: Joi.number().required(),
            bedTypeId: Joi.number().required(),
            quantity: Joi.number().required(),
            bedRoomNumber: Joi.number().required()
        })
    );

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateDeleteBedTypes = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.array().items(
        Joi.object({
            id: Joi.number().required(),
            bedTypeId: Joi.number().required(),
            quantity: Joi.number().required(),
            bedRoomNumber: Joi.number().required()
        })
    );

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

