import { Request, NextFunction, Response } from "express";
import Joi from "joi";

export const validateCreateTask = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string()
            .valid("Assigned", "In Progress", "Need Attention", "Completed")
            .default("Assigned")
            .required(),
        listing_id: Joi.string().required(),
        assignee_id: Joi.string().required(),
        task: Joi.string().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateUpdateTask = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        status: Joi.string()
            .valid("Assigned", "In Progress", "Need Attention", "Completed"),
        listing_id: Joi.string(),
        assignee_id: Joi.string(),
        task: Joi.string(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};