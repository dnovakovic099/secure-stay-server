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
            { channelId: 2018, channelName: "airbnbOfficial" },
            { channelId: 2002, channelName: "homeaway" },
            { channelId: 2005, channelName: "bookingcom" },
            { channelId: 2007, channelName: "expedia" },
            { channelId: 2009, channelName: "homeawayical" },
            { channelId: 2010, channelName: "vrboical" },
            { channelId: 2000, channelName: "direct" },
            { channelId: 2013, channelName: "bookingengine" },
            { channelId: 2015, channelName: "customIcal" },
            { channelId: 2016, channelName: "tripadvisorical" },
            { channelId: 2017, channelName: "wordpress" },
            { channelId: 2019, channelName: "marriott" },
            { channelId: 2020, channelName: "partner" },
            { channelId: 2021, channelName: "gds" },
            { channelId: 2022, channelName: "google" }
        ];
        return channels;
    }
}