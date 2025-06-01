import { ListingDetail } from "../entity/ListingDetails";
import { appDatabase } from "../utils/database.util";
import { addDays, subDays, format, startOfDay } from "date-fns";
import { HostAwayClient } from "../client/HostAwayClient";

export class OccupancyRateService {
    private listingDetailRepository = appDatabase.getRepository(ListingDetail);
    private hostAwayClient = new HostAwayClient();


    async getOccupancyPercent() {
        const CLIENT_ID = process.env.HOST_AWAY_CLIENT_ID;
        const CLIENT_SECRET = process.env.HOST_AWAY_CLIENT_SECRET;
        const today = startOfDay(new Date());
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

            const past90DateRange = calendar.filter((d: any) => startOfDay(new Date(d.date)) < today);
            const past30DateRange = calendar.filter((d: any) => startOfDay(new Date(d.date)) < today && startOfDay(new Date(d.date)) >= startOfDay(subDays(today, 30)));
            const past14DateRange = calendar.filter((d: any) => startOfDay(new Date(d.date)) < today && startOfDay(new Date(d.date)) >= startOfDay(subDays(today, 14)));
            const past7DateRange = calendar.filter((d: any) => startOfDay(new Date(d.date)) < today && startOfDay(new Date(d.date)) >= startOfDay(subDays(today, 7)));

            const future90DateRange = calendar.filter((d: any) => startOfDay(new Date(d.date)) >= today);
            const future30DateRange = calendar.filter((d: any) => startOfDay(new Date(d.date)) >= today && startOfDay(new Date(d.date)) < startOfDay(addDays(today, 30)));
            const future14DateRange = calendar.filter((d: any) => startOfDay(new Date(d.date)) >= today && startOfDay(new Date(d.date)) < startOfDay(addDays(today, 14)));
            const future7DateRange = calendar.filter((d: any) => startOfDay(new Date(d.date)) >= today && startOfDay(new Date(d.date)) < startOfDay(addDays(today, 7)));

            const pastRates = {
                "90days": {
                    occupancyRate: Math.round(((past90DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 90) * 100),
                    ownerStayDays: past90DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).length,
                    ownerStayDates: past90DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).map((d: any) => d.date),
                    blockedDates: past90DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => { return { date: d.date, note: d.note }; })
                },
                "30days": {
                    occupancyRate: Math.round(((past30DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 30) * 100),
                    ownerStayDays: past30DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).length,
                    ownerStayDates: past30DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).map((d: any) => d.date),
                    blockedDates: past30DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => { return { date: d.date, note: d.note }; })
                },
                "14days": {
                    occupancyRate: Math.round(((past14DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 14) * 100),
                    ownerStayDays: past14DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).length,
                    ownerStayDates: past14DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).map((d: any) => d.date),
                    blockedDates: past14DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => { return { date: d.date, note: d.note }; })
                },
                "7days": {
                    occupancyRate: Math.round(((past7DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 7) * 100),
                    ownerStayDays: past7DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).length,
                    ownerStayDates: past7DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).map((d: any) => d.date),
                    blockedDates: past7DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => { return { date: d.date, note: d.note }; })
                },
            };

            const futureRates = {
                "7days": {
                    occupancyRate: Math.round(((future7DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 7) * 100),
                    ownerStayDays: future7DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).length,
                    ownerStayDates: future7DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).map((d: any) => d.date),
                    blockedDates: future7DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => { return { date: d.date, note: d.note }; })
                },
                "14days": {
                    occupancyRate: Math.round(((future14DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 14) * 100),
                    ownerStayDays: future14DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).length,
                    ownerStayDates: future14DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).map((d: any) => d.date),
                    blockedDates: future14DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => { return { date: d.date, note: d.note }; })
                },
                "30days": {
                    occupancyRate: Math.round(((future30DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 30) * 100),
                    ownerStayDays: future30DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).length,
                    ownerStayDates: future30DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).map((d: any) => d.date),
                    blockedDates: future30DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => { return { date: d.date, note: d.note }; })
                },
                "90days": {
                    occupancyRate: Math.round(((future90DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked").length) / 90) * 100),
                    ownerStayDays: future90DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).length,
                    ownerStayDates: future90DateRange.filter((d: any) => d.isAvailable == 0 && d.status != "blocked" && (d.reservations.length > 0 && d.reservations[0].status == "ownerStay")).map((d: any) => d.date),
                    blockedDates: future90DateRange.filter((d: any) => d.isAvailable == 0 && d.status == "blocked").map((d: any) => { return { date: d.date, note: d.note }; })
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
                    if (Number(futureRates["7days"].occupancyRate) < 50) {
                        lowOccupancy.own.push(occupancyData);
                    }
                    break;
                case "Arbitrage":
                    result.arbitraged.push(occupancyData);
                    if (Number(futureRates["7days"].occupancyRate) < 50) {
                        lowOccupancy.arbitraged.push(occupancyData);
                    }
                    break;
                case "Property Management":
                    result.pmClients.push(occupancyData);
                    if (Number(futureRates["7days"].occupancyRate) < 50) {
                        lowOccupancy.pmClients.push(occupancyData);
                    }
                    break;
            }
        }

        return { result, lowOccupancy };
    }
}
