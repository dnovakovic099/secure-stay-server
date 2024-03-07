import { NextFunction, Request, Response } from "express";
import Joi from "joi";

export const validateSaveEmailInfoRequest = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        email: Joi.string().email().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

