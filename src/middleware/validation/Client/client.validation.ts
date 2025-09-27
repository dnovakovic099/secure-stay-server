import { max } from "date-fns";
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
        properties: Joi.array().items(Joi.number().required()).allow(null),
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
            timezone: Joi.string().required(),
            companyName: Joi.string().required().allow(null, ''),
            status: Joi.string().required().valid("onboarding", "active", "atRisk", "offboarding", "offboarded").allow(null, ''),
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
                status: Joi.string().required().valid("onboarding", "active", "atRisk", "offboarding", "offboarded").allow(null, ''),
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
        status: Joi.array().items(Joi.string().valid("onboarding", "active", "atRisk", "offboarding", "offboarded")).optional(),
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

export const validateUpdatePropertyOnboarding = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().optional(), // if the id is passed then update else if the id is not passed then create
                address: Joi.string().optional(),
                onboarding: Joi.object({
                    serviceInfo: Joi.object({
                        managementFee: Joi.number().optional().allow(null),
                        serviceType: Joi.string().optional().valid("LAUNCH", "PRO", "FULL", null),
                        contractLink: Joi.string().optional().allow(null),
                        serviceNotes: Joi.string().optional().allow(null)
                    }).optional(),
                    sales: Joi.object({
                        salesRepresentative: Joi.string().optional().allow(null),
                        salesNotes: Joi.string().optional().allow(null),
                        projectedRevenue: Joi.number().optional().allow(null),
                    }).optional(),
                    listing: Joi.object({
                        clientCurrentListingLink: Joi.array().items(Joi.string()).min(1).allow(null),
                        listingOwner: Joi.string().optional().allow(null).valid("Luxury Lodging", "Client"),
                        clientListingStatus: Joi.string().optional().allow(null).valid("Closed", "Open - Will Close", "Open - Keeping"),
                        targetLiveDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        targetStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).optional().allow(null),
                        targetDateNotes: Joi.string().optional().allow(null),
                        upcomingReservations: Joi.string().optional().allow(null),
                    }).optional(),
                    photography: Joi.object({
                        photographyCoverage: Joi.string().optional().allow(null)
                            .valid("Yes (Covered by Luxury Lodging)", "Yes (Covered by Client)", "No"),
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


export const validateSaveOnboardingDetails = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().optional(), // if the id is passed then update else if the id is not passed then create
                address: Joi.string().required(),
                onboarding: Joi.object({
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
                        actualLiveDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).required().allow(null),
                        actualStartDate: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).messages({
                            'string.pattern.base': 'Date must be in the format "yyyy-mm-dd"',
                        }).required().allow(null),
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

export const validateUpdateOnboardingDetails = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().required(),
                address: Joi.string().optional(),
                onboarding: Joi.object({
                    sales: Joi.object({
                        salesRepresentative: Joi.string().optional().allow(null),
                        salesNotes: Joi.string().optional().allow(null),
                        projectedRevenue: Joi.number().optional().allow(null),
                    }).optional(),
                    listing: Joi.object({
                        clientCurrentListingLink: Joi.array().items(Joi.string()).min(1).allow(null),
                        listingOwner: Joi.string().optional().allow(null).valid("Luxury Lodging", "Client"),
                        clientListingStatus: Joi.string().optional().allow(null).valid("Closed", "Open - Will Close", "Open - Keeping"),
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
                    }).optional(),
                    photography: Joi.object({
                        photographyCoverage: Joi.string().optional().allow(null)
                            .valid("Yes (Covered by Luxury Lodging)", "Yes (Covered by Client)", "No"),
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
                        propertyTypeId: Joi.number().required().allow(null),
                        noOfFloors: Joi.number().required().allow(null),
                        squareMeters: Joi.number().required().allow(null),
                        personCapacity: Joi.number().required().allow(null),

                        //Bedrooms
                        roomType: Joi.string().required().allow(null),
                        bedroomsNumber: Joi.number().required().allow(null),

                        propertyBedTypes: Joi.array().required().min(1).allow(null).items(
                            Joi.object({
                                floorLevel: Joi.string().required(),
                                bedroomNumber: Joi.number().required(),
                                bedTypeId: Joi.number().required(),
                                quantity: Joi.number().required()
                            })
                        ),

                        // Bathrooms
                        bathroomType: Joi.string().required().valid("private", "shared").allow(null),
                        bathroomsNumber: Joi.number().required().allow(null), // Number of Full Baths
                        guestBathroomsNumber: Joi.number().required().allow(null), // Number of Half Baths

                        //Listing Information
                        checkInTimeStart: Joi.number().required().allow(null),
                        checkOutTime: Joi.number().required().allow(null),
                        canAnyoneBookAnytime: Joi.string().required().allow(null).valid(
                            "Yes, no restrictions. (Recommended)",
                            "Yes, but please notify me of same day bookings and changes before accepting",
                            "No, please confirm with me before accepting",
                            "No, I strictly need days befor a reservation"
                        ),
                        bookingAcceptanceNoticeNotes: Joi.string().required().allow(null),

                        //house rules
                        allowPartiesAndEvents: Joi.boolean().required().allow(null),
                        allowSmoking: Joi.boolean().required().allow(null),
                        allowPets: Joi.boolean().required().allow(null),
                        petFee: Joi.number().required().allow(null),
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
                        wifiUsername: Joi.string().required().allow(null),
                        wifiPassword: Joi.string().required().allow(null),
                        wifiSpeed: Joi.string().required().allow(null),
                        locationOfModem: Joi.string().required().allow(null),
                        swimmingPoolNotes: Joi.string().required().allow(null),
                        hotTubInstructions: Joi.string().required().allow(null),



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
                onboarding: Joi.object({
                    listing: Joi.object({
                        //Listing Name
                        internalListingName: Joi.string().optional().allow(null),
                        externalListingName: Joi.string().optional().allow(null),

                        //General
                        propertyTypeId: Joi.number().optional().allow(null),
                        noOfFloors: Joi.number().optional().allow(null),
                        squareMeters: Joi.number().optional().allow(null),
                        personCapacity: Joi.number().optional().allow(null),

                        //Bedrooms
                        roomType: Joi.string().optional().allow(null),
                        bedroomsNumber: Joi.number().optional().allow(null),

                        propertyBedTypes: Joi.array().optional().min(1).allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else create new
                                floorLevel: Joi.number().optional(),
                                bedroomNumber: Joi.number().optional(),
                                bedTypeId: Joi.number().optional(),
                                quantity: Joi.number().optional()
                            })
                        ),

                        // Bathrooms
                        bathroomType: Joi.string().optional().valid("private", "shared").allow(null),
                        bathroomsNumber: Joi.number().optional().allow(null), // Number of Full Baths
                        guestBathroomsNumber: Joi.number().optional().allow(null), // Number of Half Baths

                        //bathroom location and types
                        propertyBathroomLocation: Joi.array().optional().min(1).allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                floorLevel: Joi.number().optional().allow(null),
                                bathroomType: Joi.number().optional().valid("Full", "Half"),
                                bathroomNumber: Joi.number().optional(),
                                ensuite: Joi.number().optional().allow(null),
                            })
                        ),

                        //Listing Information
                        checkInTimeStart: Joi.number().optional().allow(null),
                        checkOutTime: Joi.number().optional().allow(null),
                        canAnyoneBookAnytime: Joi.string().optional().allow(null).valid(
                            "Yes, no restrictions. (Recommended)",
                            "Yes, but please notify me of same day bookings and changes before accepting",
                            "No, please confirm with me before accepting",
                            "No, I strictly need days befor a reservation"
                        ),
                        bookingAcceptanceNoticeNotes: Joi.string().optional().allow(null),

                        //house rules
                        allowPartiesAndEvents: Joi.boolean().optional().allow(null),
                        allowSmoking: Joi.boolean().optional().allow(null),
                        allowPets: Joi.boolean().optional().allow(null),
                        petFee: Joi.number().optional().allow(null),
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
                                numberOfParkingSpots: Joi.number().optional().allow(null),
                            })
                        ),
                        parkingInstructions: Joi.string().optional().allow(null),

                        //Property Access
                        checkInProcess: Joi.array().min(1).optional().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "24-hr checkin",
                                        "In person Check-in",
                                        "Doorman"
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
                        codeResponsibleParty: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging"),
                        responsibilityToSetDoorCodes: Joi.boolean().optional().allow(null),
                        doorLockAppName: Joi.string().optional().allow(null),
                        doorLockAppUsername: Joi.string().optional().allow(null),
                        doorLockAppPassword: Joi.string().optional().allow(null),
                        lockboxLocation: Joi.string().optional().allow(null),
                        lockboxCode: Joi.string().optional().allow(null),
                        doorLockInstructions: Joi.string().optional().allow(null),

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
                                maxAdditionalHours: Joi.number().optional().allow(null)
                            })
                        ),
                        additionalServiceNotes: Joi.string().optional().allow(null),

                        //Special Instructions for Guests
                        checkInInstructions: Joi.string().optional().allow(null),
                        checkOutInstructions: Joi.string().optional().allow(null),

                        //Contractors/Vendor Management
                        vendorManagement: Joi.object({

                            //Cleaner
                            cleanerManagedBy: Joi.string().optional().allow(null).valid("Luxury Lodging", "Client"),
                            cleanerManagedByReason: Joi.string().optional().allow(null),
                            hasCurrentCleaner: Joi.string().optional().allow(null)
                                .valid(
                                    "Yes-Continue Current Cleaner",
                                    "Yes-Switch Different Cleaner",
                                    "No-Find New Cleaner",
                                    "Yes",
                                    "No"
                                ),
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
                            cleaningTurnoverNotes: Joi.string().optional().allow(null),

                            //Restocking Supplies
                            restockingSuppliesManagedBy: Joi.string().optional().allow(null).valid("Luxury Lodging", "Client"),
                            restockingSuppliesManagedByReason: Joi.string().optional().allow(null),
                            luxuryLodgingRestockWithoutApproval: Joi.boolean().optional().allow(null),
                            luxuryLodgingConfirmBeforePurchase: Joi.boolean().optional().allow(null),
                            suppliesToRestock: Joi.array().optional().allow(null).items(
                                Joi.object({
                                    id: Joi.optional().required(), // if id is passed then update else if id is not present then create
                                    supplyName: Joi.string().required(),
                                    notes: Joi.string().optional().allow(null),
                                })
                            ),

                            //Other Contractors/Vendors
                            vendorInfo: Joi.array().optional().allow(null).items(
                                Joi.object({
                                    id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                    workCategory: Joi.string().required(),
                                    managedBy: Joi.string().required().valid("Luxury Lodging", "Owner"),
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

                        //Financials
                        minPrice: Joi.number().optional().allow(null),
                        minNights: Joi.number().optional().allow(null),
                        maxNights: Joi.number().optional().allow(null),
                        propertyLicenseNumber: Joi.string().optional().allow(null),
                        tax: Joi.string().optional().allow(null),
                        financialNotes: Joi.string().optional().allow(null),

                        //amenities
                        amenities: Joi.array().items(Joi.string()).min(1).optional().allow(null),
                        wifiUsername: Joi.string().optional().allow(null),
                        wifiPassword: Joi.string().optional().allow(null),
                        wifiSpeed: Joi.string().optional().allow(null),
                        locationOfModem: Joi.string().optional().allow(null),
                        swimmingPoolNotes: Joi.string().optional().allow(null),
                        hotTubInstructions: Joi.string().optional().allow(null),
                        firePlaceNotes: Joi.string().optional().allow(null),
                        firepitNotes: Joi.string().optional().allow(null),
                        heatControlInstructions: Joi.string().optional().allow(null),
                        locationOfThemostat: Joi.string().optional().allow(null),
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
                onboarding: Joi.object({
                    financials: Joi.object({
                        minPrice: Joi.number().optional().allow(null),
                        minNights: Joi.number().optional().allow(null),
                        maxNights: Joi.number().optional().allow(null),
                        propertyLicenseNumber: Joi.string().optional().allow(null),
                        tax: Joi.string().optional().allow(null),
                        financialNotes: Joi.string().optional().allow(null),
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
                onboarding: Joi.object({
                    listing: Joi.object({
                        //calendar management
                        canAnyoneBookAnytime: Joi.string().optional().allow(null).valid(
                            "Yes, no restrictions. (Recommended)",
                            "Yes, but please notify me of same day bookings and changes before accepting",
                            "No, please confirm with me before accepting",
                            "No, I strictly need days befor a reservation"
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
                                numberOfParkingSpots: Joi.number().optional().allow(null),
                            })
                        ),
                        parkingInstructions: Joi.string().optional().allow(null),

                        //Property Access
                        checkInProcess: Joi.array().min(1).optional().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "24-hr checkin",
                                        "In person Check-in",
                                        "Doorman"
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
                        codeResponsibleParty: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging"),
                        responsibilityToSetDoorCodes: Joi.boolean().optional().allow(null),
                        doorLockAppName: Joi.string().optional().allow(null),
                        doorLockAppUsername: Joi.string().optional().allow(null),
                        doorLockAppPassword: Joi.string().optional().allow(null),
                        lockboxLocation: Joi.string().optional().allow(null),
                        lockboxCode: Joi.string().optional().allow(null),
                        doorLockInstructions: Joi.string().optional().allow(null),


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
                                maxAdditionalHours: Joi.number().optional().allow(null)
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
                        numberOfPetsAllowed: Joi.number().optional().allow(null),
                        petRestrictionsNotes: Joi.string().optional().allow(null),
                        allowChildreAndInfants: Joi.boolean().optional().allow(null),
                        childrenInfantsRestrictionReason: Joi.string().optional().allow(null),
                        allowLuggageDropoffBeforeCheckIn: Joi.boolean().optional().allow(null),
                        otherHouseRules: Joi.string().optional().allow(null),



                        //Contractors/Vendor Management
                        vendorManagement: Joi.object({

                            //Cleaner
                            cleanerManagedBy: Joi.string().optional().allow(null).valid("Luxury Lodging", "Client"),
                            cleanerManagedByReason: Joi.string().optional().allow(null),
                            hasCurrentCleaner: Joi.string().optional().allow(null)
                                .valid(
                                    "Yes-Continue Current Cleaner",
                                    "Yes-Switch Different Cleaner",
                                    "No-Find New Cleaner",
                                    "Yes",
                                    "No"
                                ),
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
                            cleaningTurnoverNotes: Joi.string().optional().allow(null),

                            //Restocking Supplies
                            restockingSuppliesManagedBy: Joi.string().optional().allow(null).valid("Luxury Lodging", "Client"),
                            restockingSuppliesManagedByReason: Joi.string().optional().allow(null),
                            luxuryLodgingRestockWithoutApproval: Joi.boolean().optional().allow(null),
                            luxuryLodgingConfirmBeforePurchase: Joi.boolean().optional().allow(null),
                            suppliesToRestock: Joi.array().optional().allow(null).items(
                                Joi.object({
                                    id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                    supplyName: Joi.string().required(),
                                    notes: Joi.string().optional().allow(null),
                                })
                            ),

                            //Other Contractors/Vendors
                            vendorInfo: Joi.array().optional().allow(null).items(
                                Joi.object({
                                    id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                    workCategory: Joi.string().required(),
                                    managedBy: Joi.string().required().valid("Luxury Lodging", "Owner"),
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
                            acknowledgeExpensesBilledToStatement: Joi.boolean().optional().allow(null),
                        }).optional().allow(null),

                        //Management Notes
                        managementNotes: Joi.string().optional().allow(null),
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
                        externalListingNotes: Joi.string().required().allow(null),
                        acknowledgesResponsibilityToInform: Joi.boolean().required().allow(null),
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


export const validateUpdateOnboardingDetailsClientForm = (request: Request, response: Response, next: NextFunction) => {
    const schema = Joi.object({
        clientId: Joi.string().required(),
        clientProperties: Joi.array().required().min(1).items(
            Joi.object({
                id: Joi.string().optional(), // if the id is passed then update else if id is not present then create
                address: Joi.string().optional(),
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
                        externalListingNotes: Joi.string().optional().allow(null),
                        acknowledgesResponsibilityToInform: Joi.boolean().optional().allow(null),
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
                        personCapacity: Joi.number().required().allow(null),

                        //Bedrooms
                        roomType: Joi.string().required().allow(null),
                        bedroomsNumber: Joi.number().required().allow(null),

                        propertyBedTypes: Joi.array().required().min(1).allow(null).items(
                            Joi.object({
                                floorLevel: Joi.string().required(),
                                bedroomNumber: Joi.number().required(),
                                bedTypeId: Joi.number().required(),
                                quantity: Joi.number().required()
                            })
                        ),

                        // Bathrooms
                        bathroomType: Joi.string().required().valid("private", "shared").allow(null),
                        bathroomsNumber: Joi.number().required().allow(null), // Number of Full Baths
                        guestBathroomsNumber: Joi.number().required().allow(null), // Number of Half Baths

                        //Listing Information
                        checkInTimeStart: Joi.number().required().allow(null),
                        checkOutTime: Joi.number().required().allow(null),
                        canAnyoneBookAnytime: Joi.string().required().allow(null).valid(
                            "Yes, no restrictions. (Recommended)",
                            "Yes, but please notify me of same day bookings and changes before accepting",
                            "No, please confirm with me before accepting",
                            "No, I strictly need days befor a reservation"
                        ),
                        bookingAcceptanceNoticeNotes: Joi.string().required().allow(null),

                        //house rules
                        allowPartiesAndEvents: Joi.boolean().required().allow(null),
                        allowSmoking: Joi.boolean().required().allow(null),
                        allowPets: Joi.boolean().required().allow(null),
                        petFee: Joi.number().required().allow(null),
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
                        wifiUsername: Joi.string().required().allow(null),
                        wifiPassword: Joi.string().required().allow(null),
                        wifiSpeed: Joi.string().required().allow(null),
                        locationOfModem: Joi.string().required().allow(null),
                        swimmingPoolNotes: Joi.string().required().allow(null),
                        hotTubInstructions: Joi.string().required().allow(null),



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
                onboarding: Joi.object({
                    serviceInfo: Joi.object({
                        managementFee: Joi.number().optional().allow(null),
                        serviceType: Joi.string().optional().valid("LAUNCH", "PRO", "FULL", null),
                    }).optional(),
                    listing: Joi.object({
                        //General
                        propertyTypeId: Joi.number().optional().allow(null),
                        noOfFloors: Joi.number().optional().allow(null),
                        squareMeters: Joi.number().optional().allow(null),
                        personCapacity: Joi.number().optional().allow(null),

                        //Bedrooms
                        roomType: Joi.string().optional().allow(null),
                        bedroomsNumber: Joi.number().optional().allow(null),

                        propertyBedTypes: Joi.array().optional().min(1).allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                floorLevel: Joi.number().optional(),
                                bedroomNumber: Joi.number().optional(),
                                bedTypeId: Joi.number().optional(),
                                quantity: Joi.number().optional()
                            })
                        ),

                        // Bathrooms
                        bathroomType: Joi.string().optional().valid("private", "shared").allow(null),
                        bathroomsNumber: Joi.number().optional().allow(null), // Number of Full Baths
                        guestBathroomsNumber: Joi.number().optional().allow(null), // Number of Half Baths

                        //bathroom location and types
                        propertyBathroomLocation: Joi.array().optional().min(1).allow(null).items(
                            Joi.object({
                                id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                floorLevel: Joi.number().optional().allow(null),
                                bathroomType: Joi.number().optional().valid("Full", "Half"),
                                bathroomNumber: Joi.number().optional(),
                                ensuite: Joi.number().optional().allow(null),
                            })
                        ),

                        
                        //Listing Information
                        checkInTimeStart: Joi.number().optional().allow(null),
                        checkOutTime: Joi.number().optional().allow(null),
                        canAnyoneBookAnytime: Joi.string().optional().allow(null).valid(
                            "Yes, no restrictions. (Recommended)",
                            "Yes, but please notify me of same day bookings and changes before accepting",
                            "No, please confirm with me before accepting",
                            "No, I strictly need days befor a reservation"
                        ),
                        bookingAcceptanceNoticeNotes: Joi.string().optional().allow(null),

                        //house rules
                        allowPartiesAndEvents: Joi.boolean().optional().allow(null),
                        allowSmoking: Joi.boolean().optional().allow(null),
                        allowPets: Joi.boolean().optional().allow(null),
                        petFee: Joi.number().optional().allow(null),
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
                                numberOfParkingSpots: Joi.number().optional().allow(null),
                            })
                        ),
                        parkingInstructions: Joi.string().optional().allow(null),

                        //Property Access
                        checkInProcess: Joi.array().min(1).optional().allow(null)
                            .items(
                                Joi.string()
                                    .valid(
                                        "24-hr checkin",
                                        "In person Check-in",
                                        "Doorman"
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
                        codeResponsibleParty: Joi.string().optional().allow(null).valid("Property Owner", "Luxury Lodging"),
                        responsibilityToSetDoorCodes: Joi.boolean().optional().allow(null),
                        doorLockAppName: Joi.string().optional().allow(null),
                        doorLockAppUsername: Joi.string().optional().allow(null),
                        doorLockAppPassword: Joi.string().optional().allow(null),
                        lockboxLocation: Joi.string().optional().allow(null),
                        lockboxCode: Joi.string().optional().allow(null),
                        doorLockInstructions: Joi.string().optional().allow(null),

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
                                maxAdditionalHours: Joi.number().optional().allow(null)
                            })
                        ),
                        additionalServiceNotes: Joi.string().optional().allow(null),


                        //Special Instructions for Guests
                        checkInInstructions: Joi.string().optional().allow(null),
                        checkOutInstructions: Joi.string().optional().allow(null),

                        //Contractors/Vendor Management
                        vendorManagement: Joi.object({

                            //Cleaner
                            cleanerManagedBy: Joi.string().optional().allow(null).valid("Luxury Lodging", "Client"),
                            cleanerManagedByReason: Joi.string().optional().allow(null),
                            hasCurrentCleaner: Joi.string().optional().allow(null)
                                .valid(
                                    "Yes-Continue Current Cleaner",
                                    "Yes-Switch Different Cleaner",
                                    "No-Find New Cleaner",
                                    "Yes",
                                    "No"
                                ),
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
                            cleaningTurnoverNotes: Joi.string().optional().allow(null),

                            //Restocking Supplies
                            restockingSuppliesManagedBy: Joi.string().optional().allow(null).valid("Luxury Lodging", "Client"),
                            restockingSuppliesManagedByReason: Joi.string().optional().allow(null),
                            luxuryLodgingRestockWithoutApproval: Joi.boolean().optional().allow(null),
                            luxuryLodgingConfirmBeforePurchase: Joi.boolean().optional().allow(null),
                            suppliesToRestock: Joi.array().optional().allow(null).items(
                                Joi.object({
                                    id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                    supplyName: Joi.string().required(),
                                    notes: Joi.string().optional().allow(null),
                                })
                            ),

                            //Other Contractors/Vendors
                            vendorInfo: Joi.array().optional().allow(null).items(
                                Joi.object({
                                    id: Joi.number().optional(), // if id is passed then update else if id is not present then create
                                    workCategory: Joi.string().required(),
                                    managedBy: Joi.string().required().valid("Luxury Lodging", "Owner"),
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

                        //Financials
                        minPrice: Joi.number().optional().allow(null),
                        minNights: Joi.number().optional().allow(null),
                        maxNights: Joi.number().optional().allow(null),
                        propertyLicenseNumber: Joi.string().optional().allow(null),
                        tax: Joi.string().optional().allow(null),
                        financialNotes: Joi.string().optional().allow(null),

                        //amenities
                        amenities: Joi.array().items(Joi.number()).min(1).optional().allow(null),
                        wifiUsername: Joi.string().optional().allow(null),
                        wifiPassword: Joi.string().optional().allow(null),
                        wifiSpeed: Joi.string().optional().allow(null),
                        locationOfModem: Joi.string().optional().allow(null),
                        swimmingPoolNotes: Joi.string().optional().allow(null),
                        hotTubInstructions: Joi.string().optional().allow(null),
                        firePlaceNotes: Joi.string().optional().allow(null),
                        firepitNotes: Joi.string().optional().allow(null),
                        heatControlInstructions: Joi.string().optional().allow(null),
                        locationOfThemostat: Joi.string().optional().allow(null),
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