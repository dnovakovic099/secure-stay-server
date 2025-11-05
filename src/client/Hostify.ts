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
            const url = `https://api-rms.hostify.com/reservations`;

            const response = await axios.get(url, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
                params: {
                    ...filter,
                },
            });

            return response.data.reservations || null;
        } catch (error) {
            logger.error("Error fetching reservations:", error.message);
            throw error;
        }
    }


    async getReservationInfo(apiKey: string, reservationId: string) {
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

}