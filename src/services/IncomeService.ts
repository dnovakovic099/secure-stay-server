
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { ConnectedAccountService } from "./ConnectedAccountService";
import { appDatabase } from "../utils/database.util";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Between } from "typeorm";

export class IncomeService {
    private hostAwayClient = new HostAwayClient();
    private reservationInfoRepo = appDatabase.getRepository(ReservationInfoEntity);

    async generateIncomeStatement(request: Request, userId: string) {
        const { listingId, dateType, fromDate, toDate, page, limit, channelId } = request.body;
        const offset = (page - 1) * limit;

        // const connectedAccountService = new ConnectedAccountService();
        // const { clientId, clientSecret } = await connectedAccountService.getPmAccountInfo(userId);

        // const reservations = await this.hostAwayClient.getReservations(
        //     clientId,
        //     clientSecret,
        //     listingId,
        //     dateType,
        //     fromDate,
        //     toDate,
        //     limit,
        //     offset,
        //     channelId
        // );

        const whereClause: any = {};

        if (listingId) {
            whereClause.listingMapId = listingId;
        }

        if (dateType === 'arrival') {
            whereClause.arrivalDate = Between(fromDate, toDate);
        } else if (dateType === 'departure') {
            whereClause.departureDate = Between(fromDate, toDate);
        } else {
            whereClause.arrivalDate = Between(fromDate, toDate);
        }

        if (channelId) {
            whereClause.channelId = channelId;
        }

        const reservations = await this.reservationInfoRepo.find({
            where: whereClause,
            skip: offset,
            take: limit,
        });

        const validReservations = this.filterValidReservation(reservations);

        const columns = [
            // "Reservation ID",
            // "Status",
            "Listing",
            "Channel",
            "Guest",
            "Amount",
            "Arrival Date",
            "Departure Date",
            // "Remaining Balance",
            // "Tax Amount",
            // "Channel Commission Amount",
            // "Hostaway Commission Amount",
            // "Cleaning Fee",
            // "Security Deposit Fee",
            // "Currency",
            // "Reservation Coupon ID"
        ];

        const rows = validReservations.map((reservation: {
            // id: number,
            // status: string,
            listingName: string,
            channelName: string,
            guestName: string,
            totalPrice: number,
            arrivalDate: string,
            departureDate: string,
            // remainingBalance: number | null,
            // taxAmount: number | null,
            // channelCommissionAmount: number | null,
            // hostawayCommissionAmount: number | null,
            // cleaningFee: number | null,
            // securityDepositFee: number | null,
            // currency: string,
            // reservationCouponId: string | null,
        }) => {
            return [
                // reservation.id,
                // reservation.status,
                reservation.listingName,
                this.modifyChannelName(reservation.channelName),
                reservation.guestName,
                reservation.totalPrice,
                reservation.arrivalDate,
                reservation.departureDate,
                // reservation.remainingBalance,
                // reservation.taxAmount,
                // reservation.channelCommissionAmount,
                // reservation.hostawayCommissionAmount,
                // reservation.cleaningFee,
                // reservation.securityDepositFee,
                // reservation.currency,
                // reservation.reservationCouponId,
            ];
        });

        return {
            columns,
            rows,
        };

    }

    public filterValidReservation(reservations: Object[]): Object[] {
        const validReservationStatus = ["new", "modified", "ownerStay",/*"cancelled" */, "accepted", "moved"];
        const filteredReservations = reservations.filter((reservation: { status: string; }) => validReservationStatus.includes(reservation.status));
        return filteredReservations;
    }

    private modifyChannelName(channelName: string) {
        switch (channelName) {
            case "airbnbOfficial":
                return "Airbnb";
            case "homeaway":
                return "Direct Booking";
            case "bookingengine":
                return "Direct Booking";
            case "bookingcom":
                return "Booking.com";
            case "vrboical":
                return "Vrbo";
            default:
                return channelName;
        }
    }

}
