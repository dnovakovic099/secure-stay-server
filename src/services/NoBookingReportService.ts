import { IsNull, In } from "typeorm";
import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { appDatabase } from "../utils/database.util";
import { Hostify, HostifyCalendarDay } from "../client/Hostify";
import logger from "../utils/logger.utils";
import { subDays, isAfter, format, startOfDay } from "date-fns";

export interface NoBookingReportFilters {
    tags?: string[];
    noBookingWindow: "7" | "14" | "30";
}

export interface NoBookingReportData {
    id: number;
    name: string;
    tags: string;
    icon: string;
    lastBookingDate: string | null;
    startDate: string | null;
}

export interface NoBookingReportResponse {
    data: NoBookingReportData[];
    generatedAt: string;
}

/**
 * Service for generating No Booking Report
 * Lists properties that haven't received bookings in specified time window
 */
export class NoBookingReportService {
    private listingRepo = appDatabase.getRepository(Listing);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private hostifyClient = new Hostify();

    // Valid booking statuses
    private validStatuses = ["new", "accepted", "modified", "ownerStay", "moved"];

    // Default base price that indicates listing hasn't been priced yet
    private defaultBasePrice = 3000;

    /**
     * Get unique tags from all listings (reuse from OccupancyPerformanceService)
     */
    async getUniqueTags(): Promise<string[]> {
        const listings = await this.listingRepo.find({
            select: ["tags"]
        });

        const allTags = new Set<string>();
        listings.forEach(listing => {
            if (listing.tags) {
                listing.tags.split(",").forEach(tag => {
                    const trimmed = tag.trim();
                    if (trimmed) allTags.add(trimmed);
                });
            }
        });

        return Array.from(allTags).sort();
    }

    /**
     * Generate the No Booking Report
     */
    async getReport(filters: NoBookingReportFilters): Promise<NoBookingReportResponse> {
        // Get all active listings
        let listings = await this.listingRepo.find({
            where: { deletedAt: IsNull() }
        });

        // Filter by tags if provided
        if (filters.tags && filters.tags.length > 0) {
            listings = listings.filter(listing => {
                const listingTags = (listing.tags || "").split(",").map(t => t.trim().toLowerCase());
                return filters.tags!.some(tag => listingTags.includes(tag.toLowerCase()));
            });
        }

        const apiKey = process.env.HOSTIFY_API_KEY || "";
        const today = new Date();
        const thresholdDays = parseInt(filters.noBookingWindow) || 7;
        const thresholdDate = subDays(today, thresholdDays);

        const report: NoBookingReportData[] = [];

        // Process listings in batches
        const batchSize = 5;
        for (let i = 0; i < listings.length; i += batchSize) {
            const batch = listings.slice(i, i + batchSize);
            const results = await Promise.all(batch.map(async (listing) => {
                try {
                    // Get last booking date
                    const lastBookingDate = await this.getLastBookingDate(listing.id);

                    // Check if listing has no bookings in the specified window
                    const hasRecentBooking = lastBookingDate && isAfter(new Date(lastBookingDate), thresholdDate);
                    
                    // For 30+ days filter, we want listings with no booking in 30+ days
                    // For 7 and 14 days, we want listings with no booking in that exact window
                    const shouldInclude = filters.noBookingWindow === "30"
                        ? !lastBookingDate || !isAfter(new Date(lastBookingDate), subDays(today, 30))
                        : !hasRecentBooking;

                    if (!shouldInclude) {
                        return null;
                    }

                    // Get or fetch start date
                    let startDate = listing.startDate ? format(listing.startDate, "yyyy-MM-dd") : null;
                    if (!startDate) {
                        startDate = await this.fetchAndSaveStartDate(apiKey, listing.id);
                    }

                    // Determine icon based on tags
                    let icon = "";
                    const tags = (listing.tags || "").split(",").map(t => t.trim().toLowerCase());
                    if (tags.includes("own")) icon = "🏠";
                    else if (tags.includes("pm")) icon = "🤝";
                    else if (tags.includes("arb")) icon = "💸";

                    return {
                        id: listing.id,
                        name: listing.internalListingName || listing.name,
                        tags: listing.tags || "",
                        icon,
                        lastBookingDate,
                        startDate
                    };
                } catch (error) {
                    logger.error(`[NoBookingReportService] Error processing listing ${listing.id}: ${error.message}`);
                    return null;
                }
            }));

            results.forEach(res => {
                if (res) report.push(res);
            });
        }

        return {
            data: report,
            generatedAt: format(new Date(), "yyyy-MM-dd HH:mm:ss 'UTC'")
        };
    }

    /**
     * Get the last booking date for a listing
     */
    private async getLastBookingDate(listingId: number): Promise<string | null> {
        const reservations = await this.reservationRepo.find({
            where: {
                listingMapId: listingId,
                status: In(this.validStatuses)
            },
            order: { reservationDate: "DESC" },
            take: 1
        });

        if (reservations.length > 0 && reservations[0].reservationDate) {
            return reservations[0].reservationDate;
        }

        return null;
    }

    /**
     * Fetch start date from Hostify calendar and save to database
     * Start date is when basePrice first changed from 3000
     */
    private async fetchAndSaveStartDate(apiKey: string, listingId: number): Promise<string | null> {
        try {
            // Fetch calendar from 2025-11-01 to current date
            const startDateRange = "2025-11-01";
            const endDateRange = format(new Date(), "yyyy-MM-dd");

            const calendar = await this.hostifyClient.getCalendar(apiKey, listingId, startDateRange, endDateRange);

            if (!calendar || calendar.length === 0) {
                logger.warn(`[NoBookingReportService] No calendar data for listing ${listingId}`);
                return null;
            }

            // Sort calendar by date ascending
            const sortedCalendar = [...calendar].sort((a, b) => 
                new Date(a.date).getTime() - new Date(b.date).getTime()
            );

            // Find the first date where basePrice is not 3000
            let startDate: string | null = null;
            for (const day of sortedCalendar) {
                const basePrice = (day as any).basePrice || day.price;
                if (basePrice !== this.defaultBasePrice) {
                    startDate = day.date;
                    break;
                }
            }

            // Save to database if found
            if (startDate) {
                await this.listingRepo.update(listingId, { startDate: new Date(startDate) });
                logger.info(`[NoBookingReportService] Updated startDate for listing ${listingId}: ${startDate}`);
            }

            return startDate;
        } catch (error) {
            logger.error(`[NoBookingReportService] Error fetching start date for listing ${listingId}: ${error.message}`);
            return null;
        }
    }
}
