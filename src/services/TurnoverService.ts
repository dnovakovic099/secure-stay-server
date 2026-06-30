import { appDatabase, ensureTurnoverSettingsColumns } from "../utils/database.util";
import { TurnoverSettings } from "../entity/TurnoverSettings";
import { ReservationDetailPreStayAudit } from "../entity/ReservationDetailPreStayAudit";
import { ReservationDetailPostStayAudit } from "../entity/ReservationDetailPostStayAudit";
import { Listing } from "../entity/Listing";
import { Contact } from "../entity/Contact";
import { ClientEntity } from "../entity/Client";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { VendorAssignment } from "../entity/VendorAssignment";
import { TurnoverSenderNumber, TurnoverSenderLabel } from "../entity/TurnoverSenderNumber";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { UpsellOrder } from "../entity/UpsellOrder";
import logger from "../utils/logger.utils";
import { Between, In, IsNull, Like, MoreThan, MoreThanOrEqual, LessThan, LessThanOrEqual, Raw } from "typeorm";
import axios from "axios";
import { Hostify } from "../client/Hostify";
import { format } from "date-fns";
import { CleanerNotified } from "../entity/ReservationDetailPreStayAudit";
import { renderTurnoverTemplate } from "../utils/turnoverTemplate.util";
import { ClientService } from "./ClientService";
import { VendorProfileService } from "./VendorProfileService";

const HOSTIFY_API_KEY = process.env.HOSTIFY_API_KEY || 'aOGSVrcPGOvvSsGD4idPKvxKaD0HGaAW';
const HOSTIFY_BASE_URL = 'https://api-rms.hostify.com';
const DEFAULT_PRE_STAY_TEMPLATE = `{propertyName} Check-In Notification

Address: {address}

Reservation #{reservationId}
Guest: {guestName}
Check-In Date: {checkInDate}

{upsellInfo}`;

const DEFAULT_POST_STAY_TEMPLATE = `{propertyName} Checkout Notification

Address: {address}

Reservation #{reservationId}
Guest: {guestName}
Checkout Date: {checkOutDate}

{upsellInfo}

Please ensure property is cleaned and restocked.`;

const DEFAULT_SAME_DAY_TEMPLATE = `{propertyName} Same-Day Turnover Notification

Address: {address}

Checkout Reservation #{postStayReservationId}
Arriving Reservation #{preStayReservationId}

Outgoing Guest: {postStayGuestName}
Incoming Guest: {preStayGuestName}

Checkout Date: {checkOutDate}
Check-In Date: {checkInDate}

{turnoverNotes}`;

const DEFAULT_RESERVATION_CHANGE_TEMPLATE = `{propertyName} Turnover Update

Reservation #{reservationId}
Guest: {guestName}
Status: {reservationStatus}

Previous stay: {previousStay}
Current stay: {currentStay}
Check-in time: {checkInTime}
Check-out time: {checkOutTime}

{changeSummary}`;
const TURNOVER_RESERVATION_STATUSES = ["new", "accepted", "modified", "ownerStay", "moved"];

interface TurnoverNotification {
    id: number;
    reservationId: number;
    listingId: number;
    listingName: string;
    listingNickname: string;
    address: string;
    propertyType: 'Own' | 'Arb' | 'PM';
    serviceType?: string | null;
    listingTimezone?: string;
    listingTimezoneLabel?: string;
    listingTags?: string;
    
    guestName: string;
    checkInDate: string;
    checkOutDate: string;
    checkInTime?: string | number;
    checkOutTime?: string | number;
    reservationCode?: string;
    
    notificationType: 'pre-stay' | 'post-stay';
    contactId?: number;
    contactName?: string;
    contactPhone?: string;
    contactRole?: string;
    messagePreview?: string;
    sentMessage?: string;
    turnoverNotes?: string;
    
    status: 'pending' | 'sent' | 'failed' | 'skipped' | 'paused';
    sentAt?: string;
    error?: string;
    templateErrorVariables?: string[];
    isSameDayTurnover?: boolean;
    preStayAuditStatus?: string | null;
    postStayAuditStatus?: string | null;
    
    // Owner info
    ownerName?: string;
    ownerEmail?: string;
    ownerPhone?: string;
    
    upsells?: any[];
    createdAt: string;
    updatedAt: string;
}

interface TurnoverFilters {
    search?: string;
    notificationType?: string[];
    status?: string[];
    propertyType?: string[];
    fromDate?: string;
    toDate?: string;
    listingId?: number;
    date?: 'today' | 'tomorrow';
    dateField?: 'checkIn' | 'checkOut';
    scopes?: string[];
}

interface TurnoverRecipientOption {
    value: string;
    label: string;
    role: string;
    phone?: string;
    kind: 'contact' | 'owner' | 'client';
}

type BackendSettingSnapshot = {
    preStayEnabled: boolean;
    postStayEnabled: boolean;
    sameDayCombinedEnabled: boolean;
    preStayScheduleMode: string;
    postStayScheduleMode: string;
    sameDayScheduleMode: string;
    preStayOffsetMinutes: number;
    postStayOffsetMinutes: number;
    sameDayOffsetMinutes: number;
    preStayMessageTemplate: string;
    postStayMessageTemplate: string;
    sameDayCombinedMessageTemplate: string;
    smsSenderNumber: string | null;
    cleanerSenderNumber: string | null;
    cleanerSenderNumberGroup1: string | null;
    cleanerSenderNumberGroup2: string | null;
    ownerSenderNumber: string | null;
    reservationChangeUpdatesEnabled: boolean;
    reservationChangeMessageTemplate: string;
    preStayDefaultRecipientType: TurnoverDefaultRecipientType;
    postStayDefaultRecipientType: TurnoverDefaultRecipientType;
    preStayScheduleDescription: string;
    postStayScheduleDescription: string;
    sameDayScheduleDescription: string;
};

type TurnoverDefaultRecipientType = "cleaner" | "owner" | "custom";

export class TurnoverService {
    private clientRepo = appDatabase.getRepository(ClientEntity);
    private clientPropertyRepo = appDatabase.getRepository(ClientPropertyEntity);
    private hostifyClient = new Hostify();
    private getZoneDateParts(date: Date, timeZone: string) {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).formatToParts(date);
        const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
        return {
            year: Number(get("year")),
            month: Number(get("month")),
            day: Number(get("day")),
            hour: Number(get("hour")),
            minute: Number(get("minute")),
            second: Number(get("second"))
        };
    }

    private getZoneOffsetMinutes(date: Date, timeZone: string): number {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            timeZoneName: "shortOffset",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).formatToParts(date);
        const tz = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
        const match = /GMT([+-]\d{1,2})(?::?(\d{2}))?/.exec(tz);
        if (!match) return 0;
        const sign = match[1].startsWith("-") ? -1 : 1;
        const hours = Math.abs(parseInt(match[1], 10));
        const minutes = match[2] ? parseInt(match[2], 10) : 0;
        return sign * (hours * 60 + minutes);
    }

    private zoneLocalToUtcDate(
        year: number,
        month: number,
        day: number,
        hour: number,
        minute: number,
        second: number,
        millisecond: number,
        timeZone: string
    ) {
        const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
        const offsetMinutes = this.getZoneOffsetMinutes(utcDate, timeZone);
        return new Date(utcDate.getTime() - offsetMinutes * 60 * 1000);
    }

    private getEasternDayRanges() {
        const timeZone = "America/New_York";
        const now = new Date();
        const todayParts = this.getZoneDateParts(now, timeZone);
        // Derive tomorrow by incrementing the Eastern calendar day to avoid DST
        // boundary errors (adding 24 h can land on the same calendar day during
        // the spring-forward transition).
        const tomorrowUtc = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day + 1, 12, 0, 0));
        const tomorrowParts = this.getZoneDateParts(tomorrowUtc, timeZone);

        const todayStart = this.zoneLocalToUtcDate(todayParts.year, todayParts.month, todayParts.day, 0, 0, 0, 0, timeZone);
        const todayEnd = this.zoneLocalToUtcDate(todayParts.year, todayParts.month, todayParts.day, 23, 59, 59, 999, timeZone);
        const tomorrowStart = this.zoneLocalToUtcDate(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, 0, 0, 0, 0, timeZone);
        const tomorrowEnd = this.zoneLocalToUtcDate(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, 23, 59, 59, 999, timeZone);

        const todayKey = `${todayParts.year}-${String(todayParts.month).padStart(2, "0")}-${String(todayParts.day).padStart(2, "0")}`;
        const tomorrowKey = `${tomorrowParts.year}-${String(tomorrowParts.month).padStart(2, "0")}-${String(tomorrowParts.day).padStart(2, "0")}`;

        return { todayStart, todayEnd, tomorrowStart, tomorrowEnd, todayKey, tomorrowKey };
    }
    private settingsRepo = appDatabase.getRepository(TurnoverSettings);
    private preStayRepo = appDatabase.getRepository(ReservationDetailPreStayAudit);
    private postStayRepo = appDatabase.getRepository(ReservationDetailPostStayAudit);
    private listingRepo = appDatabase.getRepository(Listing);
    private contactRepo = appDatabase.getRepository(Contact);
    private vendorAssignmentRepo = appDatabase.getRepository(VendorAssignment);
    private senderNumberRepo = appDatabase.getRepository(TurnoverSenderNumber);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private upsellRepo = appDatabase.getRepository(UpsellOrder);

    private async ensureSettingsSchema() {
        await ensureTurnoverSettingsColumns();
    }

    private normalizeTimeZoneCandidate(candidate?: string) {
        if (!candidate) return "";
        const normalized = candidate.trim();
        const lower = normalized.toLowerCase();
        const aliases: Record<string, string> = {
            "eastern time": "America/New_York",
            "central time": "America/Chicago",
            "mountain time": "America/Denver",
            "pacific time": "America/Los_Angeles",
            "us/eastern": "America/New_York",
            "us/central": "America/Chicago",
            "us/mountain": "America/Denver",
            "us/pacific": "America/Los_Angeles",
        };
        if (aliases[lower]) return aliases[lower];
        return normalized;
    }

    private isValidTimeZone(timeZone?: string) {
        if (!timeZone) return false;
        try {
            Intl.DateTimeFormat("en-US", { timeZone });
            return true;
        } catch {
            return false;
        }
    }

    private mapStateToTimeZone(stateCode?: string) {
        if (!stateCode) return "America/New_York";
        const state = stateCode.toUpperCase();
        const pacific = ["WA", "OR", "CA", "NV"];
        const mountain = ["ID", "MT", "WY", "UT", "CO", "NM", "AZ"];
        const central = [
            "ND",
            "SD",
            "NE",
            "KS",
            "OK",
            "TX",
            "MN",
            "IA",
            "MO",
            "AR",
            "LA",
            "WI",
            "IL",
            "MS",
            "AL",
        ];
        if (pacific.includes(state)) return "America/Los_Angeles";
        if (mountain.includes(state)) return "America/Denver";
        if (central.includes(state)) return "America/Chicago";
        return "America/New_York";
    }

    private formatDateOnly(value?: Date | string | null) {
        if (!value) return "";
        if (typeof value === "string") {
            return value.length >= 10 ? value.slice(0, 10) : value;
        }
        if (!(value instanceof Date)) return "";
        const time = value.getTime();
        if (Number.isNaN(time)) return "";
        // Use local date parts to avoid UTC off-by-one when the server timezone
        // differs from UTC (e.g. a Date representing midnight local time would
        // shift to the previous day if serialised via toISOString/UTC).
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, "0");
        const d = String(value.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    private resolveTimeZone(listing: any) {
        const candidateRaw =
            listing?.timeZoneName ||
            listing?.timezone ||
            listing?.time_zone ||
            listing?.listingTimeZoneName ||
            "";
        const candidate = this.normalizeTimeZoneCandidate(candidateRaw);
        if (this.isValidTimeZone(candidate)) return candidate;
        if (listing?.state) return this.mapStateToTimeZone(listing.state);
        if (listing?.address) {
            const match = listing.address.match(/\b([A-Z]{2})\b/);
            if (match?.[1]) return this.mapStateToTimeZone(match[1]);
        }
        return "";
    }

    private getReadableTimeZone(timeZone?: string) {
        const labels: Record<string, string> = {
            "America/New_York": "Eastern Time",
            "America/Chicago": "Central Time",
            "America/Denver": "Mountain Time",
            "America/Phoenix": "Mountain Time",
            "America/Los_Angeles": "Pacific Time",
            "America/Anchorage": "Alaska Time",
            "Pacific/Honolulu": "Hawaii Time",
        };
        if (!timeZone) return "";
        return labels[timeZone] || timeZone;
    }

    private getPropertyTypeLabel(listing: Listing): 'Own' | 'Arb' | 'PM' {
        const tags = (listing.tags || '').toLowerCase();
        if (tags.includes('own')) return 'Own';
        if (tags.includes('arb')) return 'Arb';
        return 'PM';
    }

    private getServiceTypeLabel(listing: Listing): string | null {
        const tags = (listing.tags || '').toLowerCase();
        if (tags.includes('full')) return 'Full';
        if (tags.includes('pro')) return 'Pro';
        if (tags.includes('launch')) return 'Launch';
        return null;
    }

    private isEnabledEnv(name: string) {
        return process.env[name] === 'true';
    }

    private getCheckInSenderNumber() {
        return process.env.CHECKIN_SMS_SENDER_NUMBER || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER || null;
    }

    private getCheckoutSenderNumber() {
        return process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER || null;
    }

    private getOwnerSenderNumber() {
        return process.env.OWNER_TURNOVER_SMS_SENDER_NUMBER || process.env.CHECKIN_SMS_SENDER_NUMBER || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER || null;
    }

    private getCurrentBackendSnapshot(): BackendSettingSnapshot {
        return {
            preStayEnabled: true,
            postStayEnabled: true,
            sameDayCombinedEnabled: false,
            preStayScheduleMode: 'auto',
            postStayScheduleMode: 'auto',
            sameDayScheduleMode: 'post-stay',
            preStayOffsetMinutes: 0,
            postStayOffsetMinutes: 0,
            sameDayOffsetMinutes: 0,
            preStayMessageTemplate: DEFAULT_PRE_STAY_TEMPLATE,
            postStayMessageTemplate: DEFAULT_POST_STAY_TEMPLATE,
            sameDayCombinedMessageTemplate: DEFAULT_SAME_DAY_TEMPLATE,
            smsSenderNumber: this.getCheckInSenderNumber() || this.getCheckoutSenderNumber(),
            cleanerSenderNumber: this.getCheckoutSenderNumber(),
            cleanerSenderNumberGroup1: process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP1 || this.getCheckoutSenderNumber(),
            cleanerSenderNumberGroup2: process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP2 || this.getCheckoutSenderNumber(),
            ownerSenderNumber: this.getOwnerSenderNumber(),
            reservationChangeUpdatesEnabled: true,
            reservationChangeMessageTemplate: DEFAULT_RESERVATION_CHANGE_TEMPLATE,
            preStayDefaultRecipientType: "cleaner",
            postStayDefaultRecipientType: "cleaner",
            preStayScheduleDescription: 'Default pre-stay timing. Property settings override this value.',
            postStayScheduleDescription: 'Default post-stay timing. Property settings override this value.',
            sameDayScheduleDescription: 'When enabled, same-day turnover suppresses separate pre-stay/post-stay sends and uses the earlier configured pre/post schedule.'
        };
    }

    private resolveValue<T>(propertyValue: T | null | undefined, globalValue: T | null | undefined, fallback: T): T {
        return propertyValue !== undefined && propertyValue !== null ? propertyValue : (globalValue !== undefined && globalValue !== null ? globalValue : fallback);
    }

    private resolveEnabledValue(
        settings: TurnoverSettings | null,
        field: 'preStayEnabled' | 'postStayEnabled' | 'sameDayCombinedEnabled',
        _overrideField: 'preStayEnabledOverride' | 'postStayEnabledOverride' | 'sameDayCombinedEnabledOverride',
        globalValue: boolean | null | undefined,
        fallback: boolean
    ) {
        // Global OFF is a hard kill: nothing sends when the global toggle is false.
        if (globalValue === false) return false;
        // Property explicit OFF wins for that one listing.
        if (settings?.[field] === false) return false;
        return globalValue !== undefined && globalValue !== null ? Boolean(globalValue) : fallback;
    }

    private resolveSource(settings: TurnoverSettings | null, fields: (keyof TurnoverSettings)[]) {
        if (!settings) return 'global';
        return fields.some((field) => (settings as any)[field] !== undefined && (settings as any)[field] !== null)
            ? 'property'
            : 'global';
    }

    private normalizeRecipientIds(values?: unknown, fallbackId?: number | null): string[] {
        if (Array.isArray(values)) {
            const normalized = values
                .map((value) => String(value || '').trim())
                .filter(Boolean);
            if (normalized.length > 0) return normalized;
        }
        if (fallbackId) return [`contact:${fallbackId}`];
        return [];
    }

    private normalizeSenderNumbers(data: any) {
        ['cleanerSenderNumber', 'cleanerSenderNumberGroup1', 'cleanerSenderNumberGroup2', 'ownerSenderNumber'].forEach((field) => {
            if (field in data) {
                const value = String(data[field] || '').trim();
                data[field] = value || null;
            }
        });
    }

    private normalizeDefaultRecipientType(value: any): TurnoverDefaultRecipientType | null {
        if (value === undefined || value === null || value === "") return null;
        const normalized = String(value).trim().toLowerCase();
        if (normalized === "owner") return "owner";
        if (normalized === "custom") return "custom";
        return "cleaner";
    }

    private normalizeRecipientDefaults(data: any) {
        (["preStayDefaultRecipientType", "postStayDefaultRecipientType"] as const).forEach((field) => {
            if (field in data) {
                data[field] = this.normalizeDefaultRecipientType(data[field]);
            }
        });
    }

    private getDefaultRecipientType(settingsValue: any, globalValue: any, ids: string[]): TurnoverDefaultRecipientType {
        return this.normalizeDefaultRecipientType(settingsValue) ||
            this.normalizeDefaultRecipientType(globalValue) ||
            (ids.length > 0 ? "custom" : "cleaner");
    }

    private getDynamicRecipientIds(type: TurnoverDefaultRecipientType, options: TurnoverRecipientOption[]) {
        if (type === "cleaner") {
            const cleaner = options.find((option) => option.kind === "contact" && String(option.role || "").toLowerCase() === "cleaner") ||
                options.find((option) => option.kind === "contact");
            return cleaner ? [cleaner.value] : [];
        }
        if (type === "owner") {
            const owner = options.find((option) => option.kind === "owner" || String(option.role || "").toLowerCase() === "owner");
            return owner ? [owner.value] : [];
        }
        return [];
    }

    private resolveRecipientIdsForMode(
        type: TurnoverDefaultRecipientType,
        explicitIds: string[],
        options: TurnoverRecipientOption[]
    ) {
        return type === "custom" ? explicitIds : this.getDynamicRecipientIds(type, options);
    }

    private messageSource(settings: TurnoverSettings | null, field: keyof TurnoverSettings): "property" | "global" {
        return settings && settings[field] !== undefined && settings[field] !== null && String(settings[field] || "").trim() !== "" ? "property" : "global";
    }

    private getRecipientNames(recipientIds: string[], options: TurnoverRecipientOption[]) {
        if (!recipientIds.length) return [];
        const optionMap = new Map(options.map((option) => [option.value, option.label]));
        return recipientIds.map((id) => optionMap.get(id)).filter(Boolean);
    }

    private async getRecipientOptionsForListing(listing: Listing): Promise<TurnoverRecipientOption[]> {
        const options: TurnoverRecipientOption[] = [];
        const seen = new Set<string>();

        const addOption = (option: TurnoverRecipientOption | null) => {
            if (!option || seen.has(option.value)) return;
            seen.add(option.value);
            options.push(option);
        };

        const vendorAssignments = await this.vendorAssignmentRepo.find({
            where: {
                listingId: String(listing.id),
                status: "active",
                deletedAt: IsNull()
            },
            relations: ["vendorProfile"],
            order: { role: "ASC" as any, id: "ASC" as any }
        });

        vendorAssignments.forEach((assignment) => {
            const vendor = assignment.vendorProfile;
            if (!vendor || vendor.deletedAt || !vendor.contact) return;
            addOption({
                value: `vendor:${vendor.id}`,
                label: `${vendor.name} (${assignment.role || 'Vendor'})`,
                role: assignment.role || 'Vendor',
                phone: vendor.contact || undefined,
                kind: 'contact'
            });
        });

        const clientProperties = await this.clientPropertyRepo.find({
            where: [
                { listingId: String(listing.id) },
                { hostifyListingId: String(listing.id) }
            ],
            relations: ['client']
        });

        clientProperties.forEach((property) => {
            const client = property.client;
            if (!client) return;
            const displayName = [client.preferredName || '', `${client.firstName || ''} ${client.lastName || ''}`.trim()]
                .map((value) => value.trim())
                .filter(Boolean)[0] || 'Client';
            addOption({
                value: `owner:${client.id}`,
                label: `${displayName} (Owner)`,
                role: 'Owner',
                phone: client.phone || undefined,
                kind: 'owner'
            });
        });

        return options;
    }

    private static readonly SENDER_LABELS: TurnoverSenderLabel[] = [
        "cleaner_default",
        "cleaner_group_1",
        "cleaner_group_2",
        "owners"
    ];

    private isValidSenderLabel(label: unknown): label is TurnoverSenderLabel {
        return typeof label === "string" && (TurnoverService.SENDER_LABELS as string[]).includes(label);
    }

    private formatSenderValue(countryCode: string | null | undefined, phone: string) {
        const code = String(countryCode || "").trim();
        const normalizedCode = code ? (code.startsWith("+") ? code : `+${code}`) : "";
        const trimmedPhone = String(phone || "").trim();
        if (!trimmedPhone) return "";
        return trimmedPhone.startsWith("+") ? trimmedPhone : `${normalizedCode}${trimmedPhone}`;
    }

    private mapSenderRow(row: TurnoverSenderNumber) {
        const value = this.formatSenderValue(row.countryCode, row.phone);
        return {
            id: row.id,
            label: row.label,
            value,
            displayName: row.displayName || null,
            countryCode: row.countryCode,
            phone: row.phone,
            isActive: Boolean(row.isActive),
            optionLabel: row.displayName ? `${row.displayName} (${value})` : value
        };
    }

    async getSenderNumberOptions(label?: string) {
        const where: any = { isActive: 1 };
        if (label && this.isValidSenderLabel(label)) where.label = label;
        const rows = await this.senderNumberRepo.find({
            where,
            order: { label: "ASC" as any, phone: "ASC" as any }
        });
        return rows
            .filter((row) => row.phone)
            .map((row) => {
                const mapped = this.mapSenderRow(row);
                return {
                    id: mapped.id,
                    value: mapped.value,
                    label: mapped.optionLabel,
                    senderLabel: mapped.label
                };
            });
    }

    async listSenderNumbers() {
        const rows = await this.senderNumberRepo.find({
            order: { label: "ASC" as any, phone: "ASC" as any }
        });
        return rows.map((row) => this.mapSenderRow(row));
    }

    async createSenderNumber(input: { label: string; countryCode?: string; phone: string; displayName?: string | null }, userId?: string) {
        if (!this.isValidSenderLabel(input.label)) {
            throw new Error(`Invalid sender label "${input.label}". Allowed: ${TurnoverService.SENDER_LABELS.join(", ")}`);
        }
        const phone = String(input.phone || "").trim();
        if (!phone) throw new Error("Phone number is required");
        const countryCode = String(input.countryCode || "+1").trim() || "+1";
        const duplicate = await this.senderNumberRepo.findOne({ where: { label: input.label, phone } });
        if (duplicate) throw new Error("This number already exists for the selected label");
        const entity = this.senderNumberRepo.create({
            label: input.label,
            phone,
            countryCode: countryCode.startsWith("+") ? countryCode : `+${countryCode}`,
            displayName: input.displayName?.toString().trim() || null,
            isActive: 1,
            updatedBy: userId || null
        });
        const saved = await this.senderNumberRepo.save(entity);
        return this.mapSenderRow(saved);
    }

    async updateSenderNumber(id: number, input: { label?: string; countryCode?: string; phone?: string; displayName?: string | null; isActive?: boolean }, userId?: string) {
        const existing = await this.senderNumberRepo.findOne({ where: { id } });
        if (!existing) throw new Error("Sender number not found");
        if (input.label !== undefined) {
            if (!this.isValidSenderLabel(input.label)) throw new Error("Invalid sender label");
            existing.label = input.label;
        }
        if (input.phone !== undefined) {
            const phone = String(input.phone).trim();
            if (!phone) throw new Error("Phone number is required");
            existing.phone = phone;
        }
        if (input.countryCode !== undefined) {
            const code = String(input.countryCode).trim() || "+1";
            existing.countryCode = code.startsWith("+") ? code : `+${code}`;
        }
        if (input.displayName !== undefined) {
            existing.displayName = input.displayName ? String(input.displayName).trim() : null;
        }
        if (input.isActive !== undefined) {
            existing.isActive = input.isActive ? 1 : 0;
        }
        existing.updatedBy = userId || existing.updatedBy;
        const saved = await this.senderNumberRepo.save(existing);
        return this.mapSenderRow(saved);
    }

    async deleteSenderNumber(id: number) {
        const existing = await this.senderNumberRepo.findOne({ where: { id } });
        if (!existing) throw new Error("Sender number not found");
        await this.senderNumberRepo.delete({ id });
        return { id };
    }

    private async getCurrentBackendCleanerContacts(listingId: number): Promise<Contact[]> {
        return this.contactRepo.find({
            where: {
                listingId: String(listingId),
                role: 'Cleaner',
                status: 'active',
                deletedAt: null as any
            },
            order: { isPrimary: 'DESC', name: 'ASC' as any }
        });
    }

    private getContactRecipientId(contact?: Contact | null) {
        return contact?.id ? `contact:${contact.id}` : null;
    }

    private extractHostifyNoteValue(reservation: any, keys: string[]) {
        for (const key of keys) {
            const value = reservation?.[key];
            if (value !== undefined && value !== null && String(value).trim() !== "") {
                return String(value);
            }
        }
        return null;
    }

    private async getReservationCleaningNotes(
        reservation: ReservationInfoEntity,
        cache: Map<number, string | undefined>,
        forceLive = false
    ): Promise<string | undefined> {
        if (cache.has(reservation.id)) return cache.get(reservation.id);

        let notes = reservation.hostNote || undefined;
        const hostifyApiKey = process.env.HOSTIFY_API_KEY || (forceLive ? HOSTIFY_API_KEY : undefined);
        if (hostifyApiKey) {
            try {
                const hostifyReservation = await Promise.race([
                    this.hostifyClient.getReservationInfo(hostifyApiKey, reservation.id),
                    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500))
                ]);
                const liveReservation = (hostifyReservation as any)?.reservation || {};
                notes = this.extractHostifyNoteValue(liveReservation, [
                    "cleaning_notes",
                    "cleaning_note",
                    "cleaningNote",
                    "housekeeping_note",
                    "housekeepingNote",
                    "turnover_notes",
                    "turnoverNotes",
                ]) || notes;
            } catch (error: any) {
                logger.warn(`[TurnoverService] Unable to fetch Hostify cleaning notes for reservation ${reservation.id}: ${error.message}`);
            }
        }

        cache.set(reservation.id, notes);
        return notes;
    }

    private async primeReservationCleaningNotes(
        reservations: ReservationInfoEntity[],
        cache: Map<number, string | undefined>
    ) {
        const queue = reservations.filter((reservation) => !cache.has(reservation.id));
        const workerCount = Math.min(6, queue.length);
        let index = 0;

        await Promise.all(Array.from({ length: workerCount }, async () => {
            while (index < queue.length) {
                const reservation = queue[index];
                index += 1;
                await this.getReservationCleaningNotes(reservation, cache);
            }
        }));
    }

    async refreshReservationCleaningNotes(reservationId: number): Promise<{ reservationId: number; cleaningNotes?: string }> {
        const reservation = await this.reservationRepo.findOne({ where: { id: reservationId } });
        if (!reservation) {
            throw new Error("Reservation not found");
        }

        const cache = new Map<number, string | undefined>();
        const cleaningNotes = await this.getReservationCleaningNotes(reservation, cache, true);
        return { reservationId, cleaningNotes };
    }

    async getNextCheckInNotification(listingId: number, afterDate: string): Promise<TurnoverNotification | null> {
        await this.ensureSettingsSchema();
        const reservation = await this.reservationRepo.findOne({
            where: {
                listingMapId: listingId,
                arrivalDate: MoreThan(afterDate as any),
                status: In(TURNOVER_RESERVATION_STATUSES)
            },
            order: { arrivalDate: 'ASC' as any }
        });

        if (!reservation) return null;

        const listing = await this.listingRepo.findOne({ where: { id: reservation.listingMapId } });
        if (!listing) return null;

        const globalSettings = await this.settingsRepo.findOne({ where: { listingId: 0 } });
        const settings = await this.settingsRepo.findOne({ where: { listingId: listing.id } });
        const preStayAudit = await this.preStayRepo.findOne({ where: { reservationId: reservation.id } });
        const postStayAudit = await this.postStayRepo.findOne({ where: { reservationId: reservation.id } });
        const contact = await this.resolvePreStayContact(reservation, preStayAudit, settings, globalSettings);
        const listingTimezone = this.resolveTimeZone(listing);
        const listingTimezoneLabel = this.getReadableTimeZone(listingTimezone);
        const upsells = await this.getApprovedUpsellsForReservation(reservation);
        const cleaningNotes = await this.getReservationCleaningNotes(reservation, new Map<number, string | undefined>());

        return {
            id: reservation.id,
            reservationId: reservation.id,
            listingId: listing.id,
            listingName: listing.name,
            listingNickname: listing.internalListingName || listing.name,
            address: listing.address || '',
            propertyType: this.getPropertyTypeLabel(listing),
            serviceType: this.getServiceTypeLabel(listing),
            listingTimezone: listingTimezone || 'America/Chicago',
            listingTimezoneLabel,
            listingTags: listing.tags || '',
            guestName: reservation.guestName || 'Unknown Guest',
            checkInDate: this.formatDateOnly(reservation.arrivalDate),
            checkOutDate: this.formatDateOnly(reservation.departureDate),
            checkInTime: reservation.checkInTime ?? (listing.checkInTimeStart ?? 15),
            checkOutTime: reservation.checkOutTime ?? (listing.checkOutTime ?? 11),
            reservationCode: reservation.reservationId || '',
            notificationType: 'pre-stay',
            contactId: contact?.id,
            contactName: contact?.name,
            contactPhone: contact?.contact,
            contactRole: contact?.role || undefined,
            messagePreview: this.buildCheckInMessage(reservation, listing, upsells),
            sentMessage: preStayAudit?.notificationMessage || undefined,
            turnoverNotes: cleaningNotes,
            status: (preStayAudit?.notificationStatus as any) || (preStayAudit?.cleanerNotified === 'yes' ? 'sent' : 'pending'),
            sentAt: preStayAudit?.notificationSentAt ? preStayAudit.notificationSentAt.toISOString() : undefined,
            error: undefined,
            isSameDayTurnover: false,
            preStayAuditStatus: preStayAudit?.completionStatus || 'Not Started',
            postStayAuditStatus: postStayAudit?.completionStatus || 'Not Started',
            ownerName: settings?.ownerName,
            ownerEmail: settings?.ownerEmail,
            ownerPhone: settings?.ownerPhone,
            upsells: upsells.map((u) => ({ id: u.id, type: u.type, approved: true })),
            createdAt: reservation.reservationDate || '',
            updatedAt: preStayAudit?.updatedAt?.toISOString() || ''
        };
    }

    async getLastCheckoutNotification(listingId: number, beforeDate: string): Promise<TurnoverNotification | null> {
        await this.ensureSettingsSchema();
        const reservation = await this.reservationRepo.findOne({
            where: {
                listingMapId: listingId,
                departureDate: LessThan(beforeDate as any),
                status: In(TURNOVER_RESERVATION_STATUSES)
            },
            order: { departureDate: 'DESC' as any }
        });

        if (!reservation) return null;

        const listing = await this.listingRepo.findOne({ where: { id: reservation.listingMapId } });
        if (!listing) return null;

        const globalSettings = await this.settingsRepo.findOne({ where: { listingId: 0 } });
        const settings = await this.settingsRepo.findOne({ where: { listingId: listing.id } });
        const postStayAudit = await this.postStayRepo.findOne({ where: { reservationId: reservation.id } });
        const preStayAudit = await this.preStayRepo.findOne({ where: { reservationId: reservation.id } });
        const contact = await this.resolvePostStayContact(reservation, postStayAudit, settings, globalSettings);
        const listingTimezone = this.resolveTimeZone(listing);
        const listingTimezoneLabel = this.getReadableTimeZone(listingTimezone);
        const upsells = await this.getApprovedUpsellsForReservation(reservation);
        const cleaningNotes = await this.getReservationCleaningNotes(reservation, new Map<number, string | undefined>());

        return {
            id: reservation.id + 1000000,
            reservationId: reservation.id,
            listingId: listing.id,
            listingName: listing.name,
            listingNickname: listing.internalListingName || listing.name,
            address: listing.address || '',
            propertyType: this.getPropertyTypeLabel(listing),
            serviceType: this.getServiceTypeLabel(listing),
            listingTimezone: listingTimezone || 'America/Chicago',
            listingTimezoneLabel,
            listingTags: listing.tags || '',
            guestName: reservation.guestName || 'Unknown Guest',
            checkInDate: this.formatDateOnly(reservation.arrivalDate),
            checkOutDate: this.formatDateOnly(reservation.departureDate),
            checkInTime: reservation.checkInTime ?? (listing.checkInTimeStart ?? 15),
            checkOutTime: reservation.checkOutTime ?? (listing.checkOutTime ?? 11),
            reservationCode: reservation.reservationId || '',
            notificationType: 'post-stay',
            contactId: contact?.id,
            contactName: contact?.name,
            contactPhone: contact?.contact,
            contactRole: contact?.role || undefined,
            messagePreview: this.buildCheckoutMessage(reservation, listing, upsells),
            sentMessage: postStayAudit?.cleanerNotificationMessage || undefined,
            turnoverNotes: cleaningNotes,
            status: postStayAudit?.cleanerNotificationStatus as any || 'pending',
            sentAt: postStayAudit?.cleanerNotificationSentAt?.toISOString(),
            error: postStayAudit?.cleanerNotificationError || undefined,
            isSameDayTurnover: false,
            preStayAuditStatus: preStayAudit?.completionStatus || 'Not Started',
            postStayAuditStatus: postStayAudit?.completionStatus || 'Not Started',
            ownerName: settings?.ownerName,
            ownerEmail: settings?.ownerEmail,
            ownerPhone: settings?.ownerPhone,
            upsells: upsells.map((u) => ({ id: u.id, type: u.type, approved: true })),
            createdAt: reservation.reservationDate || '',
            updatedAt: postStayAudit?.updatedAt?.toISOString() || ''
        };
    }

    private async ensureCurrentBackendDefaults(settings: TurnoverSettings | null, listingId: number) {
        const snapshot = this.getCurrentBackendSnapshot();
        let row = settings;
        let changed = false;

        if (!row) {
            row = this.settingsRepo.create({ listingId } as TurnoverSettings);
            changed = true;
        }

        const assignDefault = <K extends keyof TurnoverSettings>(field: K, value: TurnoverSettings[K]) => {
            if ((row as TurnoverSettings)[field] === undefined || (row as TurnoverSettings)[field] === null) {
                (row as TurnoverSettings)[field] = value;
                changed = true;
            }
        };

        assignDefault('preStayEnabled', snapshot.preStayEnabled as any);
        assignDefault('postStayEnabled', snapshot.postStayEnabled as any);
        assignDefault('sameDayCombinedEnabled', snapshot.sameDayCombinedEnabled as any);
        assignDefault('preStayEnabledOverride', false as any);
        assignDefault('postStayEnabledOverride', false as any);
        assignDefault('sameDayCombinedEnabledOverride', false as any);
        assignDefault('preStayScheduleMode', snapshot.preStayScheduleMode as any);
        assignDefault('postStayScheduleMode', snapshot.postStayScheduleMode as any);
        assignDefault('sameDayScheduleMode', snapshot.sameDayScheduleMode as any);
        assignDefault('preStayOffsetMinutes', snapshot.preStayOffsetMinutes as any);
        assignDefault('postStayOffsetMinutes', snapshot.postStayOffsetMinutes as any);
        assignDefault('sameDayOffsetMinutes', snapshot.sameDayOffsetMinutes as any);
        assignDefault('preStayMessageTemplate', snapshot.preStayMessageTemplate as any);
        assignDefault('postStayMessageTemplate', snapshot.postStayMessageTemplate as any);
        assignDefault('sameDayCombinedMessageTemplate', snapshot.sameDayCombinedMessageTemplate as any);
        assignDefault('reservationChangeUpdatesEnabled', snapshot.reservationChangeUpdatesEnabled as any);
        assignDefault('reservationChangeMessageTemplate', snapshot.reservationChangeMessageTemplate as any);

        return changed ? this.settingsRepo.save(row) : row;
    }

    private async resolvePreStayContact(
        reservation: ReservationInfoEntity,
        preStayAudit: ReservationDetailPreStayAudit | null,
        settings: TurnoverSettings | null,
        globalSettings: TurnoverSettings | null
    ): Promise<Contact | null> {
        const overrideId = preStayAudit?.notificationContactId;
        if (overrideId) {
            const overrideContact = await this.contactRepo.findOne({ where: { id: overrideId } });
            if (overrideContact) return overrideContact;
        }

        const settingsContactId = settings?.preStayContactId || globalSettings?.preStayContactId;
        if (settingsContactId) {
            const contact = await this.contactRepo.findOne({ where: { id: settingsContactId } });
            if (contact) return contact;
        }

        const activeContacts = await this.contactRepo.find({
            where: {
                listingId: String(reservation.listingMapId),
                role: 'Cleaner',
                status: 'active',
                deletedAt: null as any
            }
        });
        return activeContacts[0] || null;
    }

    private async resolvePostStayContact(
        reservation: ReservationInfoEntity,
        postStayAudit: ReservationDetailPostStayAudit | null,
        settings: TurnoverSettings | null,
        globalSettings: TurnoverSettings | null
    ): Promise<Contact | null> {
        const overrideId = postStayAudit?.cleanerNotificationContactId;
        if (overrideId) {
            const overrideContact = await this.contactRepo.findOne({ where: { id: overrideId } });
            if (overrideContact) return overrideContact;
        }

        const settingsContactId = settings?.postStayContactId || globalSettings?.postStayContactId;
        if (settingsContactId) {
            const contact = await this.contactRepo.findOne({ where: { id: settingsContactId } });
            if (contact) return contact;
        }

        const activeContacts = await this.contactRepo.find({
            where: {
                listingId: String(reservation.listingMapId),
                role: 'Cleaner',
                status: 'active',
                deletedAt: null as any
            }
        });
        return activeContacts[0] || null;
    }

    // Fetch all approved upsells for a reservation, matching how the reservations
    // page looks them up: by the DB reservation id (as a string) with status "Approved".
    private async getApprovedUpsellsForReservation(reservation: ReservationInfoEntity): Promise<UpsellOrder[]> {
        try {
            return await this.upsellRepo.find({
                where: { booking_id: String(reservation.id), status: In(['Approved', 'Paid']) }
            });
        } catch (error: any) {
            logger.error(`[TurnoverService] Error fetching upsells:`, error.message);
            return [];
        }
    }

    private buildCheckInMessage(reservation: ReservationInfoEntity, listing: Listing, upsells: UpsellOrder[]): string {
        const lines: string[] = [];
        lines.push(`${listing.internalListingName || listing.name} Check-In Notification`);
        lines.push('');
        lines.push(`Address: ${listing.address || ''}`);
        lines.push('');
        lines.push(`Reservation #${reservation.id}`);
        lines.push(`Guest: ${reservation.guestName || 'Unknown Guest'}`);
        const checkInDate = reservation.arrivalDate
            ? new Date(reservation.arrivalDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'N/A';
        lines.push(`Check-In Date: ${checkInDate}`);
        lines.push('');
        if (upsells.length > 0) {
            lines.push('Approved Upsells:');
            upsells.forEach((upsell) => lines.push(`- ${upsell.type}`));
        } else {
            lines.push('No approved upsells for this reservation.');
        }
        return lines.join('\n');
    }

    private buildCheckoutMessage(reservation: ReservationInfoEntity, listing: Listing, upsells: UpsellOrder[]): string {
        const lines: string[] = [];
        lines.push(`${listing.internalListingName || listing.name} Checkout Notification`);
        lines.push('');
        lines.push(`Address: ${listing.address || ''}`);
        lines.push('');
        lines.push(`Reservation #${reservation.id}`);
        lines.push(`Guest: ${reservation.guestName || 'Unknown Guest'}`);
        const checkoutDate = reservation.departureDate
            ? new Date(reservation.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'N/A';
        lines.push(`Checkout Date: ${checkoutDate}`);
        lines.push('');
        if (upsells.length > 0) {
            lines.push('Approved Upsells:');
            upsells.forEach((upsell) => lines.push(`- ${upsell.type}`));
        } else {
            lines.push('No approved upsells for this reservation.');
        }
        lines.push('');
        lines.push('Please ensure property is cleaned and restocked.');
        return lines.join('\n');
    }

    /**
     * Get turnover notifications (combined pre-stay and post-stay)
     */
    async getNotifications(filters: TurnoverFilters = {}): Promise<TurnoverNotification[]> {
        try {
            await this.ensureSettingsSchema();
            // Calculate date range from scopes or filters (Eastern date keys)
            let fromDateStr: string;
            let toDateStr: string;
            const { todayKey, tomorrowKey } = this.getEasternDayRanges();

            const scopes = filters.scopes || [];
            const hasScopes = scopes.length > 0;
            const includesToday = scopes.includes('today');
            const includesTomorrow = scopes.includes('tomorrow');
            const includesSentHistory = scopes.includes('sent-history');
            const globalSettings = await this.settingsRepo.findOne({ where: { listingId: 0 } });

            if (includesSentHistory && !filters.fromDate && !filters.toDate) {
                fromDateStr = '1970-01-01';
                toDateStr = '2999-12-31';
            } else if (includesToday || includesTomorrow) {
                if (includesToday && includesTomorrow) {
                    fromDateStr = todayKey;
                    toDateStr = tomorrowKey;
                } else if (includesTomorrow) {
                    fromDateStr = tomorrowKey;
                    toDateStr = tomorrowKey;
                } else {
                    fromDateStr = todayKey;
                    toDateStr = todayKey;
                }
            } else if (filters.fromDate && filters.toDate) {
                fromDateStr = filters.fromDate;
                toDateStr = filters.toDate;
            } else if (filters.date === 'tomorrow') {
                fromDateStr = tomorrowKey;
                toDateStr = tomorrowKey;
            } else {
                // Default: today only
                fromDateStr = todayKey;
                toDateStr = todayKey;
            }

            const notifications: TurnoverNotification[] = [];
            const seenKeys = new Set<string>();
            const cleaningNoteCache = new Map<number, string | undefined>();
            const includePreStay = hasScopes
                ? (scopes.includes('pre-stay') || includesToday || includesTomorrow || includesSentHistory)
                : (!filters.notificationType || filters.notificationType.includes('pre-stay'));
            const includePostStay = hasScopes
                ? (scopes.includes('post-stay') || includesToday || includesTomorrow || includesSentHistory)
                : (!filters.notificationType || filters.notificationType.includes('post-stay'));
            const includesSameDay = hasScopes && scopes.includes('sameday');
            const useDateFieldFilter = !includesToday && !includesTomorrow && !!(filters.fromDate && filters.toDate && filters.dateField);
            const dateField = filters.dateField === 'checkOut' ? 'checkOut' : 'checkIn';

            // Build reservation query
            const reservationWhere: any = {};
            
            if (filters.listingId) {
                reservationWhere.listingMapId = filters.listingId;
            }

            // Get reservations with check-ins in date range (pre-stay)
            if (includePreStay) {
                const preStayReservations = await this.reservationRepo.find({
                    where: {
                        ...reservationWhere,
                        ...(useDateFieldFilter && dateField === 'checkOut'
                            ? { departureDate: Between(fromDateStr, toDateStr) }
                            : { arrivalDate: Between(fromDateStr, toDateStr) }),
                        status: In(TURNOVER_RESERVATION_STATUSES)
                    }
                });
                await this.primeReservationCleaningNotes(preStayReservations, cleaningNoteCache);

                for (const res of preStayReservations) {
                    const preStayAudit = await this.preStayRepo.findOne({
                        where: { reservationId: res.id }
                    });
                    const postStayAudit = await this.postStayRepo.findOne({
                        where: { reservationId: res.id }
                    });

                    const listing = await this.listingRepo.findOne({ where: { id: res.listingMapId } });
                    if (!listing) continue;

                    // Apply property type filter
                    const propertyType = this.getPropertyTypeLabel(listing);
                    if (filters.propertyType && !filters.propertyType.includes(propertyType)) continue;

                    // Get settings for this listing
                    const settings = await this.settingsRepo.findOne({ where: { listingId: listing.id } });
                    
                    // Get contact if assigned
                    const contact = await this.resolvePreStayContact(res, preStayAudit, settings, globalSettings);
                    const listingTimezone = this.resolveTimeZone(listing);
                    const listingTimezoneLabel = this.getReadableTimeZone(listingTimezone);
                    const upsells = await this.getApprovedUpsellsForReservation(res);
                    const cleaningNotes = await this.getReservationCleaningNotes(res, cleaningNoteCache);
                    const template = this.resolveValue(settings?.preStayMessageTemplate, globalSettings?.preStayMessageTemplate, DEFAULT_PRE_STAY_TEMPLATE);
                    const renderedTemplate = renderTurnoverTemplate(template, {
                        reservation: res,
                        listing,
                        upsells,
                        turnoverNotes: cleaningNotes,
                        ownerName: settings?.ownerName,
                        ownerEmail: settings?.ownerEmail,
                        ownerPhone: settings?.ownerPhone
                    });

                    const notification: TurnoverNotification = {
                        id: res.id,
                        reservationId: res.id,
                        listingId: listing.id,
                        listingName: listing.name,
                        listingNickname: listing.internalListingName || listing.name,
                        address: listing.address || '',
                        propertyType,
                        serviceType: this.getServiceTypeLabel(listing),
                        listingTimezone: listingTimezone || 'America/Chicago',
                        listingTimezoneLabel,
                        listingTags: listing.tags || '',
                        
                        guestName: res.guestName || 'Unknown Guest',
                        checkInDate: this.formatDateOnly(res.arrivalDate),
                        checkOutDate: this.formatDateOnly(res.departureDate),
                        checkInTime: res.checkInTime ?? (listing.checkInTimeStart ?? 15),
                        checkOutTime: res.checkOutTime ?? (listing.checkOutTime ?? 11),
                        reservationCode: res.reservationId || '',
                        
                        notificationType: 'pre-stay',
                        contactId: contact?.id,
                        contactName: contact?.name,
                        contactPhone: contact?.contact, // Contact entity uses 'contact' field for phone
                        contactRole: contact?.role || undefined,
                        messagePreview: renderedTemplate.message,
                        sentMessage: preStayAudit?.notificationMessage || undefined,
                        turnoverNotes: cleaningNotes,
                        
                        status: (preStayAudit?.notificationStatus as any) || (preStayAudit?.cleanerNotified === 'yes' ? 'sent' : 'pending'),
                        sentAt: preStayAudit?.notificationSentAt ? preStayAudit.notificationSentAt.toISOString() : undefined,
                        error: preStayAudit?.notificationError || undefined,
                        templateErrorVariables: [...renderedTemplate.unknownVariables, ...renderedTemplate.missingVariables],
                        preStayAuditStatus: preStayAudit?.completionStatus || 'Not Started',
                        postStayAuditStatus: postStayAudit?.completionStatus || 'Not Started',
                        
                        ownerName: settings?.ownerName,
                        ownerEmail: settings?.ownerEmail,
                        ownerPhone: settings?.ownerPhone,
                        
                        upsells: upsells.map((u) => ({ id: u.id, type: u.type, approved: true })),
                        createdAt: res.reservationDate || '',
                        updatedAt: preStayAudit?.updatedAt?.toISOString() || ''
                    };

                    // Apply search filter
                    if (filters.search) {
                        const searchLower = filters.search.toLowerCase();
                        if (!notification.listingName.toLowerCase().includes(searchLower) &&
                            !notification.guestName.toLowerCase().includes(searchLower) &&
                            !notification.address.toLowerCase().includes(searchLower)) {
                            continue;
                        }
                    }

                    // Apply status filter
                    if (filters.status && !filters.status.includes(notification.status)) continue;

                    const dedupeKey = `${notification.reservationId}-pre-${notification.checkInDate}`;
                    if (!seenKeys.has(dedupeKey)) {
                        seenKeys.add(dedupeKey);
                        notifications.push(notification);
                    }
                }
            }

            // Get reservations with check-outs in date range (post-stay)
            if (includePostStay) {
                const postStayReservations = await this.reservationRepo.find({
                    where: {
                        ...reservationWhere,
                        ...(useDateFieldFilter && dateField === 'checkIn'
                            ? { arrivalDate: Between(fromDateStr, toDateStr) }
                            : { departureDate: Between(fromDateStr, toDateStr) }),
                        status: In(TURNOVER_RESERVATION_STATUSES)
                    }
                });
                await this.primeReservationCleaningNotes(postStayReservations, cleaningNoteCache);

                for (const res of postStayReservations) {
                    const postStayAudit = await this.postStayRepo.findOne({
                        where: { reservationId: res.id }
                    });
                    const preStayAudit = await this.preStayRepo.findOne({
                        where: { reservationId: res.id }
                    });

                    const listing = await this.listingRepo.findOne({ where: { id: res.listingMapId } });
                    if (!listing) continue;

                    // Apply property type filter
                    const propertyType = this.getPropertyTypeLabel(listing);
                    if (filters.propertyType && !filters.propertyType.includes(propertyType)) continue;

                    // Get settings for this listing
                    const settings = await this.settingsRepo.findOne({ where: { listingId: listing.id } });
                    
                    // Get contact
                    const contact = await this.resolvePostStayContact(res, postStayAudit, settings, globalSettings);
                    const listingTimezone = this.resolveTimeZone(listing);
                    const listingTimezoneLabel = this.getReadableTimeZone(listingTimezone);
                    const upsells = await this.getApprovedUpsellsForReservation(res);
                    const cleaningNotes = await this.getReservationCleaningNotes(res, cleaningNoteCache);
                    const template = this.resolveValue(settings?.postStayMessageTemplate, globalSettings?.postStayMessageTemplate, DEFAULT_POST_STAY_TEMPLATE);
                    const renderedTemplate = renderTurnoverTemplate(template, {
                        reservation: res,
                        listing,
                        upsells,
                        turnoverNotes: cleaningNotes,
                        ownerName: settings?.ownerName,
                        ownerEmail: settings?.ownerEmail,
                        ownerPhone: settings?.ownerPhone
                    });

                    const notification: TurnoverNotification = {
                        id: res.id + 1000000, // Offset to avoid ID collision
                        reservationId: res.id,
                        listingId: listing.id,
                        listingName: listing.name,
                        listingNickname: listing.internalListingName || listing.name,
                        address: listing.address || '',
                        propertyType,
                        serviceType: this.getServiceTypeLabel(listing),
                        listingTimezone: listingTimezone || 'America/Chicago',
                        listingTimezoneLabel,
                        listingTags: listing.tags || '',
                        
                        guestName: res.guestName || 'Unknown Guest',
                        checkInDate: this.formatDateOnly(res.arrivalDate),
                        checkOutDate: this.formatDateOnly(res.departureDate),
                        checkInTime: res.checkInTime ?? (listing.checkInTimeStart ?? 15),
                        checkOutTime: res.checkOutTime ?? (listing.checkOutTime ?? 11),
                        reservationCode: res.reservationId || '',
                        
                        notificationType: 'post-stay',
                        contactId: contact?.id,
                        contactName: contact?.name,
                        contactPhone: contact?.contact, // Contact entity uses 'contact' field for phone
                        contactRole: contact?.role || undefined,
                        messagePreview: renderedTemplate.message,
                        sentMessage: postStayAudit?.cleanerNotificationMessage || undefined,
                        turnoverNotes: cleaningNotes,
                        
                        status: postStayAudit?.cleanerNotificationStatus as any || 'pending',
                        sentAt: postStayAudit?.cleanerNotificationSentAt?.toISOString(),
                        error: postStayAudit?.cleanerNotificationError || undefined,
                        templateErrorVariables: [...renderedTemplate.unknownVariables, ...renderedTemplate.missingVariables],
                        preStayAuditStatus: preStayAudit?.completionStatus || 'Not Started',
                        postStayAuditStatus: postStayAudit?.completionStatus || 'Not Started',
                        
                        ownerName: settings?.ownerName,
                        ownerEmail: settings?.ownerEmail,
                        ownerPhone: settings?.ownerPhone,
                        
                        upsells: upsells.map((u) => ({ id: u.id, type: u.type, approved: true })),
                        createdAt: res.reservationDate || '',
                        updatedAt: postStayAudit?.updatedAt?.toISOString() || ''
                    };

                    // Apply search filter
                    if (filters.search) {
                        const searchLower = filters.search.toLowerCase();
                        if (!notification.listingName.toLowerCase().includes(searchLower) &&
                            !notification.guestName.toLowerCase().includes(searchLower) &&
                            !notification.address.toLowerCase().includes(searchLower)) {
                            continue;
                        }
                    }

                    // Apply status filter
                    if (filters.status && !filters.status.includes(notification.status)) continue;

                    const dedupeKey = `${notification.reservationId}-post-${notification.checkOutDate}`;
                    if (!seenKeys.has(dedupeKey)) {
                        seenKeys.add(dedupeKey);
                        notifications.push(notification);
                    }
                }
            }

            // Same-day turnover detection across full filtered dataset
            const checkInMap = new Map<string, Set<string>>();
            const checkOutMap = new Map<string, Set<string>>();

            notifications.forEach((n) => {
                const checkInKey = n.checkInDate ? n.checkInDate.slice(0, 10) : "";
                const checkOutKey = n.checkOutDate ? n.checkOutDate.slice(0, 10) : "";
                const listingKey = String(n.listingId);
                if (checkInKey) {
                    const set = checkInMap.get(listingKey) || new Set<string>();
                    set.add(checkInKey);
                    checkInMap.set(listingKey, set);
                }
                if (checkOutKey) {
                    const set = checkOutMap.get(listingKey) || new Set<string>();
                    set.add(checkOutKey);
                    checkOutMap.set(listingKey, set);
                }
            });

            notifications.forEach((n) => {
                const listingKey = String(n.listingId);
                if (n.notificationType === 'pre-stay') {
                    const dateKey = n.checkInDate ? n.checkInDate.slice(0, 10) : "";
                    n.isSameDayTurnover = dateKey ? (checkOutMap.get(listingKey)?.has(dateKey) || false) : false;
                } else {
                    const dateKey = n.checkOutDate ? n.checkOutDate.slice(0, 10) : "";
                    n.isSameDayTurnover = dateKey ? (checkInMap.get(listingKey)?.has(dateKey) || false) : false;
                }
            });

            const scopedNotifications = includesSameDay
                ? notifications.filter((n) => n.isSameDayTurnover)
                : notifications;

            // Sort by date
            scopedNotifications.sort((a, b) => {
                const dateA = a.notificationType === 'pre-stay' ? a.checkInDate : a.checkOutDate;
                const dateB = b.notificationType === 'pre-stay' ? b.checkInDate : b.checkOutDate;
                return new Date(dateA).getTime() - new Date(dateB).getTime();
            });

            // Final de-dupe: one reservation + one type + one date = one row
            const unique = new Map<string, TurnoverNotification>();
            scopedNotifications.forEach((n) => {
                const dateKey = n.notificationType === 'pre-stay' ? n.checkInDate : n.checkOutDate;
                const key = `${n.reservationId}-${n.notificationType}-${dateKey || ''}`;
                if (!unique.has(key)) {
                    unique.set(key, n);
                }
            });

            return Array.from(unique.values());
        } catch (error: any) {
            logger.error(`[TurnoverService] Error getting notifications:`, error.message);
            throw error;
        }
    }

    /**
     * Get summary counts for turnovers with filters applied
     */
    async getNotificationSummary(filters: TurnoverFilters = {}) {
        const notifications = await this.getNotifications(filters);

        const dateCounts: Record<string, { preStay: number; postStay: number; total: number; }> = {};
        const checkInByListingDate = new Map<string, Set<string>>();
        const checkOutByListingDate = new Map<string, Set<string>>();
        notifications.forEach((n) => {
            const dateKey = (n.notificationType === 'post-stay' ? n.checkOutDate : n.checkInDate)?.slice(0, 10);
            if (!dateKey) return;
            if (!dateCounts[dateKey]) {
                dateCounts[dateKey] = { preStay: 0, postStay: 0, total: 0 };
            }
            const listingKey = String(n.listingId);
            if (n.notificationType === 'pre-stay') {
                dateCounts[dateKey].preStay += 1;
                const set = checkInByListingDate.get(listingKey) || new Set<string>();
                set.add(dateKey);
                checkInByListingDate.set(listingKey, set);
            } else {
                dateCounts[dateKey].postStay += 1;
                const set = checkOutByListingDate.get(listingKey) || new Set<string>();
                set.add(dateKey);
                checkOutByListingDate.set(listingKey, set);
            }
            dateCounts[dateKey].total += 1;
        });

        const { todayKey, tomorrowKey } = this.getEasternDayRanges();

        // Count 1 per property per date where BOTH a check-in AND check-out exist (same-day turnover)
        const sameDayCounts: Record<string, number> = {};
        checkInByListingDate.forEach((checkInDates, listingId) => {
            const checkOutDates = checkOutByListingDate.get(listingId);
            if (!checkOutDates) return;
            checkInDates.forEach((dateKey) => {
                if (checkOutDates.has(dateKey)) {
                    sameDayCounts[dateKey] = (sameDayCounts[dateKey] || 0) + 1;
                }
            });
        });

        return {
            preStay: notifications.filter((n) => n.notificationType === 'pre-stay').length,
            postStay: notifications.filter((n) => n.notificationType === 'post-stay').length,
            today: dateCounts[todayKey]?.total || 0,
            tomorrow: dateCounts[tomorrowKey]?.total || 0,
            todaySummary: {
                total_turnovers: (dateCounts[todayKey]?.preStay || 0) + (dateCounts[todayKey]?.postStay || 0),
                prestay_total: dateCounts[todayKey]?.preStay || 0,
                poststay_total: dateCounts[todayKey]?.postStay || 0,
                prestay_same_day: sameDayCounts[todayKey] || 0,
                poststay_same_day: sameDayCounts[todayKey] || 0,
                prestay_standard: Math.max((dateCounts[todayKey]?.preStay || 0) - (sameDayCounts[todayKey] || 0), 0),
                poststay_standard: Math.max((dateCounts[todayKey]?.postStay || 0) - (sameDayCounts[todayKey] || 0), 0),
                same_day_turnovers: sameDayCounts[todayKey] || 0,
                date: todayKey
            },
            tomorrowSummary: {
                total_turnovers: (dateCounts[tomorrowKey]?.preStay || 0) + (dateCounts[tomorrowKey]?.postStay || 0),
                prestay_total: dateCounts[tomorrowKey]?.preStay || 0,
                poststay_total: dateCounts[tomorrowKey]?.postStay || 0,
                prestay_same_day: sameDayCounts[tomorrowKey] || 0,
                poststay_same_day: sameDayCounts[tomorrowKey] || 0,
                prestay_standard: Math.max((dateCounts[tomorrowKey]?.preStay || 0) - (sameDayCounts[tomorrowKey] || 0), 0),
                poststay_standard: Math.max((dateCounts[tomorrowKey]?.postStay || 0) - (sameDayCounts[tomorrowKey] || 0), 0),
                same_day_turnovers: sameDayCounts[tomorrowKey] || 0,
                date: tomorrowKey
            },
            dateCounts: Object.entries(dateCounts)
                .map(([date, counts]) => ({ date, ...counts }))
                .sort((a, b) => a.date.localeCompare(b.date)),
        };
    }

    /**
     * Update notification status for a reservation/type
     */
    async updateNotificationStatus(
        reservationId: number,
        type: 'pre-stay' | 'post-stay',
        action: 'send' | 'pause' | 'resume' | 'skip',
        userId?: string
    ) {
        const now = new Date();
        if (type === 'pre-stay') {
            let audit = await this.preStayRepo.findOne({ where: { reservationId } });
            if (!audit) {
                audit = this.preStayRepo.create({ reservationId });
            }
            const statusMap: Record<string, string> = {
                send: 'sent',
                pause: 'paused',
                resume: 'pending',
                skip: 'skipped'
            };
            const status = statusMap[action] || 'pending';
            audit.notificationStatus = status;
            if (action === 'send') {
                audit.notificationSentAt = now;
                audit.cleanerNotified = CleanerNotified.YES;
            }
            if (userId) {
                audit.updatedBy = userId;
            }
            return this.preStayRepo.save(audit);
        }

        let audit = await this.postStayRepo.findOne({ where: { reservationId } });
        if (!audit) {
            audit = this.postStayRepo.create({ reservationId });
        }
        const statusMap: Record<string, string> = {
            send: 'sent',
            pause: 'skipped',
            resume: 'pending',
            skip: 'skipped'
        };
        const status = statusMap[action] || 'pending';
        audit.cleanerNotificationStatus = status;
        if (action === 'send') {
            audit.cleanerNotificationSentAt = now;
        }
        if (userId) {
            audit.updatedBy = userId;
        }
        return this.postStayRepo.save(audit);
    }

    /**
     * Get turnover settings for all listings
     */
    async getSettings(filters?: { propertyType?: string[]; search?: string }): Promise<any[]> {
        try {
            await this.ensureSettingsSchema();
            const listings = await this.listingRepo.find();
            const globalSettings = await this.settingsRepo.findOne({ where: { listingId: 0 } });

            const results = [];
            
            for (const listing of listings) {
                const propertyType = this.getPropertyTypeLabel(listing);
                
                // Apply property type filter
                if (filters?.propertyType && !filters.propertyType.includes(propertyType)) continue;

                // Apply search filter
                if (filters?.search) {
                    const searchLower = filters.search.toLowerCase();
                    const listingName = (listing.internalListingName || listing.name || '').toLowerCase();
                    const address = (listing.address || '').toLowerCase();
                    if (!listingName.includes(searchLower) && !address.includes(searchLower)) continue;
                }

                const settings = await this.settingsRepo.findOne({ where: { listingId: listing.id } });
                const backendSnapshot = this.getCurrentBackendSnapshot();
                
                // Get contacts
                const recipientOptions = await this.getRecipientOptionsForListing(listing);
                const explicitPreStayRecipientIds = this.normalizeRecipientIds(
                    settings?.preStayRecipientIds !== undefined && settings?.preStayRecipientIds !== null
                        ? settings.preStayRecipientIds
                        : globalSettings?.preStayRecipientIds,
                    settings?.preStayContactId || globalSettings?.preStayContactId
                );
                const explicitPostStayRecipientIds = this.normalizeRecipientIds(
                    settings?.postStayRecipientIds !== undefined && settings?.postStayRecipientIds !== null
                        ? settings.postStayRecipientIds
                        : globalSettings?.postStayRecipientIds,
                    settings?.postStayContactId || globalSettings?.postStayContactId
                );
                const preStayDefaultRecipientType = this.getDefaultRecipientType(
                    settings?.preStayDefaultRecipientType,
                    globalSettings?.preStayDefaultRecipientType,
                    explicitPreStayRecipientIds
                );
                const postStayDefaultRecipientType = this.getDefaultRecipientType(
                    settings?.postStayDefaultRecipientType,
                    globalSettings?.postStayDefaultRecipientType,
                    explicitPostStayRecipientIds
                );
                const preStayRecipientIds = this.resolveRecipientIdsForMode(preStayDefaultRecipientType, explicitPreStayRecipientIds, recipientOptions);
                const postStayRecipientIds = this.resolveRecipientIdsForMode(postStayDefaultRecipientType, explicitPostStayRecipientIds, recipientOptions);
                const sameDayCombinedRecipientIds = this.normalizeRecipientIds(
                    [
                        ...preStayRecipientIds,
                        ...postStayRecipientIds
                    ].filter((value, index, arr) => arr.indexOf(value) === index),
                    null
                );
                const preStayEnabled = this.resolveEnabledValue(settings, 'preStayEnabled', 'preStayEnabledOverride', globalSettings?.preStayEnabled, backendSnapshot.preStayEnabled);
                const postStayEnabled = this.resolveEnabledValue(settings, 'postStayEnabled', 'postStayEnabledOverride', globalSettings?.postStayEnabled, backendSnapshot.postStayEnabled);
                const sameDayCombinedEnabled = this.resolveEnabledValue(settings, 'sameDayCombinedEnabled', 'sameDayCombinedEnabledOverride', globalSettings?.sameDayCombinedEnabled, backendSnapshot.sameDayCombinedEnabled);

                const preStayContactId = preStayRecipientIds[0]?.startsWith('contact:')
                    ? Number(preStayRecipientIds[0].split(':')[1])
                    : (settings?.preStayContactId || globalSettings?.preStayContactId);
                const postStayContactId = postStayRecipientIds[0]?.startsWith('contact:')
                    ? Number(postStayRecipientIds[0].split(':')[1])
                    : (settings?.postStayContactId || globalSettings?.postStayContactId);

                results.push({
                    id: listing.id,
                    listingId: listing.id,
                    listingName: listing.name,
                    listingNickname: listing.internalListingName || listing.name,
                    propertyType,
                    serviceType: this.getServiceTypeLabel(listing),
                    address: listing.address,
                    listingTags: listing.tags || '',
                    
                    preStayContactId: preStayContactId,
                    preStayContactName: this.getRecipientNames(preStayRecipientIds, recipientOptions).join(', '),
                    preStayRecipientIds,
                    preStayRecipientNames: this.getRecipientNames(preStayRecipientIds, recipientOptions),
                    preStayDefaultRecipientType,
                    preStayEnabled,
                    preStayMessageTemplate: this.resolveValue(settings?.preStayMessageTemplate, globalSettings?.preStayMessageTemplate, backendSnapshot.preStayMessageTemplate),
                    preStayMessageSource: this.messageSource(settings, "preStayMessageTemplate"),
                    preStayScheduleMode: this.resolveValue(settings?.preStayScheduleMode, globalSettings?.preStayScheduleMode, backendSnapshot.preStayScheduleMode),
                    preStayOffsetMinutes: this.resolveValue(settings?.preStayOffsetMinutes, globalSettings?.preStayOffsetMinutes, backendSnapshot.preStayOffsetMinutes),
                    preStaySettingsSource: this.resolveSource(settings, ['preStayEnabledOverride', 'preStayDefaultRecipientType', 'preStayRecipientIds', 'preStayScheduleMode', 'preStayOffsetMinutes', 'preStayMessageTemplate']),
                    
                    postStayContactId: postStayContactId,
                    postStayContactName: this.getRecipientNames(postStayRecipientIds, recipientOptions).join(', '),
                    postStayRecipientIds,
                    postStayRecipientNames: this.getRecipientNames(postStayRecipientIds, recipientOptions),
                    postStayDefaultRecipientType,
                    postStayEnabled,
                    postStayMessageTemplate: this.resolveValue(settings?.postStayMessageTemplate, globalSettings?.postStayMessageTemplate, backendSnapshot.postStayMessageTemplate),
                    postStayMessageSource: this.messageSource(settings, "postStayMessageTemplate"),
                    postStayScheduleMode: this.resolveValue(settings?.postStayScheduleMode, globalSettings?.postStayScheduleMode, backendSnapshot.postStayScheduleMode),
                    postStayOffsetMinutes: this.resolveValue(settings?.postStayOffsetMinutes, globalSettings?.postStayOffsetMinutes, backendSnapshot.postStayOffsetMinutes),
                    postStaySettingsSource: this.resolveSource(settings, ['postStayEnabledOverride', 'postStayDefaultRecipientType', 'postStayRecipientIds', 'postStayScheduleMode', 'postStayOffsetMinutes', 'postStayMessageTemplate']),

                    sameDayCombinedEnabled,
                    sameDayCombinedRecipientIds,
                    sameDayCombinedRecipientNames: this.getRecipientNames(sameDayCombinedRecipientIds, recipientOptions),
                    sameDayCombinedMessageTemplate: this.resolveValue(settings?.sameDayCombinedMessageTemplate, globalSettings?.sameDayCombinedMessageTemplate, backendSnapshot.sameDayCombinedMessageTemplate),
                    sameDayMessageSource: this.messageSource(settings, "sameDayCombinedMessageTemplate"),
                    sameDayScheduleMode: this.resolveValue(settings?.sameDayScheduleMode, globalSettings?.sameDayScheduleMode, backendSnapshot.sameDayScheduleMode),
                    sameDayOffsetMinutes: this.resolveValue(settings?.sameDayOffsetMinutes, globalSettings?.sameDayOffsetMinutes, backendSnapshot.sameDayOffsetMinutes),
                    sameDaySettingsSource: this.resolveSource(settings, ['sameDayCombinedEnabledOverride', 'sameDayCombinedMessageTemplate']),
                    recipientOptions,
                    smsSenderNumber: this.resolveValue(settings?.cleanerSenderNumber, globalSettings?.cleanerSenderNumber, backendSnapshot.cleanerSenderNumber),
                    cleanerSenderNumber: this.resolveValue(settings?.cleanerSenderNumber, globalSettings?.cleanerSenderNumber, backendSnapshot.cleanerSenderNumber),
                    cleanerSenderNumberGroup1: this.resolveValue(settings?.cleanerSenderNumberGroup1, globalSettings?.cleanerSenderNumberGroup1, backendSnapshot.cleanerSenderNumberGroup1),
                    cleanerSenderNumberGroup2: this.resolveValue(settings?.cleanerSenderNumberGroup2, globalSettings?.cleanerSenderNumberGroup2, backendSnapshot.cleanerSenderNumberGroup2),
                    ownerSenderNumber: this.resolveValue(settings?.ownerSenderNumber, globalSettings?.ownerSenderNumber, backendSnapshot.ownerSenderNumber),
                    preStayScheduleDescription: '',
                    postStayScheduleDescription: '',
                    sameDayScheduleDescription: 'Same-day uses the enabled pre-stay/post-stay settings and the earlier configured schedule.',
                    backendRecipientNote: 'Scheduled turnover messages use the effective settings shown in this row.',
                    
                    ownerName: settings?.ownerName,
                    ownerEmail: settings?.ownerEmail,
                    ownerPhone: settings?.ownerPhone,
                    
                    updatedAt: settings?.updatedAt,
                    updatedBy: settings?.updatedBy
                });
            }

            return results;
        } catch (error: any) {
            logger.error(`[TurnoverService] Error getting settings:`, error.message);
            throw error;
        }
    }

    /**
     * Get global turnover settings (listingId = 0)
     */
    async getGlobalSettings(): Promise<any> {
        await this.ensureSettingsSchema();
        const snapshot = this.getCurrentBackendSnapshot();
        let settings = await this.settingsRepo.findOne({ where: { listingId: 0 } });
        settings = await this.ensureCurrentBackendDefaults(settings, 0);
        return {
            ...settings,
            preStayEnabled: this.resolveValue(settings.preStayEnabled, null, snapshot.preStayEnabled),
            postStayEnabled: this.resolveValue(settings.postStayEnabled, null, snapshot.postStayEnabled),
            sameDayCombinedEnabled: this.resolveValue(settings.sameDayCombinedEnabled, null, snapshot.sameDayCombinedEnabled),
            preStayScheduleMode: this.resolveValue(settings.preStayScheduleMode, null, snapshot.preStayScheduleMode),
            postStayScheduleMode: this.resolveValue(settings.postStayScheduleMode, null, snapshot.postStayScheduleMode),
            sameDayScheduleMode: this.resolveValue(settings.sameDayScheduleMode, null, snapshot.sameDayScheduleMode),
            preStayOffsetMinutes: this.resolveValue(settings.preStayOffsetMinutes, null, snapshot.preStayOffsetMinutes),
            postStayOffsetMinutes: this.resolveValue(settings.postStayOffsetMinutes, null, snapshot.postStayOffsetMinutes),
            sameDayOffsetMinutes: this.resolveValue(settings.sameDayOffsetMinutes, null, snapshot.sameDayOffsetMinutes),
            preStayMessageTemplate: this.resolveValue(settings.preStayMessageTemplate, null, snapshot.preStayMessageTemplate),
            postStayMessageTemplate: this.resolveValue(settings.postStayMessageTemplate, null, snapshot.postStayMessageTemplate),
            sameDayCombinedMessageTemplate: this.resolveValue(settings.sameDayCombinedMessageTemplate, null, snapshot.sameDayCombinedMessageTemplate),
            reservationChangeUpdatesEnabled: this.resolveValue(settings.reservationChangeUpdatesEnabled, null, snapshot.reservationChangeUpdatesEnabled),
            reservationChangeMessageTemplate: this.resolveValue(settings.reservationChangeMessageTemplate, null, snapshot.reservationChangeMessageTemplate),
            preStayDefaultRecipientType: this.normalizeDefaultRecipientType(settings.preStayDefaultRecipientType) || snapshot.preStayDefaultRecipientType,
            postStayDefaultRecipientType: this.normalizeDefaultRecipientType(settings.postStayDefaultRecipientType) || snapshot.postStayDefaultRecipientType,
            smsSenderNumber: this.resolveValue(settings.cleanerSenderNumber, null, snapshot.cleanerSenderNumber),
            cleanerSenderNumber: this.resolveValue(settings.cleanerSenderNumber, null, snapshot.cleanerSenderNumber),
            cleanerSenderNumberGroup1: this.resolveValue(settings.cleanerSenderNumberGroup1, null, snapshot.cleanerSenderNumberGroup1),
            cleanerSenderNumberGroup2: this.resolveValue(settings.cleanerSenderNumberGroup2, null, snapshot.cleanerSenderNumberGroup2),
            ownerSenderNumber: this.resolveValue(settings.ownerSenderNumber, null, snapshot.ownerSenderNumber),
            preStayScheduleDescription: snapshot.preStayScheduleDescription,
            postStayScheduleDescription: snapshot.postStayScheduleDescription,
            sameDayScheduleDescription: snapshot.sameDayScheduleDescription,
            backendRecipientNote: 'Property-level settings override these global defaults.'
        };
    }

    /**
     * Update global turnover settings (listingId = 0)
     */
    async updateGlobalSettings(data: Partial<TurnoverSettings>, userId?: string): Promise<TurnoverSettings> {
        await this.ensureSettingsSchema();
        let settings = await this.settingsRepo.findOne({ where: { listingId: 0 } });
        if (!settings) {
            settings = this.settingsRepo.create({ listingId: 0 } as TurnoverSettings);
        }
        const normalized = { ...data } as any;
        const prePrimary = this.normalizeRecipientIds(normalized.preStayRecipientIds, normalized.preStayContactId)[0];
        const postPrimary = this.normalizeRecipientIds(normalized.postStayRecipientIds, normalized.postStayContactId)[0];
        normalized.preStayRecipientIds = this.normalizeRecipientIds(normalized.preStayRecipientIds, normalized.preStayContactId);
        normalized.postStayRecipientIds = this.normalizeRecipientIds(normalized.postStayRecipientIds, normalized.postStayContactId);
        normalized.sameDayCombinedRecipientIds = this.normalizeRecipientIds(normalized.sameDayCombinedRecipientIds, null);
        this.normalizeRecipientDefaults(normalized);
        if (normalized.preStayDefaultRecipientType && normalized.preStayDefaultRecipientType !== "custom") normalized.preStayRecipientIds = [];
        if (normalized.postStayDefaultRecipientType && normalized.postStayDefaultRecipientType !== "custom") normalized.postStayRecipientIds = [];
        normalized.preStayContactId = normalized.preStayDefaultRecipientType === "custom" && prePrimary?.startsWith('contact:') ? Number(prePrimary.split(':')[1]) : null;
        normalized.postStayContactId = normalized.postStayDefaultRecipientType === "custom" && postPrimary?.startsWith('contact:') ? Number(postPrimary.split(':')[1]) : null;
        this.normalizeSenderNumbers(normalized);
        delete normalized.preStayEnabledOverride;
        delete normalized.postStayEnabledOverride;
        delete normalized.sameDayCombinedEnabledOverride;
        Object.assign(settings, { ...normalized, updatedBy: userId });
        return await this.settingsRepo.save(settings);
    }

    /**
     * Get global recipient list for default turnover settings.
     */
    async getGlobalContacts(): Promise<TurnoverRecipientOption[]> {
        const seen = new Set<string>();
        const contacts = await this.contactRepo.find({
            where: {
                status: In(['active', 'active-backup']),
                deletedAt: null as any
            },
            order: { role: 'ASC' as any, isPrimary: 'DESC', name: 'ASC' as any }
        });
        return contacts
            .filter((contact) => {
                if (!contact.contact) return false;
                const key = `contact:${contact.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .map((contact) => ({
                value: `contact:${contact.id}`,
                label: `${contact.name} (${contact.role || 'Contact'})`,
                role: contact.role || 'Contact',
                phone: contact.contact || undefined,
                kind: 'contact' as const
            }));
    }

    /**
     * Update turnover settings for a listing
     */
    async updateSettings(listingId: number, data: Partial<TurnoverSettings>, userId?: string): Promise<TurnoverSettings> {
        try {
            await this.ensureSettingsSchema();
            let settings = await this.settingsRepo.findOne({ where: { listingId } });
            
            if (!settings) {
                settings = this.settingsRepo.create({ listingId });
            }

            const normalized = { ...data } as any;
            const hasPreRecipientUpdate = 'preStayRecipientIds' in normalized || 'preStayContactId' in normalized;
            const hasPostRecipientUpdate = 'postStayRecipientIds' in normalized || 'postStayContactId' in normalized;
            const hasSameDayRecipientUpdate = 'sameDayCombinedRecipientIds' in normalized;
            const prePrimary = hasPreRecipientUpdate
                ? this.normalizeRecipientIds(normalized.preStayRecipientIds, normalized.preStayContactId)[0]
                : undefined;
            const postPrimary = hasPostRecipientUpdate
                ? this.normalizeRecipientIds(normalized.postStayRecipientIds, normalized.postStayContactId)[0]
                : undefined;
            if (hasPreRecipientUpdate) {
                normalized.preStayRecipientIds = this.normalizeRecipientIds(normalized.preStayRecipientIds, normalized.preStayContactId);
            }
            if (hasPostRecipientUpdate) {
                normalized.postStayRecipientIds = this.normalizeRecipientIds(normalized.postStayRecipientIds, normalized.postStayContactId);
            }
            if (hasSameDayRecipientUpdate) {
                normalized.sameDayCombinedRecipientIds = this.normalizeRecipientIds(normalized.sameDayCombinedRecipientIds, null);
            }
            this.normalizeRecipientDefaults(normalized);
            if (normalized.preStayDefaultRecipientType && normalized.preStayDefaultRecipientType !== "custom") normalized.preStayRecipientIds = [];
            if (normalized.postStayDefaultRecipientType && normalized.postStayDefaultRecipientType !== "custom") normalized.postStayRecipientIds = [];
            if (hasPreRecipientUpdate || 'preStayDefaultRecipientType' in normalized) {
                normalized.preStayContactId = normalized.preStayDefaultRecipientType === "custom" && prePrimary?.startsWith('contact:') ? Number(prePrimary.split(':')[1]) : null;
            }
            if (hasPostRecipientUpdate || 'postStayDefaultRecipientType' in normalized) {
                normalized.postStayContactId = normalized.postStayDefaultRecipientType === "custom" && postPrimary?.startsWith('contact:') ? Number(postPrimary.split(':')[1]) : null;
            }
            this.normalizeSenderNumbers(normalized);
            // The global toggle is the kill switch; the legacy *EnabledOverride flags would let a
            // property bypass a global OFF, which caused the unintended live SMS incident. Force them
            // off so future per-property toggles only act as opt-out (false), never as opt-in over global.
            if ('preStayEnabled' in normalized) normalized.preStayEnabledOverride = false;
            if ('postStayEnabled' in normalized) normalized.postStayEnabledOverride = false;
            if ('sameDayCombinedEnabled' in normalized) normalized.sameDayCombinedEnabledOverride = false;

            Object.assign(settings, {
                ...normalized,
                updatedBy: userId
            });

            return await this.settingsRepo.save(settings);
        } catch (error: any) {
            logger.error(`[TurnoverService] Error updating settings:`, error.message);
            throw error;
        }
    }

    /**
     * Get contacts for a listing (cleaners)
     */
    async getContactsForListing(listingId: number): Promise<TurnoverRecipientOption[]> {
        try {
            const listing = await this.listingRepo.findOne({ where: { id: listingId } });
            if (!listing) return [];
            return this.getRecipientOptionsForListing(listing);
        } catch (error: any) {
            logger.error(`[TurnoverService] Error getting contacts:`, error.message);
            throw error;
        }
    }

    /**
     * Sync recipient sources from Vendors and All Listings client information.
     */
    async syncRecipients(userId: string = "system"): Promise<{
        vendorProfilesSynced: number;
        clientsCreated: number;
        clientsUpdated: number;
        propertiesLinked: number;
        listingsSynced: number;
        groupsSynced: number;
    }> {
        try {
            await this.ensureSettingsSchema();
            logger.info(`[TurnoverService] Syncing turnover recipient sources...`);

            const [clientSyncResult, vendorSyncResult] = await Promise.all([
                new ClientService().syncListingClientsFromOwnerContracts(userId),
                new VendorProfileService().getVendorProfiles({ limit: 10000 }, userId),
            ]);

            const result = {
                vendorProfilesSynced: vendorSyncResult.total || vendorSyncResult.vendors?.length || 0,
                clientsCreated: clientSyncResult.clientsCreated,
                clientsUpdated: clientSyncResult.clientsUpdated,
                propertiesLinked: clientSyncResult.propertiesLinked,
                listingsSynced: clientSyncResult.listingsSynced,
                groupsSynced: clientSyncResult.groupsSynced,
            };

            logger.info(`[TurnoverService] Synced turnover recipient sources`, result);
            return result;
        } catch (error: any) {
            logger.error(`[TurnoverService] Error syncing turnover recipient sources:`, error.message);
            throw error;
        }
    }

    /**
     * Sync owner data from Hostify to settings
     */
    async syncOwnersFromHostify(): Promise<{ synced: number }> {
        try {
            await this.ensureSettingsSchema();
            logger.info(`[TurnoverService] Syncing owners from Hostify...`);
            
            // Fetch all listings from Hostify using the central API client
            const hostifyClient = new Hostify();
            const hostifyListings = await hostifyClient.getListings(HOSTIFY_API_KEY);

            let synced = 0;

            for (const hostifyListing of hostifyListings) {
                // Find owner in users array
                const owner = hostifyListing.users?.find((u: any) => u.roles?.includes('Owner'));
                if (!owner) continue;

                // Find matching listing in our database
                const listing = await this.listingRepo.findOne({ where: { id: hostifyListing.id } });
                if (!listing) continue;

                // Update or create settings
                let settings = await this.settingsRepo.findOne({ where: { listingId: listing.id } });
                if (!settings) {
                    settings = this.settingsRepo.create({ listingId: listing.id });
                }

                settings.ownerName = `${owner.first_name || ''} ${owner.last_name || ''}`.trim();
                settings.ownerEmail = owner.username || '';
                settings.ownerPhone = owner.phone ? String(owner.phone) : '';

                await this.settingsRepo.save(settings);
                synced++;
            }

            logger.info(`[TurnoverService] Synced ${synced} owners from Hostify`);
            return { synced };
        } catch (error: any) {
            logger.error(`[TurnoverService] Error syncing owners:`, error.message);
            throw error;
        }
    }
}
