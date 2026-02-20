import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreateItemSupplyRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        propertyName: Joi.string().optional().allow(null, ""),
        itemsToRestock: Joi.string().required(),
        isUrgent: Joi.string().required(),
        approvedByClient: Joi.string().required().valid("Yes", "Pending Approval", "Part of +$50 batch"),
        sendToAddress: Joi.string().required(),
        requestedBy: Joi.string().required(),
        status: Joi.string().optional().valid("new", "in_progress", "completed"),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateItemSupplyRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        itemsToRestock: Joi.string().optional().allow(null, ""),
        isUrgent: Joi.string().optional().allow(null, ""),
        approvedByClient: Joi.string().optional().allow(null, "").valid("Yes", "Pending Approval", "Part of +$50 batch", null, ""),
        sendToAddress: Joi.string().optional().allow(null, ""),
        requestedBy: Joi.string().optional().allow(null, ""),
        status: Joi.string().optional().valid("new", "in_progress", "completed"),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};
