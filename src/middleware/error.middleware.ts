import { Request, Response, NextFunction } from "express";
import CustomErrorHandler from "./customError.middleware";
<<<<<<< HEAD
=======
import { ValidationError } from "joi";
>>>>>>> faaa5c9ea7fa184de63d21866351cc388516b701

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // default error
  let statusCode = 500;
  let data: { message: string; originalMessage?: string } = {
    message: "Internal Server Error",
    ...(process.env.NODE_ENV == "development" && {
      originalMessage: err.message,
    }),
  };

  if (err instanceof CustomErrorHandler) {
    const customError = err as CustomErrorHandler;
    statusCode = customError.status;
    data = {
      message: customError.message,
    };
  }

<<<<<<< HEAD
=======
  if (err instanceof ValidationError) {
    statusCode = 400;
    data = {
      message: err?.message,
    };
  }

>>>>>>> faaa5c9ea7fa184de63d21866351cc388516b701
  res.status(statusCode).json(data);
};
