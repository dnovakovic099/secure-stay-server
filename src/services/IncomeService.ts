
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { ConnectedAccountService } from "./ConnectedAccountService";

export class IncomeService {
    private hostAwayClient = new HostAwayClient();

    async generateIncomeStatement(request: Request, userId: string) {
        const { listingId, dateType, fromDate, toDate, page, limit, channelId } = request.body;
        const offset = (page - 1) * limit;

        const connectedAccountService = new ConnectedAccountService();
        const { clientId, clientSecret } = await connectedAccountService.getPmAccountInfo(userId);

        const reservations = await this.hostAwayClient.getReservations(
            clientId,
            clientSecret,
            listingId,
            dateType,
            fromDate,
            toDate,
            limit,
            offset,
            channelId
        );

        const validReservations = this.filterValidReservation(reservations);

        const columns = [
            "Reservation ID",
            "Listing",
            "Channel",
            "Guest",
            "Arrival Date",
            "Departure Date",
            "Total Price",
            "Remaining Balance",
            "Tax Amount",
            "Channel Commission Amount",
            "Hostaway Commission Amount",
            "Cleaning Fee",
            "Security Deposit Fee",
            "Currency",
            "Reservation Coupon ID"
        ];

        const rows = validReservations.map((reservation: {
            id: number,
            listingName: string,
            channelName: string,
            guestName: string,
            arrivalDate: string,
            departureDate: string,
            totalPrice: number,
            remainingBalance: number | null,
            taxAmount: number | null,
            channelCommissionAmount: number | null,
            hostawayCommissionAmount: number | null,
            cleaningFee: number | null,
            securityDepositFee: number | null,
            currency: string,
            reservationCouponId: string | null,
        }) => {
            return [
                reservation.id,
                reservation.listingName,
                reservation.channelName,
                reservation.guestName,
                reservation.arrivalDate,
                reservation.departureDate,
                reservation.totalPrice,
                reservation.remainingBalance,
                reservation.taxAmount,
                reservation.channelCommissionAmount,
                reservation.hostawayCommissionAmount,
                reservation.cleaningFee,
                reservation.securityDepositFee,
                reservation.currency,
                reservation.reservationCouponId,
            ];
        });

        return {
            columns,
            rows,
        };

    }

    private filterValidReservation(reservations: Object[]): Object[] {
        const validReservationStatus = ["new", "modified", "ownerStay"];
        const filteredReservations = reservations.filter((reservation: { status: string; }) => validReservationStatus.includes(reservation.status));
        return filteredReservations;
    }

}
