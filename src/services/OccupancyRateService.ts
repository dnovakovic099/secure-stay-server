import { Listing } from "../entity/Listing";
import { ListingDetail } from "../entity/ListingDetails";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { appDatabase } from "../utils/database.util";
import { addDays, subDays, format } from "date-fns";
import { Between } from "typeorm";
import logger from "../utils/logger.utils";
import { getReservationDaysInRange } from "../helpers/date";
import { HostAwayClient } from "../client/HostAwayClient";

// Helper function to get all dates between two dates (inclusive)
function getDatesBetween(start: Date, end: Date): string[] {
    const dates = [];
    const current = new Date(start);
    while (current <= end) {
        dates.push(format(current, "yyyy-MM-dd"));
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

// Helper to filter owner stay dates for a specific date range
function filterOwnerStayDatesInRange(
    ownerStayDateMap: Set<string>,
    rangeStart: Date,
    rangeEnd: Date
): string[] {
    const datesInRange = getDatesBetween(rangeStart, rangeEnd);
    return datesInRange.filter(date => ownerStayDateMap.has(date));
}

function filterBlockedDatesInRange(
    dates: { id: number; date: string; status: string; }[],
    rangeStart: Date,
    rangeEnd: Date
): string[] {
    const datesInRange = getDatesBetween(rangeStart, rangeEnd);
    return dates ? dates.filter(item => datesInRange.includes(item.date)).map(item => item.date) : [];
}

export class OccupancyRateService {
    private listingRepository = appDatabase.getRepository(Listing);
    private listingDetailRepository = appDatabase.getRepository(ListingDetail);
    private reservationInfoRepository = appDatabase.getRepository(ReservationInfoEntity);
    private hostAwayClient = new HostAwayClient();

    // private async calculateOccupancyRate(
    //     reservations: ReservationInfoEntity[],
    //     startDate: Date,
    //     endDate: Date,
    //     noOfDays: number,
    // ) {
    //     let calculableNights = 0;
    //     let ownerStayDays = 0;
    //     const validReservations = ["new", "modified", "ownerStay"];

    //     for (const reservation of reservations) {
    //         if (validReservations.includes(reservation.status)) {
    //             calculableNights += getReservationDaysInRange(
    //                 startDate,
    //                 endDate,
    //                 reservation.arrivalDate,
    //                 reservation.departureDate
    //             );
    //             if (reservation.status === "ownerStay") {
    //                 ownerStayDays += reservation.nights;
    //             }
    //         }
    //     }

    //     console.log(`calculableNights ${calculableNights} against noOfDays ${noOfDays} for ${reservations[0]?.listingName}`);
    //     console.log(`ownerStay: ${ownerStayDays} days`);

    //     const occupancyRate = (calculableNights / noOfDays) * 100;
    //     return {
    //         occupancyRate: Math.floor(occupancyRate),
    //         ownerStayDays,
    //     };
    // }

    // private async getReservationsForDateRange(
    //     listingId: number,
    //     startDate: Date,
    //     endDate: Date
    // ): Promise<ReservationInfoEntity[]> {
    //     return await this.reservationInfoRepository.find({
    //         where: {
    //             listingMapId: listingId,
    //             arrivalDate: Between(startDate, endDate),
    //         },
    //     });
    // }

    // public async getOccupancyRates() {
    //     const CLIENT_ID = process.env.HOST_AWAY_CLIENT_ID;
    //     const CLIENT_SECRET = process.env.HOST_AWAY_CLIENT_SECRET;
    //     const today = new Date();
    //     const currentYear= today.getFullYear();
    //     const currentMonth=today.getMonth() + 1;

    //     const listings = await appDatabase.query(`
    //           SELECT id, MIN(name) AS name, MIN(internalListingName) AS internalListingName
    //           FROM listing_info
    //           GROUP BY id
    //           `);

    //     const listingDetails = await this.listingDetailRepository.find();

    //     const result = {
    //         pmClients: [],
    //         own: [],
    //         arbitraged: [],
    //     };

    //     const lowOccupancy = {
    //         pmClients: [],
    //         own: [],
    //         arbitraged: [],
    //     };

    //     for (const listing of listings) {
    //         const detail = listingDetails.find(d => d.listingId === listing.id);
    //         if (!detail) continue;

    //         try {
    //             // Get all reservations across past and future windows
    //             const allReservations = await this.getReservationsForDateRange(
    //                 listing.id,
    //                 subDays(today, 90),
    //                 addDays(today, 90)
    //             );

    //             const calendar = await this.hostAwayClient.getCalendar(CLIENT_ID, CLIENT_SECRET, listing.id, format(subDays(today, 90), "yyyy-MM-dd"), format(addDays(today, 90), "yyyy-MM-dd"));
    //             const blockedDates = calendar && calendar.filter((item: any) => item.status == "blocked");

    //             // Build a map of all owner stay dates
    //             const ownerStayDateMap: Set<string> = new Set();
    //             for (const reservation of allReservations) {
    //                 if (reservation.status === "owner_stay" || reservation.status === "ownerStay") {
    //                     const dates = getDatesBetween(
    //                         new Date(reservation.arrivalDate),
    //                         new Date(reservation.departureDate)
    //                     );
    //                     dates.forEach(date => ownerStayDateMap.add(date));
    //                 }
    //             }

    //             // Compute pastRates with ownerStayDates
    //             const pastRates = {
    //                 "7days": {
    //                     ...(await this.calculateOccupancyRate(
    //                         await this.getReservationsForDateRange(listing.id, subDays(today, 7), today),
    //                         subDays(today, 7),
    //                         today,
    //                         7
    //                     )),
    //                     ownerStayDates: filterOwnerStayDatesInRange(ownerStayDateMap, subDays(today, 7), today),
    //                     blockedDates: filterBlockedDatesInRange(blockedDates, subDays(today, 7), today)
    //                 },
    //                 "14days": {
    //                     ...(await this.calculateOccupancyRate(
    //                         await this.getReservationsForDateRange(listing.id, subDays(today, 14), today),
    //                         subDays(today, 14),
    //                         today,
    //                         14
    //                     )),
    //                     ownerStayDates: filterOwnerStayDatesInRange(ownerStayDateMap, subDays(today, 14), today),
    //                     blockedDates: filterBlockedDatesInRange(blockedDates, subDays(today, 14), today)
    //                 },
    //                 "30days": {
    //                     ...(await this.calculateOccupancyRate(
    //                         await this.getReservationsForDateRange(listing.id, subDays(today, 30), today),
    //                         subDays(today, 30),
    //                         today,
    //                         30
    //                     )),
    //                     ownerStayDates: filterOwnerStayDatesInRange(ownerStayDateMap, subDays(today, 30), today),
    //                     blockedDates: filterBlockedDatesInRange(blockedDates, subDays(today, 30), today)
    //                 },
    //                 "90days": {
    //                     ...(await this.calculateOccupancyRate(
    //                         await this.getReservationsForDateRange(listing.id, subDays(today, 90), today),
    //                         subDays(today, 90),
    //                         today,
    //                         90
    //                     )),
    //                     ownerStayDates: filterOwnerStayDatesInRange(ownerStayDateMap, subDays(today, 90), today),
    //                     blockedDates: filterBlockedDatesInRange(blockedDates, subDays(today, 90), today)
    //                 },
    //             };

    //             // Compute futureRates with ownerStayDates
    //             const futureRates = {
    //                 "7days": {
    //                     ...(await this.calculateOccupancyRate(
    //                         await this.getReservationsForDateRange(listing.id, today, addDays(today, 7)),
    //                         today,
    //                         addDays(today, 7),
    //                         7
    //                     )),
    //                     ownerStayDates: filterOwnerStayDatesInRange(ownerStayDateMap, today, addDays(today, 7)),
    //                     blockedDates: filterBlockedDatesInRange(blockedDates, today, addDays(today, 7))
    //                 },
    //                 "14days": {
    //                     ...(await this.calculateOccupancyRate(
    //                         await this.getReservationsForDateRange(listing.id, today, addDays(today, 14)),
    //                         today,
    //                         addDays(today, 14),
    //                         14
    //                     )),
    //                     ownerStayDates: filterOwnerStayDatesInRange(ownerStayDateMap, today, addDays(today, 14)),
    //                     blockedDates: filterBlockedDatesInRange(blockedDates, today, addDays(today, 14))
    //                 },
    //                 "30days": {
    //                     ...(await this.calculateOccupancyRate(
    //                         await this.getReservationsForDateRange(listing.id, today, addDays(today, 30)),
    //                         today,
    //                         addDays(today, 30),
    //                         30
    //                     )),
    //                     ownerStayDates: filterOwnerStayDatesInRange(ownerStayDateMap, today, addDays(today, 30)),
    //                     blockedDates: filterBlockedDatesInRange(blockedDates, today, addDays(today, 30))
    //                 },
    //                 "90days": {
    //                     ...(await this.calculateOccupancyRate(
    //                         await this.getReservationsForDateRange(listing.id, today, addDays(today, 90)),
    //                         today,
    //                         addDays(today, 90),
    //                         90
    //                     )),
    //                     ownerStayDates: filterOwnerStayDatesInRange(ownerStayDateMap, today, addDays(today, 90)),
    //                     blockedDates: filterBlockedDatesInRange(blockedDates, today, addDays(today, 90))
    //                 },
    //             };



    //             const occupancyData = {
    //                 listingId: listing.id,
    //                 listingName: listing.internalListingName,
    //                 propertyType: detail.propertyOwnershipType,
    //                 pastRates,
    //                 futureRates,
    //                 currentYear,
    //                 currentMonth
    //             };

    //             // Sort listings into categories
    //             switch (detail.propertyOwnershipType) {
    //                 case "Luxury Lodging Owned":
    //                     result.own.push(occupancyData);
    //                     if (Number(futureRates["14days"].occupancyRate) < 65) {
    //                         lowOccupancy.own.push(occupancyData);
    //                     }
    //                     break;
    //                 case "Arbitrage":
    //                     result.arbitraged.push(occupancyData);
    //                     if (Number(futureRates["14days"].occupancyRate) < 65) {
    //                         lowOccupancy.arbitraged.push(occupancyData);
    //                     }
    //                     break;
    //                 case "Property Management":
    //                     result.pmClients.push(occupancyData);
    //                     if (Number(futureRates["14days"].occupancyRate) < 65) {
    //                         lowOccupancy.pmClients.push(occupancyData);
    //                     }
    //                     break;
    //             }
    //         } catch (error) {
    //             logger.error(`Error processing listing ${listing.id}:`, error);
    //             continue;
    //         }
    //     }

    //     return { result, lowOccupancy };
    // }


    async getOccupancyPercent() {
        const CLIENT_ID = process.env.HOST_AWAY_CLIENT_ID;
        const CLIENT_SECRET = process.env.HOST_AWAY_CLIENT_SECRET;
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;

        //loop through each listing
        const listings = await appDatabase.query(`
              SELECT id, MIN(name) AS name, MIN(internalListingName) AS internalListingName
              FROM listing_info
              GROUP BY id
              `);

        const listingDetails = await this.listingDetailRepository.find();

        const result = {
            pmClients: [],
            own: [],
            arbitraged: [],
        };

        const lowOccupancy = {
            pmClients: [],
            own: [],
            arbitraged: [],
        };

        for (const listing of listings) {
            const detail = listingDetails.find(d => d.listingId === listing.id);
            if (!detail) continue;

            //fetch the hostaway calendar from past 90 to future 90
            const calendar = await this.hostAwayClient.getCalendar(CLIENT_ID, CLIENT_SECRET, listing.id, format(subDays(today, 90), "yyyy-MM-dd"), format(addDays(today, 90), "yyyy-MM-dd"));
            if (!calendar) continue;

            const past90DateRange = calendar.filter((d: any) => new Date(d.date) < today);
            const past30DateRange = calendar.filter((d: any) => new Date(d.date) < today && new Date(d.date) > subDays(today, 30));
            const past14DateRange = calendar.filter((d: any) => new Date(d.date) < today && new Date(d.date) > subDays(today, 14));
            const past7DateRange = calendar.filter((d: any) => new Date(d.date) < today && new Date(d.date) > subDays(today, 7));

            const future90DateRange = calendar.filter((d: any) => new Date(d.date) > today);
            const future30DateRange = calendar.filter((d: any) => new Date(d.date) > today && new Date(d.date) < addDays(today, 30));
            const future14DateRange = calendar.filter((d: any) => new Date(d.date) > today && new Date(d.date) < addDays(today, 14));
            const future7DateRange = calendar.filter((d: any) => new Date(d.date) > today && new Date(d.date) < addDays(today, 7));

            const pastRates = {
                "7days": {
                    occupancyRate: Math.round(((past7DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 7) * 100),
                    ownerStayDays: past7DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").length,
                    ownerStayDates: past7DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").map((d: any) => d.date),
                    blockedDates: past7DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => d.date)
                },
                "14days": {
                    occupancyRate: Math.round(((past14DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 14) * 100),
                    ownerStayDays: past14DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").length,
                    ownerStayDates: past14DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").map((d: any) => d.date),
                    blockedDates: past14DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => d.date)
                },
                "30days": {
                    occupancyRate: Math.round(((past30DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 30) * 100),
                    ownerStayDays: past30DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").length,
                    ownerStayDates: past30DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").map((d: any) => d.date),
                    blockedDates: past30DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => d.date)
                },
                "90days": {
                    occupancyRate: Math.round(((past90DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 90) * 100),
                    ownerStayDays: past90DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").length,
                    ownerStayDates: past90DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").map((d: any) => d.date),
                    blockedDates: past90DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => d.date)
                }
            };

            const futureRates = {
                "7days": {
                    occupancyRate: Math.round(((future7DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 7) * 100),
                    ownerStayDays: future7DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").length,
                    ownerStayDates: future7DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").map((d: any) => d.date),
                    blockedDates: future7DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => d.date)
                },
                "14days": {
                    occupancyRate: Math.round(((future14DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 14) * 100),
                    ownerStayDays: future14DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").length,
                    ownerStayDates: future14DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").map((d: any) => d.date),
                    blockedDates: future14DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => d.date)
                },
                "30days": {
                    occupancyRate: Math.round(((future30DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 30) * 100),
                    ownerStayDays: future30DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").length,
                    ownerStayDates: future30DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").map((d: any) => d.date),
                    blockedDates: future30DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => d.date)
                },
                "90days": {
                    occupancyRate: Math.round(((future90DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 90) * 100),
                    ownerStayDays: future90DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").length,
                    ownerStayDates: future90DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && d.reservations[0].status == "ownerStay").map((d: any) => d.date),
                    blockedDates: future90DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => d.date)
                }
            };

            const occupancyData = {
                listingId: listing.id,
                listingName: listing.internalListingName,
                propertyType: detail.propertyOwnershipType,
                pastRates,
                futureRates,
                currentYear,
                currentMonth
            };

            // Sort listings into categories
            switch (detail.propertyOwnershipType) {
                case "Luxury Lodging Owned":
                    result.own.push(occupancyData);
                    if (Number(futureRates["14days"].occupancyRate) < 65) {
                        lowOccupancy.own.push(occupancyData);
                    }
                    break;
                case "Arbitrage":
                    result.arbitraged.push(occupancyData);
                    if (Number(futureRates["14days"].occupancyRate) < 65) {
                        lowOccupancy.arbitraged.push(occupancyData);
                    }
                    break;
                case "Property Management":
                    result.pmClients.push(occupancyData);
                    if (Number(futureRates["14days"].occupancyRate) < 65) {
                        lowOccupancy.pmClients.push(occupancyData);
                    }
                    break;
            }
        }

        return { result, lowOccupancy };
    }
}
