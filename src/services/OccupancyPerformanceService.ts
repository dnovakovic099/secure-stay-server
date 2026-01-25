import { appDatabase } from "../utils/database.util";
import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Hostify, HostifyCalendarDay } from "../client/Hostify";
import { subDays, subHours, isAfter, startOfDay, format } from "date-fns";
import logger from "../utils/logger.utils";

export interface OccupancyPerformanceFilters {
    tags?: string[];
    listingIds?: number[];
    startDate?: string;
    endDate?: string;
    velocityThreshold?: string; // e.g., "v3_48", "v5_7", "v10_14"
}

export class OccupancyPerformanceService {
    private listingRepo = appDatabase.getRepository(Listing);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private hostifyClient = new Hostify();

    private validStatuses = ["new", "accepted", "modified", "ownerStay", "moved"];

    async getUniqueTags() {
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

    async getReport(filters: OccupancyPerformanceFilters) {
        const query = this.listingRepo.createQueryBuilder("listing");

        if (filters.listingIds && filters.listingIds.length > 0) {
            query.andWhere("listing.id IN (:...listingIds)", { listingIds: filters.listingIds });
        }

        let listings = await query.getMany();

        // Tag filtering
        if (filters.tags && filters.tags.length > 0) {
            listings = listings.filter(listing => {
                const listingTags = (listing.tags || "").split(",").map(t => t.trim().toLowerCase());
                return filters.tags!.some(tag => listingTags.includes(tag.toLowerCase()));
            });
        }

        const apiKey = process.env.HOSTIFY_API_KEY || "";
        const today = startOfDay(new Date());

        // We'll process in batches to avoid overwhelming the Hostify API or memory
        const report: any[] = [];
        const batchSize = 5;

        for (let i = 0; i < listings.length; i += batchSize) {
            const batch = listings.slice(i, i + batchSize);
            const results = await Promise.all(batch.map(async (listing) => {
                try {
                    const occupancy = await this.calculateOccupancyRealTime(apiKey, listing.id, today, filters.startDate, filters.endDate);
                    const velocity = await this.calculateVelocity(listing.id);

                    // Icon logic
                    let icon = "";
                    const tags = (listing.tags || "").split(",").map(t => t.trim().toLowerCase());
                    if (tags.includes("own")) icon = "🏠";
                    else if (tags.includes("pm")) icon = "🤝";
                    else if (tags.includes("arb")) icon = "💸";

                    return {
                        id: listing.id,
                        name: listing.internalListingName || listing.name,
                        icon,
                        tags: listing.tags,
                        occupancy,
                        velocity
                    };
                } catch (error) {
                    logger.error(`Error processing report for listing ${listing.id}: ${error.message}`);
                    return null;
                }
            }));

            results.forEach(res => {
                if (res) report.push(res);
            });
        }

        // Velocity threshold filter
        let filteredReport = report;
        if (filters.velocityThreshold) {
            filteredReport = report.filter(item => {
                if (filters.velocityThreshold === "v3_48") return item.velocity.v3_48;
                if (filters.velocityThreshold === "v5_7") return item.velocity.v5_7;
                if (filters.velocityThreshold === "v10_14") return item.velocity.v10_14;
                return true;
            });
        }

        return {
            data: filteredReport,
            generatedAt: format(new Date(), "yyyy-MM-dd HH:mm:ss 'UTC'")
        };
    }

    private async calculateOccupancyRealTime(apiKey: string, listingId: number, today: Date, customStart?: string, customEnd?: string) {
        // Fetch calendar from Hostify
        // Range: Past 90 to Future 90
        const fetchStart = customStart ? customStart : format(subDays(today, 90), "yyyy-MM-dd");
        const fetchEnd = customEnd ? customEnd : format(addDays(today, 90), "yyyy-MM-dd");

        const calendar = await this.hostifyClient.getCalendar(apiKey, listingId, fetchStart, fetchEnd);

        const getRate = (days: number, isBackward: boolean) => {
            const start = isBackward ? subDays(today, days) : today;
            const end = isBackward ? today : addDays(today, days);

            const range = calendar.filter(d => {
                const dd = startOfDay(new Date(d.date));
                return dd >= startOfDay(start) && dd < startOfDay(end);
            });

            if (range.length === 0) return 0;
            const booked = range.filter(d => d.status === 'booked').length;

            return Math.round((booked / range.length) * 100);
        };

        const result: any = {
            p7: getRate(7, true),
            p14: getRate(14, true),
            p30: getRate(30, true),
            p90: getRate(90, true),
            f7: getRate(7, false),
            f14: getRate(14, false),
            f30: getRate(30, false),
            f90: getRate(90, false),
        };

        if (customStart && customEnd) {
            const start = startOfDay(new Date(customStart));
            const end = startOfDay(new Date(customEnd));
            const range = calendar.filter(d => {
                const dd = startOfDay(new Date(d.date));
                return dd >= start && dd <= end;
            });
            result.custom = range.length > 0 ? Math.round((range.filter(d => d.status === 'booked').length / range.length) * 100) : 0;
        }

        return result;
    }

    private async calculateVelocity(listingId: number) {
        const now = new Date();
        const h48 = subHours(now, 48);
        const d7 = subDays(now, 7);
        const d14 = subDays(now, 14);

        const reservations = await this.reservationRepo.find({
            where: { listingMapId: listingId }
        });

        const validReservations = reservations.filter(r => {
            if (!this.validStatuses.includes(r.status)) return false;
            if (!r.reservationDate) return false;
            return true;
        });

        const countSince = (date: Date) => {
            return validReservations.filter(r => {
                const rDate = new Date(r.reservationDate);
                return isAfter(rDate, date);
            }).length;
        };

        return {
            v3_48: countSince(h48) >= 3,
            v5_7: countSince(d7) >= 5,
            v10_14: countSince(d14) >= 10
        };
    }
}

function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}
