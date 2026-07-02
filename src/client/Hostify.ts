import axios from "axios";
import logger from "../utils/logger.utils";

export class Hostify {
    private apiKey: string = process.env.HOSTIFY_API_KEY || '';

    private parseHostifyJsonPreservingIds(data: unknown): any {
        if (typeof data !== "string") {
            return data;
        }

        const normalized = data.replace(
            /("channel_listing_id"\s*:\s*)(-?\d+(?:\.\d+)?)/g,
            '$1"$2"'
        );

        return JSON.parse(normalized);
    }

    private isExtraLikeRecord(value: unknown): value is Record<string, unknown> {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return false;
        }

        const record = value as Record<string, unknown>;
        const hasName =
            typeof record.name === "string" ||
            typeof record.title === "string" ||
            typeof record.label === "string";
        const hasFeeSignal =
            record.fee_id !== undefined ||
            record.feeId !== undefined ||
            record.charge_type !== undefined ||
            record.chargeType !== undefined ||
            record.system !== undefined ||
            record.status !== undefined ||
            record.active !== undefined ||
            record.is_active !== undefined;

        return hasName && hasFeeSignal;
    }

    private extractExtraItems(payload: unknown): Record<string, unknown>[] {
        const seenArrays = new Set<unknown[]>();

        const visit = (value: unknown): Record<string, unknown>[] => {
            if (Array.isArray(value)) {
                if (seenArrays.has(value)) {
                    return [];
                }
                seenArrays.add(value);

                const objectItems = value.filter(
                    (entry): entry is Record<string, unknown> =>
                        !!entry && typeof entry === "object" && !Array.isArray(entry)
                );

                if (objectItems.length > 0 && objectItems.every((entry) => this.isExtraLikeRecord(entry))) {
                    return objectItems;
                }

                return objectItems.flatMap((entry) => visit(entry));
            }

            if (!value || typeof value !== "object") {
                return [];
            }

            return Object.values(value as Record<string, unknown>).flatMap((entry) => visit(entry));
        };

        return visit(payload);
    }


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
                    include_owner_data: 1,
                },
                transformResponse: [(data) => data],
            });

            return this.parseHostifyJsonPreservingIds(response.data) || null;
        } catch (error) {
            logger.error(`Error fetching details for listing ${listingId}:`, error.message);
            return null;
        }
    }

    async getChildListings(apiKey: string, parentListingId: string) {
        try {
            const url = `https://api-rms.hostify.com/listings/children/${parentListingId}`;

            const response = await axios.get(url, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
                params: {
                    include_related_objects: 1,
                },
                transformResponse: [(data) => data],
            });

            const data = this.parseHostifyJsonPreservingIds(response.data);
            return data?.listings || [];
        } catch (error) {
            logger.error(`Error fetching child listings for ${parentListingId}:`, error.message);
            return [];
        }
    }

    async getIntegrations(apiKey: string) {
        try {
            const url = "https://api-rms.hostify.com/integrations";
            const per_page = 100;
            let page = 1;
            let hasMore = true;
            const allIntegrations: any[] = [];

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

                const integrations = response.data?.integrations || [];
                allIntegrations.push(...integrations);

                if (integrations.length < per_page) {
                    hasMore = false;
                } else {
                    page += 1;
                }
            }

            return allIntegrations;
        } catch (error) {
            logger.error("Error fetching integrations:", error.message);
            return [];
        }
    }

    async getIntegration(apiKey: string, integrationId: string | number) {
        try {
            const url = `https://api-rms.hostify.com/integrations/${integrationId}`;

            const response = await axios.get(url, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
            });

            return response.data?.integration || response.data || null;
        } catch (error) {
            logger.error(`Error fetching integration ${integrationId}:`, error.message);
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

    /**
     * Fetch a single guest record by id. New/manual reservations (and threads we
     * message first) carry only a `guest_id` — the guest's name, email and phone
     * live on this record, not on the reservation or thread summary.
     */
    async getGuest(apiKey: string, guestId: number | string) {
        try {
            const url = `https://api-rms.hostify.com/guests/${guestId}`;
            const response = await axios.get(url, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
            });
            return response.data?.guest || response.data?.data || null;
        } catch (error) {
            logger.error(`Error fetching guest ${guestId}:`, error.message);
            return null;
        }
    }

    async getReservationCustomFields(apiKey: string, reservationId: number) {
        try {
            const url = `https://api-rms.hostify.com/reservations/custom_fields/${reservationId}`;
            const response = await axios.get(url, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
            });
            return response.data?.custom_fields || [];
        } catch (error) {
            logger.error(`Error fetching custom fields for reservation ${reservationId}:`, error.message);
            return [];
        }
    }

    async updateReservationCustomField(apiKey: string, reservationId: number, customFieldId: number | string, value: any) {
        try {
            const url = "https://api-rms.hostify.com/reservations/custom_field_update";
            const response = await axios.post(url, {
                reservation_id: reservationId,
                custom_field_id: customFieldId,
                value,
            }, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
            });
            return response.data || null;
        } catch (error) {
            logger.error(`Error updating custom field ${customFieldId} for reservation ${reservationId}:`, error.message);
            throw error;
        }
    }

    async getTransactions(apiKey: string, filter: Record<string, any> = {}) {
        try {
            const url = "https://api-rms.hostify.com/transactions";
            const per_page = 100;
            let page = 1;
            let hasMore = true;
            const transactions: any[] = [];

            while (hasMore) {
                const response = await axios.get(url, {
                    headers: {
                        "x-api-key": apiKey,
                        "Cache-Control": "no-cache",
                    },
                    params: {
                        page,
                        per_page,
                        ...filter,
                    },
                });

                const fetchedTransactions = response.data?.transactions || [];
                transactions.push(...fetchedTransactions);
                if (fetchedTransactions.length < per_page) {
                    hasMore = false;
                } else {
                    page += 1;
                }
            }

            return transactions;
        } catch (error: any) {
            logger.error("Error fetching Hostify transactions:", error.message);
            return [];
        }
    }

    async updateReservationInfo(apiKey: string, reservationId: number, payload: Record<string, any>) {
        try {
            const url = `https://api-rms.hostify.com/reservations/${reservationId}`;

            const response = await axios.put(url, payload, {
                headers: {
                    "x-api-key": apiKey,
                    "Cache-Control": "no-cache",
                },
            });

            return response.data || null;
        } catch (error) {
            logger.error(`Error updating reservation ${reservationId}:`, error.message);
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

    async getExtras(apiKey: string) {
        const endpoints = [
            "https://api-rms.hostify.com/fees",
            "https://api-rms.hostify.com/extras",
            "https://api-rms.hostify.com/owners/extras",
            "https://api-rms.hostify.com/owners/fees",
        ];

        for (const url of endpoints) {
            try {
                const per_page = 100;
                let page = 1;
                let hasMore = true;
                const allExtras: any[] = [];

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

                    const payload = response.data;
                    const extras = [
                        ...(Array.isArray(payload?.fees) ? payload.fees : []),
                        ...(Array.isArray(payload?.extras) ? payload.extras : []),
                        ...(Array.isArray(payload?.data) ? payload.data : []),
                        ...(Array.isArray(payload?.items) ? payload.items : []),
                        ...this.extractExtraItems(payload),
                    ].filter(
                        (entry, index, collection) =>
                            collection.findIndex((candidate) => {
                                const candidateRecord = candidate as Record<string, unknown>;
                                const entryRecord = entry as Record<string, unknown>;
                                const candidateId = candidateRecord?.fee_id ?? candidateRecord?.feeId ?? candidateRecord?.id;
                                const entryId = entryRecord?.fee_id ?? entryRecord?.feeId ?? entryRecord?.id;
                                const candidateName = candidateRecord?.name ?? candidateRecord?.title ?? candidateRecord?.label;
                                const entryName = entryRecord?.name ?? entryRecord?.title ?? entryRecord?.label;

                                return candidateId === entryId && candidateName === entryName;
                            }) === index
                    );

                    if (!Array.isArray(extras)) {
                        break;
                    }

                    allExtras.push(...extras);

                    if (extras.length < per_page) {
                        hasMore = false;
                    } else {
                        page += 1;
                    }
                }

                if (allExtras.length > 0) {
                    return allExtras;
                }
            } catch (error: any) {
                logger.warn(`Hostify extras endpoint failed for ${url}: ${error?.message || "unknown error"}`);
            }
        }

        return [];
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
     * List all inbox threads from Hostify
     * @param apiKey The Hostify API key
     * @returns Array of thread summary objects
     */
    async listInboxThreads(apiKey: string, page = 1, per_page = 20): Promise<{ threads: any[]; per_page: number }> {
        try {
            const url = "https://api-rms.hostify.com/inbox";
            const response = await axios.get(url, {
                headers: { "x-api-key": apiKey, "Cache-Control": "no-cache" },
                params: { page, per_page },
            });
            return {
                threads: response.data?.threads || [],
                per_page,
            };
        } catch (error) {
            logger.error("Error fetching inbox threads:", error.message);
            return { threads: [], per_page };
        }
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
     * Post a reply to an inbox thread
     */
    async postInboxReply(apiKey: string, threadId: number | string, message: string): Promise<any> {
        try {
            const url = "https://api-rms.hostify.com/inbox/reply";
            const response = await axios.post(url, { thread_id: threadId, message }, {
                headers: { "x-api-key": apiKey },
            });
            return response.data || null;
        } catch (error) {
            logger.error(`Error posting reply to thread ${threadId}:`, error.message);
            throw error;
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

    // -------------------------------------------------------------------------
    // Webhooks (Amazon SNS based). Hostify supports multiple webhooks per action,
    // so adding ours does not disturb other integrations (e.g. Calry).
    // -------------------------------------------------------------------------

    /** List all registered webhooks (notifications) for the account. */
    async listWebhooks(apiKey: string): Promise<any[]> {
        try {
            const response = await axios.get("https://api-rms.hostify.com/webhooks_v2", {
                headers: { "x-api-key": apiKey, "Cache-Control": "no-cache" },
            });
            return response.data?.webhooks || [];
        } catch (error: any) {
            logger.error(`Error listing Hostify webhooks: ${error.message}`);
            return [];
        }
    }

    /**
     * Create a webhook for a given notification type pointing to our handler URL.
     * Hostify will send an SNS SubscriptionConfirmation to the URL which our
     * handler auto-confirms. `auth` is echoed back with every notification.
     */
    async createWebhook(
        apiKey: string,
        params: { notificationType: string; url: string; auth?: string }
    ): Promise<{ success: boolean; id?: number; error?: string }> {
        try {
            const response = await axios.post(
                "https://api-rms.hostify.com/webhooks_v2",
                {
                    notification_type: params.notificationType,
                    url: params.url,
                    ...(params.auth ? { auth: params.auth } : {}),
                },
                { headers: { "x-api-key": apiKey, "Content-Type": "application/json" } }
            );
            return { success: !!response.data?.success, id: response.data?.id };
        } catch (error: any) {
            const msg = error?.response?.data?.error || error.message;
            logger.error(`Error creating Hostify webhook (${params.notificationType}): ${msg}`);
            return { success: false, error: msg };
        }
    }

    /** Delete a webhook by id. */
    async deleteWebhook(apiKey: string, id: number): Promise<boolean> {
        try {
            await axios.delete(`https://api-rms.hostify.com/webhooks_v2/${id}`, {
                headers: { "x-api-key": apiKey },
            });
            return true;
        } catch (error: any) {
            logger.error(`Error deleting Hostify webhook ${id}: ${error.message}`);
            return false;
        }
    }

    /**
     * Get users/owners from Hostify
     * Note: Hostify's /users endpoint returns property owners, not team members
     */
    async getUsers(apiKey: string): Promise<HostifyUser[]> {
        try {
            const url = "https://api-rms.hostify.com/users";
            const per_page = 100;
            let page = 1;
            let hasMore = true;
            const allUsers: HostifyUser[] = [];

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

                const data = response.data;
                
                // Hostify returns users in the 'users' array
                let users: any[] = [];
                if (Array.isArray(data)) {
                    users = data;
                } else if (data && Array.isArray(data.users)) {
                    users = data.users;
                } else if (data && Array.isArray(data.data)) {
                    users = data.data;
                }
                
                logger.info(`[Hostify] Page ${page}: Found ${users.length} users`);
                
                // Transform raw Hostify user format to our interface
                const transformedUsers = users.filter(u => u.id && u.username).map((u: any) => ({
                    id: u.id,
                    first_name: u.first_name || '',
                    last_name: u.last_name || '',
                    email: u.username || u.email || '',
                    phone: u.phone?.toString() || '',
                    role: u.roles || 'owner',
                    status: u.is_active === 1 ? 'active' : 'inactive',
                    timezone: undefined,
                    language: undefined,
                    avatar: undefined,
                    permissions: [],
                    last_login_at: undefined,
                    created_at: undefined,
                    updated_at: undefined,
                    // Only include parent/master listings (master_calendar: 1)
                    listings: Array.isArray(u.listings) ? u.listings
                        .filter((l: any) => l.master_calendar == 1 || l.master_calendar === '1')
                        .map((l: any) => ({
                            id: l.id,
                            name: l.name || '',
                            nickname: l.nickname || l.internalListingName || '',
                            address: l.address || '',
                        })) : [],
                }));
                
                allUsers.push(...transformedUsers);

                // Check for more pages
                if (data.next_page) {
                    page += 1;
                } else {
                    hasMore = false;
                }
            }

            logger.info(`Fetched ${allUsers.length} users from Hostify`);
            return allUsers;
        } catch (error: any) {
            logger.error(`Error fetching Hostify users: ${error.message}`);
            throw error;
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

export interface HostifyUserListing {
    id: number;
    name: string;
    nickname?: string;
    address?: string;
}

export interface HostifyUser {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    role?: string;
    status?: string;
    timezone?: string;
    language?: string;
    avatar?: string;
    permissions?: string[];
    last_login_at?: string;
    created_at?: string;
    updated_at?: string;
    listings?: HostifyUserListing[];
}
