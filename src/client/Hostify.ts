import axios from "axios";
import logger from "../utils/logger.utils";

export class Hostify {
    private apiKey: string = process.env.HOSTIFY_API_KEY || '';


    async getListings(apiKey: string) {
        try {
            const url = "https://api-rms.hostify.com/listings";
            const per_page = 100; // Max allowed per page
            let page = 1;
            let hasMore = true;
            const allListings: any[] = [];

            while (hasMore) {
                const response = await axios.get(url, {
                    headers: {
                        "x-api-key": apiKey,
                        "Cache-Control": "no-cache",
                    },
                    params: {
                        page,
                        per_page,
                    },
                });

                const listings = response.data?.listings || [];
                allListings.push(...listings);

                // If fewer than 'per_page' items are returned, we've reached the end
                if (listings.length < per_page) {
                    hasMore = false;
                } else {
                    page += 1;
                }
            }

            return allListings;
        } catch (error) {
            logger.error("Error fetching listings:", error.message);
            return [];
        }
    }

    async getListingDetails(apiKey: string, listingId: string) {
        try {
            const url = `https://api-rms.hostify.com/listings/${listingId}`;

            const response = await axios.get(url, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
                params: {
                    include_related_objects: 1,
                },
            });

            return response.data || null;
        } catch (error) {
            logger.error(`Error fetching details for listing ${listingId}:`, error.message);
            return null;
        }
    }

    async getReservations(filter: any, apiKey: string) {
        try {
            const url = "https://api-rms.hostify.com/reservations";
            const per_page = 100; // Max allowed per page
            let page = 1;
            let hasMore = true;
            const reservations: any[] = [];

            while (hasMore) {
                const response = await axios.get(url, {
                    headers: {
                        "x-api-key": apiKey,
                        "Cache-Control": "no-cache",
                    },
                    params: {
                        page,
                        per_page,
                        ...filter
                    },
                });

                const fetchedReservations = response.data?.reservations || [];
                reservations.push(...fetchedReservations);

                // If fewer than 'per_page' items are returned, we've reached the end
                if (fetchedReservations.length < per_page) {
                    hasMore = false;
                } else {
                    page += 1;
                }
            }

            return reservations;
        } catch (error) {
            logger.error("Error fetching reservations:", error.message);
            return [];
        }
    }


    async getReservationInfo(apiKey: string, reservationId: number) {
        try {
            const url = `https://api-rms.hostify.com/reservations/${reservationId}`;

            const response = await axios.get(url, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
                params: {
                    include_related_objects: 1,
                },
            });

            return response.data || null;

        } catch (error) {
            logger.error(`Error fetching details for reservation ${reservationId}:`, error.message);
            throw error;
        }
    }

    async getListingImages(apiKey: string, listingId: string) {
        try {
            const url = `https://api-rms.hostify.com/listings/photos/${listingId}`;

            const response = await axios.get(url, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
            });

            return response.data.photos || null;
        } catch (error) {
            logger.error(`Error fetching details for listing ${listingId}:`, error.message);
            throw error;
        }
    }

    async getReviews(apiKey: string) {
        try {
            const url = "https://api-rms.hostify.com/reviews";
            const per_page = 100; // Max allowed per page
            let page = 1;
            let hasMore = true;
            const allReviews: any[] = [];

            while (hasMore) {
                const response = await axios.get(url, {
                    headers: {
                        "x-api-key": apiKey,
                        "Cache-Control": "no-cache",
                    },
                    params: {
                        page,
                        per_page,
                    },
                });

                const reviews = response.data?.reviews || [];
                allReviews.push(...reviews);

                // If fewer than 'per_page' items are returned, we've reached the end
                if (reviews.length < per_page) {
                    hasMore = false;
                } else {
                    page += 1;
                }
            }

            return allReviews;
        } catch (error) {
            logger.error("Error fetching reviews:", error.message);
            return [];
        }
    }



    /*
     Create Listing involves multiple steps:
        1. Process Location.
        2. Process Layout.
        3. Process Amenities.
        4. Process Translations.
        5. Process Booking Restrictions.
        6. Process Photos.
    **/

    async createListing(apiKey: string, payload: {
        location?: any;
        layout?: any;
        amenities?: any;
        translations?: any;
        bookingRestrictions?: any;
        photos?: any;
    }) {
        const baseUrl = "https://api-rms.hostify.com/listings";
        const headers = {
            "x-api-key": apiKey,
            "Cache-Control": "no-cache",
            "Content-Type": "application/json",
        };

        const results: any = {};
        const completedSteps: string[] = [];
        let failedStep: string | null = null;
        let errorMessage: string | null = null;

        // Step 1: Process Location (must succeed before proceeding)
        if (payload.location) {
            try {
                logger.info(`Sending location payload to Hostify: ${JSON.stringify(payload.location, null, 2)}`);
                const locationResponse = await axios.post(
                    `${baseUrl}/process_location`,
                    payload.location,
                    { headers }
                );
                results.location = locationResponse.data;
                completedSteps.push("location");
                logger.info(`Location processed successfully: ${JSON.stringify(locationResponse.data, null, 2)}`);
            } catch (error: any) {
                failedStep = "location";
                const errorData = error?.response?.data || {};
                errorMessage = errorData?.message || error?.message || "Unknown error occurred";

                // Log detailed error information
                logger.error(`Error processing location: Status=${error?.response?.status}, StatusText=${error?.response?.statusText}, Error=${errorMessage}, ErrorData=${JSON.stringify(errorData, null, 2)}, SentPayload=${JSON.stringify(payload.location, null, 2)}`);

                return {
                    success: false,
                    completedSteps,
                    failedStep,
                    error: errorMessage,
                    errorDetails: errorData, // Include full error response
                    results,
                };
            }
        }

        // Step 2: Process Layout (only runs if Step 1 succeeded)
        if (payload.layout) {
            try {
                const layoutResponse = await axios.post(
                    `${baseUrl}/process_layout`,
                    payload.layout,
                    { headers }
                );
                results.layout = layoutResponse.data;
                completedSteps.push("layout");
                logger.info("Layout processed successfully");
            } catch (error: any) {
                failedStep = "layout";
                errorMessage = error?.response?.data?.message || error?.message || "Unknown error occurred";
                logger.error("Error processing layout:", errorMessage);
                return {
                    success: false,
                    completedSteps,
                    failedStep,
                    error: errorMessage,
                    results,
                };
            }
        }

        // Step 3: Process Amenities (only runs if previous steps succeeded)
        if (payload.amenities) {
            try {
                logger.info(`Sending amenities payload to Hostify: ${JSON.stringify(payload.amenities, null, 2)}`);
                const amenitiesResponse = await axios.post(
                    `${baseUrl}/process_amenities`,
                    payload.amenities,
                    { headers }
                );
                results.amenities = amenitiesResponse.data;
                completedSteps.push("amenities");
                logger.info(`Amenities processed successfully: ${JSON.stringify(amenitiesResponse.data, null, 2)}`);
            } catch (error: any) {
                failedStep = "amenities";
                const errorData = error?.response?.data || {};
                errorMessage = errorData?.message || error?.message || "Unknown error occurred";

                logger.error(`Error processing amenities: Status=${error?.response?.status}, StatusText=${error?.response?.statusText}, Error=${errorMessage}, ErrorData=${JSON.stringify(errorData, null, 2)}, SentPayload=${JSON.stringify(payload.amenities, null, 2)}`);

                return {
                    success: false,
                    completedSteps,
                    failedStep,
                    error: errorMessage,
                    errorDetails: errorData,
                    results,
                };
            }
        }

        // Step 4: Process Translations (only runs if previous steps succeeded)
        if (payload.translations) {
            try {
                const translationsResponse = await axios.post(
                    `${baseUrl}/process_translations`,
                    payload.translations,
                    { headers }
                );
                results.translations = translationsResponse.data;
                completedSteps.push("translations");
                logger.info("Translations processed successfully");
            } catch (error: any) {
                failedStep = "translations";
                errorMessage = error?.response?.data?.message || error?.message || "Unknown error occurred";
                logger.error("Error processing translations:", errorMessage);
                return {
                    success: false,
                    completedSteps,
                    failedStep,
                    error: errorMessage,
                    results,
                };
            }
        }

        // Step 5: Process Booking Restrictions (only runs if previous steps succeeded)
        if (payload.bookingRestrictions) {
            try {
                const bookingRestrictionsResponse = await axios.post(
                    `${baseUrl}/process_booking_restrictions`,
                    payload.bookingRestrictions,
                    { headers }
                );
                results.bookingRestrictions = bookingRestrictionsResponse.data;
                completedSteps.push("bookingRestrictions");
                logger.info("Booking restrictions processed successfully");
            } catch (error: any) {
                failedStep = "bookingRestrictions";
                errorMessage = error?.response?.data?.message || error?.message || "Unknown error occurred";
                logger.error("Error processing booking restrictions:", errorMessage);
                return {
                    success: false,
                    completedSteps,
                    failedStep,
                    error: errorMessage,
                    results,
                };
            }
        }

        // Step 6: Process Photos (only runs if all previous steps succeeded)
        if (payload.photos) {
            try {
                const photosResponse = await axios.post(
                    `${baseUrl}/process_photos`,
                    payload.photos,
                    { headers }
                );
                results.photos = photosResponse.data;
                completedSteps.push("photos");
                logger.info("Photos processed successfully");
            } catch (error: any) {
                failedStep = "photos";
                errorMessage = error?.response?.data?.message || error?.message || "Unknown error occurred";
                logger.error("Error processing photos:", errorMessage);
                return {
                    success: false,
                    completedSteps,
                    failedStep,
                    error: errorMessage,
                    results,
                };
            }
        }

        // All steps completed successfully
        return {
            success: true,
            completedSteps,
            failedStep: null,
            error: null,
            results,
        };
    }

    /**
     * Get inbox message thread from Hostify
     * @param apiKey The Hostify API key
     * @param inboxId The inbox/conversation ID
     * @returns Inbox thread with messages
     */
    async getInboxThread(apiKey: string, inboxId: string): Promise<HostifyInboxThread | null> {
        try {
            const url = `https://api-rms.hostify.com/inbox/${inboxId}`;

            const response = await axios.get(url, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
            });

            return response.data || null;
        } catch (error) {
            logger.error(`Error fetching inbox thread ${inboxId}:`, error.message);
            return null;
        }
    }

    /**
     * Get listing fees including tax rate from Hostify
     * Tax is stored as a percentage (e.g., 10.25 = 10.25%)
     */
    async getListingFees(apiKey: string, listingId: number): Promise<HostifyListingFees | null> {
        try {
            const url = `https://api-rms.hostify.com/listings/${listingId}`;
            const response = await axios.get(url, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
                params: {
                    include_related_objects: 0,  // We only need the listing data
                },
            });

            const listing = response.data?.listing;
            if (!listing) {
                return null;
            }

            return {
                listingId: listing.id,
                tax: listing.tax || 0,  // Tax percentage (e.g., 10.25)
                cleaningFee: listing.cleaning_fee || 0,
                petsAllowed: listing.pets_allowed === 1,
                petsFee: listing.pets_fee || 0,
                securityDeposit: listing.security_deposit || 0,
                extraPerson: listing.extra_person || 0,
                guestsIncluded: listing.guests_included || 1,
                currency: listing.currency || 'USD',
            };
        } catch (error: any) {
            logger.error(`Error fetching listing fees for ${listingId}: ${error.message}`);
            return null;
        }
    }

    async getCalendar(apiKey: string, listingId: number, startDate: string, endDate: string): Promise<HostifyCalendarDay[]> {
        try {
            const url = "https://api-rms.hostify.com/calendar";
            const response = await axios.get(url, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
                params: {
                    listing_id: listingId,
                    start_date: startDate,
                    end_date: endDate
                }
            });

            const data = response.data;
            if (Array.isArray(data)) {
                return data;
            }
            if (data && Array.isArray(data.calendar)) {
                return data.calendar;
            }
            if (data && Array.isArray(data.data)) {
                return data.data;
            }

            logger.warn(`Unexpected calendar data format for listing ${listingId}: ${JSON.stringify(data).substring(0, 100)}`);
            return [];
        } catch (error: any) {
            logger.error(`Error fetching calendar for listing ${listingId}: ${error.message}`);
            return [];
        }
    }

}

// --- Type Definitions ---

export interface HostifyInboxMessage {
    id: number;
    message: string;
    sender: string;
    from: string;  // 'guest' | 'host' | 'system'
    created: string;
    channel?: string;
}

export interface HostifyInboxThread {
    id: number;
    reservationId?: number;
    guestName?: string;
    guestEmail?: string;
    guestPhone?: string;
    listingId?: number;
    listingName?: string;
    messages: HostifyInboxMessage[];
    createdAt: string;
    updatedAt: string;
}
export interface HostifyCalendarDay {
    date: string;
    status: string;
    price: number;
    basePrice: number;
    listing_id: number;
    currency: string;
    min_stay: number;
    max_stay: number;
    cta: boolean;
    ctd: boolean;
    losPrice: any;
    bookingValue: number | null;
    note: string | null;
    statusNote: string | null;
}

export interface HostifyListingFees {
    listingId: number;
    tax: number;  // Tax percentage (e.g., 10.25 means 10.25%)
    cleaningFee: number;
    petsAllowed: boolean;
    petsFee: number;
    securityDeposit: number;
    extraPerson: number;
    guestsIncluded: number;
    currency: string;
}
