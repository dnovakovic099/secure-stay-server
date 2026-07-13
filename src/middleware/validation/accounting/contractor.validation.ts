import { Request, NextFunction, Response } from "express";
import Joi from "joi";

export const validateContractorInfo = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        contractorName: Joi.string().required(),
        contractorNumber: Joi.string().required().allow(null)
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};

export const validateUpdateContractorInfo = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        contractorName: Joi.string().required(),
        contractorNumber: Joi.string().required().allow(null, ""),
        updateExistingExpenses: Joi.boolean().optional(),
        syncVendorProfile: Joi.boolean().optional()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
        return;
    }
    next();
};

export const validateMapContractorVendorProfile = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        vendorProfileId: Joi.number().integer().positive().required(),
        keepNameFrom: Joi.string().valid("contractor", "vendor").optional(),
        keepPhoneFrom: Joi.string().valid("contractor", "vendor").optional(),
        updateExistingExpenses: Joi.boolean().optional(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
        return;
    }
    next();
};

export const validateDeleteContractorInfo = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        replacementContractorId: Joi.number().integer().positive().optional().allow(null, ""),
        replacementContractorName: Joi.string().optional().allow(null, ""),
        replacementContractorNumber: Joi.string().optional().allow(null, ""),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
        return;
    }
    next();
};

export const validateMergeContractors = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        sourceContractorIds: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
        targetContractorId: Joi.number().integer().positive().required(),
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
        return;
    }
    next();
};
