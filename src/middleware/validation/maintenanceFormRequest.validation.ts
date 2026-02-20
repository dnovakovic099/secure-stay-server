import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreateMaintenanceFormRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        propertyName: Joi.string().optional().allow(null, ""),
        budget: Joi.string().required(),
        email: Joi.string().email().required(),
        scopeOfWork: Joi.string().required(),
        propertyAccessInformation: Joi.string().required(),
        expectedTimeframe: Joi.string().required(),
        status: Joi.string().optional().valid("new", "in_progress", "completed"),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateMaintenanceFormRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        budget: Joi.string().optional().allow(null, ""),
        email: Joi.string().optional().allow(null, ""),
        scopeOfWork: Joi.string().optional().allow(null, ""),
        propertyAccessInformation: Joi.string().optional().allow(null, ""),
        expectedTimeframe: Joi.string().optional().allow(null, ""),
        status: Joi.string().optional().valid("new", "in_progress", "completed"),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};
