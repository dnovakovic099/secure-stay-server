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