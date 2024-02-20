
import { Request, Response, NextFunction } from 'express';
import CustomErrorHandler from './customError.middleware';

export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {

    // default error
    let statusCode = 500;
    let data: { message: string, originalMessage?: string } = {
        message: "Internal Server Error",
        ...(process.env.NODE_ENV == "development" && { originalMessage: err.message })
    };

    if (err instanceof CustomErrorHandler) {
        const customError = err as CustomErrorHandler;
        statusCode = customError.status;
        data = {
            message: customError.message
        };
    }

    res.status(statusCode).json(data);
};

