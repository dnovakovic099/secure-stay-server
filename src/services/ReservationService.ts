import { appDatabase } from "../utils/database.util";
import { ReservationEntity } from "../entity/Reservation";
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { getCurrentDateInUTC } from "../helpers/date";
import * as XLSX from 'xlsx';
import { ReservationDetailPreStayAuditService } from "./ReservationDetailPreStayAuditService";
import { ReservationDetailPostStayAuditService } from "./ReservationDetailPostStayAuditService";

export class ReservationService {

    private reservationRepository = appDatabase
        .getRepository(ReservationEntity);

    private hostAwayClient = new HostAwayClient();
    private preStayAuditService = new ReservationDetailPreStayAuditService();
    private postStayAuditService = new ReservationDetailPostStayAuditService();

    // async getReservationStatusByLink(request: Request) {
    //     const reservationLink = String(request.params.reservationLink);
    //     if (reservationLink === null) {
    //         throw new Error("ReservationService: ReservationLink is null");
    //     }
    //     let status = "CREATED";

    //     await this.reservationRepository
    //         .findOne({ where: { reservationLink } })
    //         .then(reservation => {
    //             if (reservation === null) {
    //                 throw new Error("ReservationService: Reservation is null");
    //             }
    //             if (new Date(reservation.reservationInfo.departureDate) < new Date()) {
    //                 status = "FINISHED";
    //                 //TODO: CHECK BY PRICE
    //             } else if (reservation?.userVerification?.approved === 1 && reservation.payments.length > 0) {
    //                 status = "PAID";
    //             }
    //         });

    //     return status;
    // }

    // async getReservationListingInfo(request: Request) {
    //     const reservationLink = String(request.params.reservationLink);
    //     const reservation = await this.reservationRepository
    //         .findOne({ where: { reservationLink } })

    //     return this.hostAwayClient.getListingInfo(reservation?.reservationInfo?.listingMapId);
    // }

    async getHostawayReservationListStartingToday(){
        const currentDate=getCurrentDateInUTC()
        const reservations = await this.hostAwayClient.getReservationList(currentDate);
        return reservations.filter((reservation: { status: string; }) => reservation.status === 'new');
    }

    async getReservationInfo(request: Request) {
        // Extract query parameters
        const page = Number(request.query.page) || 1;
        const limit = Number(request.query.limit) || 10;
        const guestName = String(request.query.guestName || undefined);
        const arrivalStartDate = String(request.query.arrivalStartDate) || undefined;
        const listingId = request.query.listingId ? Number(request.query.listingId) : undefined;
        const offset = (page - 1) * limit;

        try {
            // Get today's reservations first
            const today = new Date().toISOString().split('T')[0];
            const todayReservations = await this.hostAwayClient.getReservationInfo({
                arrivalStartDate: today,
                arrivalEndDate: today,
            });

            // Get regular filtered results
            const regularReservations = await this.hostAwayClient.getReservationInfo({
                limit,
                offset,
                guestName,
                arrivalStartDate : arrivalStartDate || undefined,
                listingId: listingId || undefined
            });

            // Combine results, removing duplicates
            const todayResults = todayReservations.result || [];
            const regularResults = regularReservations.result || [];

            // Filter out today's reservations that might appear in regular results
            const todayReservationIds = new Set(todayResults.map(r => r.reservationId));
            const filteredRegularResults = regularResults.filter(r => !todayReservationIds.has(r.reservationId));

            // Combine today's reservations with filtered regular results
            const combinedResults = [...todayResults, ...filteredRegularResults];

            // Fetch audit statuses and append to each reservation
            for (const reservation of combinedResults) {
                const preStayStatus = await this.preStayAuditService.fetchCompletionStatusByReservationId(reservation.reservationId);
                const postStayStatus = await this.postStayAuditService.fetchCompletionStatusByReservationId(reservation.reservationId);
                const reservationWithAuditStatus = {
                    ...reservation,
                    preStayAuditStatus: preStayStatus,
                    postStayAuditStatus: postStayStatus
                };
                Object.assign(reservation, reservationWithAuditStatus);
            }
            return {
                status: "success",
                result: combinedResults,
                count: regularReservations.count,
                currentPage: page,
                totalPages: Math.ceil(regularReservations.count / limit),
            };

        } catch (error) {
            console.error("Error fetching reservations:", error);
            throw new Error("Failed to fetch reservation info.");
        }
    }
    
    async exportReservationToExcel(request: Request): Promise<Buffer> {
    const reservations = await this.hostAwayClient.getReservationInfo();
    const formattedData = reservations?.result?.map(reservation => ({
      GuestName: reservation.guestName,
      ChannelName: reservation.channelName,
      CheckInDate: reservation.arrivalDate,
      Amount: reservation.totalPrice,
      Status: reservation.status,
      ListingId: reservation.listingMapId
    }));

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const csv = XLSX.utils.sheet_to_csv(worksheet);

    return Buffer.from(csv, 'utf-8');
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