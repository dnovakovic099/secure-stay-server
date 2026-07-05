import { Message } from "../entity/Message";
import { MessagingEmailInfo } from "../entity/MessagingEmail";
import { MessagingPhoneNoInfo } from "../entity/MessagingPhoneNo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { appDatabase } from "../utils/database.util";
import sendEmail from "../utils/sendEmai";
import { HostAwayClient } from "../client/HostAwayClient";
import { Hostify } from "../client/Hostify";
import logger from "../utils/logger.utils";
import { isEmojiOrThankYouMessage, isReactionMessage } from "../helpers/helpers";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import sendSlackMessage from "../utils/sendSlackMsg";
import { buildUnansweredMessageAlert } from "../utils/slackMessageBuilder";
import { Listing } from "../entity/Listing";
import { ListingService } from "./ListingService";
import { In, Like } from "typeorm";
import { OpenPhoneService } from "./OpenPhoneService";

// Hostify message webhook payload interface
export interface HostifyMessagePayload {
    thread_id: string;
    message_id: number;
    message: string;
    guest_id: string;
    guest_name: string;
    created: string;
    sent_by: string | null;
    is_automatic: number;
    is_sms: boolean;
    is_incoming: number;
    reservation_id: string;
    attachment_url: string | null;
    type: string;
    listing_id: string;
    action: string;
}

interface MessageType {
    id: number;
    conversationId: number;
    reservationId: number;
    body: string;
    isIncoming: number;
    date: Date;
}

interface MessageObj {
    id: number;
    conversationId: number;
    reservationId: number;
    isIncoming: number;
    date: string;
}

export class MessagingService {
    private messagingEmailInfoRepository = appDatabase.getRepository(MessagingEmailInfo);
    private messagingPhoneNoInfoRepository = appDatabase.getRepository(MessagingPhoneNoInfo);
    private messageRepository = appDatabase.getRepository(Message);
    private hostawayClient = new HostAwayClient();
    private hostifyClient = new Hostify();
    private listingRepository = appDatabase.getRepository(Listing);
    private reservationRepository = appDatabase.getRepository(ReservationInfoEntity);
    private listingService = new ListingService();
    private openPhoneService = new OpenPhoneService();

    private normalizeText(value: any) {
        return String(value || "").trim().toLowerCase();
    }

    private parseDate(value: any): Date | null {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    private getEasternDateKey(value: any): string | null {
        const parsed = value instanceof Date ? value : this.parseDate(value);
        if (!parsed) return null;
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/New_York",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(parsed);
    }

    private isDateInRange(date: Date | null, from?: string, to?: string) {
        if (!date) return false;
        const dateKey = this.getEasternDateKey(date);
        if (!dateKey) return false;
        if (from && dateKey < from) return false;
        if (to && dateKey > to) return false;
        return true;
    }

    private extractHostifyNoteValue(reservation: any, keys: string[]) {
        for (const key of keys) {
            const value = reservation?.[key];
            if (value !== undefined && value !== null && String(value).trim() !== "") {
                return value;
            }
        }
        return null;
    }

    private normalizePropertyTypeValue(listing: Listing | null | undefined) {
        const raw = `${listing?.tags || ""} ${listing?.propertyType || ""}`.toLowerCase();
        if (raw.includes("own")) return "Own";
        if (raw.includes("arb")) return "Arb";
        if (raw.includes("pm")) return "PM";
        return null;
    }

    private normalizeServiceTypeValue(listing: Listing | null | undefined, normalizedListing?: any) {
        const raw = `${listing?.tags || ""} ${normalizedListing?.serviceType || ""}`.toLowerCase();
        if (raw.includes("full")) return "Full";
        if (raw.includes("pro")) return "Pro";
        if (raw.includes("launch")) return "Launch";
        return null;
    }

    private normalizePortfolioValue(listing: any) {
        const raw = `${listing?.portfolio || ""} ${listing?.tags || ""}`.toLowerCase();
        if (raw.includes("group 1") || raw.includes("group1")) return "Group 1";
        if (raw.includes("group 2") || raw.includes("group2")) return "Group 2";
        return null;
    }

    private getStayTiming(arrivalDate?: any, departureDate?: any, timeZone?: string | null, checkInTime?: any, checkOutTime?: any) {
        const arrival = this.normalizeDateKey(arrivalDate);
        const departure = this.normalizeDateKey(departureDate);
        if (!arrival || !departure) return null;

        // Past/Ongoing/Future are evaluated in the reservation's local timezone
        // using check-in / check-out times to determine boundaries.
        const tz = this.isValidTimeZone(timeZone) ? String(timeZone) : "America/New_York";
        const nowParts = this.getTimeZoneParts(new Date(), tz);
        const currentHour = nowParts.hour + (nowParts.minute / 60);
        const checkInHour = this.parseHourValue(checkInTime, 15) ?? 15;
        const checkOutHour = this.parseHourValue(checkOutTime, 11) ?? 11;

        if (nowParts.dateKey < arrival) return "Future";
        if (nowParts.dateKey === arrival) {
            return currentHour < checkInHour ? "Future" : "Ongoing";
        }
        if (nowParts.dateKey > departure) return "Past";
        if (nowParts.dateKey === departure) {
            return currentHour < checkOutHour ? "Ongoing" : "Past";
        }
        return "Ongoing";
    }

    // CI Today / CO Today are intentionally evaluated in New York time, regardless of
    // the property's local timezone. This gives a single, consistent "today" reference
    // for the operations team.
    private isCheckInToday(arrivalDate?: any) {
        const arrival = this.normalizeDateKey(arrivalDate);
        if (!arrival) return false;
        const todayNy = this.getTimeZoneParts(new Date(), "America/New_York").dateKey;
        return todayNy === arrival;
    }

    private isCheckOutToday(departureDate?: any) {
        const departure = this.normalizeDateKey(departureDate);
        if (!departure) return false;
        const todayNy = this.getTimeZoneParts(new Date(), "America/New_York").dateKey;
        return todayNy === departure;
    }

    private getLastMessageFrom(thread: any) {
        const raw = thread?.last_message_from || thread?.last_message_sender || thread?.lastMessageFrom || thread?.from;
        const value = this.normalizeText(raw);
        if (value.includes("guest") || value === "incoming") return "Guest";
        if (value.includes("host") || value.includes("user") || value.includes("rep") || value === "outgoing") return "Us";
        if (Number(thread?.answered) === 0 || Number(thread?.channel_unread) === 1) return "Guest";
        return null;
    }

    private isValidTimeZone(timeZone?: string | null) {
        if (!timeZone) return false;
        try {
            Intl.DateTimeFormat("en-US", { timeZone });
            return true;
        } catch {
            return false;
        }
    }

    private getTimeZoneParts(date: Date, timeZone: string) {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }).formatToParts(date);

        const getPart = (type: string) => parts.find((part) => part.type === type)?.value || "";

        return {
            year: Number(getPart("year")),
            month: Number(getPart("month")),
            day: Number(getPart("day")),
            hour: Number(getPart("hour")),
            minute: Number(getPart("minute")),
            second: Number(getPart("second")),
            dateKey: `${getPart("year")}-${getPart("month")}-${getPart("day")}`,
        };
    }

    private normalizeDateKey(value: any): string | null {
        if (!value) return null;
        if (value instanceof Date) return value.toISOString().slice(0, 10);
        const raw = String(value).trim();
        const directMatch = raw.match(/\d{4}-\d{2}-\d{2}/);
        if (directMatch?.[0]) return directMatch[0];
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toISOString().slice(0, 10);
    }

    private parseHourValue(value: any, fallback: number | null = null): number | null {
        if (value === null || value === undefined || value === "") return fallback;
        if (typeof value === "number" && !Number.isNaN(value)) return value;
        const raw = String(value).trim();
        const match = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
        if (!match) return fallback;
        let hour = Number(match[1]);
        const minute = Number(match[2] || 0);
        const period = String(match[3] || "").toUpperCase();
        if (period === "PM" && hour < 12) hour += 12;
        if (period === "AM" && hour === 12) hour = 0;
        return hour + (minute / 60);
    }

    private isCurrentlyHosting(input: {
        arrivalDate?: any;
        departureDate?: any;
        timeZone?: string | null;
        checkInTime?: any;
        checkOutTime?: any;
    }) {
        const arrivalDate = this.normalizeDateKey(input.arrivalDate);
        const departureDate = this.normalizeDateKey(input.departureDate);
        if (!arrivalDate || !departureDate) return false;

        const timeZone = this.isValidTimeZone(input.timeZone) ? String(input.timeZone) : "America/New_York";
        const nowParts = this.getTimeZoneParts(new Date(), timeZone);
        const currentHour = nowParts.hour + (nowParts.minute / 60);
        const checkInHour = this.parseHourValue(input.checkInTime, 15);
        const checkOutHour = this.parseHourValue(input.checkOutTime, 11);

        if (nowParts.dateKey === arrivalDate) {
            return currentHour >= (checkInHour ?? 15);
        }

        if (nowParts.dateKey === departureDate) {
            return currentHour < (checkOutHour ?? 11);
        }

        return nowParts.dateKey > arrivalDate && nowParts.dateKey < departureDate;
    }

    private parseMultiValueFilter(value: any) {
        if (!value) return [];
        return String(value)
            .split(",")
            .map((item) => this.normalizeText(item))
            .filter(Boolean);
    }

    private normalizePhoneDigits(value: any) {
        return String(value || "").replace(/\D/g, "");
    }

    private getThreadUpdatedAt(thread: any) {
        return thread?.updated_at || thread?.last_message || thread?.lastActivityAt || thread?.createdAt || null;
    }

    private sortThreadsByRecent(threads: any[]) {
        return [...threads].sort((a, b) => {
            const aTime = new Date(this.getThreadUpdatedAt(a) || 0).getTime();
            const bTime = new Date(this.getThreadUpdatedAt(b) || 0).getTime();
            return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
        });
    }

    private async findReservationForPhone(phone: string) {
        const digits = this.normalizePhoneDigits(phone);
        const candidates = Array.from(new Set([
            digits,
            digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : "",
            digits.length >= 10 ? digits.slice(-10) : "",
            digits.length >= 7 ? digits.slice(-7) : "",
        ].filter(Boolean)));

        for (const candidate of candidates) {
            const reservation = await this.reservationRepository.findOne({
                where: { phone: Like(`%${candidate}%`) },
                order: { arrivalDate: "DESC" as any },
            });
            if (reservation) return reservation;
        }

        return null;
    }

    private async mapOpenPhoneConversationsToThreads(conversations: any[]) {
        return Promise.all((conversations || []).map(async (conversation) => {
            const participant = Array.isArray(conversation.participants)
                ? conversation.participants.find((phone: string) => this.normalizePhoneDigits(phone).length >= 7) || conversation.participants[0]
                : null;
            const reservation = participant ? await this.findReservationForPhone(participant) : null;
            const listingId = Number((reservation as any)?.listingMapId || 0);
            const listing = listingId
                ? await this.listingRepository.findOne({ where: { id: listingId }, withDeleted: true })
                : null;
            const normalizedListing = listing
                ? (this.listingService as any).normalizeListingOverview?.(listing) || null
                : null;
            const lastMessage = conversation.lastMessage || null;
            const updatedAt = lastMessage?.createdAt || conversation.lastActivityAt || conversation.updatedAt || conversation.createdAt || null;
            const direction = lastMessage?.direction === "incoming" ? "Guest" : lastMessage?.direction === "outgoing" ? "Us" : null;
            const arrivalDate = reservation?.arrivalDate || null;
            const departureDate = reservation?.departureDate || null;
            const timeZoneIdentifier =
                normalizedListing?.timezoneIdentifier ||
                listing?.timeZoneName ||
                "America/New_York";

            return {
                id: `quo-${conversation.id}`,
                source: "quo",
                reservation_id: reservation?.id || 0,
                guest_id: 0,
                listing_id: listingId || 0,
                integration_id: 0,
                integration_type_id: 0,
                integration_type_name: "Quo",
                preview: lastMessage?.text || "No recent SMS message",
                last_message: updatedAt,
                nights: 0,
                guests: Number((reservation as any)?.guests || (reservation as any)?.numberOfGuests || 0),
                start_date: arrivalDate,
                is_archived: 0,
                answered: direction === "Guest" ? 0 : 1,
                channel_unread: direction === "Guest" ? 1 : 0,
                guest_name: reservation?.guestName || participant || "Quo conversation",
                listing_name: listing?.internalListingName || reservation?.listingName || listing?.name || null,
                property_type: this.normalizePropertyTypeValue(listing),
                service_type: this.normalizeServiceTypeValue(listing, normalizedListing),
                portfolio: this.normalizePortfolioValue(listing),
                reservation_status: reservation?.status || null,
                confirmation_code: reservation?.confirmation_code || null,
                reservation_note: reservation?.hostNote || null,
                guest_picture: reservation?.guestPicture || null,
                guest_thumb: reservation?.guestPicture || null,
                guest_phone: participant || reservation?.phone || null,
                arrival_date: arrivalDate,
                departure_date: departureDate,
                updated_at: updatedAt,
                timezone_identifier: timeZoneIdentifier,
                timezone_name: normalizedListing?.timezoneName || timeZoneIdentifier,
                check_in_time_local: normalizedListing?.checkInLocal || null,
                check_out_time_local: normalizedListing?.checkOutLocal || null,
                stay_timing: this.getStayTiming(arrivalDate, departureDate, timeZoneIdentifier),
                last_message_from: direction,
                currently_hosting: this.isCurrentlyHosting({
                    arrivalDate,
                    departureDate,
                    timeZone: timeZoneIdentifier,
                    checkInTime: reservation?.checkInTime ?? listing?.checkInTimeStart ?? normalizedListing?.checkInLocal,
                    checkOutTime: reservation?.checkOutTime ?? listing?.checkOutTime ?? normalizedListing?.checkOutLocal,
                }),
                openphone_conversation_id: conversation.id,
                openphone_phone_number_id: conversation.phoneNumberId,
                openphone_participants: conversation.participants || [],
                assignee_id: null,
                assignee: null,
            };
        }));
    }

    private async listOpenPhoneThreads(per_page = 20, query: any = {}) {
        try {
            const maxResults = Math.min(Math.max(Number(query?.maxResults || per_page * 2 || 40), per_page), 50);
            const result = await this.openPhoneService.listInboxConversations(maxResults);
            const mapped = await this.mapOpenPhoneConversationsToThreads(result.data || []);
            return {
                threads: mapped,
                total: result.totalItems || mapped.length,
                nextPageToken: result.nextPageToken || null,
            };
        } catch (error) {
            logger.error(`[OpenPhone] Error listing inbox source threads: ${error.message}`);
            return {
                threads: [],
                total: 0,
                nextPageToken: null,
            };
        }
    }

    private async enrichHostifyThreads(threads: any[]) {
        const reservationIds = threads
            .map((thread) => Number(thread?.reservation_id))
            .filter((id) => Number.isFinite(id) && id > 0);
        const listingIds = threads
            .map((thread) => Number(thread?.listing_id))
            .filter((id) => Number.isFinite(id) && id > 0);

        const [reservations, listings] = await Promise.all([
            reservationIds.length
                ? this.reservationRepository.find({ where: { id: In(reservationIds) } })
                : Promise.resolve([]),
            listingIds.length
                ? this.listingRepository.find({ where: { id: In(listingIds) }, withDeleted: true })
                : Promise.resolve([]),
        ]);

        const reservationMap = new Map(reservations.map((reservation) => [Number(reservation.id), reservation]));
        const listingMap = new Map(listings.map((listing) => [Number(listing.id), listing]));

        return threads.map((thread) => {
            const reservation = reservationMap.get(Number(thread?.reservation_id));
            const listing = listingMap.get(Number(thread?.listing_id || reservation?.listingMapId));
            const normalizedListing = listing
                ? (this.listingService as any).normalizeListingOverview?.(listing) || null
                : null;
            const timeZoneIdentifier =
                normalizedListing?.timezoneIdentifier ||
                listing?.timeZoneName ||
                "America/New_York";
            const checkInTimeLocal =
                normalizedListing?.checkInLocal ||
                (reservation?.checkInTime !== null && reservation?.checkInTime !== undefined
                    ? `${String(reservation?.checkInTime).padStart(2, "0")}:00`
                    : null);
            const checkOutTimeLocal =
                normalizedListing?.checkOutLocal ||
                (reservation?.checkOutTime !== null && reservation?.checkOutTime !== undefined
                    ? `${String(reservation?.checkOutTime).padStart(2, "0")}:00`
                    : null);
            const arrivalDate = reservation?.arrivalDate || thread?.start_date || null;
            const departureDate = reservation?.departureDate || thread?.departure_date || null;

            return {
                ...thread,
                reservation_status: reservation?.status || null,
                listing_name: listing?.internalListingName || reservation?.listingName || listing?.name || null,
                property_type: this.normalizePropertyTypeValue(listing),
                service_type: this.normalizeServiceTypeValue(listing, normalizedListing),
                portfolio: this.normalizePortfolioValue(listing),
                confirmation_code: reservation?.confirmation_code || null,
                reservation_note: reservation?.hostNote || null,
                guest_picture: reservation?.guestPicture || thread?.guest_thumb || null,
                guest_phone: reservation?.phone || null,
                arrival_date: arrivalDate,
                departure_date: departureDate,
                confirmed_at: reservation?.reservationDate || null,
                // Keep original Hostify updated_at / last_message for correct timestamp display
                timezone_identifier: timeZoneIdentifier,
                timezone_name: normalizedListing?.timezoneName || timeZoneIdentifier,
                check_in_time_local: checkInTimeLocal,
                check_out_time_local: checkOutTimeLocal,
                stay_timing: this.getStayTiming(
                    arrivalDate,
                    departureDate,
                    timeZoneIdentifier,
                    reservation?.checkInTime ?? listing?.checkInTimeStart ?? checkInTimeLocal,
                    reservation?.checkOutTime ?? listing?.checkOutTime ?? checkOutTimeLocal,
                ),
                ci_today: this.isCheckInToday(arrivalDate),
                co_today: this.isCheckOutToday(departureDate),
                last_message_from: this.getLastMessageFrom(thread),
                currently_hosting: this.isCurrentlyHosting({
                    arrivalDate,
                    departureDate,
                    timeZone: timeZoneIdentifier,
                    checkInTime: reservation?.checkInTime ?? listing?.checkInTimeStart ?? checkInTimeLocal,
                    checkOutTime: reservation?.checkOutTime ?? listing?.checkOutTime ?? checkOutTimeLocal,
                }),
            };
        });
    }

    private filterEnrichedThreads(threads: any[], query: any) {
        const keyword = this.normalizeText(query.keyword);
        const requestedFields = String(query.searchFields || "guest,confirmation")
            .split(",")
            .map((item) => this.normalizeText(item))
            .filter(Boolean);
        const searchFields = requestedFields.length ? requestedFields : ["guest", "confirmation"];
        const properties = this.parseMultiValueFilter(query.property);
        const propertyTypes = this.parseMultiValueFilter(query.propertyType);
        const serviceTypes = this.parseMultiValueFilter(query.serviceType);
        const portfolios = this.parseMultiValueFilter(query.portfolio);
        const reservationStatuses = this.parseMultiValueFilter(query.reservationStatus);
        const lastMessageFrom = this.parseMultiValueFilter(query.lastMessageFrom);
        const stayTiming = this.parseMultiValueFilter(query.stayTiming);
        const unrespondedOnly = String(query.unresponded || "").toLowerCase() === "true";
        const dateType = this.normalizeText(query.dateType || "updated");
        const dateFrom = typeof query.dateFrom === "string" ? query.dateFrom : undefined;
        const dateTo = typeof query.dateTo === "string" ? query.dateTo : undefined;
        const includesCurrentlyHosting = reservationStatuses.includes("currently hosting");
        const explicitStatuses = reservationStatuses.filter((status) => status !== "currently hosting");

        return threads.filter((thread) => {
            if (properties.length && !properties.includes(this.normalizeText(thread.listing_name))) {
                return false;
            }

            if (propertyTypes.length && !propertyTypes.includes(this.normalizeText(thread.property_type))) {
                return false;
            }

            if (serviceTypes.length && !serviceTypes.includes(this.normalizeText(thread.service_type))) {
                return false;
            }

            if (portfolios.length && !portfolios.includes(this.normalizeText(thread.portfolio))) {
                return false;
            }

            if (lastMessageFrom.length && !lastMessageFrom.includes(this.normalizeText(thread.last_message_from))) {
                return false;
            }

            if (stayTiming.length) {
                const threadTiming = this.normalizeText(thread.stay_timing);
                const wantsCiToday = stayTiming.includes("ci today");
                const wantsCoToday = stayTiming.includes("co today");
                const explicitTimings = stayTiming.filter((value) => value !== "ci today" && value !== "co today");
                const timingMatch = explicitTimings.length ? explicitTimings.includes(threadTiming) : false;
                const ciMatch = wantsCiToday && Boolean(thread.ci_today);
                const coMatch = wantsCoToday && Boolean(thread.co_today);
                if (!timingMatch && !ciMatch && !coMatch) {
                    return false;
                }
            }

            if (unrespondedOnly && !(Number(thread.answered) === 0 || Number(thread.channel_unread) === 1)) {
                return false;
            }

            if (reservationStatuses.length) {
                const statusMatch = explicitStatuses.length
                    ? explicitStatuses.includes(this.normalizeText(thread.reservation_status))
                    : false;
                const hostingMatch = includesCurrentlyHosting && Boolean(thread.currently_hosting);
                if (!statusMatch && !hostingMatch) {
                    return false;
                }
            }

            if (dateFrom || dateTo) {
                const dateValue = dateType === "checkin"
                    ? this.parseDate(thread.arrival_date || thread.start_date)
                    : dateType === "checkout"
                        ? this.parseDate(thread.departure_date)
                        : dateType === "confirmed"
                            ? this.parseDate(thread.confirmed_at)
                            : dateType === "cancelled"
                                ? this.parseDate(this.normalizeText(thread.reservation_status) === "cancelled" ? thread.updated_at : null)
                        : this.parseDate(thread.last_message || thread.updated_at);
                if (!this.isDateInRange(dateValue, dateFrom, dateTo)) {
                    return false;
                }
            }

            if (!keyword) return true;

            const candidates: Record<string, string> = {
                guest: `${thread.guest_name || ""} ${thread.guest_phone || ""}`,
                message: `${thread.preview || ""}`,
                confirmation: `${thread.confirmation_code || ""}`,
                notes: `${thread.reservation_note || ""}`,
                property: `${thread.listing_name || ""} ${thread.property_type || ""} ${thread.service_type || ""} ${thread.portfolio || ""}`,
                status: `${thread.reservation_status || ""}`,
                all: `${thread.guest_name || ""} ${thread.preview || ""} ${thread.confirmation_code || ""} ${thread.reservation_note || ""} ${thread.listing_name || ""} ${thread.property_type || ""} ${thread.service_type || ""} ${thread.portfolio || ""} ${thread.reservation_status || ""} ${thread.guest_phone || ""}`,
            };

            return searchFields.some((field) => this.normalizeText(field in candidates ? candidates[field] : candidates.all).includes(keyword));
        });
    }

    async saveEmailInfo(email: string) {
        const isExist = await this.messagingEmailInfoRepository.findOne({ where: { email } });
        if (isExist) {
            throw CustomErrorHandler.alreadyExists('Email already exists');
        }

        const emailInfo = new MessagingEmailInfo();
        emailInfo.email = email;
        emailInfo.created_at = new Date();
        emailInfo.updated_at = new Date();

        return await this.messagingEmailInfoRepository.save(emailInfo);
    }

    async deleteEmailInfo(id: number) {
        return await this.messagingEmailInfoRepository.delete({ id });
    }

    async getEmailList() {
        const emails = await this.messagingEmailInfoRepository.find({ select: ['id', 'email'] });
        return emails;
    }

    async savePhoneNoInfo(countryCode: string, phoneNo: string, supportsSMS: boolean, supportsCalling: boolean, supportsWhatsApp: boolean) {
        const isExist = await this.messagingPhoneNoInfoRepository.findOne({ where: { phone: phoneNo } });
        if (isExist) {
            throw CustomErrorHandler.alreadyExists('Phone already exists');
        }

        const phoneNoInfo = new MessagingPhoneNoInfo();
        phoneNoInfo.country_code = countryCode;
        phoneNoInfo.phone = phoneNo;
        phoneNoInfo.supportsSMS = supportsSMS;
        phoneNoInfo.supportsCalling = supportsCalling;
        phoneNoInfo.supportsWhatsApp = supportsWhatsApp;
        phoneNoInfo.created_at = new Date();
        phoneNoInfo.updated_at = new Date();

        return await this.messagingPhoneNoInfoRepository.save(phoneNoInfo);
    }

    async deletePhoneNoInfo(id: number) {
        return await this.messagingPhoneNoInfoRepository.delete({ id });
    }

    async updatePhoneNoInfo(id: number, countryCode: string, phoneNo: string, supportsSMS: boolean, supportsCalling: boolean, supportsWhatsApp: boolean) {
        const phoneNoInfo = await this.messagingPhoneNoInfoRepository.findOne({ where: { id } });
        if (!phoneNoInfo) {
            throw CustomErrorHandler.notFound('Phone number not found');
        }

        phoneNoInfo.country_code = countryCode;
        phoneNoInfo.phone = phoneNo;
        phoneNoInfo.supportsSMS = supportsSMS;
        phoneNoInfo.supportsCalling = supportsCalling;
        phoneNoInfo.supportsWhatsApp = supportsWhatsApp;
        phoneNoInfo.updated_at = new Date();

        return await this.messagingPhoneNoInfoRepository.save(phoneNoInfo);
    }

    async getPhoneNoList() {
        const phoneNoList = await this.messagingPhoneNoInfoRepository.find({ select: ['id', 'country_code', 'phone', 'supportsSMS', 'supportsCalling', 'supportsWhatsApp'] });
        return phoneNoList;
    }

    async handleConversation(message: MessageType) {
        logger.info(`New message received from webhook: ${JSON.stringify(message)}`)
        const inquiryStatuses = [
            "pending",
            "awaitingPayment",
            "inquiry",
            "inquiryPreapproved",
            "inquiryDenied",
            "inquiryTimedout",
            "inquiryNotPossible"
        ];
        const reservationInfo = await this.hostawayClient.getReservation(
            message.reservationId,
            process.env.HOSTAWAY_CLIENT_ID,
            process.env.HOSTAWAY_CLIENT_SECRET
        );
        if (!inquiryStatuses.includes(reservationInfo.status)) {
            logger.info(`Message ${message.id} received from webhook does not comply with reservation(${reservationInfo?.status}) inquiry status`);
            logger.info(`Skipping database save for the conversationId: ${message.conversationId} messageId:${message.id} `);
            return;
        };

        // save the message in the database only if isIncoming is 1; 
        if (message.isIncoming && message.isIncoming == 1) {
            await this.saveIncomingGuestMessage(message);
            logger.info(`Guest message saved successfully messageId: ${message.id} conversationId: ${message.conversationId}`);
        }
        return;
    }

    async getUnansweredMessages(page: number, limit: number, answered: boolean) {
        const [messages, total] = await this.messageRepository
            .createQueryBuilder('message')
            .leftJoinAndMapOne(
                'message.reservation',
                ReservationInfoEntity,
                'reservation',
                'message.reservationId = reservation.id'
            )
            .where('message.answered = :answered', { answered })
            .orderBy('message.createdAt', 'DESC')
            .skip((page - 1) * limit)
            .take(limit)
            .getManyAndCount();

        return {
            data: messages.map(msg => {
                const mappedMsg = {
                    ...msg,
                    guestName: msg.guestName || msg['reservation']?.guestName || null,
                    conversationId: msg.source === 'hostify' ? msg.threadId : msg.conversationId,
                };
                return mappedMsg;
            }),
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }


    async updateMessageStatus(messageId: number, answered: boolean) {
        const message = await this.messageRepository.findOne({ where: { id: messageId } });
        if (!message) {
            throw CustomErrorHandler.notFound('Message not found');
        }
        message.answered = answered;
        return await this.messageRepository.save(message);
    }

    private async saveIncomingGuestMessage(message: MessageType) {
        const newMessage = new Message();
        newMessage.messageId = message.id;
        newMessage.conversationId = message.conversationId;
        newMessage.reservationId = message.reservationId;
        newMessage.body = message.body;
        newMessage.isIncoming = message.isIncoming;
        newMessage.receivedAt = message.date;
        newMessage.answered = false;

        return await this.messageRepository.save(newMessage);
    }

    private async fetchGuestMessages() {
        const messages = await this.messageRepository.find({
            where: {
                answered: false,
            },
        });

        return messages;
    }

    public async processUnanweredMessages() {
        const unansweredMessages = await this.fetchGuestMessages();
        if (unansweredMessages.length == 0) {
            logger.info('No unanswered messages found');
            return;
        }

        for (const msg of unansweredMessages) {
            logger.info(`Checking whether answered or not for messageId ${msg.messageId}`)
            //fetch the conversation messages from hostaway
            const conversationMessages = await this.hostawayClient.fetchConversationMessages(
                msg.conversationId,
                process.env.HOSTAWAY_CLIENT_ID,
                process.env.HOSTAWAY_CLIENT_SECRET
            );

            if (!conversationMessages) {
                logger.info(`Unable to fetch conversation messages from Hostaway for ${msg.messageId}`);
                return;
            }
            //check if conversation has been answered after the guest message
            const isAnswered = await this.checkUnasweredMessages(conversationMessages, msg);
            logger.info(`isAnswered is ${isAnswered} for messageId ${msg.messageId}`);
            if (!isAnswered) {
                const isReactionMsg = isReactionMessage(msg.body);
                const isEmojiOrThankYouMsg= isEmojiOrThankYouMessage(msg.body);
                if (isReactionMsg || isEmojiOrThankYouMsg) {
                    await this.updateMessageAsAnswered(msg);
                } else {
                    const isValidInquiryMessage = await this.checkValidInquiryReservation(msg);
                    if (isValidInquiryMessage) {
                        logger.info(`Checking if guest message ${msg.messageId} received time has exceeded more than 5 minutes`);
                        await this.checkGuestMessageTime(msg);
                    } else {
                        await this.updateMessageAsAnswered(msg);
                    }
                }
            }
        }
        return;
    }

    private async checkValidInquiryReservation(msg: Message) {
        //check if inquiry message thread is moved to booked message thread
        const reservation = await this.hostawayClient.getReservation(
            msg.reservationId,
            process.env.HOST_AWAY_CLIENT_ID,
            process.env.HOST_AWAY_CLIENT_SECRET
        );
        const inquiryStatuses = [
            "pending",
            "awaitingPayment",
            "inquiry",
            "inquiryPreapproved",
            "inquiryDenied",
            "inquiryTimedout",
            "inquiryNotPossible",
            "preapproved",
            "timedout",
            "not_possible"
        ];
        if (!reservation) {
            return false;
        }
        return inquiryStatuses.includes(reservation?.status);
    }

    private async checkGuestMessageTime(msg: Message) {
        const nowUtc = new Date(); // Current UTC time
        const receivedAt = msg.receivedAt; // Already in UTC

        // Calculate the difference in milliseconds
        const differenceInMilliseconds = nowUtc.getTime() - receivedAt.getTime();
        logger.info(`Difference in ms is ${differenceInMilliseconds} for messageId ${msg.messageId}`)

        // Check if the difference is greater than 5 minutes
        if (differenceInMilliseconds > 5 * 60 * 1000) {
            logger.info(`Sending Slack notification for unanswered guest message conversationId: ${msg.conversationId || msg.threadId} messageId: ${msg.messageId}`);
            await this.notifyUnansweredMessageSlack(msg);
        }
    }


    private async checkUnasweredMessages(conversationMessages: MessageObj[], guestMessage: Message): Promise<Boolean> {
        for (const msg of conversationMessages) {
            const currentMessageDate = new Date(msg.date);
            if (msg.isIncoming == 0 && (currentMessageDate.getTime() > guestMessage.receivedAt.getTime())) {
                await this.updateMessageAsAnswered(guestMessage);
                logger.info(`Updated messageId ${guestMessage.messageId} as answered`);
                return true;
            }
        }
        return false;
    }

    private async updateMessageAsAnswered(guestMessage: Message) {
        const message = await this.messageRepository.findOne({ where: { id: guestMessage.id } });
        if (!message) {
            logger.info(`Could not find message with messageId:${guestMessage.messageId}`);
            return;
        }

        message.answered = true;
        return await this.messageRepository.save(message);
    };

    private async notifyUnansweredMessage(body: string, reservationId: number, date: Date, currentTimeStamp: number) {

        const subject = `Action Required: Guest Message Waiting for Your Response-${currentTimeStamp}`;
        const html = `
               <html>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); padding: 30px; border: 1px solid #ddd;">
      <h2 style="color: #0056b3; font-size: 20px; margin-bottom: 20px; text-align: center; border-bottom: 2px solid #0056b3; padding-bottom: 10px;">
        Notification: Unaddressed Guest Message
      </h2>
      <p style="margin: 20px 0; font-size: 16px; color: #555; text-align: center;">
        A guest has sent a message that requires your attention. Please review the details below:
      </p>
      <div style="background-color: #f9f9fc; border-left: 5px solid #0056b3; padding: 15px; margin: 20px 0; border-radius: 6px;">
        <p style="font-size: 18px; color: #333; margin: 0;">
          <strong>Message:</strong>
        </p>
        <p style="font-size: 20px; color: #000; margin: 10px 0; font-weight: bold;">
          ${body}
        </p>
      </div>
      <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Reservation ID:</strong> ${reservationId}
      </p>
            <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Received at:</strong> ${date}
      </p>
    </div>
  </body>
</html>

        `;

        await sendEmail(subject, html, process.env.EMAIL_FROM, process.env.EMAIL_TO);
    }

    /**
     * Send Slack notification for unanswered guest message
     */
    private async notifyUnansweredMessageSlack(msg: Message) {
        try {
            // Fetch the internal listing name if listingId is available
            let propertyName: string | undefined;
            if (msg.listingId) {
                const listing = await appDatabase.getRepository(Listing).findOne({
                    where: { id: Number(msg.listingId) },
                    select: ['internalListingName']
                });
                propertyName = listing?.internalListingName || undefined;
            }

            const slackMessage = buildUnansweredMessageAlert(
                msg.body,
                msg.reservationId,
                msg.receivedAt,
                msg.guestName || undefined,
                propertyName
            );
            await sendSlackMessage(slackMessage);
            logger.info(`[Slack] Unanswered message notification sent for messageId: ${msg.messageId}`);
        } catch (error) {
            logger.error(`[Slack] Error sending unanswered message notification: ${error.message}`);
        }
    }

    // ==================== HOSTIFY-SPECIFIC METHODS ====================

    /**
     * Save an incoming guest message from Hostify webhook
     * Only saves messages where is_incoming === 1
     */
    async saveHostifyGuestMessage(payload: HostifyMessagePayload) {
        try {
            // Check if message already exists
            const existingMessage = await this.messageRepository.findOne({
                where: { messageId: payload.message_id }
            });

            if (existingMessage) {
                logger.info(`[Hostify] Message ${payload.message_id} already exists, skipping save`);
                return existingMessage;
            }

            //check for listing_id
            const listing=await this.listingRepository.findOne({
                where: { id: Number(payload.listing_id) }
            });

            if(!listing){
                logger.info(`[Hostify] Listing ${payload.listing_id} not found, skipping save`);
                return;
            }

            const newMessage = new Message();
            newMessage.messageId = payload.message_id;
            newMessage.reservationId = Number(payload.reservation_id);
            newMessage.body = payload.message;
            newMessage.isIncoming = payload.is_incoming;
            newMessage.receivedAt = new Date(payload.created);
            newMessage.answered = false;

            // Hostify-specific fields
            newMessage.threadId = payload.thread_id;
            newMessage.listingId = payload.listing_id;
            newMessage.guestId = payload.guest_id;
            newMessage.guestName = payload.guest_name || null;
            newMessage.source = 'hostify';

            const savedMessage = await this.messageRepository.save(newMessage);
            logger.info(`[Hostify] Guest message saved successfully - messageId: ${payload.message_id}, threadId: ${payload.thread_id}`);
            return savedMessage;
        } catch (error) {
            logger.error(`[Hostify] Error saving guest message: ${error.message}`);
            throw error;
        }
    }

    /**
     * Process unanswered messages using Hostify APIs
     * Fetches unanswered Hostify messages and checks if they've been responded to
     */
    public async processUnansweredMessagesHostify() {
        const unansweredMessages = await this.messageRepository.find({
            where: {
                answered: false,
                source: 'hostify'
            },
            order: { createdAt: 'ASC' },
            take: 300,
        });

        if (unansweredMessages.length === 0) {
            logger.info('[Hostify] No unanswered messages found');
            return;
        }

        logger.info(`[Hostify] Processing ${unansweredMessages.length} unanswered messages`);

        for (const msg of unansweredMessages) {
            try {
                logger.info(`[Hostify] Checking message ${msg.messageId} in thread ${msg.threadId}`);

                // Check if message has been answered via Hostify inbox
                const isAnswered = await this.checkHostifyMessageAnswered(msg);
                logger.info(`[Hostify] Message ${msg.messageId} isAnswered: ${isAnswered}`);

                if (!isAnswered) {
                    // Check for emoji/thank you messages (auto-mark as answered)
                    const isReactionMsg = isReactionMessage(msg.body);
                    const isEmojiOrThankYouMsg = isEmojiOrThankYouMessage(msg.body);

                    if (isReactionMsg || isEmojiOrThankYouMsg) {
                        logger.info(`[Hostify] Message ${msg.messageId} is reaction/thank you, marking as answered`);
                        await this.updateMessageAsAnswered(msg);
                    } else {
                        // Check if message has exceeded 5 minute threshold
                        await this.checkGuestMessageTime(msg);
                    }
                }
            } catch (error) {
                logger.error(`[Hostify] Error processing message ${msg.messageId}: ${error.message}`);
            }
        }
    }

    /**
     * Check if a Hostify message has been answered by fetching the inbox thread
     * Returns true if there's an outgoing message after the guest message
     */
    private async checkHostifyMessageAnswered(guestMessage: Message): Promise<boolean> {
        if (!guestMessage.threadId) {
            logger.warn(`[Hostify] No threadId for message ${guestMessage.messageId}`);
            return false;
        }

        const listing=await this.listingRepository.findOne({
            where: { id: Number(guestMessage.listingId) }
        });

        if(!listing){
            await this.updateMessageAsAnswered(guestMessage);
            return true;
        }

        const apiKey = process.env.HOSTIFY_API_KEY;
        if (!apiKey) {
            logger.error('[Hostify] HOSTIFY_API_KEY not configured');
            return false;
        }

        try {
            const inboxThread = await this.hostifyClient.getInboxThread(apiKey, guestMessage.threadId);

            if (!inboxThread || !inboxThread.messages || inboxThread.messages.length === 0) {
                logger.info(`[Hostify] No messages found in thread ${guestMessage.threadId}`);
                return false;
            }

            // Check if there's any host/representative message after the guest message
            const guestMessageTime = guestMessage.receivedAt.getTime();

            for (const msg of inboxThread.messages) {
                const messageTime = new Date(msg.created).getTime();
                // Check if this is an outgoing message (host/representative) sent after the guest message
                if (msg.from !== 'guest' && messageTime > guestMessageTime) {
                    logger.info(`[Hostify] Found reply message ${msg.id} after guest message ${guestMessage.messageId}`);
                    await this.updateMessageAsAnswered(guestMessage);
                    return true;
                }

                if (msg.id === guestMessage.messageId && msg.from === "automatic") {
                    await this.updateMessageAsAnswered(guestMessage);
                    return true;
                }
            }

            return false;
        } catch (error) {
            logger.error(`[Hostify] Error checking thread ${guestMessage.threadId}: ${error.message}`);
            return false;
        }
    }

    async listHostifyThreads(page = 1, per_page = 20, query: any = {}) {
        try {
            const source = this.normalizeText(query?.source || "hostify");
            const wantsQuo = source === "quo";
            const wantsAll = source === "all";
            const hasFilterOrSearch = Boolean(
                query?.keyword ||
                query?.property ||
                query?.propertyType ||
                query?.serviceType ||
                query?.portfolio ||
                query?.reservationStatus ||
                query?.lastMessageFrom ||
                query?.stayTiming ||
                query?.unresponded ||
                query?.dateFrom ||
                query?.dateTo
            );
            const requiresExtendedSearch = Boolean(hasFilterOrSearch || wantsQuo || wantsAll);

            if (!requiresExtendedSearch) {
                const result = await this.hostifyClient.listInboxThreads(process.env.HOSTIFY_API_KEY, page, per_page);
                const enriched = await this.enrichHostifyThreads(result.threads || []);
                return {
                    threads: enriched,
                    per_page,
                    total: enriched.length,
                };
            }

            const maxPages = hasFilterOrSearch ? 10 : 1;
            const collected: any[] = [];

            if (!wantsQuo) {
                // Fetch first page to check if more exist
                const firstResult = await this.hostifyClient.listInboxThreads(process.env.HOSTIFY_API_KEY, 1, per_page);
                const firstBatch = firstResult.threads || [];
                collected.push(...firstBatch);

                // Fetch remaining pages in parallel for speed
                if (firstBatch.length >= per_page && maxPages > 1) {
                    const remaining = await Promise.all(
                        Array.from({ length: maxPages - 1 }, (_, i) =>
                            this.hostifyClient.listInboxThreads(process.env.HOSTIFY_API_KEY, i + 2, per_page)
                        )
                    );
                    for (const result of remaining) {
                        const batch = result.threads || [];
                        if (!batch.length) break;
                        collected.push(...batch);
                        if (batch.length < per_page) break;
                    }
                }
            }

            const hostifyThreads = wantsQuo ? [] : await this.enrichHostifyThreads(collected);
            const quoThreads = wantsQuo || wantsAll ? (await this.listOpenPhoneThreads(per_page, query)).threads : [];
            const combined = wantsQuo ? quoThreads : wantsAll ? this.sortThreadsByRecent([...hostifyThreads, ...quoThreads]) : hostifyThreads;
            const filtered = this.filterEnrichedThreads(combined, query);
            const startIndex = Math.max(page - 1, 0) * per_page;
            const paged = filtered.slice(startIndex, startIndex + per_page);

            return {
                threads: paged,
                per_page,
                total: filtered.length,
            };
        } catch (error) {
            logger.error(`[Hostify] Error listing inbox threads: ${error.message}`);
            throw error;
        }
    }

    async getHostifyThread(threadId: string) {
        try {
            const thread = await this.hostifyClient.getInboxThread(process.env.HOSTIFY_API_KEY, threadId);
            return thread;
        } catch (error) {
            logger.error(`[Hostify] Error fetching thread ${threadId}: ${error.message}`);
            throw error;
        }
    }

    async postHostifyReply(threadId: string, message: string) {
        try {
            const result = await this.hostifyClient.postInboxReply(process.env.HOSTIFY_API_KEY, threadId, message);
            return result;
        } catch (error) {
            logger.error(`[Hostify] Error posting reply to thread ${threadId}: ${error.message}`);
            throw error;
        }
    }

    async getGuestReservationDetails(reservationId: number) {
        const reservation = await this.reservationRepository.findOne({ where: { id: reservationId } });
        if (!reservation) return null;

        const listing = reservation.listingMapId
            ? await this.listingRepository.findOne({ where: { id: reservation.listingMapId }, withDeleted: true })
            : null;

        let hostifyReservation: any = null;
        let customFields: any[] = [];
        try {
            const [reservationResponse, customFieldResponse] = await Promise.all([
                this.hostifyClient.getReservationInfo(process.env.HOSTIFY_API_KEY, reservationId),
                this.hostifyClient.getReservationCustomFields(process.env.HOSTIFY_API_KEY, reservationId),
            ]);
            hostifyReservation = reservationResponse;
            customFields = Array.isArray(customFieldResponse) ? customFieldResponse : [];
        } catch (error: any) {
            logger.warn(`[Hostify] Unable to enrich reservation details for ${reservationId}: ${error.message}`);
        }

        const liveReservation = hostifyReservation?.reservation || {};
        const liveListing = hostifyReservation?.listing || {};

        // Guest name/email/phone usually live only on the Hostify guest record
        // (reservations carry a guest_id, not a name — notably new/manual
        // bookings we message first). Resolve it when the local row is missing it.
        let guestRecord: any = null;
        const guestId = liveReservation?.guest_id ?? (reservation as any).guestId ?? null;
        if (guestId && (!reservation.guestName || !reservation.phone || !reservation.guestEmail)) {
            try {
                guestRecord = await this.hostifyClient.getGuest(process.env.HOSTIFY_API_KEY, guestId);
            } catch (error: any) {
                logger.warn(`[Hostify] Unable to resolve guest ${guestId} for reservation ${reservationId}: ${error.message}`);
            }
        }
        const resolvedGuestName =
            reservation.guestName ||
            guestRecord?.name ||
            [guestRecord?.first_name, guestRecord?.last_name].filter(Boolean).join(" ").trim() ||
            liveReservation?.guest_name ||
            null;
        const resolvedGuestEmail = reservation.guestEmail || guestRecord?.email || liveReservation?.guest_email || null;
        const normalizedListing = listing
            ? (this.listingService as any).normalizeListingOverview?.(listing) || null
            : null;

        const hostNote = this.extractHostifyNoteValue(liveReservation, [
            "host_note",
            "hostNote",
            "reservation_note",
            "reservationNote",
            "notes",
        ]) ?? reservation.hostNote ?? null;

        const cleaningNote = this.extractHostifyNoteValue(liveReservation, [
            "cleaning_notes",
            "cleaning_note",
            "cleaningNote",
            "housekeeping_note",
            "housekeepingNote",
            "turnover_notes",
            "turnoverNotes",
        ]);

        const timeZoneIdentifier =
            normalizedListing?.timezoneIdentifier ||
            listing?.timeZoneName ||
            liveListing?.timezone ||
            "America/New_York";

        const checkInLocal =
            normalizedListing?.checkInLocal ||
            (reservation.checkInTime !== null && reservation.checkInTime !== undefined
                ? `${String(reservation.checkInTime).padStart(2, "0")}:00`
                : null);
        const checkOutLocal =
            normalizedListing?.checkOutLocal ||
            (reservation.checkOutTime !== null && reservation.checkOutTime !== undefined
                ? `${String(reservation.checkOutTime).padStart(2, "0")}:00`
                : null);

        const phones = [
            reservation.phone,
            guestRecord?.phone,
            liveReservation?.phone,
            liveReservation?.guest?.phone,
            hostifyReservation?.guest?.phone,
        ]
            .filter((phone) => phone !== undefined && phone !== null && String(phone).trim() !== "")
            .map((phone) => String(phone).trim())
            .filter((phone, index, array) => array.indexOf(phone) === index)
            .map((phone, index) => ({ value: phone, isDefault: index === 0, source: index === 0 ? "Reservation" : "Hostify" }));

        return {
            ...reservation,
            guestName: resolvedGuestName,
            guestEmail: resolvedGuestEmail,
            listingName: listing?.internalListingName || reservation.listingName || listing?.name || null,
            propertyType: this.normalizePropertyTypeValue(listing),
            serviceType: this.normalizeServiceTypeValue(listing, normalizedListing),
            portfolio: this.normalizePortfolioValue(listing),
            status: liveReservation?.status_description || liveReservation?.status || reservation.status || null,
            stayTiming: this.getStayTiming(reservation.arrivalDate || liveReservation?.checkIn, reservation.departureDate || liveReservation?.checkOut, timeZoneIdentifier),
            guestPicture: reservation.guestPicture || guestRecord?.picture || guestRecord?.thumbnail_url || hostifyReservation?.guest?.picture || liveReservation?.guest?.picture || liveReservation?.guest_picture || null,
            phones,
            hostNote,
            cleaningNote: cleaningNote ?? null,
            guests: liveReservation?.guests ?? reservation.numberOfGuests ?? null,
            adults: liveReservation?.adults ?? reservation.adults ?? null,
            children: liveReservation?.children ?? reservation.children ?? null,
            infants: liveReservation?.infants ?? reservation.infants ?? null,
            pets: liveReservation?.pets ?? reservation.pets ?? null,
            revenue: liveReservation?.revenue ?? reservation.totalPrice ?? null,
            netRevenue: liveReservation?.net_revenue ?? liveReservation?.payout_price ?? reservation.owner_revenue ?? null,
            nightRate: liveReservation?.price_per_night ?? liveReservation?.base_price ?? null,
            // reservation.base_price only gets populated on records synced *after* the
            // 20260705_add_base_price_to_reservation_info migration; for older rows the
            // column is still NULL in the DB. Fall back to the live Hostify value so the
            // Base Price row in the mitigation review modal doesn't render as "—".
            base_price: reservation.base_price ?? liveReservation?.base_price ?? null,
            cleaningFee: liveReservation?.cleaning_fee ?? reservation.cleaningFee ?? null,
            channelCommission: liveReservation?.channel_commission ?? reservation.channelCommissionAmount ?? null,
            confirmedAt: liveReservation?.confirmed_at ?? reservation.reservationDate ?? null,
            plannedArrival: liveReservation?.planned_arrival ?? null,
            plannedDeparture: liveReservation?.planned_departure ?? null,
            hostifyCheckinFormLink: liveReservation?.hostify_checkin_form_link ?? null,
            hostifyCheckinFormCompleted: liveReservation?.hostify_checkin_form_completed ?? null,
            customFields,
            timezoneIdentifier: timeZoneIdentifier,
            timezoneName: normalizedListing?.timezoneName || timeZoneIdentifier,
            checkInTimeLocal: checkInLocal,
            checkOutTimeLocal: checkOutLocal,
            checkInTimeEastern: normalizedListing?.checkInEastern || null,
            checkOutTimeEastern: normalizedListing?.checkOutEastern || null,
        };
    }

    async updateGuestReservationNotes(reservationId: number, payload: { hostNote?: string | null; cleaningNote?: string | null }) {
        const reservation = await this.reservationRepository.findOne({ where: { id: reservationId } });
        if (!reservation) {
            throw CustomErrorHandler.notFound("Reservation not found");
        }

        if (payload.hostNote !== undefined) {
            reservation.hostNote = payload.hostNote || null;
            await this.reservationRepository.save(reservation);
        }

        const hostifyPayload: Record<string, any> = {};
        if (payload.hostNote !== undefined) {
            hostifyPayload.host_note = payload.hostNote || "";
        }
        if (payload.cleaningNote !== undefined) {
            hostifyPayload.cleaning_note = payload.cleaningNote || "";
        }

        let syncStatus: "synced" | "local_only" = "local_only";
        let syncMessage: string | null = null;

        if (Object.keys(hostifyPayload).length) {
            try {
                await this.hostifyClient.updateReservationInfo(process.env.HOSTIFY_API_KEY, reservationId, hostifyPayload);
                syncStatus = "synced";
            } catch (error: any) {
                syncMessage = error?.response?.data?.message || error?.message || "Hostify sync failed";
                logger.warn(`[Hostify] Reservation notes sync failed for ${reservationId}: ${syncMessage}`);
            }
        }

        return {
            ...(await this.getGuestReservationDetails(reservationId)),
            syncStatus,
            syncMessage,
        };
    }

    async updateReservationCustomField(reservationId: number, customFieldId: number | string, value: any) {
        const reservation = await this.reservationRepository.findOne({ where: { id: reservationId } });
        if (!reservation) {
            throw CustomErrorHandler.notFound("Reservation not found");
        }

        await this.hostifyClient.updateReservationCustomField(process.env.HOSTIFY_API_KEY, reservationId, customFieldId, value ?? "");

        return {
            ...(await this.getGuestReservationDetails(reservationId)),
            syncStatus: "synced",
            syncMessage: null,
        };
    }
}
