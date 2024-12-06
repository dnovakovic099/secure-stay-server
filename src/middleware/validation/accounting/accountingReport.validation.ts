import { Request, NextFunction, Response } from "express";
import Joi from "joi";
import { ExpenseStatus } from "../../../entity/Expense";

export const validatePrintExpenseIncomeStatement = (request: Request, response: Response, next: NextFunction) => {
  const schema = Joi.object({
    listingId: Joi.number().required().allow(''),
    fromDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
      'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
    }).required(),
    toDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
      'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
    }).required(),
    status: Joi.string().required()
      .valid(ExpenseStatus.PENDING, ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE)
      .allow(''),
    channelId: Joi.number().required().allow(""),
    dateType: Joi.string().required().valid("arrival", "departure").allow(''),
    page: Joi.number().required(),
    limit: Joi.number().required(),
  });

  const { error } = schema.validate(request.query);
  if (error) {
    next(error);
  }
  next();
};