import { NextFunction, Request, Response } from "express";
import Joi from "joi";

export const validateCreateListingSchedule = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        scheduleType: Joi.string().required().valid(
            "weekly", "bi-weekly", "monthly", "quarterly", "annually", "check-out basis", "as required"
        ).allow(null),
        intervalMonth: Joi.number().integer().min(1).max(12).required().allow(null),
        dayOfWeek: Joi.array().items(Joi.number().integer().min(0).max(6).required()).allow(null),
        weekOfMonth: Joi.number().integer().min(1).max(5).required().allow(null),
        dayOfMonth: Joi.number().integer().min(1).max(32).required().allow(null),
        scheduling: Joi.string().valid("LL", "LL-auto", "Client", "NA").required().allow(null),
        workCategory: Joi.string().valid(
            "Cleaning",
            "Repair",
            "Pool Cleaning",
            "Pool Issues",
            "Landscaping",
            "Pest Control",
            "HVAC Maintenance",
            "Electrical",
            "Plumbing",
            "Snow Removal",
        ).required(),
        listingId: Joi.number().required(),
    }).custom((value, helpers) => {
        switch (value.paymentScheduleType) {
            case "weekly":
            case "bi-weekly": {
                if ((value.paymentDayOfWeek && value.paymentDayOfWeek.length == 0)) {
                    return helpers.message({ custom: '"paymentWeekOfBiWeekly" must be provided when "paymentDayOfWeek" is present' });
                }
                break;
            }
            case "monthly": {
                if ((value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentWeekOfMonth" must be provided when "paymentDayOfWeek" is present' });
                }
                if ((value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && value.paymentDayOfMonth) {
                    return helpers.message({ custom: '"paymentDayOfMonth" should not be provided when "paymentDayOfWeek" is present' });
                }
                break;
            }
            case "quarterly": {
                if (!value.paymentIntervalMonth) {
                    return helpers.message({ custom: '"paymentIntervalMonth" is required for quarterly payments' });
                }
                if (value.paymentIntervalMonth > 3) {
                    return helpers.message({ custom: '"paymentIntervalMonth" must be 3 or less for quarterly payments' });
                }
                if (value.paymentIntervalMonth && (value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentWeekOfMonth" must be provided when "paymentDayOfWeek" is present for quarterly payments' });
                }
                if (value.paymentIntervalMonth && !(value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentDayOfMonth && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentDayOfMonth" or "paymentWeekOfMonth" must be provided for quarterly payments' });
                }
                break;
            }
            case "annually": {
                if (!value.paymentIntervalMonth) {
                    return helpers.message({ custom: '"paymentIntervalMonth" is required for annually payments' });
                }
                if (value.paymentIntervalMonth > 12) {
                    return helpers.message({ custom: '"paymentIntervalMonth" must be 12 or less for annually payments' });
                }
                if (value.paymentIntervalMonth && (value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentWeekOfMonth" must be provided when "paymentDayOfWeek" is present for annually payments' });
                }
                if (value.paymentIntervalMonth && !(value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentDayOfMonth && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentDayOfMonth" or "paymentWeekOfMonth" must be provided for annually payments' });
                }
                break;
            }
            default:
                break;
        }
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};

export const validateUpdateListingSchedule = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        id: Joi.number().required(),
        scheduleType: Joi.string().required().valid(
            "weekly", "bi-weekly", "monthly", "quarterly", "annually", "check-out basis", "as required"
        ).allow(null),
        intervalMonth: Joi.number().integer().min(1).max(12).required().allow(null),
        dayOfWeek: Joi.array().items(Joi.number().integer().min(0).max(6).required()).allow(null),
        weekOfMonth: Joi.number().integer().min(1).max(5).required().allow(null),
        dayOfMonth: Joi.number().integer().min(1).max(32).required().allow(null),
        scheduling: Joi.string().valid("LL", "LL-auto", "Client", "NA").required().allow(null),
        workCategory: Joi.string().valid(
            "Cleaning",
            "Repair",
            "Pool Cleaning",
            "Pool Issues",
            "Landscaping",
            "Pest Control",
            "HVAC Maintenance",
            "Electrical",
            "Plumbing",
            "Snow Removal",
        ).required(),
        listingId: Joi.number().required()
    }).custom((value, helpers) => {
        switch (value.paymentScheduleType) {
            case "weekly":
            case "bi-weekly": {
                if ((value.paymentDayOfWeek && value.paymentDayOfWeek.length == 0)) {
                    return helpers.message({ custom: '"paymentWeekOfBiWeekly" must be provided when "paymentDayOfWeek" is present' });
                }
                break;
            }
            case "monthly": {
                if ((value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentWeekOfMonth" must be provided when "paymentDayOfWeek" is present' });
                }
                if ((value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && value.paymentDayOfMonth) {
                    return helpers.message({ custom: '"paymentDayOfMonth" should not be provided when "paymentDayOfWeek" is present' });
                }
                break;
            }
            case "quarterly": {
                if (!value.paymentIntervalMonth) {
                    return helpers.message({ custom: '"paymentIntervalMonth" is required for quarterly payments' });
                }
                if (value.paymentIntervalMonth > 3) {
                    return helpers.message({ custom: '"paymentIntervalMonth" must be 3 or less for quarterly payments' });
                }
                if (value.paymentIntervalMonth && (value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentWeekOfMonth" must be provided when "paymentDayOfWeek" is present for quarterly payments' });
                }
                if (value.paymentIntervalMonth && !(value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentDayOfMonth && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentDayOfMonth" or "paymentWeekOfMonth" must be provided for quarterly payments' });
                }
                break;
            }
            case "annually": {
                if (!value.paymentIntervalMonth) {
                    return helpers.message({ custom: '"paymentIntervalMonth" is required for annually payments' });
                }
                if (value.paymentIntervalMonth > 12) {
                    return helpers.message({ custom: '"paymentIntervalMonth" must be 12 or less for annually payments' });
                }
                if (value.paymentIntervalMonth && (value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentWeekOfMonth" must be provided when "paymentDayOfWeek" is present for annually payments' });
                }
                if (value.paymentIntervalMonth && !(value.paymentDayOfWeek && value.paymentDayOfWeek.length > 0) && !value.paymentDayOfMonth && !value.paymentWeekOfMonth) {
                    return helpers.message({ custom: '"paymentDayOfMonth" or "paymentWeekOfMonth" must be provided for annually payments' });
                }
                break;
            }
            default:
                break;
        }
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }

    next();
};
