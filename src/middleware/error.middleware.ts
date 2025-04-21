import { Request, Response, NextFunction } from "express";
import CustomErrorHandler from "./customError.middleware";
import { ValidationError } from "joi";
import logger from "../utils/logger.utils";

export const errorHandler = (
  err: any,
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

  if (err.type === "entity.too.large" || err.status === 413) {
    statusCode = 413;
    data.message = "Payload too large. Maximum allowed size is 50MB.";
    logger.error(`413 Error: Payload too large from ${req.ip} at ${req.originalUrl}`);
  }

  if (err instanceof CustomErrorHandler) {
    const customError = err as CustomErrorHandler;
    statusCode = customError.status;
    data = {
      message: customError.message,
    };
  }

  if (err instanceof ValidationError) {
    statusCode = 400;
    data = {
      message: err?.message,
    };
  }

  res.status(statusCode).json(data);
};
