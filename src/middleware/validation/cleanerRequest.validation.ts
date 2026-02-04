import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreateCleanerRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        fullAddress: Joi.string().required(),
        specialArrangementPreference: Joi.string().required(),
        isPropertyReadyCleaned: Joi.string().required(),
        scheduleInitialClean: Joi.string().required(),
        propertyAccessInformation: Joi.string().required(),
        cleaningClosetCodeLocation: Joi.string().required(),
        trashScheduleInstructions: Joi.string().required(),
        suppliesToRestock: Joi.string().required(),
        status: Joi.string().optional().valid("new", "in_progress", "completed"),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateCleanerRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        fullAddress: Joi.string().optional().allow(null, ""),
        specialArrangementPreference: Joi.string().optional().allow(null, ""),
        isPropertyReadyCleaned: Joi.string().optional().allow(null, ""),
        scheduleInitialClean: Joi.string().optional().allow(null, ""),
        propertyAccessInformation: Joi.string().optional().allow(null, ""),
        cleaningClosetCodeLocation: Joi.string().optional().allow(null, ""),
        trashScheduleInstructions: Joi.string().optional().allow(null, ""),
        suppliesToRestock: Joi.string().optional().allow(null, ""),
        status: Joi.string().optional().valid("new", "in_progress", "completed"),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};
