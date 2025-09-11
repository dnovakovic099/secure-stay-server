import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreateClient = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        primaryContact: Joi.object({
            firstName: Joi.string().required(),
            lastName: Joi.string().required(),
            preferredName: Joi.string().required().allow(null, ''),
            email: Joi.string().email().required(),
            dialCode: Joi.string().required().allow(null, ''),
            phone: Joi.string().required().allow(null, ''),
            timezone: Joi.string().required(),
            companyName: Joi.string().required().allow(null, ''),
            status: Joi.string().required().allow(null, ''),
            notes: Joi.string().required().allow(null, ''),
        }),
        secondaryContacts: Joi.array().items(
            Joi.object({
                firstName: Joi.string().required(),
                lastName: Joi.string().required(),
                preferredName: Joi.string().required().allow(null, ''),
                email: Joi.string().email().required(),
                dialCode: Joi.string().required().allow(null, ''),
                phone: Joi.string().required().allow(null, ''),
                timezone: Joi.string().required(),
                companyName: Joi.string().required().allow(null, ''),
                status: Joi.string().required().allow(null, ''),
                notes: Joi.string().required().allow(null, ''),
                type: Joi.string().required().valid("secondaryContact", "pointOfContact"),
            }),
        ).allow(null),
        properties: Joi.array().items(Joi.number().required()).allow(null)

    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateClient = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        primaryContact: Joi.object({
            id: Joi.string().required(),
            firstName: Joi.string().required(),
            lastName: Joi.string().required(),
            preferredName: Joi.string().required().allow(null, ''),
            email: Joi.string().email().required(),
            dialCode: Joi.string().required().allow(null, ''),
            phone: Joi.string().required().allow(null, ''),
            timezone: Joi.string().required(),
            companyName: Joi.string().required().allow(null, ''),
            status: Joi.string().required().valid("active", "atRisk", "offboarding", "offboarded").allow(null, ''),
            notes: Joi.string().required().allow(null, ''),
        }),
        secondaryContacts: Joi.array().items(
            Joi.object({
                id: Joi.string().optional(), // if new secondary contact, id may not be present
                firstName: Joi.string().required(),
                lastName: Joi.string().required(),
                preferredName: Joi.string().required().allow(null, ''),
                email: Joi.string().email().required(),
                dialCode: Joi.string().required().allow(null, ''),
                phone: Joi.string().required().allow(null, ''),
                timezone: Joi.string().required(),
                companyName: Joi.string().required().allow(null, ''),
                status: Joi.string().required().valid("active", "atRisk", "offboarding", "offboarded").allow(null, ''),
                notes: Joi.string().required().allow(null, ''),
                type: Joi.string().required().valid("secondaryContact", "pointOfContact"),
            }),
        ).allow(null),
        properties: Joi.array().items(Joi.number().required()).allow(null)
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateGetClients = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        limit: Joi.number().required(),
        keyword: Joi.string().optional(),
        listingId: Joi.array().items(Joi.string()).optional(),
        serviceType: Joi.array().items(Joi.string()).optional(),
        status: Joi.array().items(Joi.string().valid("active", "atRisk", "offboarding", "offboarded")).optional(),
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }
    next();
}