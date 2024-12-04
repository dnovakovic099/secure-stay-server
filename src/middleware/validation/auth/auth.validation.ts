import Joi from "joi";
import { Request, Response, NextFunction } from "express";

export const validateSignin = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().required()
    });

    const { error } = schema.validate(request.body);
    if (error) {
        next(error);
    }
    next();
};