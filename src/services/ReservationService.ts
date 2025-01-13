import { appDatabase } from "../utils/database.util";
import { ReservationEntity } from "../entity/Reservation";
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { getCurrentDateInUTC } from "../helpers/date";

export class ReservationService {

    private reservationRepository = appDatabase
        .getRepository(ReservationEntity);

    private hostAwayClient = new HostAwayClient();


    async getReservationStatusByLink(request: Request) {
        const reservationLink = String(request.params.reservationLink);
        if (reservationLink === null) {
            throw new Error("ReservationService: ReservationLink is null");
        }
        let status = "CREATED";

        await this.reservationRepository
            .findOne({ where: { reservationLink } })
            .then(reservation => {
                if (reservation === null) {
                    throw new Error("ReservationService: Reservation is null");
                }
                if (new Date(reservation.reservationInfo.departureDate) < new Date()) {
                    status = "FINISHED";
                    //TODO: CHECK BY PRICE
                } else if (reservation?.userVerification?.approved === 1 && reservation.payments.length > 0) {
                    status = "PAID";
                }
            });

        return status;
    }

    async getReservationListingInfo(request: Request) {
        const reservationLink = String(request.params.reservationLink);
        const reservation = await this.reservationRepository
            .findOne({ where: { reservationLink } })

        return this.hostAwayClient.getListingInfo(reservation?.reservationInfo?.listingMapId);
    }

    async getHostawayReservationListStartingToday(){
        const currentDate=getCurrentDateInUTC()
        const reservations = await this.hostAwayClient.getReservationList(currentDate);
        return reservations.filter((reservation: { status: string; }) => reservation.status === 'new');
    }

    async getChannelList() {
        const channels = [
            { channelId: 2018, channelName: "Airbnb" },
            { channelId: 2002, channelName: "Homeaway" },
            { channelId: 2005, channelName: "Booking.com" },
            { channelId: 2007, channelName: "Expedia" },
            { channelId: 2009, channelName: "Homeawayical" },
            { channelId: 2010, channelName: "Vrbo" },
            { channelId: 2000, channelName: "Direct" },
            { channelId: 2013, channelName: "Booking engine" },
            { channelId: 2015, channelName: "CustomIcal" },
            { channelId: 2016, channelName: "Tripadvisorical" },
            { channelId: 2017, channelName: "Wordpress" },
            { channelId: 2019, channelName: "Marriott" },
            { channelId: 2020, channelName: "Partner" },
            { channelId: 2021, channelName: "gds" },
            { channelId: 2022, channelName: "Google" }
        ];
        return channels;
    }

    public async fetchReservations(
        clientId: string,
        clientSecret: string,
        listingId: number,
        dateType: string,
        fromDate: string,
        toDate: string,
        limit: number,
        offset: number,
        channelId: number
    ) {
        //fetch reservations
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

        const validReservations = this.filterValidReservation(reservations, fromDate);
        return validReservations;
    }

    private filterValidReservation(reservations: Object[], fromDate: string): Object[] {
        const validReservationStatus = ["new", "modified", "ownerStay"];

        const filteredReservations = reservations.filter((reservation: { status: string; departureDate: string; }) => {
            // Filter by status and exclude reservations ending on the `fromDate`
            return validReservationStatus.includes(reservation.status) && reservation.departureDate !== fromDate;
        });

        return filteredReservations;
    }
}