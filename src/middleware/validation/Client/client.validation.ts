import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validateCreateClient = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        primaryContact: Joi.object({
            firstName: Joi.string().required(),
            lastName: Joi.string().required(),
            preferredName: Joi.string().required().allow(null, ''),
            email: Joi.string().email().required(),
            dialCode: Joi.string().required().allow(null, ''),
            phone: Joi.string().required().allow(null, ''),
            timezone: Joi.string().required(),
            companyName: Joi.string().required().allow(null, ''),
            status: Joi.string().required().allow(null, ''),
            notes: Joi.string().required().allow(null, ''),
        }),
        secondaryContacts: Joi.array().items(
            Joi.object({
                firstName: Joi.string().required(),
                lastName: Joi.string().required(),
                preferredName: Joi.string().required().allow(null, ''),
                email: Joi.string().email().required(),
                dialCode: Joi.string().required().allow(null, ''),
                phone: Joi.string().required().allow(null, ''),
                timezone: Joi.string().required(),
                companyName: Joi.string().required().allow(null, ''),
                status: Joi.string().required().allow(null, ''),
                notes: Joi.string().required().allow(null, ''),
                type: Joi.string().required().valid("secondaryContact", "pointOfContact"),
            }),
        ).allow(null),
        properties: Joi.array().items(Joi.number().required()).allow(null)

    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateClient = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        primaryContact: Joi.object({
            id: Joi.string().required(),
            firstName: Joi.string().required(),
            lastName: Joi.string().required(),
            preferredName: Joi.string().required().allow(null, ''),
            email: Joi.string().email().required(),
            dialCode: Joi.string().required().allow(null, ''),
            phone: Joi.string().required().allow(null, ''),
            timezone: Joi.string().required(),
            companyName: Joi.string().required().allow(null, ''),
            status: Joi.string().required().valid("active", "atRisk", "offboarding", "offboarded").allow(null, ''),
            notes: Joi.string().required().allow(null, ''),
        }),
        secondaryContacts: Joi.array().items(
            Joi.object({
                id: Joi.string().optional(), // if new secondary contact, id may not be present
                firstName: Joi.string().required(),
                lastName: Joi.string().required(),
                preferredName: Joi.string().required().allow(null, ''),
                email: Joi.string().email().required(),
                dialCode: Joi.string().required().allow(null, ''),
                phone: Joi.string().required().allow(null, ''),
                timezone: Joi.string().required(),
                companyName: Joi.string().required().allow(null, ''),
                status: Joi.string().required().valid("active", "atRisk", "offboarding", "offboarded").allow(null, ''),
                notes: Joi.string().required().allow(null, ''),
                type: Joi.string().required().valid("secondaryContact", "pointOfContact"),
            }),
        ).allow(null),
        properties: Joi.array().items(Joi.number().required()).allow(null)
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateGetClients = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        page: Joi.number().required(),
        limit: Joi.number().required(),
        keyword: Joi.string().optional(),
        listingId: Joi.array().items(Joi.string()).optional(),
        serviceType: Joi.array().items(Joi.string()).optional(),
        status: Joi.array().items(Joi.string().valid("active", "atRisk", "offboarding", "offboarded")).optional(),
    });

    const { error } = schema.validate(request.query);
    if (error) {
        return next(error);
    }
    next();
}

export const validateCreatePropertyOnboarding = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                address: Joi.string().required(),
                onboarding: Joi.object({
                    serviceInfo: Joi.object({
                        managementFee: Joi.number().required().allow(null),
                        serviceType: Joi.string().required().valid("LAUNCH", "PRO", "FULL"),
                        contractLink: Joi.string().required().allow(null),
                        serviceNotes: Joi.string().required().allow(null)
                    }),
                    sales: Joi.object({
                        salesRepresentative: Joi.string().required().allow(null),
                        salesNotes: Joi.string().required().allow(null),
                        projectedRevenue: Joi.number().required().allow(null),
                    }),
                    listing: Joi.object({
                        clientCurrentListingLink: Joi.array().items(Joi.string()).min(1).allow(null),
                        listingOwner: Joi.string().required().allow(null).valid("Luxury Lodging", "Client"),
                        clientListingStatus: Joi.string().required().allow(null).valid("Closed", "Open - Will Close", "Open - Keeping"),
                        targetLiveDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).required().allow(null),
                        targetStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).required().allow(null),
                        targetDateNotes: Joi.string().required().allow(null),
                        upcomingReservations: Joi.string().required().allow(null),
                    }),
                    photography: Joi.object({
                        photographyCoverage: Joi.string().required().allow(null)
                            .valid("Yes (Covered by Luxury Lodging)", "Yes (Covered by Client)", "No"),
                        photographyNotes: Joi.string().required().allow(null),
                    })
                })
            })
        )

    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};