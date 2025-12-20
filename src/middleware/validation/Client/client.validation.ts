import { max } from "date-fns";
import { Request, Response, NextFunction } from "express";
import Joi from "joi";

enum PropertyStatus {
    ACTIVE = "active",
    ONBOARDING = "onboarding",
    ON_HOLD = "on-hold",
    POTENTIAL_OFFBOARDING = "potential-offboarding",
    OFFBOARDING = "offboarding",
    INACTIVE = "inactive",
}

export const validateCreateClient = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        primaryContact: Joi.object({
            firstName: Joi.string().required(),
            lastName: Joi.string().required(),
            preferredName: Joi.string().required().allow(null, ''),
            email: Joi.string().email().required(),
            dialCode: Joi.string().required().allow(null, ''),
            phone: Joi.string().required().allow(null, ''),
            timezone: Joi.string().required().allow(null, ''),
            companyName: Joi.string().required().allow(null, ''),
            status: Joi.string().required().allow(null, ''),
            notes: Joi.string().required().allow(null, ''),
            clientFolder: Joi.string().optional().allow(null, ''), 
        }),
        secondaryContacts: Joi.array().items(
            Joi.object({
                firstName: Joi.string().required(),
                lastName: Joi.string().required(),
                preferredName: Joi.string().required().allow(null, ''),
                email: Joi.string().email().required(),
                dialCode: Joi.string().required().allow(null, ''),
                phone: Joi.string().required().allow(null, ''),
                timezone: Joi.string().required().allow(null, ''),
                companyName: Joi.string().required().allow(null, ''),
                status: Joi.string().required().allow(null, ''),
                notes: Joi.string().required().allow(null, ''),
                type: Joi.string().required().valid("secondaryContact", "pointOfContact"),
            }),
        ).allow(null),
        properties: Joi.array().items(Joi.number().required()).allow(null),
        source: Joi.string().optional().valid("listingIntakePage", "clientsPage")

    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateCreateClientWithPreOnboarding = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        primaryContact: Joi.object({
            firstName: Joi.string().required(),
            lastName: Joi.string().required(),
            preferredName: Joi.string().required().allow(null, ''),
            email: Joi.string().email().required(),
            dialCode: Joi.string().required().allow(null, ''),
            phone: Joi.string().required().allow(null, ''),
            timezone: Joi.string().required().allow(null, ''),
            companyName: Joi.string().required().allow(null, ''),
            status: Joi.string().required().allow(null, ''),
            notes: Joi.string().required().allow(null, ''),
            clientFolder: Joi.string().optional().allow(null, ''), 
        }),
        secondaryContacts: Joi.array().items(
            Joi.object({
                firstName: Joi.string().required(),
                lastName: Joi.string().required(),
                preferredName: Joi.string().required().allow(null, ''),
                email: Joi.string().email().required(),
                dialCode: Joi.string().required().allow(null, ''),
                phone: Joi.string().required().allow(null, ''),
                timezone: Joi.string().required().allow(null, ''),
                companyName: Joi.string().required().allow(null, ''),
                status: Joi.string().required().allow(null, ''),
                notes: Joi.string().required().allow(null, ''),
                type: Joi.string().required().valid("secondaryContact", "pointOfContact"),
            }),
        ).allow(null),
        existingClientId: Joi.string().optional().allow(null, ''),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                address: Joi.string().required(),
                streetAddress: Joi.string().optional().allow(null),
                unitNumber: Joi.string().optional().allow(null),
                city: Joi.string().optional().allow(null),
                state: Joi.string().optional().allow(null),
                country: Joi.string().optional().allow(null),
                zipCode: Joi.string().optional().allow(null),
                latitude: Joi.number().optional().allow(null),
                longitude: Joi.number().optional().allow(null),
                onboarding: Joi.object({
                    serviceInfo: Joi.object({
                        managementFee: Joi.number().required().allow(null),
                        serviceType: Joi.string().required().valid("LAUNCH", "PRO", "FULL", null),
                        serviceNotes: Joi.string().optional().allow(null)
                    }).optional(),
                    sales: Joi.object({
                        salesRepresentative: Joi.string().required().allow(null),
                        salesNotes: Joi.string().optional().allow(null),
                        projectedRevenue: Joi.number().optional().allow(null),
                        minPrice: Joi.number().optional().allow(null),
                    }).optional(),
                    listing: Joi.object({
                        clientCurrentListingLink: Joi.array().items(Joi.string()).min(1).allow(null),
                        listingOwner: Joi.string().optional().allow(null),
                        clientListingStatus: Joi.string().optional().allow(null).valid(
                            "Active (Keeping: Need to Disclose Process)", 
                            "Active (Will Unpublish)",
                            "Active (Keeping + Disclosed Process to Client)",
                            "Inactive/Unpublished"
                        ),
                        targetLiveDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        targetStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        targetDateNotes: Joi.string().optional().allow(null),
                        upcomingReservations: Joi.string().optional().allow(null),
                        onboardingCallSchedule: Joi.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).messages({
                            'string.pattern.base': 'DateTime must be in the format "yyyy-mm-dd HH:mm"',
                        }).optional().allow(null),
                    }).optional(),
                    photography: Joi.object({
                        photographyCoverage: Joi.string().required().allow(null)
                            .valid("Yes (Covered by Luxury Lodging)", "Yes (Covered by Client)", "No"),
                        photographyNotes: Joi.string().optional().allow(null),
                    }).optional(),
                    contractorsVendor: Joi.object({
                        cleaning: Joi.string().optional().allow(null),
                        maintenance: Joi.string().optional().allow(null),
                        biWeeklyInspection: Joi.string().optional().allow(null),
                    }).optional(),
                    financial: Joi.object({
                        claimsFee: Joi.string().optional().allow(null).valid("Yes", "No"),
                        onboardingFee: Joi.string().optional().allow(null).valid("Yes", "No"),
                        onboardingFeeDetails: Joi.string().optional().allow(null),
                        offboardingFee: Joi.string().optional().allow(null).valid("Yes", "No"),
                        offboardingFeeDetails: Joi.string().optional().allow(null),
                        techFee: Joi.string().optional().allow(null).valid("Yes", "No"),
                        techFeeDetails: Joi.string().optional().allow(null),
                        payoutSchedule: Joi.string().optional().allow(null).valid("Monthly", "Bi-weekly", "Weekly"),
                        taxesAddendum: Joi.string().optional().allow(null).valid("Yes", "No"),
                        projectedRevenue: Joi.string().optional().allow(null),
                    }).optional()
                }).optional()
            })
        ),
        source: Joi.string().optional().valid("listingIntakePage", "clientsPage")
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
            timezone: Joi.string().required().allow(null, ''),
            companyName: Joi.string().required().allow(null, ''),
            status: Joi.string().required().valid().allow(null, ''),
            notes: Joi.string().required().allow(null, ''),
            clientFolder: Joi.string().optional().allow(null, ''), 
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
                timezone: Joi.string().required().allow(null, ''),
                companyName: Joi.string().required().allow(null, ''),
                status: Joi.string().required().valid(...Object.values(PropertyStatus)).allow(null, ''),
                notes: Joi.string().required().allow(null, ''),
                type: Joi.string().required().valid("secondaryContact", "pointOfContact"),
            }),
        ).allow(null),
        properties: Joi.array().items(Joi.number().required()).allow(null),
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
        status: Joi.array().items(Joi.string().valid(...Object.values(PropertyStatus))).optional(),
        source: Joi.string().valid("listingIntakePage", "clientsPage").optional()
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
                streetAddress: Joi.string().optional().allow(null),
                unitNumber: Joi.string().optional().allow(null),
                city: Joi.string().optional().allow(null),
                state: Joi.string().optional().allow(null),
                country: Joi.string().optional().allow(null),
                zipCode: Joi.string().optional().allow(null),
                latitude: Joi.number().optional().allow(null),
                longitude: Joi.number().optional().allow(null),
                onboarding: Joi.object({
                    serviceInfo: Joi.object({
                        managementFee: Joi.number().required().allow(null),
                        serviceType: Joi.string().required().valid("LAUNCH", "PRO", "FULL", null),
                        serviceNotes: Joi.string().required().allow(null)
                    }).optional(),
                    sales: Joi.object({
                        salesRepresentative: Joi.string().required().allow(null),
                        salesNotes: Joi.string().optional().allow(null),
                        projectedRevenue: Joi.number().optional().allow(null),
                        minPrice: Joi.number().optional().allow(null),
                    }).optional(),
                    listing: Joi.object({
                        clientCurrentListingLink: Joi.array().items(Joi.string()).min(1).allow(null),
                        listingOwner: Joi.string().optional().allow(null),
                        clientListingStatus: Joi.string().optional().allow(null).valid(
                            "Active (Keeping: Need to Disclose Process)", 
                            "Active (Will Unpublish)",
                            "Active (Keeping + Disclosed Process to Client)",
                            "Inactive/Unpublished"
                        ),
                        targetLiveDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        targetStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        targetDateNotes: Joi.string().optional().allow(null),
                        upcomingReservations: Joi.string().optional().allow(null),
                        onboardingCallSchedule: Joi.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).messages({
                            'string.pattern.base': 'DateTime must be in the format "yyyy-mm-dd HH:mm"',
                        }).optional().allow(null),
                    }).optional(),
                    photography: Joi.object({
                        photographyCoverage: Joi.string().required().allow(null)
                            .valid("Yes (Covered by Luxury Lodging)", "Yes (Covered by Client)", "No"),
                        photographyNotes: Joi.string().optional().allow(null),
                    }).optional(),
                    contractorsVendor: Joi.object({
                        cleaning: Joi.string().optional().allow(null),
                        maintenance: Joi.string().optional().allow(null),
                        biWeeklyInspection: Joi.string().optional().allow(null),
                    }).optional(),
                    financial: Joi.object({
                        claimsFee: Joi.string().optional().allow(null).valid("Yes", "No"),
                        onboardingFee: Joi.string().optional().allow(null).valid("Yes", "No"),
                        onboardingFeeDetails: Joi.string().optional().allow(null),
                        offboardingFee: Joi.string().optional().allow(null).valid("Yes", "No"),
                        offboardingFeeDetails: Joi.string().optional().allow(null),
                        techFee: Joi.string().optional().allow(null).valid("Yes", "No"),
                        techFeeDetails: Joi.string().optional().allow(null),
                        payoutSchedule: Joi.string().optional().allow(null).valid("Monthly", "Bi-weekly", "Weekly"),
                        taxesAddendum: Joi.string().optional().allow(null).valid("Yes", "No"),
                    }).optional()
                }).optional()
            })
        )
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdatePropertyOnboarding = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().optional(), // if the id is passed then update else if the id is not passed then create
                address: Joi.string().optional(),
                streetAddress: Joi.string().optional().allow(null),
                unitNumber: Joi.string().optional().allow(null),
                city: Joi.string().optional().allow(null),
                state: Joi.string().optional().allow(null),
                country: Joi.string().optional().allow(null),
                zipCode: Joi.string().optional().allow(null),
                latitude: Joi.number().optional().allow(null),
                longitude: Joi.number().optional().allow(null),
                onboarding: Joi.object({
                    serviceInfo: Joi.object({
                        managementFee: Joi.number().optional().allow(null),
                        serviceType: Joi.string().optional().valid("LAUNCH", "PRO", "FULL", null),
                        serviceNotes: Joi.string().optional().allow(null)
                    }).optional(),
                    sales: Joi.object({
                        salesRepresentative: Joi.string().optional().allow(null),
                        salesNotes: Joi.string().optional().allow(null),
                        projectedRevenue: Joi.number().optional().allow(null),
                        minPrice: Joi.number().optional().allow(null),
                    }).optional(),
                    listing: Joi.object({
                        clientCurrentListingLink: Joi.array().items(Joi.string()).min(1).allow(null),
                        listingOwner: Joi.string().optional().allow(null),
                        clientListingStatus: Joi.string().optional().allow(null).valid(
                            "Active (Keeping: Need to Disclose Process)",
                            "Active (Will Unpublish)",
                            "Active (Keeping + Disclosed Process to Client)",
                            "Inactive/Unpublished"
                        ),
                        targetLiveDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        targetStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        targetDateNotes: Joi.string().optional().allow(null),
                        upcomingReservations: Joi.string().optional().allow(null),
                        onboardingCallSchedule: Joi.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).messages({
                            'string.pattern.base': 'DateTime must be in the format "yyyy-mm-dd HH:mm"',
                        }).optional().allow(null),
                    }).optional(),
                    photography: Joi.object({
                        photographyCoverage: Joi.string().optional().allow(null)
                            .valid("Yes (Covered by Luxury Lodging)", "Yes (Covered by Client)", "No"),
                        photographyNotes: Joi.string().optional().allow(null),
                    }).optional(),
                    contractorsVendor: Joi.object({
                        cleaning: Joi.string().optional().allow(null),
                        maintenance: Joi.string().optional().allow(null),
                        biWeeklyInspection: Joi.string().optional().allow(null),
                    }).optional(),
                    financial: Joi.object({
                        claimsFee: Joi.string().optional().allow(null).valid("Yes", "No"),
                        onboardingFee: Joi.string().optional().allow(null).valid("Yes", "No"),
                        onboardingFeeDetails: Joi.string().optional().allow(null),
                        offboardingFee: Joi.string().optional().allow(null).valid("Yes", "No"),
                        offboardingFeeDetails: Joi.string().optional().allow(null),
                        techFee: Joi.string().optional().allow(null).valid("Yes", "No"),
                        techFeeDetails: Joi.string().optional().allow(null),
                        payoutSchedule: Joi.string().optional().allow(null).valid("Monthly", "Bi-weekly", "Weekly"),
                        taxesAddendum: Joi.string().optional().allow(null).valid("Yes", "No"),
                    }).optional()
                }).optional()
            })
        )
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};


export const validateSaveOnboardingDetails = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().optional(), // if the id is passed then update else if the id is not passed then create
                address: Joi.string().required(),
                streetAddress: Joi.string().optional().allow(null),
                unitNumber: Joi.string().optional().allow(null),
                city: Joi.string().optional().allow(null),
                state: Joi.string().optional().allow(null),
                country: Joi.string().optional().allow(null),
                zipCode: Joi.string().optional().allow(null),
                latitude: Joi.number().optional().allow(null),
                longitude: Joi.number().optional().allow(null),
                listingId: Joi.string().optional().allow(null),
                onboarding: Joi.object({
                    sales: Joi.object({
                        salesRepresentative: Joi.string().required().allow(null),
                        salesNotes: Joi.string().required().allow(null),
                        projectedRevenue: Joi.number().required().allow(null),
                    }),
                    listing: Joi.object({
                        clientCurrentListingLink: Joi.array().items(Joi.string()).min(1).allow(null),
                        listingOwner: Joi.string().required().allow(null),
                        clientListingStatus: Joi.string().required().allow(null).valid(
                            "Active (Keeping: Need to Disclose Process)",
                            "Active (Will Unpublish)",
                            "Active (Keeping + Disclosed Process to Client)",
                            "Inactive/Unpublished"
                        ),
                        targetLiveDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).required().allow(null),
                        targetStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).required().allow(null),
                        targetDateNotes: Joi.string().required().allow(null),
                        actualLiveDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).required().allow(null),
                        actualStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).required().allow(null),
                        upcomingReservations: Joi.string().required().allow(null),
                        onboardingCallSchedule: Joi.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).messages({
                            'string.pattern.base': 'DateTime must be in the format "yyyy-mm-dd HH:mm"',
                        }).optional().allow(null),
                    }),
                    photography: Joi.object({
                        photographyCoverage: Joi.string().required().allow(null)
                            .valid("Yes (Covered by Luxury Lodging)", "Yes (Covered by Client)", "No"),
                        photographyNotes: Joi.string().required().allow(null),
                    }),
                    clientAcknowledgement: Joi.object({
                        acknowledgePropertyReadyByStartDate: Joi.boolean().optional().allow(null),
                        agreesUnpublishExternalListings: Joi.boolean().optional().allow(null),
                        acknowledgesResponsibilityToInform: Joi.boolean().optional().allow(null),
                    }).optional(),
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

export const validateUpdateOnboardingDetails = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().optional(), // if the id is passed then update else if the id is not passed then create
                address: Joi.string().optional(),
                streetAddress: Joi.string().optional().allow(null),
                unitNumber: Joi.string().optional().allow(null),
                city: Joi.string().optional().allow(null),
                state: Joi.string().optional().allow(null),
                country: Joi.string().optional().allow(null),
                zipCode: Joi.string().optional().allow(null),
                latitude: Joi.number().optional().allow(null),
                longitude: Joi.number().optional().allow(null),
                listingId: Joi.string().optional().allow(null),
                status: Joi.string().optional(),
                onboarding: Joi.object({
                    sales: Joi.object({
                        salesRepresentative: Joi.string().optional().allow(null),
                        salesNotes: Joi.string().optional().allow(null),
                        projectedRevenue: Joi.string().optional().allow(null),
                    }).optional(),
                    listing: Joi.object({
                        clientCurrentListingLink: Joi.array().items(Joi.string()).min(1).allow(null),
                        listingOwner: Joi.string().optional().allow(null),
                        clientListingStatus: Joi.string().optional().allow(null).valid(
                            "Active (Keeping: Need to Disclose Process)",
                            "Active (Will Unpublish)",
                            "Active (Keeping + Disclosed Process to Client)",
                            "Inactive/Unpublished"
                        ),
                        targetLiveDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        targetStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        targetDateNotes: Joi.string().optional().allow(null),
                        actualLiveDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        actualStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        upcomingReservations: Joi.string().optional().allow(null),
                        onboardingCallSchedule: Joi.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).messages({
                            'string.pattern.base': 'DateTime must be in the format "yyyy-mm-dd HH:mm"',
                        }).optional().allow(null),
                    }).optional(),
                    photography: Joi.object({
                        photographyCoverage: Joi.string().optional().allow(null)
                            .valid("Yes (Covered by Luxury Lodging)", "Yes (Covered by Client)", "No"),
                        photographyNotes: Joi.string().optional().allow(null),
                    }).optional(),
                    clientAcknowledgement: Joi.object({
                        acknowledgePropertyReadyByStartDate: Joi.boolean().optional().allow(null),
                        agreesUnpublishExternalListings: Joi.boolean().optional().allow(null),
                        acknowledgesResponsibilityToInform: Joi.boolean().optional().allow(null),
                    }).optional(),
                }).optional()
            })
        )
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateSaveServiceInfo = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().required(),
                address: Joi.string().required(),
                onboarding: Joi.object({
                    serviceInfo: Joi.object({
                        managementFee: Joi.number().required().allow(null),
                        serviceType: Joi.string().required().valid("LAUNCH", "PRO", "FULL"),
                        contractLink: Joi.string().required().allow(null),
                        serviceNotes: Joi.string().required().allow(null)
                    }),
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

export const validateUpdateServiceInfo = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().required(),
                address: Joi.string().optional(),
                onboarding: Joi.object({
                    serviceInfo: Joi.object({
                        managementFee: Joi.number().optional().allow(null),
                        serviceType: Joi.string().optional().valid("LAUNCH", "PRO", "FULL", null),
                        contractLink: Joi.string().optional().allow(null),
                        serviceNotes: Joi.string().optional().allow(null)
                    }).required()
                }).required()
            })
        )
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};


export const validateSaveListingInfo = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().required(),
                address: Joi.string().required(),
                onboarding: Joi.object({
                    listing: Joi.object({
                        //General
                        propertyTypeId: Joi.string().required().allow(null),
                        noOfFloors: Joi.number().required().allow(null),
                        squareMeters: Joi.number().required().allow(null),
                        squareFeet: Joi.number().optional().allow(null),
                        personCapacity: Joi.number().required().allow(null),

                        //Bedrooms
                        roomType: Joi.string().required().allow(null),
                        bedroomsNumber: Joi.number().required().allow(null),
                        bedroomNotes: Joi.string().optional().allow(null),

                        propertyBedTypes: Joi.array().required().min(1).allow(null).items(
                            Joi.object({
                                floorLevel: Joi.number().optional().allow(null),
                                bedroomNumber: Joi.number().optional().allow(null),
                                beds: Joi.array().optional().allow(null).items(
                                    Joi.object({
                                        bedTypeId: Joi.string().optional().allow(null),
                                        quantity: Joi.number().optional().allow(null),
                                        airMattressSize: Joi.string().optional().allow(null),
                                        upperBunkSize: Joi.string().optional().allow(null),
                                        lowerBunkSize: Joi.string().optional().allow(null)
                                    })
                                )
                            })
                        ),


                        // Bathrooms
                        bathroomType: Joi.string().required().valid("private", "shared").allow(null),
                        bathroomsNumber: Joi.number().required().allow(null), // Number of Full Baths
                        guestBathroomsNumber: Joi.number().required().allow(null), // Number of Half Baths
                        bathroomNotes: Joi.string().optional().allow(null),

                        //Listing Information
                        checkInTimeStart: Joi.number().required().allow(null),
                        checkOutTime: Joi.number().required().allow(null),
                        canAnyoneBookAnytime: Joi.string().required().allow(null).valid(
                            "Yes, no restrictions. (Recommended)",
                            "Yes, but please notify me of SAME DAY bookings/changes before accepting",
                            "Yes, but please notify me if booking/changes is within 1 DAY of check-in/adjustment",
                            "No, please always confirm with me before accepting",
                            "No, I auto-decline reservations if check-in is within x number of days from today"
                        ),
                        bookingAcceptanceNoticeNotes: Joi.string().required().allow(null),

                        //house rules
                        allowPartiesAndEvents: Joi.boolean().required().allow(null),
                        allowSmoking: Joi.boolean().required().allow(null),
                        allowPets: Joi.boolean().required().allow(null),
                        petFee: Joi.number().required().allow(null),
                        petFeeType: Joi.string().required().allow(null).valid("Per Stay", "Per Pet", "Per Pet/Night"),
                        numberOfPetsAllowed: Joi.number().required().allow(null),
                        petRestrictionsNotes: Joi.string().required().allow(null),
                        allowChildreAndInfants: Joi.boolean().required().allow(null),
                        allowLuggageDropoffBeforeCheckIn: Joi.boolean().required().allow(null),
                        otherHouseRules: Joi.string().required().allow(null),

                        //parking
                        parkingType: Joi.array().min(1).required().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "Street Parking",
                                        "Driveaway",
                                        "Garage",
                                        "In-building Facility",
                                        "Valet Parking",
                                        "No Parking Available"
                                    )
                            ),
                        parkingFee: Joi.number().required().allow(null),
                        numberOfParkingSpots: Joi.number().required().allow(null),
                        parkingInstructions: Joi.string().required().allow(null),

                        //Property Access
                        checkInProcess: Joi.array().min(1).required().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "24-hr checkin",
                                        "In person Check-in",
                                        "Doorman"
                                    )
                            ),
                        doorLockType: Joi.array().min(1).required().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "Smart Lock (w/app)",
                                        "Smart Lock (w/o app)",
                                        "Lockbox",
                                        "Deadbolt Lock",
                                        "In-Person Check-in"
                                    ),
                            ),
                        doorLockCodeType: Joi.string().required().allow(null)
                            .valid(
                                "Unique",
                                "Standard"
                            ),
                        codeResponsibleParty: Joi.string().required().allow(null).valid("Property Owner", "Luxury Lodging"),
                        doorLockAppName: Joi.string().required().allow(null),
                        doorLockAppUsername: Joi.string().required().allow(null),
                        doorLockAppPassword: Joi.string().required().allow(null),
                        lockboxLocation: Joi.string().required().allow(null),
                        lockboxCode: Joi.string().required().allow(null),
                        doorLockInstructions: Joi.string().required().allow(null),
                        emergencyBackUpCode: Joi.string().optional().allow(null),

                        //Waste Management
                        wasteCollectionDays: Joi.string().required().allow(null),
                        wasteBinLocation: Joi.string().required().allow(null),
                        wasteManagementInstructions: Joi.string().required().allow(null),

                        //additional services/upsells
                        propertyUpsells: Joi.array().min(1).required().allow(null).items(
                            Joi.object({
                                upsellName: Joi.string().required(),
                                allowUpsell: Joi.boolean().required(),
                                feeType: Joi.string().required().valid("Free", "Standard", "Per Hour", "Daily", "Daily (Required for whole stay)"),
                                maxAdditionalHours: Joi.number().required().allow(null)
                            })
                        ),
                        additionalServiceNotes: Joi.string().required().allow(null),


                        //amenities
                        amenities: Joi.array().items(Joi.string()).min(1).required().allow(null),
                        acknowledgeAmenitiesAccurate: Joi.boolean().required().allow(null),
                        acknowledgeSecurityCamerasDisclosed: Joi.boolean().required().allow(null),
                        otherAmenities: Joi.string().required().allow(null),
                        wifiUsername: Joi.string().required().allow(null),
                        wifiPassword: Joi.string().required().allow(null),
                        wifiSpeed: Joi.string().required().allow(null),
                        locationOfModem: Joi.string().required().allow(null),
                        swimmingPoolNotes: Joi.string().required().allow(null),
                        hotTubInstructions: Joi.string().required().allow(null),
                        hotTubPrivacy: Joi.string().required().allow(null),
                        hotTubAvailability: Joi.string().required().allow(null),
                        firePlaceNotes: Joi.string().required().allow(null),
                        firepitNotes: Joi.string().required().allow(null),
                        firepitType: Joi.string().required().allow(null),
                        gameConsoleType: Joi.string().required().allow(null),
                        gameConsoleNotes: Joi.string().required().allow(null),
                        safeBoxLocationInstructions: Joi.string().required().allow(null),
                        gymPrivacy: Joi.string().required().allow(null),
                        gymNotes: Joi.string().required().allow(null),
                        saunaPrivacy: Joi.string().required().allow(null),
                        saunaNotes: Joi.string().required().allow(null),
                        exerciseEquipmentTypes: Joi.string().required().allow(null),
                        exerciseEquipmentNotes: Joi.string().required().allow(null),
                        golfType: Joi.string().required().allow(null),
                        golfNotes: Joi.string().required().allow(null),
                        basketballPrivacy: Joi.string().required().allow(null),
                        basketballNotes: Joi.string().required().allow(null),
                        tennisPrivacy: Joi.string().required().allow(null),
                        tennisNotes: Joi.string().required().allow(null),
                        workspaceLocation: Joi.string().required().allow(null),
                        workspaceInclusion: Joi.string().required().allow(null),
                        workspaceNotes: Joi.string().required().allow(null),
                        boatDockPrivacy: Joi.string().required().allow(null),
                        boatDockNotes: Joi.string().required().allow(null),
                        heatControlInstructions: Joi.string().required().allow(null),
                        locationOfThemostat: Joi.string().required().allow(null),
                        securityCameraLocations: Joi.string().required().allow(null),
                        coffeeMakerType: Joi.string().required().allow(null),
                        carbonMonoxideDetectorLocation: Joi.string().required().allow(null),
                        smokeDetectorLocation: Joi.string().required().allow(null),
                        fireExtinguisherLocation: Joi.string().required().allow(null),
                        firstAidKitLocation: Joi.string().required().allow(null),
                        emergencyExitLocation: Joi.string().required().allow(null),



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

export const validateUpdateListingInfo = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().required(),
                address: Joi.string().optional(),
                streetAddress: Joi.string().optional().allow(null),
                unitNumber: Joi.string().optional().allow(null),
                city: Joi.string().optional().allow(null),
                state: Joi.string().optional().allow(null),
                country: Joi.string().optional().allow(null),
                zipCode: Joi.string().optional().allow(null),
                latitude: Joi.number().optional().allow(null),
                longitude: Joi.number().optional().allow(null),
                listingId: Joi.string().optional().allow(null),
                onboarding: Joi.object({
                    listing: Joi.object({
                        //Listing Name
                        internalListingName: Joi.string().optional().allow(null),
                        externalListingName: Joi.string().optional().allow(null),

                        //General
                        propertyTypeId: Joi.string().optional().allow(null),
                        noOfFloors: Joi.number().optional().allow(null),
                        unitFloor: Joi.string().optional().allow(null),
                        squareMeters: Joi.number().optional().allow(null),
                        squareFeet: Joi.number().optional().allow(null),
                        personCapacity: Joi.number().optional().allow(null),

                        //Bedrooms
                        roomType: Joi.string().optional().allow(null),
                        bedroomsNumber: Joi.number().optional().allow(null),
                        bedroomNotes: Joi.string().optional().allow(null),
                        chargeForExtraGuests: Joi.boolean().optional().allow(null),
                        guestsIncluded: Joi.number().optional().allow(null),
                        priceForExtraPerson: Joi.number().optional().allow(null),
                        extraGuestFeeType: Joi.string().optional().allow(null).valid("Per Guest", "Per Guest/Night"),

                        propertyBedTypes: Joi.array().optional().min(1).allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else create new
                                floorLevel: Joi.number().optional().allow(null),
                                bedroomNumber: Joi.number().optional().allow(null),
                                beds: Joi.array().optional().allow(null).items(
                                    Joi.object({
                                        bedTypeId: Joi.string().optional().allow(null),
                                        quantity: Joi.number().optional().allow(null),
                                        airMattressSize: Joi.string().optional().allow(null),
                                        upperBunkSize: Joi.string().optional().allow(null),
                                        lowerBunkSize: Joi.string().optional().allow(null)
                                    })
                                )
                            })
                        ),

                        // Bathrooms
                        bathroomType: Joi.string().optional().valid("private", "shared").allow(null),
                        bathroomsNumber: Joi.number().optional().allow(null), // Number of Full Baths
                        guestBathroomsNumber: Joi.number().optional().allow(null), // Number of Half Baths
                        bathroomNotes: Joi.string().optional().allow(null),

                        //bathroom location and types
                        propertyBathroomLocation: Joi.array().optional().min(1).allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                floorLevel: Joi.number().optional().allow(null),
                                bathroomType: Joi.string().optional().valid("Full", "Half").allow(null),
                                bathroomNumber: Joi.number().optional().allow(null),
                                ensuite: Joi.number().optional().allow(null),
                                bathroomFeatures: Joi.string().optional().allow(null),
                                privacyType: Joi.string().optional().allow(null)
                            })
                        ),

                        //Listing Information
                        checkInTimeStart: Joi.number().optional().allow(null),
                        checkOutTime: Joi.number().optional().allow(null),
                        canAnyoneBookAnytime: Joi.string().optional().allow(null).valid(
                            "Yes, no restrictions. (Recommended)",
                            "Yes, but please notify me of SAME DAY bookings/changes before accepting",
                            "Yes, but please notify me if booking/changes is within 1 DAY of check-in/adjustment",
                            "No, please always confirm with me before accepting",
                            "No, I auto-decline reservations if check-in is within x number of days from today"
                        ),
                        bookingAcceptanceNoticeNotes: Joi.string().optional().allow(null),

                        //house rules
                        allowPartiesAndEvents: Joi.boolean().optional().allow(null),
                        allowSmoking: Joi.boolean().optional().allow(null),
                        allowPets: Joi.boolean().optional().allow(null),
                        petFee: Joi.number().optional().allow(null),
                        petFeeType: Joi.string().optional().allow(null).valid("Per Stay", "Per Pet", "Per Pet/Night"),
                        numberOfPetsAllowed: Joi.number().optional().allow(null),
                        petRestrictionsNotes: Joi.string().optional().allow(null),
                        allowChildreAndInfants: Joi.boolean().optional().allow(null),
                        childrenInfantsRestrictionReason: Joi.string().optional().allow(null),
                        allowLuggageDropoffBeforeCheckIn: Joi.boolean().optional().allow(null),
                        otherHouseRules: Joi.string().optional().allow(null),

                        //parking
                        parking: Joi.array().min(1).optional().allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                parkingType: Joi.string().valid(
                                    "Street Parking",
                                    "Driveaway",
                                    "Garage",
                                    "In-building Facility",
                                    "Valet Parking",
                                    "No Parking Available"
                                ).required(),
                                parkingFee: Joi.number().optional().allow(null),
                                parkingFeeType: Joi.string().optional().valid("Per Night", "Per Stay").allow(null),
                                numberOfParkingSpots: Joi.number().optional().allow(null),
                            })
                        ),
                        parkingInstructions: Joi.string().optional().allow(null),

                        //Property Access
                        checkInProcess: Joi.array().min(1).optional().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "Smartlock",
                                        "Keypad",
                                        "Lockbox",
                                        "Doorman",
                                        "Host Check-In",
                                        "Other Check-In"
                                    )
                            ),
                        doorLockType: Joi.array().min(1).optional().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "Smart Lock (w/app)",
                                        "Smart Lock (w/o app)",
                                        "Lockbox",
                                        "Deadbolt Lock",
                                        "In-Person Check-in"
                                    ),
                            ),
                        doorLockCodeType: Joi.string().optional().allow(null)
                            .valid(
                                "Unique",
                                "Standard"
                            ),
                        codeResponsibleParty: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging", "Request consideration"),
                        responsibilityToSetDoorCodes: Joi.boolean().optional().allow(null),
                        standardDoorCode: Joi.string().optional().allow(null),
                        doorLockAppName: Joi.string().optional().allow(null),
                        doorLockAppUsername: Joi.string().optional().allow(null),
                        doorLockAppPassword: Joi.string().optional().allow(null),
                        lockboxLocation: Joi.string().optional().allow(null),
                        lockboxCode: Joi.string().optional().allow(null),
                        doorLockInstructions: Joi.string().optional().allow(null),
                        emergencyBackUpCode: Joi.string().optional().allow(null),

                        //Waste Management
                        wasteCollectionDays: Joi.string().optional().allow(null),
                        wasteBinLocation: Joi.string().optional().allow(null),
                        wasteManagementInstructions: Joi.string().optional().allow(null),

                        //additional services/upsells
                        propertyUpsells: Joi.array().min(1).optional().allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                upsellName: Joi.string().optional(),
                                allowUpsell: Joi.boolean().optional(),
                                fee: Joi.number().optional().allow(null),
                                feeType: Joi.string().optional().valid("Free", "Standard", "Per Hour", "Daily", "Daily (Required for whole stay)"),
                                maxAdditionalHours: Joi.number().optional().allow(null),
                                notes: Joi.string().optional().allow(null)
                            })
                        ),
                        additionalServiceNotes: Joi.string().optional().allow(null),

                        //Special Instructions for Guests
                        checkInInstructions: Joi.string().optional().allow(null),
                        checkOutInstructions: Joi.string().optional().allow(null),

                        //Contractors/Vendor Management
                        vendorManagement: Joi.object({

                            //Cleaner
                            cleanerManagedBy: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging", "Property Owner & Luxury Lodging", "Others"),
                            cleanerManagedByReason: Joi.string().optional().allow(null),
                            hasCurrentCleaner: Joi.string().optional().allow(null)
                                .valid(
                                    "Yes",
                                    "Yes, but I'd like to request for a new cleaner",
                                    "No, please source a cleaner for me"
                                ),
                            hasCurrentCleanerReason: Joi.string().optional().allow(null),
                            cleaningFee: Joi.number().optional().allow(null),
                            cleanerName: Joi.string().optional().allow(null),
                            cleanerPhone: Joi.string().optional().allow(null),
                            cleanerEmail: Joi.string().optional().allow(null),

                            acknowledgeCleanerResponsibility: Joi.boolean().optional().allow(null),
                            acknowledgeCleanerResponsibilityReason: Joi.string().optional().allow(null),
                            ensureCleanersScheduled: Joi.boolean().optional().allow(null),
                            ensureCleanersScheduledReason: Joi.string().optional().allow(null),
                            propertyCleanedBeforeNextCheckIn: Joi.boolean().optional().allow(null),
                            propertyCleanedBeforeNextCheckInReason: Joi.string().optional().allow(null),
                            luxuryLodgingReadyAssumption: Joi.boolean().optional().allow(null),
                            luxuryLodgingReadyAssumptionReason: Joi.string().optional().allow(null),
                            requestCalendarAccessForCleaner: Joi.boolean().optional().allow(null),
                            requestCalendarAccessForCleanerReason: Joi.string().optional().allow(null),
                            cleaningTurnoverNotes: Joi.string().optional().allow(null),

                            //Restocking Supplies
                            restockingSuppliesManagedBy: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging", "Property Owner & Luxury Lodging", "Others"),
                            restockingSuppliesManagedByReason: Joi.string().optional().allow(null),
                            supplyClosetLocation: Joi.string().optional().allow(null),
                            supplyClosetCode: Joi.string().optional().allow(null),
                            luxuryLodgingRestockWithoutApproval: Joi.boolean().optional().allow(null),
                            luxuryLodgingConfirmBeforePurchase: Joi.boolean().optional().allow(null),
                            suppliesToRestock: Joi.array().optional().allow(null).items(
                                Joi.object({
                                    id: Joi.number().optional().allow(null), // if id is passed then update else if id is not present then create
                                    supplyName: Joi.string().required(),
                                    notes: Joi.string().optional().allow(null, ""),
                                })
                            ),

                            //Other Contractors/Vendors
                            vendorInfo: Joi.array().optional().allow(null).items(
                                Joi.object({
                                    id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                    role: Joi.string().when('id', {
                                        is: Joi.exist(),
                                        then: Joi.optional(),
                                        otherwise: Joi.required()
                                    }),
                                    workCategory: Joi.string().optional(), // kept for backward compatibility
                                    managedBy: Joi.string().required().valid("Property Owner", "Luxury Lodging", "Property Owner & Luxury Lodging", "Others"),
                                    name: Joi.string().required().allow(null),
                                    contact: Joi.string().required().allow(null),
                                    email: Joi.string().required().allow(null),
                                    scheduleType: Joi.string().required().valid(
                                        "weekly", "bi-weekly", "monthly", "quarterly", "annually", "check-out basis", "as required"
                                    ).allow(null),
                                    intervalMonth: Joi.number().integer().min(1).max(12).required().allow(null),
                                    dayOfWeek: Joi.array().items(Joi.number().integer().min(0).max(6).required()).allow(null),
                                    weekOfMonth: Joi.number().integer().min(1).max(5).required().allow(null),
                                    dayOfMonth: Joi.number().integer().min(1).max(32).required().allow(null),
                                    notes: Joi.string().optional().allow(null),
                                })
                            ),
                            addtionalVendorManagementNotes: Joi.string().optional().allow(null),
                            acknowledgeMaintenanceResponsibility: Joi.boolean().optional().allow(null),
                            authorizeLuxuryLodgingAction: Joi.boolean().optional().allow(null),
                            acknowledgeExpensesBilledToStatement: Joi.boolean().optional().allow(null),
                        }).optional().allow(null),

                        //Management
                        specialInstructions: Joi.string().optional().allow(null).valid(
                            "Yes, no restrictions. (Recommended)",
                            "Yes, but please notify me of SAME DAY bookings/changes before accepting",
                            "Yes, but please notify me if booking/changes is within 1 DAY of check-in/adjustment",
                            "No, please always confirm with me before accepting",
                            "No, auto-decline reservations if check-in is within x number of days from today"
                        ),
                        leadTimeDays: Joi.number().optional().allow(null),
                        bookingAcceptanceNotes: Joi.string().optional().allow(null),
                        managementNotes: Joi.string().optional().allow(null),
                        acknowledgeNoGuestContact: Joi.boolean().optional().allow(null),
                        acknowledgeNoPropertyAccess: Joi.boolean().optional().allow(null),
                        acknowledgeNoDirectTransactions: Joi.boolean().optional().allow(null),

                        //Financials
                        minPrice: Joi.number().optional().allow(null),
                        minNights: Joi.number().optional().allow(null),
                        maxNights: Joi.number().optional().allow(null),
                        propertyLicenseNumber: Joi.string().optional().allow(null, ""),
                        tax: Joi.string().optional().allow(null),
                        financialNotes: Joi.string().optional().allow(null),

                        //Standard Booking Settings
                        instantBooking: Joi.boolean().optional().allow(null),
                        instantBookingNotes: Joi.string().optional().allow(null),
                        minimumAdvanceNotice: Joi.boolean().optional().allow(null),
                        minimumAdvanceNoticeNotes: Joi.string().optional().allow(null),
                        preparationDays: Joi.boolean().optional().allow(null),
                        preparationDaysNotes: Joi.string().optional().allow(null),
                        bookingWindow: Joi.boolean().optional().allow(null),
                        bookingWindowNotes: Joi.string().optional().allow(null),
                        minimumStay: Joi.boolean().optional().allow(null),
                        minimumStayNotes: Joi.string().optional().allow(null),
                        maximumStay: Joi.boolean().optional().allow(null),
                        maximumStayNotes: Joi.string().optional().allow(null),

                        //amenities
                        amenities: Joi.array().items(Joi.string()).min(1).optional().allow(null),
                        acknowledgeAmenitiesAccurate: Joi.boolean().optional().allow(null),
                        acknowledgeSecurityCamerasDisclosed: Joi.boolean().optional().allow(null),
                        otherAmenities: Joi.string().optional().allow(null),
                        wifiAvailable: Joi.string().optional().allow(null).valid("Yes", "No"),
                        wifiUsername: Joi.string().optional().allow(null),
                        wifiPassword: Joi.string().optional().allow(null),
                        wifiSpeed: Joi.string().optional().allow(null),
                        locationOfModem: Joi.string().optional().allow(null),
                        ethernetCable: Joi.boolean().optional().allow(null),
                        pocketWifi: Joi.boolean().optional().allow(null),
                        paidWifi: Joi.boolean().optional().allow(null),
                        swimmingPoolNotes: Joi.string().optional().allow(null),
                        hotTubInstructions: Joi.string().optional().allow(null),
                        hotTubPrivacy: Joi.string().optional().allow(null),
                        hotTubAvailability: Joi.string().optional().allow(null),
                        firePlaceNotes: Joi.string().optional().allow(null),
                        firepitNotes: Joi.string().optional().allow(null),
                        firepitType: Joi.string().optional().allow(null),
                        gameConsoleType: Joi.string().optional().allow(null),
                        gameConsoleNotes: Joi.string().optional().allow(null),
                        safeBoxLocationInstructions: Joi.string().optional().allow(null),
                        gymPrivacy: Joi.string().optional().allow(null),
                        gymNotes: Joi.string().optional().allow(null),
                        saunaPrivacy: Joi.string().optional().allow(null),
                        saunaNotes: Joi.string().optional().allow(null),
                        exerciseEquipmentTypes: Joi.string().optional().allow(null),
                        exerciseEquipmentNotes: Joi.string().optional().allow(null),
                        golfType: Joi.string().optional().allow(null),
                        golfNotes: Joi.string().optional().allow(null),
                        basketballPrivacy: Joi.string().optional().allow(null),
                        basketballNotes: Joi.string().optional().allow(null),
                        tennisPrivacy: Joi.string().optional().allow(null),
                        tennisNotes: Joi.string().optional().allow(null),
                        workspaceLocation: Joi.string().optional().allow(null),
                        workspaceInclusion: Joi.string().optional().allow(null),
                        workspaceNotes: Joi.string().optional().allow(null),
                        boatDockPrivacy: Joi.string().optional().allow(null),
                        boatDockNotes: Joi.string().optional().allow(null),
                        heatControlInstructions: Joi.string().optional().allow(null),
                        locationOfThemostat: Joi.string().optional().allow(null),
                        securityCameraLocations: Joi.string().optional().allow(null),
                        coffeeMakerType: Joi.string().optional().allow(null),
                        carbonMonoxideDetectorLocation: Joi.string().optional().allow(null),
                        smokeDetectorLocation: Joi.string().optional().allow(null),
                        fireExtinguisherLocation: Joi.string().optional().allow(null),
                        firstAidKitLocation: Joi.string().optional().allow(null),
                        emergencyExitLocation: Joi.string().optional().allow(null),
                    }).optional()
                }).optional()
            })
        )
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateUpdateFinancialsInternalForm = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().required(),
                address: Joi.string().optional(), // if this is available then only update the address else ignore
                listingId: Joi.string().optional().allow(null),
                onboarding: Joi.object({
                    financials: Joi.object({
                        minPriceWeekday: Joi.number().optional().allow(null),
                        minPriceWeekend: Joi.number().optional().allow(null),
                        minNightsWeekday: Joi.number().optional().allow(null),
                        minNightsWeekend: Joi.number().optional().allow(null),
                        maxNights: Joi.number().optional().allow(null),
                        propertyLicenseNumber: Joi.string().optional().allow(null, ""),
                        tax: Joi.string().optional().allow(null),
                        financialNotes: Joi.string().optional().allow(null),
                        minimumStay: Joi.boolean().optional().allow(null),
                        maximumStay: Joi.boolean().optional().allow(null),
                        pricingStrategyPreference: Joi.string().optional().allow(null),
                        minimumNightsRequiredByLaw: Joi.string().optional().allow(null),
                        statementSchedule: Joi.string().optional().valid("Weekly", "Bi-Weekly Batch A", "Bi-Weekly Batch B", "Monthly").allow(null),
                        statementType: Joi.string().optional().valid("Check-Out", "Check-In", "Calendar").allow(null),
                        payoutMethod: Joi.string().optional().valid("Bank Transfer", "Zelle", "Venmo", "Others").allow(null),
                        claimFee: Joi.string().optional().valid("Yes", "No").allow(null),
                        claimFeeNotes: Joi.string().optional().allow(null),
                        techFee: Joi.string().optional().valid("Yes", "No").allow(null),
                        techFeeNotes: Joi.string().optional().allow(null),
                        onboardingFee: Joi.string().optional().valid("Yes", "No").allow(null),
                        onboardingFeeAmountAndConditions: Joi.string().optional().allow(null),
                        offboardingFee: Joi.string().optional().valid("Yes", "No").allow(null),
                        offboardingFeeAmountAndConditions: Joi.string().optional().allow(null),
                        payoutSchdule: Joi.string().optional().valid("Monthly", "Bi-weekly", "Weekly").allow(null),
                        taxesAddedum: Joi.string().optional().valid("Yes", "No").allow(null),
                    }).required()
                }).required()
            })
        )
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
}

export const validateUpdateManagementInternalForm = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().required(),
                address: Joi.string().optional(), // if this is available then only update the address else ignore
                listingId: Joi.string().optional().allow(null),
                onboarding: Joi.object({
                    listing: Joi.object({
                        //calendar management
                        canAnyoneBookAnytime: Joi.string().optional().allow(null).valid(
                            "Yes, no restrictions. (Recommended)",
                            "Yes, but please notify me of SAME DAY bookings/changes before accepting",
                            "Yes, but please notify me if booking/changes is within 1 DAY of check-in/adjustment",
                            "No, please always confirm with me before accepting",
                            "No, I auto-decline reservations if check-in is within x number of days from today"
                        ),
                        bookingAcceptanceNoticeNotes: Joi.string().optional().allow(null),
                        leadTimeDays: Joi.number().optional().allow(null),
                        calendarManagementNotes: Joi.string().optional().allow(null),

                        // Reservation Management
                        checkInTimeStart: Joi.number().optional().allow(null),
                        checkInTimeEnd: Joi.number().optional().allow(null),
                        checkOutTime: Joi.number().optional().allow(null),

                        //parking
                        parking: Joi.array().min(1).optional().allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                parkingType: Joi.string().valid(
                                    "Street Parking",
                                    "Driveaway",
                                    "Garage",
                                    "In-building Facility",
                                    "Valet Parking",
                                    "No Parking Available"
                                ).required(),
                                parkingFee: Joi.number().optional().allow(null),
                                parkingFeeType: Joi.string().optional().valid("Per Night", "Per Stay").allow(null),
                                numberOfParkingSpots: Joi.number().optional().allow(null),
                            })
                        ),
                        parkingInstructions: Joi.string().optional().allow(null),

                        //Property Access
                        checkInProcess: Joi.array().min(1).optional().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "Smartlock",
                                        "Keypad",
                                        "Lockbox",
                                        "Doorman",
                                        "Host Check-In",
                                        "Other Check-In"
                                    )
                            ),
                        doorLockType: Joi.array().min(1).optional().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "Smart Lock (w/app)",
                                        "Smart Lock (w/o app)",
                                        "Lockbox",
                                        "Deadbolt Lock",
                                        "In-Person Check-in"
                                    ),
                            ),
                        doorLockCodeType: Joi.string().optional().allow(null)
                            .valid(
                                "Unique",
                                "Standard"
                            ),
                        codeResponsibleParty: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging", "Request consideration"),
                        responsibilityToSetDoorCodes: Joi.boolean().optional().allow(null),
                        standardDoorCode: Joi.string().optional().allow(null),
                        doorLockAppName: Joi.string().optional().allow(null),
                        doorLockAppUsername: Joi.string().optional().allow(null),
                        doorLockAppPassword: Joi.string().optional().allow(null),
                        lockboxLocation: Joi.string().optional().allow(null),
                        lockboxCode: Joi.string().optional().allow(null),
                        doorLockInstructions: Joi.string().optional().allow(null),
                        emergencyBackUpCode: Joi.string().optional().allow(null),


                        //Waste Management
                        wasteCollectionDays: Joi.string().optional().allow(null),
                        wasteBinLocation: Joi.string().optional().allow(null),
                        wasteManagementInstructions: Joi.string().optional().allow(null),

                        //additional services/upsells
                        propertyUpsells: Joi.array().min(1).optional().allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                upsellName: Joi.string().optional(),
                                allowUpsell: Joi.boolean().optional(),
                                feeType: Joi.string().optional().valid("Free", "Standard", "Per Hour", "Daily", "Daily (Required for whole stay)"),
                                fee: Joi.number().optional().allow(null),
                                maxAdditionalHours: Joi.number().optional().allow(null),
                                notes: Joi.string().optional().allow(null)
                            })
                        ),
                        additionalServiceNotes: Joi.string().optional().allow(null),


                        //Special Instructions for Guests
                        checkInInstructions: Joi.string().optional().allow(null),
                        checkOutInstructions: Joi.string().optional().allow(null),


                        //house rules
                        allowPartiesAndEvents: Joi.boolean().optional().allow(null),
                        allowSmoking: Joi.boolean().optional().allow(null),
                        allowPets: Joi.boolean().optional().allow(null),
                        petFee: Joi.number().optional().allow(null),
                        petFeeType: Joi.string().optional().allow(null).valid("Per Stay", "Per Pet", "Per Pet/Night"),
                        numberOfPetsAllowed: Joi.number().optional().allow(null),
                        petRestrictionsNotes: Joi.string().optional().allow(null),
                        allowChildreAndInfants: Joi.boolean().optional().allow(null),
                        childrenInfantsRestrictionReason: Joi.string().optional().allow(null),
                        allowLuggageDropoffBeforeCheckIn: Joi.boolean().optional().allow(null),
                        otherHouseRules: Joi.string().optional().allow(null),

                        //WiFi
                        wifiAvailable: Joi.string().optional().allow(null).valid("Yes", "No"),
                        wifiUsername: Joi.string().optional().allow(null),
                        wifiPassword: Joi.string().optional().allow(null),
                        wifiSpeed: Joi.string().optional().allow(null),
                        locationOfModem: Joi.string().optional().allow(null),
                        ethernetCable: Joi.boolean().optional().allow(null),
                        pocketWifi: Joi.boolean().optional().allow(null),
                        paidWifi: Joi.boolean().optional().allow(null),

                        //Contractors/Vendor Management
                        vendorManagement: Joi.object({

                            //Cleaner
                            cleanerManagedBy: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging", "Property Owner & Luxury Lodging", "Others"),
                            cleanerManagedByReason: Joi.string().optional().allow(null),
                            hasCurrentCleaner: Joi.string().optional().allow(null)
                                .valid(
                                    "Yes",
                                    "Yes, but I'd like to request for a new cleaner",
                                    "No, please source a cleaner for me"
                                ),
                            hasCurrentCleanerReason: Joi.string().optional().allow(null),
                            cleaningFee: Joi.number().optional().allow(null),
                            cleanerName: Joi.string().optional().allow(null),
                            cleanerPhone: Joi.string().optional().allow(null),
                            cleanerEmail: Joi.string().optional().allow(null),

                            acknowledgeCleanerResponsibility: Joi.boolean().optional().allow(null),
                            acknowledgeCleanerResponsibilityReason: Joi.string().optional().allow(null),
                            ensureCleanersScheduled: Joi.boolean().optional().allow(null),
                            ensureCleanersScheduledReason: Joi.string().optional().allow(null),
                            propertyCleanedBeforeNextCheckIn: Joi.boolean().optional().allow(null),
                            propertyCleanedBeforeNextCheckInReason: Joi.string().optional().allow(null),
                            luxuryLodgingReadyAssumption: Joi.boolean().optional().allow(null),
                            luxuryLodgingReadyAssumptionReason: Joi.string().optional().allow(null),
                            requestCalendarAccessForCleaner: Joi.boolean().optional().allow(null),
                            requestCalendarAccessForCleanerReason: Joi.string().optional().allow(null),
                            cleaningTurnoverNotes: Joi.string().optional().allow(null),

                            //Restocking Supplies
                            restockingSuppliesManagedBy: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging", "Property Owner & Luxury Lodging", "Others"),
                            restockingSuppliesManagedByReason: Joi.string().optional().allow(null),
                            supplyClosetLocation: Joi.string().optional().allow(null),
                            supplyClosetCode: Joi.string().optional().allow(null),
                            luxuryLodgingRestockWithoutApproval: Joi.boolean().optional().allow(null),
                            luxuryLodgingConfirmBeforePurchase: Joi.boolean().optional().allow(null),
                            suppliesToRestock: Joi.array().optional().allow(null).items(
                                Joi.object({
                                    id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                    supplyName: Joi.string().required(),
                                    notes: Joi.string().optional().allow(null, ""),
                                })
                            ),

                            //Maintenance
                            maintenanceManagedBy: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging", "Property Owner & Luxury Lodging", "Others"),
                            maintenanceManagedByReason: Joi.string().optional().allow(null),

                            //Other Contractors/Vendors
                            vendorInfo: Joi.array().optional().allow(null).items(
                                Joi.object({
                                    id: Joi.number().optional().allow(null), // if id is passed then update else if id is not present then create
                                    role: Joi.string().when('id', {
                                        is: Joi.exist(),
                                        then: Joi.optional(),
                                        otherwise: Joi.required()
                                    }),
                                    workCategory: Joi.string().optional(), // kept for backward compatibility
                                    managedBy: Joi.string().required().valid("Property Owner", "Luxury Lodging", "Property Owner & Luxury Lodging", "Others"),
                                    name: Joi.string().required().allow(null),
                                    contact: Joi.string().required().allow(null),
                                    email: Joi.string().required().allow(null),
                                    scheduleType: Joi.string().required().valid(
                                        "weekly", "bi-weekly", "monthly", "quarterly", "annually", "check-out basis", "as required"
                                    ).allow(null),
                                    intervalMonth: Joi.number().integer().min(1).max(12).required().allow(null),
                                    dayOfWeek: Joi.array().items(Joi.number().integer().min(0).max(6).required()).allow(null),
                                    weekOfMonth: Joi.number().integer().min(1).max(5).required().allow(null),
                                    dayOfMonth: Joi.number().integer().min(1).max(32).required().allow(null),
                                    notes: Joi.string().optional().allow(null),
                                })
                            ),
                            addtionalVendorManagementNotes: Joi.string().optional().allow(null),
                            acknowledgeMaintenanceResponsibility: Joi.boolean().optional().allow(null),
                            authorizeLuxuryLodgingAction: Joi.boolean().optional().allow(null),
                            acknowledgeExpensesBilledToStatement: Joi.boolean().optional().allow(null),
                            acknowledgeNoGuestContact: Joi.boolean().optional().allow(null),
                            acknowledgeNoPropertyAccess: Joi.boolean().optional().allow(null),
                            acknowledgeNoDirectTransactions: Joi.boolean().optional().allow(null),
                        }).optional().allow(null),

                        //Standard Booking Settings
                        instantBooking: Joi.boolean().optional().allow(null),
                        instantBookingNotes: Joi.string().optional().allow(null),
                        minimumAdvanceNotice: Joi.boolean().optional().allow(null),
                        minimumAdvanceNoticeNotes: Joi.string().optional().allow(null),
                        preparationDays: Joi.boolean().optional().allow(null),
                        preparationDaysNotes: Joi.string().optional().allow(null),
                        bookingWindow: Joi.boolean().optional().allow(null),
                        bookingWindowNotes: Joi.string().optional().allow(null),
                        minimumStay: Joi.boolean().optional().allow(null),
                        minimumStayNotes: Joi.string().optional().allow(null),
                        maximumStay: Joi.boolean().optional().allow(null),
                        maximumStayNotes: Joi.string().optional().allow(null),

                        //Management Notes
                        managementNotes: Joi.string().optional().allow(null),
                        acknowledgeNoGuestContact: Joi.boolean().optional().allow(null),
                        acknowledgeNoPropertyAccess: Joi.boolean().optional().allow(null),
                        acknowledgeNoDirectTransactions: Joi.boolean().optional().allow(null),
                    }).required()
                }).required()
            })
        )
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
}



export const validateSaveOnboardingDetailsClientForm = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().optional(), // if the id is passed then update else if id is not present then create
                address: Joi.string().required(),
                streetAddress: Joi.string().optional().allow(null),
                unitNumber: Joi.string().optional().allow(null),
                city: Joi.string().optional().allow(null),
                state: Joi.string().optional().allow(null),
                country: Joi.string().optional().allow(null),
                zipCode: Joi.string().optional().allow(null),
                latitude: Joi.number().optional().allow(null),
                longitude: Joi.number().optional().allow(null),
                onboarding: Joi.object({
                    listing: Joi.object({
                        targetLiveDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).required().allow(null),
                        targetStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).required().allow(null),
                        acknowledgePropertyReadyByStartDate: Joi.boolean().required().allow(null),
                        agreesUnpublishExternalListings: Joi.boolean().required().allow(null),
                        upcomingReservations: Joi.string().required().allow(null),
                        onboardingCallSchedule: Joi.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).messages({
                            'string.pattern.base': 'DateTime must be in the format "yyyy-mm-dd HH:mm"',
                        }).optional().allow(null),
                        externalListingNotes: Joi.string().required().allow(null),
                        acknowledgesResponsibilityToInform: Joi.boolean().required().allow(null),
                    }),
                    photography: Joi.object({
                        photographyNotes: Joi.string().required().allow(null),
                    }).optional()
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


export const validateUpdateOnboardingDetailsClientForm = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().optional(), // if the id is passed then update else if id is not present then create
                address: Joi.string().optional(),
                streetAddress: Joi.string().optional().allow(null),
                unitNumber: Joi.string().optional().allow(null),
                city: Joi.string().optional().allow(null),
                state: Joi.string().optional().allow(null),
                country: Joi.string().optional().allow(null),
                zipCode: Joi.string().optional().allow(null),
                latitude: Joi.number().optional().allow(null),
                longitude: Joi.number().optional().allow(null),
                onboarding: Joi.object({
                    listing: Joi.object({
                        targetLiveDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        targetStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        acknowledgePropertyReadyByStartDate: Joi.boolean().optional().allow(null),
                        agreesUnpublishExternalListings: Joi.boolean().optional().allow(null),
                        upcomingReservations: Joi.string().optional().allow(null),
                        onboardingCallSchedule: Joi.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).messages({
                            'string.pattern.base': 'DateTime must be in the format "yyyy-mm-dd HH:mm"',
                        }).optional().allow(null),
                        targetDateNotes: Joi.string().optional().allow(null),
                        acknowledgesResponsibilityToInform: Joi.boolean().optional().allow(null),
                    }).optional(),
                    photography: Joi.object({
                        photographyNotes: Joi.string().optional().allow(null),
                    }).optional()
                }).optional()
            })
        )
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateSaveListingDetailsClientForm = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().required(),
                address: Joi.string().required(),
                onboarding: Joi.object({
                    serviceInfo: Joi.object({
                        managementFee: Joi.number().required().allow(null),
                        serviceType: Joi.string().required().valid("LAUNCH", "PRO", "FULL"),
                    }),
                    listing: Joi.object({
                        //General
                        propertyTypeId: Joi.number().required().allow(null),
                        noOfFloors: Joi.number().required().allow(null),
                        squareMeters: Joi.number().required().allow(null),
                        squareFeet: Joi.number().optional().allow(null),
                        personCapacity: Joi.number().required().allow(null),

                        //Bedrooms
                        roomType: Joi.string().required().allow(null),
                        listingType: Joi.string().optional().allow(null), // alias for roomType
                        bedroomsNumber: Joi.number().required().allow(null),
                        bedroomNotes: Joi.string().optional().allow(null),
                        chargeForExtraGuests: Joi.boolean().optional().allow(null),
                        guestsIncluded: Joi.number().optional().allow(null),
                        priceForExtraPerson: Joi.number().optional().allow(null),
                        extraGuestFeeType: Joi.string().optional().allow(null).valid("Per Guest", "Per Guest/Night"),

                        propertyBedTypes: Joi.array().required().min(1).allow(null).items(
                            Joi.object({
                                floorLevel: Joi.number().optional().allow(null),
                                bedroomNumber: Joi.number().optional().allow(null),
                                beds: Joi.array().optional().allow(null).items(
                                    Joi.object({
                                        bedTypeId: Joi.string().optional().allow(null),
                                        quantity: Joi.number().optional().allow(null),
                                        airMattressSize: Joi.string().optional().allow(null),
                                        upperBunkSize: Joi.string().optional().allow(null),
                                        lowerBunkSize: Joi.string().optional().allow(null)
                                    })
                                )
                            })
                        ),

                        // Bathrooms
                        bathroomType: Joi.string().required().valid("private", "shared").allow(null),
                        bathroomsNumber: Joi.number().required().allow(null), // Number of Full Baths
                        guestBathroomsNumber: Joi.number().required().allow(null), // Number of Half Baths
                        bathroomNotes: Joi.string().optional().allow(null),

                        //Listing Information
                        checkInTimeStart: Joi.number().required().allow(null),
                        checkOutTime: Joi.number().required().allow(null),
                        canAnyoneBookAnytime: Joi.string().required().allow(null).valid(
                            "Yes, no restrictions. (Recommended)",
                            "Yes, but please notify me of SAME DAY bookings/changes before accepting",
                            "Yes, but please notify me if booking/changes is within 1 DAY of check-in/adjustment",
                            "No, please always confirm with me before accepting",
                            "No, I auto-decline reservations if check-in is within x number of days from today"
                        ),
                        bookingAcceptanceNoticeNotes: Joi.string().required().allow(null),

                        //house rules
                        allowPartiesAndEvents: Joi.boolean().required().allow(null),
                        allowSmoking: Joi.boolean().required().allow(null),
                        allowPets: Joi.boolean().required().allow(null),
                        petFee: Joi.number().required().allow(null),
                        petFeeType: Joi.string().required().allow(null).valid("Per Stay", "Per Pet", "Per Pet/Night"),
                        numberOfPetsAllowed: Joi.number().required().allow(null),
                        petRestrictionsNotes: Joi.string().required().allow(null),
                        allowChildreAndInfants: Joi.boolean().required().allow(null),
                        allowLuggageDropoffBeforeCheckIn: Joi.boolean().required().allow(null),
                        otherHouseRules: Joi.string().required().allow(null),

                        //parking
                        parkingType: Joi.array().min(1).required().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "Street Parking",
                                        "Driveaway",
                                        "Garage",
                                        "In-building Facility",
                                        "Valet Parking",
                                        "No Parking Available"
                                    )
                            ),
                        parkingFee: Joi.number().required().allow(null),
                        numberOfParkingSpots: Joi.number().required().allow(null),
                        parkingInstructions: Joi.string().required().allow(null),

                        //Property Access
                        checkInProcess: Joi.array().min(1).required().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "24-hr checkin",
                                        "In person Check-in",
                                        "Doorman"
                                    )
                            ),
                        doorLockType: Joi.array().min(1).required().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "Smart Lock (w/app)",
                                        "Smart Lock (w/o app)",
                                        "Lockbox",
                                        "Deadbolt Lock",
                                        "In-Person Check-in"
                                    ),
                            ),
                        doorLockCodeType: Joi.string().required().allow(null)
                            .valid(
                                "Unique",
                                "Standard"
                            ),
                        codeResponsibleParty: Joi.string().required().allow(null).valid("Property Owner", "Luxury Lodging"),
                        doorLockAppName: Joi.string().required().allow(null),
                        doorLockAppUsername: Joi.string().required().allow(null),
                        doorLockAppPassword: Joi.string().required().allow(null),
                        lockboxLocation: Joi.string().required().allow(null),
                        lockboxCode: Joi.string().required().allow(null),
                        doorLockInstructions: Joi.string().required().allow(null),
                        emergencyBackUpCode: Joi.string().optional().allow(null),

                        //Waste Management
                        wasteCollectionDays: Joi.string().required().allow(null),
                        wasteBinLocation: Joi.string().required().allow(null),
                        wasteManagementInstructions: Joi.string().required().allow(null),

                        //additional services/upsells
                        propertyUpsells: Joi.array().min(1).required().allow(null).items(
                            Joi.object({
                                upsellName: Joi.string().required(),
                                allowUpsell: Joi.boolean().required(),
                                feeType: Joi.string().required().valid("Free", "Standard", "Per Hour", "Daily", "Daily (Required for whole stay)"),
                                maxAdditionalHours: Joi.number().required().allow(null)
                            })
                        ),
                        additionalServiceNotes: Joi.string().required().allow(null),


                        //amenities
                        amenities: Joi.array().items(Joi.string()).min(1).required().allow(null),
                        acknowledgeAmenitiesAccurate: Joi.boolean().required().allow(null),
                        acknowledgeSecurityCamerasDisclosed: Joi.boolean().required().allow(null),
                        otherAmenities: Joi.string().required().allow(null),
                        wifiUsername: Joi.string().required().allow(null),
                        wifiPassword: Joi.string().required().allow(null),
                        wifiSpeed: Joi.string().required().allow(null),
                        locationOfModem: Joi.string().required().allow(null),
                        swimmingPoolNotes: Joi.string().required().allow(null),
                        hotTubInstructions: Joi.string().required().allow(null),
                        hotTubPrivacy: Joi.string().required().allow(null),
                        hotTubAvailability: Joi.string().required().allow(null),
                        firePlaceNotes: Joi.string().required().allow(null),
                        firepitNotes: Joi.string().required().allow(null),
                        firepitType: Joi.string().required().allow(null),
                        gameConsoleType: Joi.string().required().allow(null),
                        gameConsoleNotes: Joi.string().required().allow(null),
                        safeBoxLocationInstructions: Joi.string().required().allow(null),
                        gymPrivacy: Joi.string().required().allow(null),
                        gymNotes: Joi.string().required().allow(null),
                        saunaPrivacy: Joi.string().required().allow(null),
                        saunaNotes: Joi.string().required().allow(null),
                        exerciseEquipmentTypes: Joi.string().required().allow(null),
                        exerciseEquipmentNotes: Joi.string().required().allow(null),
                        golfType: Joi.string().required().allow(null),
                        golfNotes: Joi.string().required().allow(null),
                        basketballPrivacy: Joi.string().required().allow(null),
                        basketballNotes: Joi.string().required().allow(null),
                        tennisPrivacy: Joi.string().required().allow(null),
                        tennisNotes: Joi.string().required().allow(null),
                        workspaceLocation: Joi.string().required().allow(null),
                        workspaceInclusion: Joi.string().required().allow(null),
                        workspaceNotes: Joi.string().required().allow(null),
                        boatDockPrivacy: Joi.string().required().allow(null),
                        boatDockNotes: Joi.string().required().allow(null),
                        heatControlInstructions: Joi.string().required().allow(null),
                        locationOfThemostat: Joi.string().required().allow(null),
                        securityCameraLocations: Joi.string().required().allow(null),
                        coffeeMakerType: Joi.string().required().allow(null),
                        carbonMonoxideDetectorLocation: Joi.string().required().allow(null),
                        smokeDetectorLocation: Joi.string().required().allow(null),
                        fireExtinguisherLocation: Joi.string().required().allow(null),
                        firstAidKitLocation: Joi.string().required().allow(null),
                        emergencyExitLocation: Joi.string().required().allow(null),



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

export const validateUpdateListingDetailsClientForm = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().required(),
                address: Joi.string().optional(),
                streetAddress: Joi.string().optional().allow(null),
                unitNumber: Joi.string().optional().allow(null),
                city: Joi.string().optional().allow(null),
                state: Joi.string().optional().allow(null),
                country: Joi.string().optional().allow(null),
                zipCode: Joi.string().optional().allow(null),
                latitude: Joi.number().optional().allow(null),
                longitude: Joi.number().optional().allow(null),
                listingId: Joi.string().optional().allow(null, ""),
                onboarding: Joi.object({
                    serviceInfo: Joi.object({
                        managementFee: Joi.number().optional().allow(null),
                        serviceType: Joi.string().optional().valid("LAUNCH", "PRO", "FULL", null),
                    }).optional(),
                    listing: Joi.object({
                        //General
                        propertyTypeId: Joi.string().optional().allow(null),
                        noOfFloors: Joi.number().optional().allow(null),
                        unitFloor: Joi.string().optional().allow(null),
                        squareMeters: Joi.number().optional().allow(null),
                        squareFeet: Joi.number().optional().allow(null),
                        personCapacity: Joi.number().optional().allow(null),

                        //Bedrooms
                        roomType: Joi.string().optional().allow(null),
                        listingType: Joi.string().optional().allow(null), // alias for roomType
                        bedroomsNumber: Joi.number().optional().allow(null),
                        bedroomNotes: Joi.string().optional().allow(null),
                        chargeForExtraGuests: Joi.boolean().optional().allow(null),
                        guestsIncluded: Joi.number().optional().allow(null),
                        priceForExtraPerson: Joi.number().optional().allow(null),
                        extraGuestFeeType: Joi.string().optional().allow(null).valid("Per Guest", "Per Guest/Night"),

                        propertyBedTypes: Joi.array().optional().min(1).allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                floorLevel: Joi.number().optional().allow(null),
                                bedroomNumber: Joi.number().optional().allow(null),
                                beds: Joi.array().optional().allow(null).items(
                                    Joi.object({
                                        bedTypeId: Joi.string().optional().allow(null),
                                        quantity: Joi.number().optional().allow(null),
                                        airMattressSize: Joi.string().optional().allow(null),
                                        upperBunkSize: Joi.string().optional().allow(null),
                                        lowerBunkSize: Joi.string().optional().allow(null)
                                    })
                                )
                            })
                        ),

                        // Bathrooms
                        bathroomType: Joi.string().optional().valid("private", "shared").allow(null),
                        bathroomsNumber: Joi.number().optional().allow(null), // Number of Full Baths
                        guestBathroomsNumber: Joi.number().optional().allow(null), // Number of Half Baths
                        bathroomNotes: Joi.string().optional().allow(null),

                        //bathroom location and types
                        propertyBathroomLocation: Joi.array().optional().min(1).allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                floorLevel: Joi.number().optional().allow(null),
                                bathroomType: Joi.string().optional().valid("Full", "Half").allow(null),
                                bathroomNumber: Joi.number().optional().allow(null),
                                ensuite: Joi.number().optional().allow(null),
                                bathroomFeatures: Joi.string().optional().allow(null),
                                privacyType: Joi.string().optional().allow(null)
                            })
                        ),

                        
                        //Listing Information
                        checkInTimeStart: Joi.number().optional().allow(null),
                        checkOutTime: Joi.number().optional().allow(null),
                        canAnyoneBookAnytime: Joi.string().optional().allow(null).valid(
                            "Yes, no restrictions. (Recommended)",
                            "Yes, but please notify me of SAME DAY bookings/changes before accepting",
                            "Yes, but please notify me if booking/changes is within 1 DAY of check-in/adjustment",
                            "No, please always confirm with me before accepting",
                            "No, I auto-decline reservations if check-in is within x number of days from today"
                        ),
                        bookingAcceptanceNoticeNotes: Joi.string().optional().allow(null),

                        //house rules
                        allowPartiesAndEvents: Joi.boolean().optional().allow(null),
                        allowSmoking: Joi.boolean().optional().allow(null),
                        allowPets: Joi.boolean().optional().allow(null),
                        petFee: Joi.number().optional().allow(null),
                        petFeeType: Joi.string().optional().allow(null).valid("Per Stay", "Per Pet", "Per Pet/Night"),
                        numberOfPetsAllowed: Joi.number().optional().allow(null),
                        petRestrictionsNotes: Joi.string().optional().allow(null),
                        allowChildreAndInfants: Joi.boolean().optional().allow(null),
                        childrenInfantsRestrictionReason: Joi.string().optional().allow(null),
                        allowLuggageDropoffBeforeCheckIn: Joi.boolean().optional().allow(null),
                        otherHouseRules: Joi.string().optional().allow(null),

                        //parking
                        parking: Joi.array().min(1).optional().allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                parkingType: Joi.string().valid(
                                    "Street Parking",
                                    "Driveaway",
                                    "Garage",
                                    "In-building Facility",
                                    "Valet Parking",
                                    "No Parking Available"
                                ).required().allow(null),
                                parkingFee: Joi.number().optional().allow(null),
                                parkingFeeType: Joi.string().optional().valid("Per Night", "Per Stay").allow(null),
                                numberOfParkingSpots: Joi.number().optional().allow(null),
                            })
                        ),
                        parkingInstructions: Joi.string().optional().allow(null),

                        //Property Access
                        checkInProcess: Joi.array().min(1).optional().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "Smartlock",
                                        "Keypad",
                                        "Lockbox",
                                        "Doorman",
                                        "Host Check-In",
                                        "Other Check-In"
                                    )
                            ),
                        doorLockType: Joi.array().min(1).optional().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "Smart Lock (w/app)",
                                        "Smart Lock (w/o app)",
                                        "Lockbox",
                                        "Deadbolt Lock",
                                        "In-Person Check-in"
                                    ),
                            ),
                        doorLockCodeType: Joi.string().optional().allow(null)
                            .valid(
                                "Unique",
                                "Standard"
                            ),
                        codeResponsibleParty: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging", "Request consideration"),
                        responsibilityToSetDoorCodes: Joi.boolean().optional().allow(null),
                        standardDoorCode: Joi.string().optional().allow(null),
                        doorLockAppName: Joi.string().optional().allow(null),
                        doorLockAppUsername: Joi.string().optional().allow(null),
                        doorLockAppPassword: Joi.string().optional().allow(null),
                        lockboxLocation: Joi.string().optional().allow(null),
                        lockboxCode: Joi.string().optional().allow(null),
                        doorLockInstructions: Joi.string().optional().allow(null),
                        emergencyBackUpCode: Joi.string().optional().allow(null),

                        //Waste Management
                        wasteCollectionDays: Joi.string().optional().allow(null),
                        wasteBinLocation: Joi.string().optional().allow(null),
                        wasteManagementInstructions: Joi.string().optional().allow(null),

                        //additional services/upsells
                        propertyUpsells: Joi.array().min(1).optional().allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                upsellName: Joi.string().optional().allow(null),
                                allowUpsell: Joi.boolean().optional().allow(null),
                                feeType: Joi.string().optional().valid("Free", "Standard", "Per Hour", "Daily", "Daily (Required for whole stay)").allow(null),
                                fee: Joi.number().optional().allow(null),
                                maxAdditionalHours: Joi.number().optional().allow(null),
                                notes: Joi.string().optional().allow(null)
                            })
                        ),
                        additionalServiceNotes: Joi.string().optional().allow(null),


                        //Special Instructions for Guests
                        checkInInstructions: Joi.string().optional().allow(null),
                        checkOutInstructions: Joi.string().optional().allow(null),

                        //Contractors/Vendor Management
                        vendorManagement: Joi.object({

                            //Cleaner
                            cleanerManagedBy: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging", "Property Owner & Luxury Lodging", "Others"),
                            cleanerManagedByReason: Joi.string().optional().allow(null),
                            hasCurrentCleaner: Joi.string().optional().allow(null)
                                .valid(
                                    "Yes",
                                    "Yes, but I'd like to request for a new cleaner",
                                    "No, please source a cleaner for me"
                                ),
                            hasCurrentCleanerReason: Joi.string().optional().allow(null),
                            cleaningFee: Joi.number().optional().allow(null),
                            cleanerName: Joi.string().optional().allow(null),
                            cleanerPhone: Joi.string().optional().allow(null),
                            cleanerEmail: Joi.string().optional().allow(null),

                            acknowledgeCleanerResponsibility: Joi.boolean().optional().allow(null),
                            acknowledgeCleanerResponsibilityReason: Joi.string().optional().allow(null),
                            ensureCleanersScheduled: Joi.boolean().optional().allow(null),
                            ensureCleanersScheduledReason: Joi.string().optional().allow(null),
                            propertyCleanedBeforeNextCheckIn: Joi.boolean().optional().allow(null),
                            propertyCleanedBeforeNextCheckInReason: Joi.string().optional().allow(null),
                            luxuryLodgingReadyAssumption: Joi.boolean().optional().allow(null),
                            luxuryLodgingReadyAssumptionReason: Joi.string().optional().allow(null),
                            requestCalendarAccessForCleaner: Joi.boolean().optional().allow(null),
                            requestCalendarAccessForCleanerReason: Joi.string().optional().allow(null),
                            cleaningTurnoverNotes: Joi.string().optional().allow(null),

                            //Restocking Supplies
                            restockingSuppliesManagedBy: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging", "Property Owner & Luxury Lodging", "Others"),
                            restockingSuppliesManagedByReason: Joi.string().optional().allow(null),
                            supplyClosetLocation: Joi.string().optional().allow(null),
                            supplyClosetCode: Joi.string().optional().allow(null),
                            luxuryLodgingRestockWithoutApproval: Joi.boolean().optional().allow(null),
                            luxuryLodgingConfirmBeforePurchase: Joi.boolean().optional().allow(null),
                            suppliesToRestock: Joi.array().optional().allow(null).items(
                                Joi.object({
                                    id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                    supplyName: Joi.string().required(),
                                    notes: Joi.string().optional().allow(null, ""),
                                })
                            ),

                            //Maintenance
                            maintenanceManagedBy: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging", "Property Owner & Luxury Lodging", "Others"),
                            maintenanceManagedByReason: Joi.string().optional().allow(null),

                            //Other Contractors/Vendors
                            vendorInfo: Joi.array().optional().allow(null).items(
                                Joi.object({
                                    id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                    role: Joi.string().when('id', {
                                        is: Joi.exist(),
                                        then: Joi.optional(),
                                        otherwise: Joi.required()
                                    }),
                                    workCategory: Joi.string().optional(), // kept for backward compatibility
                                    managedBy: Joi.string().required().valid("Property Owner", "Luxury Lodging", "Property Owner & Luxury Lodging", "Others"),
                                    name: Joi.string().required().allow(null),
                                    contact: Joi.string().required().allow(null),
                                    email: Joi.string().required().allow(null),
                                    scheduleType: Joi.string().required().valid(
                                        "weekly", "bi-weekly", "monthly", "quarterly", "annually", "check-out basis", "as required"
                                    ).allow(null),
                                    intervalMonth: Joi.number().integer().min(1).max(12).required().allow(null),
                                    dayOfWeek: Joi.array().items(Joi.number().integer().min(0).max(6).required()).allow(null),
                                    weekOfMonth: Joi.number().integer().min(1).max(5).required().allow(null),
                                    dayOfMonth: Joi.number().integer().min(1).max(32).required().allow(null),
                                    notes: Joi.string().optional().allow(null),
                                })
                            ),
                            addtionalVendorManagementNotes: Joi.string().optional().allow(null),
                            acknowledgeMaintenanceResponsibility: Joi.boolean().optional().allow(null),
                            authorizeLuxuryLodgingAction: Joi.boolean().optional().allow(null),
                            acknowledgeExpensesBilledToStatement: Joi.boolean().optional().allow(null),
                        }).optional().allow(null),

                        //Management
                        specialInstructions: Joi.string().optional().allow(null).valid(
                            "Yes, no restrictions. (Recommended)",
                            "Yes, but please notify me of SAME DAY bookings/changes before accepting",
                            "Yes, but please notify me if booking/changes is within 1 DAY of check-in/adjustment",
                            "No, please always confirm with me before accepting",
                            "No, auto-decline reservations if check-in is within x number of days from today"
                        ),
                        leadTimeDays: Joi.number().optional().allow(null),
                        bookingAcceptanceNotes: Joi.string().optional().allow(null),

                        //Standard Booking Settings
                        instantBooking: Joi.boolean().optional().allow(null),
                        instantBookingNotes: Joi.string().optional().allow(null),
                        minimumAdvanceNotice: Joi.boolean().optional().allow(null),
                        minimumAdvanceNoticeNotes: Joi.string().optional().allow(null),
                        preparationDays: Joi.boolean().optional().allow(null),
                        preparationDaysNotes: Joi.string().optional().allow(null),
                        bookingWindow: Joi.boolean().optional().allow(null),
                        bookingWindowNotes: Joi.string().optional().allow(null),
                        minimumStay: Joi.boolean().optional().allow(null),
                        minimumStayNotes: Joi.string().optional().allow(null),
                        maximumStay: Joi.boolean().optional().allow(null),
                        maximumStayNotes: Joi.string().optional().allow(null),

                        //Management Notes
                        managementNotes: Joi.string().optional().allow(null),
                        acknowledgeNoGuestContact: Joi.boolean().optional().allow(null),
                        acknowledgeNoPropertyAccess: Joi.boolean().optional().allow(null),
                        acknowledgeNoDirectTransactions: Joi.boolean().optional().allow(null),

                        //Financials
                        minPriceWeekday: Joi.number().optional().allow(null),
                        minPriceWeekend: Joi.number().optional().allow(null),
                        minNightsWeekday: Joi.number().optional().allow(null),
                        minNightsWeekend: Joi.number().optional().allow(null),
                        maxNights: Joi.number().optional().allow(null),
                        pricingStrategyPreference: Joi.string().optional().allow(null),
                        minimumNightsRequiredByLaw: Joi.string().optional().allow(null).valid("Yes", "No"),
                        propertyLicenseNumber: Joi.string().optional().allow(null, ""),
                        tax: Joi.string().optional().allow(null),
                        financialNotes: Joi.string().optional().allow(null),

                        //amenities
                        amenities: Joi.array().items(Joi.string()).min(1).optional().allow(null),
                        acknowledgeAmenitiesAccurate: Joi.boolean().optional().allow(null),
                        acknowledgeSecurityCamerasDisclosed: Joi.boolean().optional().allow(null),
                        otherAmenities: Joi.string().optional().allow(null),
                        wifiAvailable: Joi.string().optional().allow(null).valid("Yes", "No"),
                        wifiUsername: Joi.string().optional().allow(null),
                        wifiPassword: Joi.string().optional().allow(null),
                        wifiSpeed: Joi.string().optional().allow(null),
                        locationOfModem: Joi.string().optional().allow(null),
                        ethernetCable: Joi.boolean().optional().allow(null),
                        pocketWifi: Joi.boolean().optional().allow(null),
                        paidWifi: Joi.boolean().optional().allow(null),
                        swimmingPoolNotes: Joi.string().optional().allow(null),
                        hotTubInstructions: Joi.string().optional().allow(null),
                        hotTubPrivacy: Joi.string().optional().allow(null),
                        hotTubAvailability: Joi.string().optional().allow(null),
                        firePlaceNotes: Joi.string().optional().allow(null),
                        firepitNotes: Joi.string().optional().allow(null),
                        firepitType: Joi.string().optional().allow(null),
                        gameConsoleType: Joi.string().optional().allow(null),
                        gameConsoleNotes: Joi.string().optional().allow(null),
                        safeBoxLocationInstructions: Joi.string().optional().allow(null),
                        gymPrivacy: Joi.string().optional().allow(null),
                        gymNotes: Joi.string().optional().allow(null),
                        saunaPrivacy: Joi.string().optional().allow(null),
                        saunaNotes: Joi.string().optional().allow(null),
                        exerciseEquipmentTypes: Joi.string().optional().allow(null),
                        exerciseEquipmentNotes: Joi.string().optional().allow(null),
                        golfType: Joi.string().optional().allow(null),
                        golfNotes: Joi.string().optional().allow(null),
                        basketballPrivacy: Joi.string().optional().allow(null),
                        basketballNotes: Joi.string().optional().allow(null),
                        tennisPrivacy: Joi.string().optional().allow(null),
                        tennisNotes: Joi.string().optional().allow(null),
                        workspaceLocation: Joi.string().optional().allow(null),
                        workspaceInclusion: Joi.string().optional().allow(null),
                        workspaceNotes: Joi.string().optional().allow(null),
                        boatDockPrivacy: Joi.string().optional().allow(null),
                        boatDockNotes: Joi.string().optional().allow(null),
                        heatControlInstructions: Joi.string().optional().allow(null),
                        locationOfThemostat: Joi.string().optional().allow(null),
                        securityCameraLocations: Joi.string().optional().allow(null),
                        coffeeMakerType: Joi.string().optional().allow(null),
                        carbonMonoxideDetectorLocation: Joi.string().optional().allow(null),
                        smokeDetectorLocation: Joi.string().optional().allow(null),
                        fireExtinguisherLocation: Joi.string().optional().allow(null),
                        firstAidKitLocation: Joi.string().optional().allow(null),
                        emergencyExitLocation: Joi.string().optional().allow(null),
                    }).optional()
                }).optional()
            })
        )
    });

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};

export const validateSubmitAllClientForms = (request: Request, response: Response, next: NextFunction) => {
    // This validation allows all three data objects to be optional or null
    // The individual service methods will validate their respective data
    const schema = Joi.object({
        clientData: Joi.object().optional().allow(null),
        onboardingData: Joi.object().optional().allow(null),
        listingData: Joi.object().optional().allow(null),
    }).min(1); // At least one of the three must be present

    const { error } = schema.validate(request.body);
    if (error) {
        return next(error);
    }
    next();
};