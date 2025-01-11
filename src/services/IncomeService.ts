
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { ConnectedAccountService } from "./ConnectedAccountService";
import { differenceInDays } from 'date-fns';

interface Reservation {
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
}

export class IncomeService {
    private hostAwayClient = new HostAwayClient();

    private calculateProratedAmount(reservation: Reservation, fromDate: string, toDate: string): number {
        const totalNights = differenceInDays(
            new Date(reservation.departureDate),
            new Date(reservation.arrivalDate)
        );

        const pricePerNight = reservation.totalPrice / totalNights;

        const periodStart = new Date(Math.max(
            new Date(reservation.arrivalDate).getTime(),
            new Date(fromDate).getTime()
        ));
        const periodEnd = new Date(Math.min(
            new Date(reservation.departureDate).getTime(),
            new Date(toDate).getTime()
        ));

        const nightsInPeriod = differenceInDays(periodEnd, periodStart);

        return pricePerNight * nightsInPeriod;
    }

    async generateIncomeStatement(request: Request, userId: string) {
        const { listingId, dateType, fromDate, toDate, page, limit, channelId } = request.body;
        const offset = (page - 1) * limit;

        const connectedAccountService = new ConnectedAccountService();
        const { clientId, clientSecret } = await connectedAccountService.getPmAccountInfo(userId);

        const hostAwayDateType = dateType === 'prorated' ? 'arrival' : dateType;

        const reservations = await this.hostAwayClient.getReservations(
            clientId,
            clientSecret,
            listingId,
            hostAwayDateType,
            fromDate,
            toDate,
            limit,
            offset,
            channelId
        );

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

        const rows = validReservations.map((reservation: Reservation) => {
            const amount = dateType === 'prorated' 
                ? this.calculateProratedAmount(reservation, fromDate, toDate)
                : reservation.totalPrice;
            return [
                // reservation.id,
                // reservation.status,
                reservation.listingName,
                this.modifyChannelName(reservation.channelName),
                reservation.guestName,
                amount,
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
        const validReservationStatus = ["new", "modified", "ownerStay",/*"cancelled" */];
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
