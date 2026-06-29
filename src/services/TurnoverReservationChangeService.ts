import { In, IsNull } from "typeorm";
import { appDatabase, ensureTurnoverSettingsColumns } from "../utils/database.util";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { ReservationDetailPreStayAudit } from "../entity/ReservationDetailPreStayAudit";
import { ReservationDetailPostStayAudit } from "../entity/ReservationDetailPostStayAudit";
import { Listing } from "../entity/Listing";
import { TurnoverSettings } from "../entity/TurnoverSettings";
import { Contact } from "../entity/Contact";
import { ClientEntity } from "../entity/Client";
import { VendorAssignment } from "../entity/VendorAssignment";
import { OpenPhoneService } from "./OpenPhoneService";
import logger from "../utils/logger.utils";

type Recipient = { id?: number | string; name: string; contact?: string | null; role?: string | null };
type ReservationSnapshot = Partial<ReservationInfoEntity>;

const ACTIVE_RESERVATION_STATUSES = ["new", "accepted", "modified", "ownerStay", "moved"];
const CHANGE_FIELDS: Array<keyof ReservationInfoEntity> = ["arrivalDate", "departureDate", "checkInTime", "checkOutTime", "listingMapId", "status"];

export class TurnoverReservationChangeService {
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private preStayRepo = appDatabase.getRepository(ReservationDetailPreStayAudit);
    private postStayRepo = appDatabase.getRepository(ReservationDetailPostStayAudit);
    private listingRepo = appDatabase.getRepository(Listing);
    private settingsRepo = appDatabase.getRepository(TurnoverSettings);
    private contactRepo = appDatabase.getRepository(Contact);
    private clientRepo = appDatabase.getRepository(ClientEntity);
    private vendorAssignmentRepo = appDatabase.getRepository(VendorAssignment);
    private openPhoneService = new OpenPhoneService();

    async handleReservationUpdated(previous: ReservationSnapshot, current: ReservationInfoEntity): Promise<void> {
        await ensureTurnoverSettingsColumns();
        if (!this.hasRelevantChange(previous, current)) return;

        const [preStay, postStay] = await Promise.all([
            this.preStayRepo.findOne({ where: { reservationId: current.id } }),
            this.postStayRepo.findOne({ where: { reservationId: current.id } })
        ]);
        const preSent = preStay?.notificationStatus === "sent";
        const postSent = postStay?.cleanerNotificationStatus === "sent";
        if (!preSent && !postSent) return;

        const listing = await this.listingRepo.findOne({ where: { id: current.listingMapId } });
        if (!listing) return;

        const settings = await this.getEffectiveSettings(listing.id);
        const wasSameDay = await this.hasSameDayPair(previous);
        const isSameDay = await this.hasSameDayPair(current);
        const becameSameDay = !wasSameDay && isSameDay && settings.sameDayCombinedEnabled;
        const becameCancelled = this.isCancelled(current.status) && !this.isCancelled(previous.status);
        const scheduleChanged = CHANGE_FIELDS.some((field) => field !== "status" && this.normalizeValue(previous[field]) !== this.normalizeValue(current[field]));

        if (!becameCancelled && !scheduleChanged && !becameSameDay) return;

        const message = this.buildCorrectionMessage({
            previous,
            current,
            listing,
            becameCancelled,
            scheduleChanged,
            becameSameDay
        });
        const recipientIds = this.getRecipientIds(settings, preSent, postSent, becameSameDay);
        const recipients = await this.resolveRecipients(current, recipientIds);
        if (!recipients.length) {
            logger.warn(`[TurnoverReservationChange] No recipients found for reservation ${current.id} correction.`);
            return;
        }

        await this.sendCorrectionMessages(current.id, recipients, message, listing, settings);
        logger.info(`[TurnoverReservationChange] Correction handled for reservation ${current.id}. Pre-sent: ${preSent}; Post-sent: ${postSent}.`);
    }

    private hasRelevantChange(previous: ReservationSnapshot, current: ReservationInfoEntity) {
        return CHANGE_FIELDS.some((field) => this.normalizeValue(previous[field]) !== this.normalizeValue(current[field]));
    }

    private normalizeValue(value: unknown) {
        if (value instanceof Date) return value.toISOString().slice(0, 10);
        if (typeof value === "string") return value.trim();
        if (value === undefined || value === null) return "";
        return String(value);
    }

    private isCancelled(status?: string | null) {
        return String(status || "").trim().toLowerCase() === "cancelled";
    }

    private sameDate(a?: Date | string | null, b?: Date | string | null) {
        const left = this.normalizeValue(a);
        const right = this.normalizeValue(b);
        return !!left && !!right && left === right;
    }

    private async hasSameDayPair(reservation: ReservationSnapshot) {
        const listingId = reservation.listingMapId;
        if (!listingId || this.isCancelled(reservation.status)) return false;
        const reservations = await this.reservationRepo.find({
            where: {
                listingMapId: listingId as number,
                status: In(ACTIVE_RESERVATION_STATUSES)
            }
        });
        return reservations.some((candidate) => {
            if (candidate.id === reservation.id) return false;
            return this.sameDate(candidate.departureDate, reservation.arrivalDate) ||
                this.sameDate(candidate.arrivalDate, reservation.departureDate);
        });
    }

    private async getEffectiveSettings(listingId: number) {
        const [settings, globalSettings] = await Promise.all([
            this.settingsRepo.findOne({ where: { listingId } }),
            this.settingsRepo.findOne({ where: { listingId: 0 } })
        ]);
        const resolve = <T>(propertyValue: T | null | undefined, globalValue: T | null | undefined, fallback: T): T =>
            propertyValue !== undefined && propertyValue !== null ? propertyValue : (globalValue !== undefined && globalValue !== null ? globalValue : fallback);
        return {
            preStayRecipientIds: resolve(settings?.preStayRecipientIds, globalSettings?.preStayRecipientIds, [] as string[]) || [],
            postStayRecipientIds: resolve(settings?.postStayRecipientIds, globalSettings?.postStayRecipientIds, [] as string[]) || [],
            sameDayCombinedEnabled: resolve(settings?.sameDayCombinedEnabled, globalSettings?.sameDayCombinedEnabled, false),
            cleanerSenderNumber: resolve(settings?.cleanerSenderNumber, globalSettings?.cleanerSenderNumber, process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER || null),
            cleanerSenderNumberGroup1: resolve(settings?.cleanerSenderNumberGroup1, globalSettings?.cleanerSenderNumberGroup1, process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP1 || null),
            cleanerSenderNumberGroup2: resolve(settings?.cleanerSenderNumberGroup2, globalSettings?.cleanerSenderNumberGroup2, process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP2 || null),
            ownerSenderNumber: resolve(settings?.ownerSenderNumber, globalSettings?.ownerSenderNumber, process.env.OWNER_TURNOVER_SMS_SENDER_NUMBER || null)
        };
    }

    private getRecipientIds(
        settings: Awaited<ReturnType<TurnoverReservationChangeService["getEffectiveSettings"]>>,
        preSent: boolean,
        postSent: boolean,
        becameSameDay: boolean
    ) {
        const ids = [
            ...(preSent || becameSameDay ? settings.preStayRecipientIds : []),
            ...(postSent || becameSameDay ? settings.postStayRecipientIds : [])
        ];
        return Array.from(new Set(ids));
    }

    private async resolveRecipients(reservation: ReservationInfoEntity, recipientIds: string[]) {
        const recipients: Recipient[] = [];
        const addRecipient = (recipient: Recipient | null) => {
            if (!recipient?.contact) return;
            const key = `${recipient.role || ""}:${recipient.id || recipient.contact}`;
            if (recipients.some((existing) => `${existing.role || ""}:${existing.id || existing.contact}` === key)) return;
            recipients.push(recipient);
        };

        const contactIds = recipientIds.filter((id) => id.startsWith("contact:")).map((id) => Number(id.split(":")[1])).filter(Number.isFinite);
        if (contactIds.length) {
            const contacts = await this.contactRepo.find({
                where: { id: In(contactIds), status: In(["active", "active-backup"] as any), deletedAt: null as any }
            });
            contacts.forEach((contact) => addRecipient({ id: `contact:${contact.id}`, name: contact.name, contact: contact.contact, role: contact.role || "Contact" }));
        }

        for (const id of recipientIds) {
            if (id.startsWith("vendor:")) {
                const vendorProfileId = Number(id.split(":")[1]);
                if (!Number.isFinite(vendorProfileId)) continue;
                const assignment = await this.vendorAssignmentRepo.findOne({
                    where: {
                        vendorProfileId,
                        listingId: String(reservation.listingMapId),
                        status: "active",
                        deletedAt: IsNull()
                    },
                    relations: ["vendorProfile"]
                });
                if (assignment?.vendorProfile?.contact) {
                    addRecipient({
                        id: `vendor:${assignment.vendorProfile.id}`,
                        name: assignment.vendorProfile.name,
                        contact: assignment.vendorProfile.contact,
                        role: assignment.role || "Vendor"
                    });
                }
            } else if (id.startsWith("owner:") || id.startsWith("client:")) {
                const client = await this.clientRepo.findOne({ where: { id: id.split(":")[1] } });
                if (client?.phone) {
                    addRecipient({
                        id,
                        name: client.preferredName || `${client.firstName || ""} ${client.lastName || ""}`.trim() || "Owner",
                        contact: client.phone,
                        role: id.startsWith("owner:") ? "Owner" : "Client"
                    });
                }
            }
        }

        if (!recipients.length) {
            const fallbackAssignments = await this.vendorAssignmentRepo.find({
                where: { listingId: String(reservation.listingMapId), status: "active", deletedAt: IsNull() },
                relations: ["vendorProfile"],
                order: { role: "ASC" as any, id: "ASC" as any }
            });
            fallbackAssignments
                .filter((assignment) => assignment.vendorProfile?.contact)
                .forEach((assignment) => addRecipient({
                    id: `vendor:${assignment.vendorProfile.id}`,
                    name: assignment.vendorProfile.name,
                    contact: assignment.vendorProfile.contact,
                    role: assignment.role || "Vendor"
                }));
        }

        return recipients;
    }

    private buildCorrectionMessage(params: {
        previous: ReservationSnapshot;
        current: ReservationInfoEntity;
        listing: Listing;
        becameCancelled: boolean;
        scheduleChanged: boolean;
        becameSameDay: boolean;
    }) {
        const { previous, current, listing, becameCancelled, becameSameDay } = params;
        const propertyName = listing.internalListingName || listing.name || `Listing ${listing.id}`;
        const previousDates = `${this.formatDate(previous.arrivalDate)} to ${this.formatDate(previous.departureDate)}`;
        const currentDates = `${this.formatDate(current.arrivalDate)} to ${this.formatDate(current.departureDate)}`;
        const lines = [
            `${propertyName} Turnover Update`,
            "",
            `Reservation #${current.reservationId || current.hostawayReservationId || current.id}`,
            `Guest: ${current.guestName || "Guest"}`,
            `Previous stay: ${previousDates}`,
            `Current stay: ${currentDates}`,
            `Check-in time: ${this.formatTime(current.checkInTime ?? listing.checkInTimeStart)}`,
            `Check-out time: ${this.formatTime(current.checkOutTime ?? listing.checkOutTime)}`
        ];
        if (becameCancelled) {
            lines.push("", "This reservation has been cancelled. Please do not follow the previously sent turnover message for this reservation.");
        } else if (becameSameDay) {
            lines.push("", "This reservation is now part of a same-day turnover. Please follow this updated same-day turnover information instead of the earlier separate message.");
        } else {
            lines.push("", "The reservation dates or times changed after the turnover message was sent. Please follow this updated information.");
        }
        return lines.join("\n");
    }

    private formatDate(value?: Date | string | null) {
        if (!value) return "Not set";
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    private formatTime(value?: string | number | null) {
        if (value === undefined || value === null || value === "") return "Not set";
        if (typeof value === "number") return `${String(Math.floor(value)).padStart(2, "0")}:00`;
        return String(value);
    }

    private getListingPortfolioGroup(listing: Listing) {
        const tags = String(listing.tags || "").toLowerCase();
        if (tags.includes("group1")) return "group1";
        if (tags.includes("group2")) return "group2";
        return null;
    }

    private getSenderNumberForRecipient(
        recipient: Recipient,
        listing: Listing,
        settings: Awaited<ReturnType<TurnoverReservationChangeService["getEffectiveSettings"]>>
    ) {
        const role = String(recipient.role || "").toLowerCase();
        if (role === "owner" || role === "client") {
            return settings.ownerSenderNumber || process.env.OWNER_TURNOVER_SMS_SENDER_NUMBER || process.env.CHECKIN_SMS_SENDER_NUMBER || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER;
        }
        const group = this.getListingPortfolioGroup(listing);
        if (group === "group1") return settings.cleanerSenderNumberGroup1 || settings.cleanerSenderNumber || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP1 || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER;
        if (group === "group2") return settings.cleanerSenderNumberGroup2 || settings.cleanerSenderNumber || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP2 || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER;
        return settings.cleanerSenderNumber || process.env.CHECKIN_SMS_SENDER_NUMBER || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER;
    }

    private async sendCorrectionMessages(
        reservationId: number,
        recipients: Recipient[],
        message: string,
        listing: Listing,
        settings: Awaited<ReturnType<TurnoverReservationChangeService["getEffectiveSettings"]>>
    ) {
        if (!process.env.OPEN_PHONE_API_KEY) {
            logger.warn(`[TurnoverReservationChange] OpenPhone is not configured; correction not sent for reservation ${reservationId}.`);
            return;
        }
        for (const recipient of recipients) {
            const senderNumber = this.getSenderNumberForRecipient(recipient, listing, settings);
            if (!senderNumber) {
                logger.warn(`[TurnoverReservationChange] SMS sender number is not configured; correction not sent for reservation ${reservationId}.`);
                continue;
            }
            const phoneNumber = this.openPhoneService.formatPhoneNumber("+1", recipient.contact);
            if (!phoneNumber) {
                logger.warn(`[TurnoverReservationChange] Invalid correction recipient phone for reservation ${reservationId}: ${recipient.name}`);
                continue;
            }
            await this.openPhoneService.sendSMSWithSender(phoneNumber, message, senderNumber);
            logger.info(`[TurnoverReservationChange] Correction sent to ${recipient.name} for reservation ${reservationId}.`);
        }
    }

}
