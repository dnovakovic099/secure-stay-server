import os from "os";
import path from "path";
import fs from "fs";
import puppeteer from "puppeteer";
import { addDays, endOfDay, format, startOfDay, subDays } from "date-fns";
import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { RentalAgreementSigning } from "../entity/RentalAgreementSigning";
import { RentalAgreementTemplate } from "../entity/RentalAgreementTemplate";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { FileInfo } from "../entity/FileInfo";
import { Listing } from "../entity/Listing";
import { PUPPETEER_LAUNCH_OPTIONS } from "../constants";
import { rentalAgreementTemplateService } from "./RentalAgreementTemplateService";
import { sendSupportEmail } from "../utils/sendSupportEmail";
import { RentalAgreementReservationDocument } from "../entity/RentalAgreementReservationDocument";
import { formatPhoneForDisplay } from "../utils/phoneDisplay.util";
import { Hostify } from "../client/Hostify";
import { drive } from "../utils/drive";

const signingRepo = () => appDatabase.getRepository(RentalAgreementSigning);
const fileInfoRepo = () => appDatabase.getRepository(FileInfo);
const reservationInfoRepo = () => appDatabase.getRepository(ReservationInfoEntity);
const listingRepo = () => appDatabase.getRepository(Listing);
const reservationDocumentRepo = () => appDatabase.getRepository(RentalAgreementReservationDocument);

type RentalAgreementAdminFilters = {
    search?: string;
    signingStatus?: string;
    pdfStatus?: string;
    fromDate?: string;
    toDate?: string;
    dateType?: string;
    channel?: string;
    property?: string;
    listingId?: string;
    propertyType?: string;
    serviceType?: string;
    bothCompletion?: string;
    signatureCompletion?: string;
    idCompletion?: string;
    overridden?: string;
    overriddenBy?: string;
    signatureTimestampOverridden?: string;
    sort?: string;
    page?: number;
    limit?: number;
    includeMetadata?: string | boolean;
    statusTab?: string;
    bucket?: string;
    editedOnly?: string | boolean;
};

type RentalAgreementSummaryCard = {
    label: string;
    total: number;
    signed: number;
    unsigned: number;
    overridden: number;
};

type RentalAgreementOverviewRow = {
    reservationInfoId: number;
    hostifyReservationId: string;
    reservationCode: string | null;
    guestName: string;
    guestEmail: string;
    propertyName: string;
    propertyAddress: string;
    channelName: string;
    currency: string | null;
    securityDepositFee: number | null;
    securityDepositTransactionId: number | string | null;
    securityDepositStatus: string | null;
    securityDepositCompleted: boolean;
    securityDepositSource: string | null;
    securityDepositDetails: string | null;
    securityDepositChargeDate: string | null;
    arrivalDate: string | null;
    departureDate: string | null;
    checkInTime: string;
    checkOutTime: string;
    signingId: number | null;
    isSigned: boolean;
    signedAt: string | null;
    signedByName: string | null;
    signedByEmail: string | null;
    pdfStatus: string | null;
    pdfDownloadAvailable: boolean;
    pdfViewUrl: string | null;
    isEdited: boolean;
    isOverridden: boolean;
    overrideReason: string | null;
    skipIdUpload: boolean;
    skipIdUploadReason: string | null;
    signatureComplete: boolean;
    idUploadComplete: boolean;
    idFrontUploaded: boolean;
    idBackUploaded: boolean;
    propertyType: string | null;
    serviceType: string | null;
    viewedAt: string | null;
    firstViewedAt: string | null;
    lastViewedAt: string | null;
    overriddenBy: string | null;
    overriddenAt: string | null;
    signatureTimestampOverrideAt: string | null;
    signatureTimezoneOverride: string | null;
    signatureTimestampOverrideUpdatedBy: string | null;
    lastEditedBy: string | null;
    agreementStatus: "signed" | "overridden" | "not_yet_signed";
};

type RentalAgreementSecurityDepositTransaction = {
    transactionId: number | string | null;
    amount: number | null;
    currency: string | null;
    status: string | null;
    completed: boolean;
    source: string | null;
    details: string | null;
    chargeDate: string | null;
};

type RentalAgreementTemplateContext = {
    guestName: string;
    guestFirstName: string;
    guestLastName: string;
    guestEmail: string;
    guestPhone: string;
    channel: string;
    petCount: string;
    checkInDate: string;
    checkOutDate: string;
    listingName: string;
    propertyName: string;
    propertyFullAddress: string;
    checkInTime: string;
    checkOutTime: string;
    nights: string;
    numberOfGuests: string;
    totalPrice: string;
    currency: string;
    reservationId: string;
    confirmationCode: string;
};

type AgreementSnapshot = {
    headerHtml: string;
    bodyHtml: string;
    footerHtml: string;
    emailSubject: string;
    emailBodyHtml: string;
    isEdited: boolean;
    isOverridden: boolean;
    overrideReason: string | null;
    sourceTemplateId: number | null;
};

type PreviewReservationContext = {
    hostifyReservationId: string;
    reservationCode: string;
    confirmationCode: string;
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    channel: string;
    petCount: number;
    listingName: string;
    propertyName: string;
    propertyAddress: string;
    arrivalDate: string | null;
    departureDate: string | null;
    checkInTime: string;
    checkOutTime: string;
};

export class RentalAgreementSigningService {
    private excludedReservationStatuses = [
        "cancelled", "pending", "awaitingpayment",
        "declined", "expired", "inquiry",
        "inquirypreapproved", "inquirydenied",
        "inquirytimedout", "inquirynotpossible",
        "denied", "no_show", "awaiting_payment",
        "declined_inq", "preapproved", "offer",
        "withdrawn", "timedout", "not_possible", "deleted", "voided"
    ];
    private rentalAgreementMinArrivalDate = "2026-05-01";
    private hostifyClient = new Hostify();
    private securityDepositTransactionCache = new Map<string, {
        expiresAt: number;
        transaction: RentalAgreementSecurityDepositTransaction | null;
    }>();
    private securityDepositTransactionCacheTtlMs = 2 * 60 * 1000;

    private getTransactionString(transaction: any, keys: string[]) {
        for (const key of keys) {
            const value = transaction?.[key];
            if (value !== undefined && value !== null && String(value).trim()) {
                return String(value).trim();
            }
        }
        return "";
    }

    private getTransactionCompleted(transaction: any) {
        const value = transaction?.is_completed ?? transaction?.isCompleted ?? transaction?.completed;
        if (typeof value === "boolean") return value;
        const normalized = String(value ?? "").trim().toLowerCase();
        return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "completed";
    }

    private getTransactionTagsText(transaction: any) {
        const tags = Array.isArray(transaction?.tags) ? transaction.tags : [];
        return tags
            .map((tag: any) => String(tag?.tag || tag?.name || tag?.label || tag || "").trim())
            .filter(Boolean)
            .join(" ");
    }

    private isSecurityDepositTransaction(transaction: any) {
        const haystack = [
            this.getTransactionString(transaction, ["type", "transaction_type", "transactionType", "payout_type_label", "payoutTypeLabel", "category"]),
            this.getTransactionString(transaction, ["details", "notes", "code"]),
            this.getTransactionTagsText(transaction),
        ].join(" ").toLowerCase();

        return /\bdeposit\b/.test(haystack) || haystack.includes("security deposit");
    }

    private normalizeSecurityDepositTransaction(transaction: any): RentalAgreementSecurityDepositTransaction {
        const amountValue = transaction?.amount ?? transaction?.value;
        const amount = amountValue !== undefined && amountValue !== null && amountValue !== ""
            ? Number(amountValue)
            : null;
        const completed = this.getTransactionCompleted(transaction);
        const status = this.getTransactionString(transaction, ["status", "payment_status", "paymentStatus", "charge_status", "chargeStatus", "state"])
            || (completed ? "Completed" : null);

        return {
            transactionId: transaction?.id ?? transaction?.transaction_id ?? transaction?.transactionId ?? null,
            amount: amount !== null && !Number.isNaN(amount) ? amount : null,
            currency: this.getTransactionString(transaction, ["currency"]) || null,
            status,
            completed,
            source: this.getTransactionString(transaction, ["source"]) || null,
            details: this.getTransactionString(transaction, ["details", "notes", "code"]) || null,
            chargeDate: this.formatDateOnlyValue(transaction?.charge_date || transaction?.chargeDate || null),
        };
    }

    private async getSecurityDepositTransactionsByReservation(hostifyReservationIds: string[]) {
        const now = Date.now();
        const uniqueReservationIds = Array.from(new Set(hostifyReservationIds.map((id) => String(id || "").trim()).filter(Boolean)));
        const result = new Map<string, RentalAgreementSecurityDepositTransaction | null>();
        const missingReservationIds: string[] = [];

        uniqueReservationIds.forEach((reservationId) => {
            const cached = this.securityDepositTransactionCache.get(reservationId);
            if (cached && cached.expiresAt > now) {
                result.set(reservationId, cached.transaction);
            } else {
                missingReservationIds.push(reservationId);
            }
        });

        const apiKey = process.env.HOSTIFY_API_KEY || "";
        if (!apiKey || missingReservationIds.length === 0) return result;

        const concurrency = 5;
        let cursor = 0;
        const worker = async () => {
            while (cursor < missingReservationIds.length) {
                const reservationId = missingReservationIds[cursor++];
                const numericReservationId = Number(reservationId);
                if (!Number.isFinite(numericReservationId)) {
                    result.set(reservationId, null);
                    continue;
                }
                const transactions = await this.hostifyClient.getTransactions(apiKey, { reservation_id: numericReservationId });
                const depositTransaction = transactions
                    .filter((transaction: any) => this.getTransactionCompleted(transaction) && this.isSecurityDepositTransaction(transaction))
                    .sort((a: any, b: any) => {
                        const aTime = new Date(a?.charge_date || a?.chargeDate || a?.arrival_date || 0).getTime();
                        const bTime = new Date(b?.charge_date || b?.chargeDate || b?.arrival_date || 0).getTime();
                        return bTime - aTime;
                    })[0] || null;
                const normalized = depositTransaction ? this.normalizeSecurityDepositTransaction(depositTransaction) : null;
                result.set(reservationId, normalized);
                this.securityDepositTransactionCache.set(reservationId, {
                    expiresAt: Date.now() + this.securityDepositTransactionCacheTtlMs,
                    transaction: normalized,
                });
            }
        };

        await Promise.all(Array.from({ length: Math.min(concurrency, missingReservationIds.length) }, () => worker()));
        return result;
    }

    private normalizeRentalAgreementChannel(channelName?: string | null): string | null {
        const value = String(channelName || "").trim();
        if (!value) return null;
        const normalized = value.toLowerCase();

        if (normalized.includes("airbnb")) return "Airbnb";
        if (normalized.includes("booking")) return "Booking.com";
        if (normalized.includes("vrbo") || normalized.includes("homeaway")) return "Vrbo";
        if (normalized.includes("direct") || normalized.includes("website") || normalized.includes("hostaway")) return "Direct";
        if (normalized.includes("hvmb") || normalized.includes("marriott")) return "HVMB / Marriott";
        if (normalized.includes("google")) return "Google";
        if (normalized === "customlocal") return "Customlocal";
        if (normalized === "owner") return "Owner";
        if (normalized === "partner") return "Partner";
        if (normalized.includes("whimstay")) return "Whimstay";

        return value;
    }

    private buildRentalAgreementChannelWhere(channelValues: string[]) {
        const normalizedValues = Array.from(
            new Set(channelValues.map((value) => this.normalizeRentalAgreementChannel(value)).filter(Boolean)),
        ) as string[];
        if (!normalizedValues.length) return null;

        const clauses: string[] = [];
        const params: Record<string, string> = {};

        normalizedValues.forEach((value, index) => {
            const key = `channelFilter${index}`;
            params[key] = value;
            clauses.push(`
                CASE
                    WHEN LOWER(COALESCE(reservation.channelName, '')) LIKE '%airbnb%' THEN 'Airbnb'
                    WHEN LOWER(COALESCE(reservation.channelName, '')) LIKE '%booking%' THEN 'Booking.com'
                    WHEN LOWER(COALESCE(reservation.channelName, '')) LIKE '%vrbo%' OR LOWER(COALESCE(reservation.channelName, '')) LIKE '%homeaway%' THEN 'Vrbo'
                    WHEN LOWER(COALESCE(reservation.channelName, '')) LIKE '%direct%' OR LOWER(COALESCE(reservation.channelName, '')) LIKE '%website%' OR LOWER(COALESCE(reservation.channelName, '')) LIKE '%hostaway%' THEN 'Direct'
                    WHEN LOWER(COALESCE(reservation.channelName, '')) LIKE '%hvmb%' OR LOWER(COALESCE(reservation.channelName, '')) LIKE '%marriott%' THEN 'HVMB / Marriott'
                    WHEN LOWER(COALESCE(reservation.channelName, '')) LIKE '%google%' THEN 'Google'
                    WHEN LOWER(COALESCE(reservation.channelName, '')) = 'customlocal' THEN 'Customlocal'
                    WHEN LOWER(COALESCE(reservation.channelName, '')) = 'owner' THEN 'Owner'
                    WHEN LOWER(COALESCE(reservation.channelName, '')) = 'partner' THEN 'Partner'
                    WHEN LOWER(COALESCE(reservation.channelName, '')) LIKE '%whimstay%' THEN 'Whimstay'
                    ELSE TRIM(COALESCE(reservation.channelName, ''))
                END = :${key}
            `);
        });

        return {
            sql: `(${clauses.join(" OR ")})`,
            params,
        };
    }

    private getFrontendBaseUrl() {
        const explicitFrontendUrl = String(process.env.FRONTEND_URL || "").trim();
        if (explicitFrontendUrl) return explicitFrontendUrl.replace(/\/$/, "");

        const configuredBaseUrl = String(process.env.BASE_URL || "").trim();
        if (configuredBaseUrl) {
            return configuredBaseUrl.replace(/:5000\b/, ":3000").replace(/\/$/, "");
        }

        return "https://securestay.ai";
    }

    private formatDateValue(d: Date | string | null | undefined): string {
        if (!d) return "";
        let date: Date;
        if (typeof d === "string") {
            const trimmed = d.trim();
            const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (dateOnly) {
                date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
            } else {
                date = new Date(trimmed);
            }
        } else {
            date = d;
        }
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    }

    private formatHourValue(hour: number | string | null | undefined): string {
        if (hour === null || hour === undefined || hour === "") return "";
        const normalizedHour = Number(hour);
        if (!Number.isFinite(normalizedHour)) return String(hour);
        const date = new Date();
        date.setHours(normalizedHour, 0, 0, 0);
        return date.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
        });
    }

    private formatDateOnlyValue(value: Date | string | null | undefined): string | null {
        if (!value) return null;
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (!trimmed) return null;
            if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
            const isoLike = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
            if (isoLike) return isoLike[1];
        }

        const nextDate = new Date(value);
        if (Number.isNaN(nextDate.getTime())) return null;
        return format(nextDate, "yyyy-MM-dd");
    }

    private async getListingForReservation(reservationInfo: ReservationInfoEntity): Promise<Listing | null> {
        if (!reservationInfo?.listingMapId) return null;
        return listingRepo().findOne({ where: { id: reservationInfo.listingMapId } });
    }

    private getDisplayPropertyName(info: ReservationInfoEntity, listing: Listing | null): string {
        return info.listingName || listing?.internalListingName || listing?.name || "";
    }

    private getActualListingName(info: ReservationInfoEntity, listing: Listing | null): string {
        return listing?.name || listing?.externalListingName || info.listingName || listing?.internalListingName || "";
    }

    private formatAgreementHtmlPhone(html: string | null | undefined, phone?: string | null): string {
        const source = String(html || "");
        const formattedPhone = formatPhoneForDisplay(phone);
        const rawPhone = String(phone || "").trim();
        if (!source || !formattedPhone || !rawPhone || formattedPhone === rawPhone) return source;

        const escapedRaw = rawPhone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const digitsOnly = rawPhone.replace(/\D/g, "");
        let result = source.replace(new RegExp(escapedRaw, "g"), formattedPhone);
        if (digitsOnly.length >= 10) {
            result = result.replace(new RegExp(`\\+?${digitsOnly}`, "g"), formattedPhone);
        }
        return result;
    }

    private buildTemplateContext(info: ReservationInfoEntity, listing: Listing | null): RentalAgreementTemplateContext {
        const propertyName = this.getDisplayPropertyName(info, listing);
        const listingName = this.getActualListingName(info, listing);
        const propertyFullAddress = listing?.address || "";
        const checkInTime = this.formatHourValue(info.checkInTime ?? listing?.checkInTimeStart);
        const checkOutTime = this.formatHourValue(info.checkOutTime ?? listing?.checkOutTime);

        return {
            guestName: info.guestName || "",
            guestFirstName: info.guestFirstName || "",
            guestLastName: info.guestLastName || "",
            guestEmail: info.guestEmail || "",
            guestPhone: formatPhoneForDisplay(info.phone) || info.phone || "",
            channel: info.channelName || "",
            petCount: String(info.pets || 0),
            checkInDate: this.formatDateValue(info.arrivalDate),
            checkOutDate: this.formatDateValue(info.departureDate),
            listingName,
            propertyName,
            propertyFullAddress,
            checkInTime,
            checkOutTime,
            nights: String(info.nights || ""),
            numberOfGuests: String(info.numberOfGuests || ""),
            totalPrice: String(info.totalPrice || ""),
            currency: info.currency || "",
            reservationId: info.reservationId || "",
            confirmationCode: info.confirmation_code || "",
        };
    }

    private resolveTemplateString(html: string | null | undefined, context: RentalAgreementTemplateContext): string {
        const source = String(html || "");
        const tokenMap: Record<string, string> = {
            guestName: context.guestName,
            guestFirstName: context.guestFirstName,
            guestLastName: context.guestLastName,
            guestEmail: context.guestEmail,
            guestPhone: context.guestPhone,
            channel: context.channel,
            petCount: context.petCount,
            checkInDate: context.checkInDate,
            checkOutDate: context.checkOutDate,
            listingName: context.listingName,
            propertyName: context.propertyName,
            propertyFullAddress: context.propertyFullAddress,
            checkInTime: context.checkInTime,
            checkOutTime: context.checkOutTime,
            nights: context.nights,
            numberOfGuests: context.numberOfGuests,
            totalPrice: context.totalPrice,
            currency: context.currency,
            reservationId: context.reservationId,
            confirmationCode: context.confirmationCode,
        };

        return source.replace(/\{\{(\w+)\}\}/g, (_, token) => tokenMap[token] ?? "");
    }

    private resolveTemplate(bodyHtml: string, info: ReservationInfoEntity, listing: Listing | null = null): string {
        return this.resolveTemplateString(bodyHtml, this.buildTemplateContext(info, listing));
    }

    private normalizeHtmlBlock(value: string | null | undefined) {
        return String(value || "").trim();
    }

    private combineAgreementSections(headerHtml: string, bodyHtml: string, footerHtml: string) {
        return `
            <div class="agreement-sections">
                ${headerHtml ? `<div class="agreement-header-block">${headerHtml}</div>` : ""}
                <div class="agreement-body-block">${bodyHtml}</div>
                ${footerHtml ? `<div class="agreement-footer-block">${footerHtml}</div>` : ""}
            </div>
        `;
    }

    private buildDefaultEmailSubject(info: ReservationInfoEntity, listing: Listing | null) {
        const propertyName = this.getDisplayPropertyName(info, listing) || "your stay";
        return `Rental Agreement for ${propertyName}`;
    }

    private buildDefaultEmailBody(info: ReservationInfoEntity, listing: Listing | null, signingUrl: string) {
        const propertyName = this.getDisplayPropertyName(info, listing) || "your stay";
        const checkInDate = this.formatDateValue(info.arrivalDate);
        return `
            <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
                <p>Hello ${info.guestFirstName || info.guestName || "Guest"},</p>
                <p>Your rental agreement for <strong>${propertyName}</strong>${checkInDate ? ` starting on <strong>${checkInDate}</strong>` : ""} is ready to review and sign.</p>
                <p>
                    <a href="{{signingLink}}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">
                        Review &amp; Sign Agreement
                    </a>
                </p>
                <p>If the button above does not work, you can copy and paste this link into your browser:</p>
                <p><a href="{{signingLink}}">{{signingLink}}</a></p>
                <p>Thank you,<br/>Luxury Lodging PM</p>
            </div>
        `.replace(/\{\{signingLink\}\}/g, signingUrl);
    }

    private buildDefaultHeaderTemplate() {
        return `
            <h1 style="margin:0;font-size:44px;font-weight:800;line-height:1.1;">Rental Agreement</h1>
            <p style="margin:18px 0 0;font-size:24px;font-weight:600;line-height:1.3;">{{propertyName}}</p>
            <div style="margin-top:30px;font-size:18px;line-height:1.7;">
                <span><strong>Guest:</strong> {{guestName}}</span>
                <span style="margin-left:32px;"><strong>Check-in:</strong> {{checkInDate}}</span>
                <span style="margin-left:32px;"><strong>Check-out:</strong> {{checkOutDate}}</span>
            </div>
        `;
    }

    private buildDefaultFooterTemplate() {
        return `
            <h3 style="margin:0 0 14px;font-size:24px;font-weight:800;color:#1f3c68;">Sign Below</h3>
            <p style="margin:0;font-size:18px;line-height:1.6;color:#5f6b7a;">
                By signing below, you confirm that you have read and agree to the rental agreement above.
            </p>
        `;
    }

    private extractPropertyTypeFromTags(tags?: string | null): string | null {
        const parts = String(tags || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
        for (const part of parts) {
            if (part === "own") return "Own";
            if (part === "arb") return "Arb";
            if (part === "pm") return "PM";
        }
        return null;
    }

    private extractServiceTypeFromTags(tags?: string | null): string | null {
        const parts = String(tags || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
        for (const part of parts) {
            if (part === "full") return "Full";
            if (part === "pro") return "Pro";
            if (part === "launch") return "Launch";
        }
        return null;
    }

    private buildBucketWhere(bucket: string | undefined) {
        const today = startOfDay(new Date());
        const tomorrow = addDays(today, 1);
        const nextSevenEnd = addDays(today, 6);

        switch (bucket) {
            case "ongoingStay":
                return {
                    sql: "reservation.arrivalDate < :today AND reservation.departureDate >= :today",
                    params: { today: format(today, "yyyy-MM-dd") },
                };
            case "checkingInToday":
                return {
                    sql: "reservation.arrivalDate = :today",
                    params: { today: format(today, "yyyy-MM-dd") },
                };
            case "checkingInTomorrow":
                return {
                    sql: "reservation.arrivalDate = :tomorrow",
                    params: { tomorrow: format(tomorrow, "yyyy-MM-dd") },
                };
            case "checkingInNext7Days":
                return {
                    sql: "reservation.arrivalDate BETWEEN :today AND :nextSevenEnd",
                    params: {
                        today: format(today, "yyyy-MM-dd"),
                        nextSevenEnd: format(nextSevenEnd, "yyyy-MM-dd"),
                    },
                };
            default:
                return null;
        }
    }

    private activeApplicabilityRuleSql(reservationAlias = "reservation") {
        return `
            EXISTS (
                SELECT 1
                FROM rental_agreement_template_rules applicabilityRule
                INNER JOIN rental_agreement_templates applicabilityTemplate
                    ON applicabilityTemplate.id = applicabilityRule.templateId
                    AND applicabilityTemplate.isActive = 1
                WHERE applicabilityRule.listingId = ${reservationAlias}.listingMapId
                    AND applicabilityRule.isActive = 1
                    AND (
                        applicabilityRule.channelId IS NULL
                        OR applicabilityRule.channelId = ${reservationAlias}.channelId
                        OR LOWER(COALESCE(applicabilityRule.channelName, '') COLLATE utf8mb4_unicode_ci) = LOWER(COALESCE(${reservationAlias}.channelName, '') COLLATE utf8mb4_unicode_ci)
                    )
            )
        `;
    }

    private buildDirectDownloadPath(signingId: number) {
        return `/rental-agreement/signings/${signingId}/file`;
    }

    private buildGuestDownloadPath(hostifyReservationId: string, baseUrl?: string) {
        const downloadPath = `/rental-agreement/guest/${hostifyReservationId}/download`;
        return baseUrl ? `${baseUrl}${downloadPath}` : downloadPath;
    }

    private async getReservationAndListing(hostifyReservationId: string): Promise<{ reservationInfo: ReservationInfoEntity; listing: Listing | null }> {
        const reservationInfo = await reservationInfoRepo().findOne({
            where: { id: Number(hostifyReservationId) },
        });
        if (!reservationInfo) throw new Error("Reservation not found");

        const listing = await this.getListingForReservation(reservationInfo);
        return { reservationInfo, listing };
    }

    private async getSigningWithFile(signingId: number): Promise<{ signing: RentalAgreementSigning | null; fileInfo: FileInfo | null }> {
        const signing = await signingRepo().findOne({ where: { id: signingId } });
        if (!signing) return { signing: null, fileInfo: null };

        const fileInfo = signing.fileInfoId
            ? await fileInfoRepo().findOne({ where: { id: signing.fileInfoId } })
            : null;

        return { signing, fileInfo };
    }

    private async getFileInfoForSigning(signing: RentalAgreementSigning): Promise<FileInfo | null> {
        if (!signing.fileInfoId) return null;
        return fileInfoRepo().findOne({ where: { id: signing.fileInfoId } });
    }

    private async getReservationDocument(hostifyReservationId: string) {
        return reservationDocumentRepo().findOne({
            where: { hostifyReservationId },
        });
    }

    private async markAgreementViewed(hostifyReservationId: string, reservationInfo: ReservationInfoEntity, templateId: number | null) {
        const existing = await this.getReservationDocument(hostifyReservationId);
        const now = new Date();
        if (!existing) {
            const reservationDocument = reservationDocumentRepo().create({
                hostifyReservationId,
                reservationInfoId: reservationInfo.id,
                sourceTemplateId: templateId,
                firstViewedAt: now,
                lastViewedAt: now,
            });
            await reservationDocumentRepo().save(reservationDocument);
            return;
        }

        existing.firstViewedAt = existing.firstViewedAt || now;
        existing.lastViewedAt = now;
        if (!existing.sourceTemplateId && templateId) {
            existing.sourceTemplateId = templateId;
        }
        await reservationDocumentRepo().save(existing);
    }

    private async buildAgreementSnapshot(hostifyReservationId: string, info: ReservationInfoEntity, listing: Listing | null) {
        const template = await rentalAgreementTemplateService.getForReservationContext(info.listingMapId, info.channelId);
        if (!template) throw new Error("No active rental agreement template configured");

        const reservationDocument = await this.getReservationDocument(hostifyReservationId);
        const signingUrl = `${this.getFrontendBaseUrl()}/rental-agreement/${hostifyReservationId}`;

        if (reservationDocument) {
            return {
                template,
                reservationDocument,
                snapshot: {
                    headerHtml: this.normalizeHtmlBlock(reservationDocument.headerHtml) || this.normalizeHtmlBlock(template.headerHtml) || this.buildDefaultHeaderTemplate(),
                    bodyHtml: this.normalizeHtmlBlock(reservationDocument.bodyHtml) || this.normalizeHtmlBlock(template.bodyHtml),
                    footerHtml: this.normalizeHtmlBlock(reservationDocument.footerHtml) || this.normalizeHtmlBlock(template.footerHtml) || this.buildDefaultFooterTemplate(),
                    emailSubject: reservationDocument.emailSubject || this.buildDefaultEmailSubject(info, listing),
                    emailBodyHtml: reservationDocument.emailBodyHtml || this.buildDefaultEmailBody(info, listing, signingUrl),
                    isEdited: Boolean(reservationDocument.isEdited),
                    isOverridden: Boolean(reservationDocument.isOverridden),
                    overrideReason: reservationDocument.overrideReason || null,
                    sourceTemplateId: reservationDocument.sourceTemplateId || null,
                } as AgreementSnapshot,
            };
        }

        return {
            template,
            reservationDocument: null,
            snapshot: {
                headerHtml: this.normalizeHtmlBlock(template.headerHtml) || this.buildDefaultHeaderTemplate(),
                bodyHtml: this.normalizeHtmlBlock(template.bodyHtml),
                footerHtml: this.normalizeHtmlBlock(template.footerHtml) || this.buildDefaultFooterTemplate(),
                emailSubject: this.buildDefaultEmailSubject(info, listing),
                emailBodyHtml: this.buildDefaultEmailBody(info, listing, signingUrl),
                isEdited: false,
                isOverridden: false,
                overrideReason: null,
                sourceTemplateId: template.id,
            } as AgreementSnapshot,
        };
    }

    private renderAgreementSnapshot(snapshot: AgreementSnapshot, info: ReservationInfoEntity, listing: Listing | null) {
        const context = this.buildTemplateContext(info, listing);
        const resolvedHeaderHtml = this.resolveTemplateString(snapshot.headerHtml, context);
        const resolvedBodyHtml = this.resolveTemplateString(snapshot.bodyHtml, context);
        const resolvedFooterHtml = this.resolveTemplateString(snapshot.footerHtml, context);

        return {
            context,
            resolvedHeaderHtml,
            resolvedBodyHtml,
            resolvedFooterHtml,
            renderedHtml: this.combineAgreementSections(resolvedHeaderHtml, resolvedBodyHtml, resolvedFooterHtml),
        };
    }

    private isDownloadArtifactAvailable(fileInfo: FileInfo | null): boolean {
        if (!fileInfo) return false;
        if (fileInfo.webContentLink) return true;
        if (fileInfo.localPath && fs.existsSync(fileInfo.localPath)) return true;
        return false;
    }

    private async regeneratePdfIfNeeded(signing: RentalAgreementSigning): Promise<{ signing: RentalAgreementSigning; fileInfo: FileInfo | null }> {
        let fileInfo = await this.getFileInfoForSigning(signing);
        if (this.isDownloadArtifactAvailable(fileInfo)) {
            return { signing, fileInfo };
        }

        const reservationInfo = await reservationInfoRepo().findOne({ where: { id: signing.reservationInfoId } });
        if (!reservationInfo) return { signing, fileInfo };

        await signingRepo().update(signing.id, { pdfStatus: "pending_pdf" });
        try {
            await this.generateAndUploadPdf(signing.id, reservationInfo);
        } catch (_) {
            // Keep signed state intact and leave retry available.
        }

        const refreshedSigning = await signingRepo().findOne({ where: { id: signing.id } });
        if (!refreshedSigning) return { signing, fileInfo: null };
        fileInfo = await this.getFileInfoForSigning(refreshedSigning);
        return { signing: refreshedSigning, fileInfo };
    }

    private buildOverviewRow(
        raw: any,
        pdfDownloadAvailable: boolean,
        fileInfo: FileInfo | null,
        securityDepositTransaction?: RentalAgreementSecurityDepositTransaction | null,
    ): RentalAgreementOverviewRow {
        const isSigned = Boolean(raw.signingId);
        const isOverridden = Boolean(raw.isOverridden);
        const signatureComplete = isSigned || isOverridden;
        const idFrontUploaded = Boolean(raw.idFrontFileInfoId);
        const idBackUploaded = Boolean(raw.idBackFileInfoId);
        const idUploadComplete = Boolean(raw.skipIdUpload) || (idFrontUploaded && idBackUploaded);
        const agreementStatus = isSigned ? "signed" : isOverridden ? "overridden" : "not_yet_signed";

        return {
            reservationInfoId: Number(raw.reservationInfoId),
            hostifyReservationId: String(raw.hostifyReservationId || raw.reservationInfoId),
            reservationCode: raw.reservationCode || null,
            guestName: raw.guestName || "Guest",
            guestEmail: raw.guestEmail || "",
            propertyName: raw.propertyName || "—",
            propertyAddress: raw.propertyAddress || "",
            channelName: raw.channelName || "—",
            currency: securityDepositTransaction?.currency || raw.currency || null,
            securityDepositFee: securityDepositTransaction?.amount ?? null,
            securityDepositTransactionId: securityDepositTransaction?.transactionId || null,
            securityDepositStatus: securityDepositTransaction?.status || null,
            securityDepositCompleted: Boolean(securityDepositTransaction?.completed),
            securityDepositSource: securityDepositTransaction?.source || null,
            securityDepositDetails: securityDepositTransaction?.details || null,
            securityDepositChargeDate: securityDepositTransaction?.chargeDate || null,
            arrivalDate: this.formatDateOnlyValue(raw.arrivalDate),
            departureDate: this.formatDateOnlyValue(raw.departureDate),
            checkInTime: this.formatHourValue(raw.checkInTime ?? raw.listingCheckInTime),
            checkOutTime: this.formatHourValue(raw.checkOutTime ?? raw.listingCheckOutTime),
            signingId: raw.signingId ? Number(raw.signingId) : null,
            isSigned,
            signedAt: raw.signedAt ? new Date(raw.signedAt).toISOString() : null,
            signedByName: raw.signedByName || null,
            signedByEmail: raw.signedByEmail || null,
            pdfStatus: raw.pdfStatus || null,
            pdfDownloadAvailable,
            pdfViewUrl: fileInfo?.webViewLink || null,
            isEdited: Boolean(raw.isEdited),
            isOverridden,
            overrideReason: raw.overrideReason || null,
            skipIdUpload: Boolean(raw.skipIdUpload),
            skipIdUploadReason: raw.skipIdUploadReason || null,
            signatureComplete,
            idUploadComplete,
            idFrontUploaded,
            idBackUploaded,
            propertyType: raw.propertyType || null,
            serviceType: raw.serviceType || null,
            viewedAt: raw.lastViewedAt ? new Date(raw.lastViewedAt).toISOString() : raw.firstViewedAt ? new Date(raw.firstViewedAt).toISOString() : null,
            firstViewedAt: raw.firstViewedAt ? new Date(raw.firstViewedAt).toISOString() : null,
            lastViewedAt: raw.lastViewedAt ? new Date(raw.lastViewedAt).toISOString() : null,
            overriddenBy: raw.overriddenBy || null,
            overriddenAt: raw.overriddenAt ? new Date(raw.overriddenAt).toISOString() : null,
            signatureTimestampOverrideAt: raw.signatureTimestampOverrideAt ? new Date(raw.signatureTimestampOverrideAt).toISOString() : null,
            signatureTimezoneOverride: raw.signatureTimezoneOverride || null,
            signatureTimestampOverrideUpdatedBy: raw.signatureTimestampOverrideUpdatedBy || null,
            lastEditedBy: raw.lastEditedBy || null,
            agreementStatus,
        };
    }

    async getAgreementForGuest(hostifyReservationId: string): Promise<{
        reservationInfo: ReservationInfoEntity;
        template: {
            id: number | null;
            name: string;
            headerHtml: string;
            bodyHtml: string;
            footerHtml: string;
            isEdited: boolean;
            isOverridden: boolean;
        };
        idUploadRequired: boolean;
        alreadySigned: boolean;
        signing?: Pick<RentalAgreementSigning, "pdfStatus" | "fileInfoId">;
    }> {
        const { reservationInfo, listing } = await this.getReservationAndListing(hostifyReservationId);
        const { template, reservationDocument, snapshot } = await this.buildAgreementSnapshot(hostifyReservationId, reservationInfo, listing);
        await this.markAgreementViewed(hostifyReservationId, reservationInfo, template.id);

        const idUploadRequired = !(reservationDocument?.skipIdUpload ?? false);

        const existingSigning = await signingRepo().findOne({
            where: { hostifyReservationId },
        });

        return {
            reservationInfo: {
                ...reservationInfo,
                actualListingName: this.getActualListingName(reservationInfo, listing),
                propertyFullAddress: listing?.address || "",
                checkInTimeDisplay: this.formatHourValue(reservationInfo.checkInTime ?? listing?.checkInTimeStart),
                checkOutTimeDisplay: this.formatHourValue(reservationInfo.checkOutTime ?? listing?.checkOutTime),
            } as ReservationInfoEntity,
            template: {
                id: template.id,
                name: template.name || "Rental Agreement",
                headerHtml: snapshot.headerHtml,
                bodyHtml: snapshot.bodyHtml,
                footerHtml: snapshot.footerHtml,
                isEdited: snapshot.isEdited,
                isOverridden: snapshot.isOverridden,
            },
            idUploadRequired,
            alreadySigned: !!existingSigning,
            ...(existingSigning && {
                signing: { pdfStatus: existingSigning.pdfStatus, fileInfoId: existingSigning.fileInfoId },
            }),
        };
    }

    async saveIdPhotos(
        hostifyReservationId: string,
        idFrontFile: Express.Multer.File,
        idBackFile: Express.Multer.File,
    ): Promise<{ idFrontFileInfoId: number; idBackFileInfoId: number }> {
        const reservationInfo = await reservationInfoRepo().findOne({
            where: { id: Number(hostifyReservationId) },
        });
        if (!reservationInfo) throw new Error("Reservation not found");

        const entityId = Number(hostifyReservationId);

        const frontInfo = fileInfoRepo().create({
            entityType: "rental-agreement-id",
            entityId,
            localPath: idFrontFile.path,
            fileName: idFrontFile.filename,
            originalName: idFrontFile.originalname,
            mimetype: idFrontFile.mimetype,
            status: "pending",
        });
        const savedFront = await fileInfoRepo().save(frontInfo);

        const backInfo = fileInfoRepo().create({
            entityType: "rental-agreement-id",
            entityId,
            localPath: idBackFile.path,
            fileName: idBackFile.filename,
            originalName: idBackFile.originalname,
            mimetype: idBackFile.mimetype,
            status: "pending",
        });
        const savedBack = await fileInfoRepo().save(backInfo);

        return { idFrontFileInfoId: savedFront.id, idBackFileInfoId: savedBack.id };
    }

    async submitSigning(data: {
        hostifyReservationId: string;
        signatureDataUrl: string;
        signedByName: string;
        signedByEmail?: string;
        idFrontFileInfoId?: number;
        idBackFileInfoId?: number;
    }, ip: string, userAgent: string): Promise<{ signingId: number }> {
        const existing = await signingRepo().findOne({
            where: { hostifyReservationId: data.hostifyReservationId },
        });
        if (existing) throw new Error("Agreement already signed for this reservation");

        const { reservationInfo, listing } = await this.getReservationAndListing(data.hostifyReservationId);
        const { template, reservationDocument, snapshot } = await this.buildAgreementSnapshot(data.hostifyReservationId, reservationInfo, listing);
        const { renderedHtml } = this.renderAgreementSnapshot(snapshot, reservationInfo, listing);

        const idUploadRequired = !(reservationDocument?.skipIdUpload ?? false);
        if (idUploadRequired && (!data.idFrontFileInfoId || !data.idBackFileInfoId)) {
            throw new Error("ID photo upload is required before signing");
        }

        if (data.idFrontFileInfoId) {
            const frontFile = await fileInfoRepo().findOne({
                where: {
                    id: data.idFrontFileInfoId,
                    entityType: "rental-agreement-id",
                    entityId: Number(data.hostifyReservationId),
                },
            });
            if (!frontFile) throw new Error("Front ID photo not found for this reservation");
        }

        if (data.idBackFileInfoId) {
            const backFile = await fileInfoRepo().findOne({
                where: {
                    id: data.idBackFileInfoId,
                    entityType: "rental-agreement-id",
                    entityId: Number(data.hostifyReservationId),
                },
            });
            if (!backFile) throw new Error("Back ID photo not found for this reservation");
        }

        const signing = signingRepo().create({
            hostifyReservationId: data.hostifyReservationId,
            reservationInfoId: reservationInfo.id,
            templateId: template.id,
            renderedHtml,
            signatureDataUrl: data.signatureDataUrl,
            signedByName: data.signedByName,
            signedByEmail: data.signedByEmail || reservationInfo.guestEmail || undefined,
            ipAddress: ip,
            userAgent,
            signedAt: new Date(),
            pdfStatus: "pending_pdf",
            ...(data.idFrontFileInfoId && { idFrontFileInfoId: data.idFrontFileInfoId }),
            ...(data.idBackFileInfoId && { idBackFileInfoId: data.idBackFileInfoId }),
        });

        const saved = await signingRepo().save(signing);
        this.generateAndUploadPdf(saved.id, reservationInfo).catch((err) => {
            console.error(`[RentalAgreement] PDF generation failed for signing ${saved.id}:`, err);
        });

        return { signingId: saved.id };
    }

    async getSigningStatus(hostifyReservationId: string, baseUrl?: string): Promise<{
        pdfStatus: string;
        downloadUrl: string | null;
    }> {
        const signing = await signingRepo().findOne({
            where: { hostifyReservationId },
        });
        if (!signing) return { pdfStatus: "not_found", downloadUrl: null };

        const fileInfo = await this.getFileInfoForSigning(signing);
        const downloadUrl = this.isDownloadArtifactAvailable(fileInfo)
            ? this.buildGuestDownloadPath(hostifyReservationId, baseUrl)
            : null;

        return { pdfStatus: signing.pdfStatus, downloadUrl };
    }

    async getSigningsByReservation(hostifyReservationId: string): Promise<{
        signing: RentalAgreementSigning | null;
        downloadUrl: string | null;
        idFrontPhoto: { status: string; webViewLink: string | null; webContentLink: string | null } | null;
        idBackPhoto: { status: string; webViewLink: string | null; webContentLink: string | null } | null;
    }> {
        const signing = await signingRepo().findOne({
            where: { hostifyReservationId },
            relations: ["template"],
        });

        if (!signing) return { signing: null, downloadUrl: null, idFrontPhoto: null, idBackPhoto: null };

        const fileInfo = await this.getFileInfoForSigning(signing);
        const downloadUrl = this.isDownloadArtifactAvailable(fileInfo)
            ? this.buildDirectDownloadPath(signing.id)
            : null;

        const idFrontFileInfo = signing.idFrontFileInfoId
            ? await fileInfoRepo().findOne({ where: { id: signing.idFrontFileInfoId } })
            : null;
        const idBackFileInfo = signing.idBackFileInfoId
            ? await fileInfoRepo().findOne({ where: { id: signing.idBackFileInfoId } })
            : null;

        const toIdPhotoResult = (fi: FileInfo | null) =>
            fi ? { status: fi.status, webViewLink: fi.webViewLink || null, webContentLink: fi.webContentLink || null } : null;

        return {
            signing,
            downloadUrl,
            idFrontPhoto: toIdPhotoResult(idFrontFileInfo),
            idBackPhoto: toIdPhotoResult(idBackFileInfo),
        };
    }

    async getDownloadUrl(signingId: number): Promise<string | null> {
        const { signing, fileInfo } = await this.getSigningWithFile(signingId);
        if (!signing) return null;
        if (this.isDownloadArtifactAvailable(fileInfo)) return this.buildDirectDownloadPath(signingId);
        return null;
    }

    async getAdminOverview(filters: RentalAgreementAdminFilters): Promise<{
        summary: {
            ongoingStay: RentalAgreementSummaryCard;
            checkingInToday: RentalAgreementSummaryCard;
            checkingInTomorrow: RentalAgreementSummaryCard;
            checkingInNext7Days: RentalAgreementSummaryCard;
        };
        overallSummary: RentalAgreementSummaryCard;
        records: RentalAgreementOverviewRow[];
        availableChannels: string[];
        availableProperties: string[];
        availableOverriddenBy: string[];
        total: number;
        page: number;
        limit: number;
        hasMore: boolean;
    }> {
        const page = Math.max(1, Number(filters.page) || 1);
        const limit = Math.min(200, Math.max(10, Number(filters.limit) || 50));
        const includeMetadata = String(filters.includeMetadata ?? "true") !== "false";
        const search = String(filters.search || "").trim();
        const signingStatus = String(filters.signingStatus || "all");
        const statusTab = String(filters.statusTab || "all");
        const pdfStatus = String(filters.pdfStatus || "all");
        const dateType = String(filters.dateType || "checkIn");
        const channelValues = String(filters.channel || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        const propertyValues = String(filters.property || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        const listingIdValues = String(filters.listingId || "")
            .split(",")
            .map((value) => Number(value.trim()))
            .filter(Boolean);
        const propertyTypeValues = String(filters.propertyType || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        const serviceTypeValues = String(filters.serviceType || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        const overriddenByValues = String(filters.overriddenBy || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        const bothCompletion = String(filters.bothCompletion || "all");
        const signatureCompletion = String(filters.signatureCompletion || "all");
        const idCompletion = String(filters.idCompletion || "all");
        const overridden = String(filters.overridden || "all");
        const signatureTimestampOverridden = String(filters.signatureTimestampOverridden || "all");
        const sort = String(filters.sort || "checkInAsc");
        const editedOnly = String(filters.editedOnly || "false") === "true";
        const bucket = String(filters.bucket || "");

        const today = startOfDay(new Date());
        const fromDate = filters.fromDate ? startOfDay(new Date(filters.fromDate)) : null;
        const toDate = filters.toDate ? endOfDay(new Date(filters.toDate)) : null;

        const qb = reservationInfoRepo()
            .createQueryBuilder("reservation")
            .leftJoin(RentalAgreementSigning, "signing", "signing.reservationInfoId = reservation.id")
            .leftJoin(Listing, "listing", "listing.id = reservation.listingMapId")
            .leftJoin(RentalAgreementReservationDocument, "document", "document.hostifyReservationId = reservation.id")
            .select([
                "reservation.id AS reservationInfoId",
                "reservation.id AS hostifyReservationId",
                "reservation.reservationId AS reservationCode",
                "reservation.guestName AS guestName",
                "reservation.guestEmail AS guestEmail",
                "reservation.listingName AS propertyName",
                "reservation.channelName AS channelName",
                "reservation.currency AS currency",
                "reservation.securityDepositFee AS securityDepositFee",
                "reservation.arrivalDate AS arrivalDate",
                "reservation.departureDate AS departureDate",
                "reservation.checkInTime AS checkInTime",
                "reservation.checkOutTime AS checkOutTime",
                "listing.address AS propertyAddress",
                "listing.checkInTimeStart AS listingCheckInTime",
                "listing.checkOutTime AS listingCheckOutTime",
                "signing.id AS signingId",
                "signing.signedAt AS signedAt",
                "signing.signedByName AS signedByName",
                "signing.signedByEmail AS signedByEmail",
                "signing.pdfStatus AS pdfStatus",
                "signing.fileInfoId AS fileInfoId",
                "signing.idFrontFileInfoId AS idFrontFileInfoId",
                "signing.idBackFileInfoId AS idBackFileInfoId",
                "document.isEdited AS isEdited",
                "document.isOverridden AS isOverridden",
                "document.overrideReason AS overrideReason",
                "document.skipIdUpload AS skipIdUpload",
                "document.skipIdUploadReason AS skipIdUploadReason",
                "document.firstViewedAt AS firstViewedAt",
                "document.lastViewedAt AS lastViewedAt",
                "document.overriddenBy AS overriddenBy",
                "document.overriddenAt AS overriddenAt",
                "document.signatureTimestampOverrideAt AS signatureTimestampOverrideAt",
                "document.signatureTimezoneOverride AS signatureTimezoneOverride",
                "document.signatureTimestampOverrideUpdatedBy AS signatureTimestampOverrideUpdatedBy",
                "document.lastEditedBy AS lastEditedBy",
                "listing.tags AS listingTags",
            ])
            .where("reservation.arrivalDate IS NOT NULL")
            .andWhere("reservation.arrivalDate >= :minArrivalDate", {
                minArrivalDate: this.rentalAgreementMinArrivalDate,
            })
            .andWhere("LOWER(COALESCE(reservation.status, '')) NOT IN (:...excludedStatuses)", {
                excludedStatuses: this.excludedReservationStatuses,
            })
            .andWhere(this.activeApplicabilityRuleSql("reservation"));

        const bucketWhere = this.buildBucketWhere(bucket);
        if (bucketWhere) {
            qb.andWhere(bucketWhere.sql, bucketWhere.params);
        } else if (fromDate || toDate) {
            if (dateType === "checkOut") {
                if (fromDate) qb.andWhere("reservation.departureDate >= :fromDate", { fromDate: format(fromDate, "yyyy-MM-dd") });
                if (toDate) qb.andWhere("reservation.departureDate <= :toDate", { toDate: format(toDate, "yyyy-MM-dd") });
            } else if (dateType === "signed") {
                qb.andWhere("signing.signedAt IS NOT NULL");
                if (fromDate) qb.andWhere("DATE(signing.signedAt) >= :fromDate", { fromDate: format(fromDate, "yyyy-MM-dd") });
                if (toDate) qb.andWhere("DATE(signing.signedAt) <= :toDate", { toDate: format(toDate, "yyyy-MM-dd") });
            } else if (dateType === "viewed") {
                qb.andWhere("COALESCE(document.lastViewedAt, document.firstViewedAt) IS NOT NULL");
                if (fromDate) qb.andWhere("DATE(COALESCE(document.lastViewedAt, document.firstViewedAt)) >= :fromDate", { fromDate: format(fromDate, "yyyy-MM-dd") });
                if (toDate) qb.andWhere("DATE(COALESCE(document.lastViewedAt, document.firstViewedAt)) <= :toDate", { toDate: format(toDate, "yyyy-MM-dd") });
            } else if (dateType === "overridden") {
                qb.andWhere("document.overriddenAt IS NOT NULL");
                if (fromDate) qb.andWhere("DATE(document.overriddenAt) >= :fromDate", { fromDate: format(fromDate, "yyyy-MM-dd") });
                if (toDate) qb.andWhere("DATE(document.overriddenAt) <= :toDate", { toDate: format(toDate, "yyyy-MM-dd") });
            } else {
                if (fromDate) qb.andWhere("reservation.arrivalDate >= :fromDate", { fromDate: format(fromDate, "yyyy-MM-dd") });
                if (toDate) qb.andWhere("reservation.arrivalDate <= :toDate", { toDate: format(toDate, "yyyy-MM-dd") });
            }
        }

        const channelWhere = this.buildRentalAgreementChannelWhere(channelValues);
        if (channelWhere) {
            qb.andWhere(channelWhere.sql, channelWhere.params);
        }

        if (propertyValues.length) {
            qb.andWhere("reservation.listingName IN (:...propertyValues)", { propertyValues });
        }

        if (listingIdValues.length) {
            qb.andWhere("reservation.listingMapId IN (:...listingIdValues)", { listingIdValues });
        }

        if (propertyTypeValues.length) {
            const clauses = propertyTypeValues.map((value, index) => {
                const param = `propertyType${index}`;
                return `(listing.tags LIKE :${param} OR listing.propertyType LIKE :${param})`;
            });
            qb.andWhere(`(${clauses.join(" OR ")})`, Object.fromEntries(propertyTypeValues.map((value, index) => [`propertyType${index}`, `%${value}%`])));
        }

        if (serviceTypeValues.length) {
            const clauses = serviceTypeValues.map((value, index) => {
                const param = `serviceType${index}`;
                return `listing.tags LIKE :${param}`;
            });
            qb.andWhere(`(${clauses.join(" OR ")})`, Object.fromEntries(serviceTypeValues.map((value, index) => [`serviceType${index}`, `%${value}%`])));
        }

        if (search) {
            qb.andWhere(
                "(reservation.guestName LIKE :search OR reservation.guestEmail LIKE :search OR reservation.listingName LIKE :search OR reservation.reservationId LIKE :search)",
                { search: `%${search}%` },
            );
        }

        if (signingStatus === "signed") {
            qb.andWhere("signing.id IS NOT NULL");
        } else if (signingStatus === "unsigned") {
            qb.andWhere("signing.id IS NULL");
        }

        if (statusTab === "signed") {
            qb.andWhere("signing.id IS NOT NULL");
        } else if (statusTab === "overridden") {
            qb.andWhere("COALESCE(document.isOverridden, 0) = 1");
        } else if (statusTab === "not_yet_signed") {
            qb.andWhere("signing.id IS NULL AND COALESCE(document.isOverridden, 0) = 0");
        }

        if (editedOnly) {
            qb.andWhere("COALESCE(document.isEdited, 0) = 1");
        }

        if (overridden === "overridden") {
            qb.andWhere("COALESCE(document.isOverridden, 0) = 1");
        } else if (overridden === "not_overridden") {
            qb.andWhere("COALESCE(document.isOverridden, 0) = 0");
        }

        if (overriddenByValues.length) {
            qb.andWhere("document.overriddenBy IN (:...overriddenByValues)", { overriddenByValues });
        }

        if (signatureTimestampOverridden === "overridden") {
            qb.andWhere("document.signatureTimestampOverrideAt IS NOT NULL");
        } else if (signatureTimestampOverridden === "not_overridden") {
            qb.andWhere("document.signatureTimestampOverrideAt IS NULL");
        }

        const signatureCompleteSql = "(signing.id IS NOT NULL OR COALESCE(document.isOverridden, 0) = 1)";
        const idCompleteSql = "(COALESCE(document.skipIdUpload, 0) = 1 OR (signing.idFrontFileInfoId IS NOT NULL AND signing.idBackFileInfoId IS NOT NULL))";
        if (bothCompletion === "complete") {
            qb.andWhere(`${signatureCompleteSql} AND ${idCompleteSql}`);
        } else if (bothCompletion === "incomplete") {
            qb.andWhere(`NOT (${signatureCompleteSql} AND ${idCompleteSql})`);
        }
        if (signatureCompletion === "complete") {
            qb.andWhere(signatureCompleteSql);
        } else if (signatureCompletion === "incomplete") {
            qb.andWhere(`NOT ${signatureCompleteSql}`);
        }
        if (idCompletion === "complete") {
            qb.andWhere(idCompleteSql);
        } else if (idCompletion === "incomplete") {
            qb.andWhere(`NOT ${idCompleteSql}`);
        }

        if (pdfStatus === "ready") {
            qb.andWhere("signing.pdfStatus = 'pdf_ready'");
        } else if (pdfStatus === "pending") {
            qb.andWhere("signing.pdfStatus = 'pending_pdf'");
        } else if (pdfStatus === "failed") {
            qb.andWhere("signing.pdfStatus = 'pdf_failed'");
        } else if (pdfStatus === "missing") {
            qb.andWhere("signing.id IS NOT NULL AND (signing.pdfStatus IS NULL OR signing.fileInfoId IS NULL)");
        }

        switch (sort) {
            case "checkInDesc":
                qb.orderBy("reservation.arrivalDate", "DESC");
                break;
            case "guestNameAsc":
                qb.orderBy("reservation.guestName", "ASC");
                break;
            case "guestNameDesc":
                qb.orderBy("reservation.guestName", "DESC");
                break;
            case "signedAtDesc":
                qb.orderBy("CASE WHEN signing.signedAt IS NULL THEN 1 ELSE 0 END", "ASC");
                qb.addOrderBy("signing.signedAt", "DESC");
                break;
            case "signedAtAsc":
                qb.orderBy("CASE WHEN signing.signedAt IS NULL THEN 1 ELSE 0 END", "ASC");
                qb.addOrderBy("signing.signedAt", "ASC");
                break;
            case "checkInAsc":
            default:
                qb.orderBy("reservation.arrivalDate", "ASC");
                break;
        }

        qb.addOrderBy("reservation.id", "DESC");
        qb.skip((page - 1) * limit).take(limit + 1);

        const channelRowsPromise = includeMetadata ? reservationInfoRepo()
            .createQueryBuilder("reservation")
            .select("DISTINCT reservation.channelName", "channelName")
            .where("reservation.arrivalDate IS NOT NULL")
            .andWhere("reservation.arrivalDate >= :minArrivalDate", {
                minArrivalDate: this.rentalAgreementMinArrivalDate,
            })
            .andWhere("LOWER(COALESCE(reservation.status, '')) NOT IN (:...excludedStatuses)", {
                excludedStatuses: this.excludedReservationStatuses,
            })
            .andWhere(this.activeApplicabilityRuleSql("reservation"))
            .andWhere("COALESCE(reservation.channelName, '') <> ''")
            .orderBy("reservation.channelName", "ASC")
            .getRawMany() : Promise.resolve([]);

        const propertyRowsPromise = includeMetadata ? reservationInfoRepo()
            .createQueryBuilder("reservation")
            .select("DISTINCT reservation.listingName", "propertyName")
            .where("reservation.arrivalDate IS NOT NULL")
            .andWhere("reservation.arrivalDate >= :minArrivalDate", {
                minArrivalDate: this.rentalAgreementMinArrivalDate,
            })
            .andWhere("LOWER(COALESCE(reservation.status, '')) NOT IN (:...excludedStatuses)", {
                excludedStatuses: this.excludedReservationStatuses,
            })
            .andWhere(this.activeApplicabilityRuleSql("reservation"))
            .andWhere("COALESCE(reservation.listingName, '') <> ''")
            .orderBy("reservation.listingName", "ASC")
            .getRawMany() : Promise.resolve([]);

        const overriddenByRowsPromise = includeMetadata ? reservationDocumentRepo()
            .createQueryBuilder("document")
            .select("DISTINCT document.overriddenBy", "overriddenBy")
            .where("COALESCE(document.overriddenBy, '') <> ''")
            .orderBy("document.overriddenBy", "ASC")
            .getRawMany() : Promise.resolve([]);

        const [rawRows, channelRows, propertyRows, overriddenByRows] = await Promise.all([
            qb.getRawMany(),
            channelRowsPromise,
            propertyRowsPromise,
            overriddenByRowsPromise,
        ]);
        const hasMore = rawRows.length > limit;
        const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
        const total = (page - 1) * limit + pageRows.length + (hasMore ? 1 : 0);
        const availableChannels = Array.from(
            new Set(
                channelRows
                    .map((row) => this.normalizeRentalAgreementChannel(row.channelName))
                    .filter(Boolean),
            ),
        ).sort((a, b) => a.localeCompare(b));
        const availableProperties = Array.from(
            new Set(
                propertyRows
                    .map((row) => String(row.propertyName || "").trim())
                    .filter(Boolean),
            ),
        ).sort((a, b) => a.localeCompare(b));
        const availableOverriddenBy = Array.from(
            new Set(
                overriddenByRows
                    .map((row) => String(row.overriddenBy || "").trim())
                    .filter(Boolean),
            ),
        ).sort((a, b) => a.localeCompare(b));

        const fileInfoIds = pageRows.map((row) => Number(row.fileInfoId)).filter(Boolean);
        const fileInfos = fileInfoIds.length > 0
            ? await fileInfoRepo().findBy({ id: In(fileInfoIds) })
            : [];
        const fileInfoMap = new Map(fileInfos.map((fileInfo) => [fileInfo.id, fileInfo]));
        const securityDepositTransactionsByReservation = await this.getSecurityDepositTransactionsByReservation(
            pageRows.map((row) => String(row.hostifyReservationId || row.reservationInfoId)),
        );

        const records = pageRows.map((row) => {
            const fileInfo = row.fileInfoId ? fileInfoMap.get(Number(row.fileInfoId)) || null : null;
            const hostifyReservationId = String(row.hostifyReservationId || row.reservationInfoId);
            const enrichedRow = {
                ...row,
                propertyType: this.extractPropertyTypeFromTags(row.listingTags),
                serviceType: this.extractServiceTypeFromTags(row.listingTags),
            };
            return this.buildOverviewRow(
                enrichedRow,
                this.isDownloadArtifactAvailable(fileInfo),
                fileInfo,
                securityDepositTransactionsByReservation.get(hostifyReservationId) || null,
            );
        });

        const buildSummaryCard = async (
            label: string,
            whereSql: string,
            whereParams: Record<string, string>,
        ): Promise<RentalAgreementSummaryCard> => {
            const raw = await reservationInfoRepo()
                .createQueryBuilder("reservation")
                .leftJoin(RentalAgreementSigning, "signing", "signing.reservationInfoId = reservation.id")
                .leftJoin(RentalAgreementReservationDocument, "document", "document.hostifyReservationId = reservation.id")
                .select("COUNT(DISTINCT reservation.id)", "total")
                .addSelect("COUNT(DISTINCT CASE WHEN signing.id IS NOT NULL THEN reservation.id END)", "signed")
                .addSelect("COUNT(DISTINCT CASE WHEN signing.id IS NULL AND COALESCE(document.isOverridden, 0) = 0 THEN reservation.id END)", "unsigned")
                .addSelect("COUNT(DISTINCT CASE WHEN COALESCE(document.isOverridden, 0) = 1 THEN reservation.id END)", "overridden")
                .where(whereSql, whereParams)
                .andWhere("reservation.arrivalDate >= :minArrivalDate", {
                    minArrivalDate: this.rentalAgreementMinArrivalDate,
                })
                .andWhere("LOWER(COALESCE(reservation.status, '')) NOT IN (:...excludedStatuses)", {
                    excludedStatuses: this.excludedReservationStatuses,
                })
                .andWhere(this.activeApplicabilityRuleSql("reservation"))
                .getRawOne();

            return {
                label,
                total: Number(raw?.total || 0),
                signed: Number(raw?.signed || 0),
                unsigned: Number(raw?.unsigned || 0),
                overridden: Number(raw?.overridden || 0),
            };
        };

        const tomorrow = addDays(today, 1);
        const nextSevenEnd = addDays(today, 6);

        const [ongoingStay, checkingInToday, checkingInTomorrow, checkingInNext7Days, overallSummary] = includeMetadata ? await Promise.all([
            buildSummaryCard("Ongoing Stay", "reservation.arrivalDate < :today AND reservation.departureDate >= :today", {
                today: format(today, "yyyy-MM-dd"),
            }),
            buildSummaryCard("Checking In Today", "reservation.arrivalDate = :today", {
                today: format(today, "yyyy-MM-dd"),
            }),
            buildSummaryCard("Checking In Tomorrow", "reservation.arrivalDate = :tomorrow", {
                tomorrow: format(tomorrow, "yyyy-MM-dd"),
            }),
            buildSummaryCard("Next 7 Days", "reservation.arrivalDate BETWEEN :today AND :nextSevenEnd", {
                today: format(today, "yyyy-MM-dd"),
                nextSevenEnd: format(nextSevenEnd, "yyyy-MM-dd"),
            }),
            buildSummaryCard("Overall", "reservation.arrivalDate IS NOT NULL", {}),
        ]) : [
            { label: "Ongoing Stay", total: 0, signed: 0, unsigned: 0, overridden: 0 },
            { label: "Checking In Today", total: 0, signed: 0, unsigned: 0, overridden: 0 },
            { label: "Checking In Tomorrow", total: 0, signed: 0, unsigned: 0, overridden: 0 },
            { label: "Next 7 Days", total: 0, signed: 0, unsigned: 0, overridden: 0 },
            { label: "Overall", total: 0, signed: 0, unsigned: 0, overridden: 0 },
        ];

        return {
            summary: {
                ongoingStay,
                checkingInToday,
                checkingInTomorrow,
                checkingInNext7Days,
            },
            overallSummary,
            records,
            availableChannels,
            availableProperties,
            availableOverriddenBy,
            total,
            page,
            limit,
            hasMore,
        };
    }

    async getLatestPreviewContext() {
        const reservationInfo = await reservationInfoRepo()
            .createQueryBuilder("reservation")
            .where("reservation.arrivalDate >= :today", {
                today: format(startOfDay(new Date()), "yyyy-MM-dd"),
            })
            .andWhere("LOWER(COALESCE(reservation.status, '')) NOT IN (:...excludedStatuses)", {
                excludedStatuses: this.excludedReservationStatuses,
            })
            .orderBy("reservation.arrivalDate", "ASC")
            .addOrderBy("reservation.id", "ASC")
            .getOne();

        if (!reservationInfo) {
            return { reservation: null };
        }

        const listing = await this.getListingForReservation(reservationInfo);
        const previewReservation: PreviewReservationContext = {
            hostifyReservationId: String(reservationInfo.id),
            reservationCode: reservationInfo.reservationId || "",
            confirmationCode: reservationInfo.confirmation_code || "",
            guestName: reservationInfo.guestName || "",
            guestEmail: reservationInfo.guestEmail || "",
            guestPhone: formatPhoneForDisplay(reservationInfo.phone) || reservationInfo.phone || "",
            channel: reservationInfo.channelName || "",
            petCount: reservationInfo.pets || 0,
            listingName: this.getActualListingName(reservationInfo, listing),
            propertyName: this.getDisplayPropertyName(reservationInfo, listing),
            propertyAddress: listing?.address || "",
            arrivalDate: reservationInfo.arrivalDate ? new Date(reservationInfo.arrivalDate).toISOString() : null,
            departureDate: reservationInfo.departureDate ? new Date(reservationInfo.departureDate).toISOString() : null,
            checkInTime: this.formatHourValue(reservationInfo.checkInTime ?? listing?.checkInTimeStart),
            checkOutTime: this.formatHourValue(reservationInfo.checkOutTime ?? listing?.checkOutTime),
        };

        return {
            reservation: previewReservation,
        };
    }

    async getReservationDocumentForAdmin(hostifyReservationId: string) {
        const { reservationInfo, listing } = await this.getReservationAndListing(hostifyReservationId);
        const { template, reservationDocument, snapshot } = await this.buildAgreementSnapshot(hostifyReservationId, reservationInfo, listing);
        const rendered = this.renderAgreementSnapshot(snapshot, reservationInfo, listing);
        const signing = await signingRepo().findOne({ where: { hostifyReservationId } });
        const fileInfo = signing ? await this.getFileInfoForSigning(signing) : null;
        const toIdPhotoResult = (fi: FileInfo | null) =>
            fi
                ? {
                    status: fi.status,
                    webViewLink: fi.webViewLink || null,
                    webContentLink: fi.webContentLink || null,
                }
                : null;

        return {
            templateId: template.id,
            sourceTemplateId: snapshot.sourceTemplateId,
            reservationInfo: {
                id: reservationInfo.id,
                hostifyReservationId: String(reservationInfo.id),
                reservationCode: reservationInfo.reservationId || "",
                confirmationCode: reservationInfo.confirmation_code || "",
                hostifyReservationUrl: reservationInfo.reservationId
                    ? `https://us.hostify.com/reservations/view/${reservationInfo.reservationId}`
                    : `https://us.hostify.com/reservations/view/${hostifyReservationId}`,
                guestName: reservationInfo.guestName || "",
                guestEmail: reservationInfo.guestEmail || "",
                guestPhone: formatPhoneForDisplay(reservationInfo.phone) || reservationInfo.phone || "",
                channelName: reservationInfo.channelName || "",
                listingName: this.getDisplayPropertyName(reservationInfo, listing),
                propertyFullAddress: listing?.address || "",
                propertyType: this.extractPropertyTypeFromTags(listing?.tags) || null,
                serviceType: this.extractServiceTypeFromTags(listing?.tags) || null,
                arrivalDate: reservationInfo.arrivalDate ? new Date(reservationInfo.arrivalDate).toISOString() : null,
                departureDate: reservationInfo.departureDate ? new Date(reservationInfo.departureDate).toISOString() : null,
            },
            document: {
                id: reservationDocument?.id || null,
                headerHtml: snapshot.headerHtml,
                bodyHtml: snapshot.bodyHtml,
                footerHtml: snapshot.footerHtml,
                emailSubject: snapshot.emailSubject,
                emailBodyHtml: snapshot.emailBodyHtml,
                isEdited: snapshot.isEdited,
                isOverridden: snapshot.isOverridden,
                overrideReason: snapshot.overrideReason,
                firstViewedAt: reservationDocument?.firstViewedAt ? reservationDocument.firstViewedAt.toISOString() : null,
                lastViewedAt: reservationDocument?.lastViewedAt ? reservationDocument.lastViewedAt.toISOString() : null,
                overriddenBy: reservationDocument?.overriddenBy || null,
                lastEditedBy: reservationDocument?.lastEditedBy || null,
                skipIdUpload: reservationDocument?.skipIdUpload ?? false,
                skipIdUploadAt: reservationDocument?.skipIdUploadAt ? reservationDocument.skipIdUploadAt.toISOString() : null,
                skipIdUploadBy: reservationDocument?.skipIdUploadBy || null,
                skipIdUploadReason: reservationDocument?.skipIdUploadReason || null,
                signatureTimestampOverrideAt: reservationDocument?.signatureTimestampOverrideAt ? reservationDocument.signatureTimestampOverrideAt.toISOString() : null,
                signatureTimezoneOverride: reservationDocument?.signatureTimezoneOverride || null,
                signatureTimestampOverrideUpdatedBy: reservationDocument?.signatureTimestampOverrideUpdatedBy || null,
            },
            preview: {
                headerHtml: rendered.resolvedHeaderHtml,
                bodyHtml: rendered.resolvedBodyHtml,
                footerHtml: rendered.resolvedFooterHtml,
                renderedHtml: rendered.renderedHtml,
                context: rendered.context,
            },
            signing: signing ? {
                id: signing.id,
                signedAt: signing.signedAt ? signing.signedAt.toISOString() : null,
                signedByName: signing.signedByName || null,
                signedByEmail: signing.signedByEmail || null,
                renderedHtml: this.formatAgreementHtmlPhone(signing.renderedHtml, reservationInfo.phone) || null,
                signatureDataUrl: signing.signatureDataUrl || null,
                pdfStatus: signing.pdfStatus || null,
                pdfDownloadAvailable: this.isDownloadArtifactAvailable(fileInfo),
                pdfViewUrl: fileInfo?.webViewLink || null,
            } : null,
            idFrontPhoto: signing?.idFrontFileInfoId
                ? await fileInfoRepo().findOne({ where: { id: signing.idFrontFileInfoId } }).then(toIdPhotoResult)
                : null,
            idBackPhoto: signing?.idBackFileInfoId
                ? await fileInfoRepo().findOne({ where: { id: signing.idBackFileInfoId } }).then(toIdPhotoResult)
                : null,
        };
    }

    async createManualAgreement(payload: {
        guestName?: string;
        guestEmail?: string;
        guestPhone?: string;
        listingName?: string;
        listingMapId?: number | null;
        arrivalDate?: string;
        departureDate?: string;
        checkInTime?: number | string | null;
        checkOutTime?: number | string | null;
        numberOfGuests?: number | string | null;
        pets?: number | string | null;
        channelName?: string;
        reservationCode?: string;
    }): Promise<{ hostifyReservationId: string }> {
        const guestName = String(payload.guestName || "").trim();
        const listingName = String(payload.listingName || "").trim();
        const arrivalDate = this.formatDateOnlyValue(payload.arrivalDate);
        const departureDate = this.formatDateOnlyValue(payload.departureDate);
        if (!guestName) throw new Error("Guest name is required");
        if (!arrivalDate || !departureDate) throw new Error("Check-in and check-out dates are required");

        const selectedListing = payload.listingMapId
            ? await listingRepo().findOne({ where: { id: Number(payload.listingMapId) } })
            : null;
        const maxManual = await reservationInfoRepo()
            .createQueryBuilder("reservation")
            .select("MIN(reservation.id)", "minId")
            .where("reservation.id < 0")
            .getRawOne();
        const nextId = Math.min(-1, Number(maxManual?.minId || 0) - 1);
        const [guestFirstName, ...lastNameParts] = guestName.split(/\s+/).filter(Boolean);
        const manualReservationCode = String(payload.reservationCode || `MANUAL-RA-${Math.abs(nextId)}`).trim();

        const reservation = reservationInfoRepo().create({
            id: nextId,
            listingMapId: selectedListing?.id || (payload.listingMapId ? Number(payload.listingMapId) : null),
            listingName: listingName || selectedListing?.internalListingName || selectedListing?.name || "Manual Rental Agreement",
            source: "manual_rental_agreement",
            channelName: String(payload.channelName || "Manual").trim() || "Manual",
            reservationId: manualReservationCode,
            guestName,
            guestFirstName: guestFirstName || guestName,
            guestLastName: lastNameParts.join(" "),
            guestEmail: String(payload.guestEmail || "").trim(),
            phone: String(payload.guestPhone || "").trim(),
            numberOfGuests: Number(payload.numberOfGuests || 1),
            pets: Number(payload.pets || 0),
            arrivalDate: arrivalDate as any,
            departureDate: departureDate as any,
            checkInTime: payload.checkInTime === "" || payload.checkInTime === null || payload.checkInTime === undefined
                ? (selectedListing?.checkInTimeStart ?? null)
                : Number(payload.checkInTime),
            checkOutTime: payload.checkOutTime === "" || payload.checkOutTime === null || payload.checkOutTime === undefined
                ? (selectedListing?.checkOutTime ?? null)
                : Number(payload.checkOutTime),
            nights: Math.max(1, Math.round((new Date(`${departureDate}T00:00:00`).getTime() - new Date(`${arrivalDate}T00:00:00`).getTime()) / 86400000)),
            currency: selectedListing?.currencyCode || "USD",
            status: "confirmed",
        });

        await reservationInfoRepo().save(reservation);
        return { hostifyReservationId: String(nextId) };
    }

    async upsertReservationDocumentForAdmin(
        hostifyReservationId: string,
        payload: Partial<Pick<RentalAgreementReservationDocument, "headerHtml" | "bodyHtml" | "footerHtml" | "emailSubject" | "emailBodyHtml">> & {
            markAsOverridden?: boolean;
            overrideReason?: string | null;
            skipIdUpload?: boolean;
            skipIdUploadReason?: string | null;
            signatureTimestampOverrideAt?: string | null;
            signatureTimezoneOverride?: string | null;
        },
        userId?: string,
    ) {
        const { reservationInfo, listing } = await this.getReservationAndListing(hostifyReservationId);
        const { template, reservationDocument, snapshot } = await this.buildAgreementSnapshot(hostifyReservationId, reservationInfo, listing);

        const nextDocument = reservationDocument || reservationDocumentRepo().create({
            hostifyReservationId,
            reservationInfoId: reservationInfo.id,
            sourceTemplateId: template?.id || null,
            isEdited: false,
            isOverridden: false,
        });
        const previousSignatureTimestampOverrideAt = nextDocument.signatureTimestampOverrideAt?.getTime() ?? null;
        const previousSignatureTimezoneOverride = nextDocument.signatureTimezoneOverride || null;
        let signatureTimestampOverrideChanged = false;

        nextDocument.headerHtml = payload.headerHtml ?? snapshot.headerHtml;
        nextDocument.bodyHtml = payload.bodyHtml ?? snapshot.bodyHtml;
        nextDocument.footerHtml = payload.footerHtml ?? snapshot.footerHtml;
        nextDocument.emailSubject = payload.emailSubject ?? snapshot.emailSubject;
        nextDocument.emailBodyHtml = payload.emailBodyHtml ?? snapshot.emailBodyHtml;
        nextDocument.isEdited = true;
        nextDocument.lastEditedAt = new Date();
        nextDocument.lastEditedBy = userId || null;
        nextDocument.sourceTemplateId = template?.id || nextDocument.sourceTemplateId || null;
        if (payload.markAsOverridden) {
            nextDocument.isOverridden = true;
            nextDocument.overriddenAt = new Date();
            nextDocument.overriddenBy = userId || null;
            nextDocument.overrideReason = payload.overrideReason || nextDocument.overrideReason || "Edited from internal agreement detail";
        } else if (payload.markAsOverridden === false) {
            nextDocument.isOverridden = false;
            nextDocument.overriddenAt = null;
            nextDocument.overriddenBy = null;
            nextDocument.overrideReason = null;
        }

        if (typeof payload.skipIdUpload === "boolean") {
            nextDocument.skipIdUpload = payload.skipIdUpload;
            nextDocument.skipIdUploadAt = payload.skipIdUpload ? new Date() : null;
            nextDocument.skipIdUploadBy = payload.skipIdUpload ? (userId || null) : null;
            nextDocument.skipIdUploadReason = payload.skipIdUpload
                ? (String(payload.skipIdUploadReason || "").trim() || nextDocument.skipIdUploadReason || "Manual ID upload requirement override")
                : null;
        }

        if (payload.signatureTimestampOverrideAt !== undefined || payload.signatureTimezoneOverride !== undefined) {
            const timestampValue = String(payload.signatureTimestampOverrideAt || "").trim();
            const timezoneValue = String(payload.signatureTimezoneOverride || "").trim();
            nextDocument.signatureTimestampOverrideAt = timestampValue ? new Date(timestampValue) : null;
            nextDocument.signatureTimezoneOverride = timestampValue ? (timezoneValue || "America/New_York") : null;
            nextDocument.signatureTimestampOverrideUpdatedAt = timestampValue ? new Date() : null;
            nextDocument.signatureTimestampOverrideUpdatedBy = timestampValue ? (userId || null) : null;
            signatureTimestampOverrideChanged =
                previousSignatureTimestampOverrideAt !== (nextDocument.signatureTimestampOverrideAt?.getTime() ?? null)
                || previousSignatureTimezoneOverride !== (nextDocument.signatureTimezoneOverride || null);
        }

        await reservationDocumentRepo().save(nextDocument);
        if (signatureTimestampOverrideChanged) {
            const signing = await signingRepo().findOne({ where: { hostifyReservationId } });
            if (signing?.signedAt) {
                signing.pdfStatus = "pending_pdf";
                signing.fileInfoId = null;
                await signingRepo().save(signing);
            }
        }
        return this.getReservationDocumentForAdmin(hostifyReservationId);
    }

    async setReservationOverride(hostifyReservationId: string, isOverridden: boolean, userId?: string, overrideReason?: string | null) {
        const { reservationInfo, listing } = await this.getReservationAndListing(hostifyReservationId);
        const { template, reservationDocument, snapshot } = await this.buildAgreementSnapshot(hostifyReservationId, reservationInfo, listing);

        const nextDocument = reservationDocument || reservationDocumentRepo().create({
            hostifyReservationId,
            reservationInfoId: reservationInfo.id,
            sourceTemplateId: template?.id || null,
            headerHtml: snapshot.headerHtml,
            bodyHtml: snapshot.bodyHtml,
            footerHtml: snapshot.footerHtml,
            emailSubject: snapshot.emailSubject,
            emailBodyHtml: snapshot.emailBodyHtml,
            isEdited: snapshot.isEdited,
        });

        nextDocument.isOverridden = isOverridden;
        nextDocument.overriddenAt = isOverridden ? new Date() : null;
        nextDocument.overriddenBy = isOverridden ? (userId || null) : null;
        nextDocument.overrideReason = isOverridden ? (String(overrideReason || "").trim() || nextDocument.overrideReason || "Manual override") : null;

        await reservationDocumentRepo().save(nextDocument);
        return this.getReservationDocumentForAdmin(hostifyReservationId);
    }

    async getManualSendPreview(hostifyReservationId: string) {
        const { reservationInfo, listing } = await this.getReservationAndListing(hostifyReservationId);
        const { snapshot } = await this.buildAgreementSnapshot(hostifyReservationId, reservationInfo, listing);
        const signingUrl = `${this.getFrontendBaseUrl()}/rental-agreement/${hostifyReservationId}`;

        return {
            recipientEmail: reservationInfo.guestEmail || "",
            senderEmail: process.env.SUPPORT_EMAIL || "support@luxurylodgingpm.com",
            subject: snapshot.emailSubject || this.buildDefaultEmailSubject(reservationInfo, listing),
            bodyHtml: (snapshot.emailBodyHtml || this.buildDefaultEmailBody(reservationInfo, listing, signingUrl)).replace(/\{\{signingLink\}\}/g, signingUrl),
        };
    }

    async sendAgreement(
        hostifyReservationId: string,
        options?: { recipientEmail?: string; subject?: string; bodyHtml?: string },
    ): Promise<{ recipientEmail: string; subject: string }> {
        const { reservationInfo, listing } = await this.getReservationAndListing(hostifyReservationId);
        const preview = await this.getManualSendPreview(hostifyReservationId);
        const recipientEmail = String(options?.recipientEmail || preview.recipientEmail || "").trim();
        if (!recipientEmail) throw new Error("Reservation does not have a guest email");

        const signingUrl = `${this.getFrontendBaseUrl()}/rental-agreement/${hostifyReservationId}`;
        const subject = String(options?.subject || preview.subject || "").trim() || this.buildDefaultEmailSubject(reservationInfo, listing);
        let bodyHtml = String(options?.bodyHtml || preview.bodyHtml || "").trim();
        if (!bodyHtml) {
            bodyHtml = this.buildDefaultEmailBody(reservationInfo, listing, signingUrl);
        }
        bodyHtml = bodyHtml.replace(/\{\{signingLink\}\}/g, signingUrl);

        await sendSupportEmail(recipientEmail, subject, bodyHtml);
        return { recipientEmail, subject };
    }

    async retryPdfGeneration(signingId: number): Promise<{ pdfStatus: string }> {
        const signing = await signingRepo().findOne({ where: { id: signingId } });
        if (!signing) throw new Error("Signing not found");

        const reservationInfo = await reservationInfoRepo().findOne({ where: { id: signing.reservationInfoId } });
        if (!reservationInfo) throw new Error("Reservation not found");

        await signingRepo().update(signingId, { pdfStatus: "pending_pdf" });
        this.generateAndUploadPdf(signingId, reservationInfo).catch((err) => {
            console.error(`[RentalAgreement] PDF retry failed for signing ${signingId}:`, err);
        });

        return { pdfStatus: "pending_pdf" };
    }

    async getAdminDownloadTarget(signingId: number): Promise<{
        fileName: string;
        localPath: string | null;
        driveFileId: string | null;
        pdfStatus: string;
    } | null> {
        const { signing } = await this.getSigningWithFile(signingId);
        if (!signing) return null;

        const { signing: refreshedSigning, fileInfo } = await this.regeneratePdfIfNeeded(signing);

        return {
            fileName: fileInfo?.fileName || `rental-agreement-${signingId}.pdf`,
            localPath: fileInfo?.localPath && fs.existsSync(fileInfo.localPath) ? fileInfo.localPath : null,
            driveFileId: fileInfo?.driveFileId || null,
            pdfStatus: refreshedSigning.pdfStatus,
        };
    }

    async getGuestDownloadTarget(hostifyReservationId: string): Promise<{
        fileName: string;
        localPath: string | null;
        driveFileId: string | null;
        pdfStatus: string;
    } | null> {
        const signing = await signingRepo().findOne({ where: { hostifyReservationId } });
        if (!signing) return null;

        const { signing: refreshedSigning, fileInfo } = await this.regeneratePdfIfNeeded(signing);

        return {
            fileName: fileInfo?.fileName || `rental-agreement-${hostifyReservationId}.pdf`,
            localPath: fileInfo?.localPath && fs.existsSync(fileInfo.localPath) ? fileInfo.localPath : null,
            driveFileId: fileInfo?.driveFileId || null,
            pdfStatus: refreshedSigning.pdfStatus,
        };
    }

    private async getFileInfoDataUri(fileInfoId?: number | null): Promise<string | null> {
        if (!fileInfoId) return null;
        const fileInfo = await fileInfoRepo().findOne({ where: { id: fileInfoId } });
        if (!fileInfo?.localPath || !fs.existsSync(fileInfo.localPath)) return null;
        const mimetype = fileInfo.mimetype || "image/jpeg";
        const fileContent = fs.readFileSync(fileInfo.localPath);
        return `data:${mimetype};base64,${fileContent.toString("base64")}`;
    }

    async getIdPhotoContent(hostifyReservationId: string, type: "front" | "back"): Promise<{ buffer: Buffer; mimetype: string } | null> {
        const signing = await signingRepo().findOne({ where: { hostifyReservationId } });
        if (!signing) return null;

        const fileInfoId = type === "front" ? signing.idFrontFileInfoId : signing.idBackFileInfoId;
        if (!fileInfoId) return null;

        const fileInfo = await fileInfoRepo().findOne({ where: { id: fileInfoId } });
        if (!fileInfo) return null;

        const mimetype = fileInfo.mimetype || "image/jpeg";

        if (fileInfo.localPath && fs.existsSync(fileInfo.localPath)) {
            return { buffer: fs.readFileSync(fileInfo.localPath), mimetype };
        }

        if (fileInfo.driveFileId) {
            const driveRes = await drive.files.get(
                { fileId: fileInfo.driveFileId, alt: "media" },
                { responseType: "arraybuffer" }
            ) as any;
            return { buffer: Buffer.from(driveRes.data as ArrayBuffer), mimetype };
        }

        return null;
    }

    private async generateAndUploadPdf(signingId: number, reservationInfo: ReservationInfoEntity): Promise<void> {
        const signing = await signingRepo().findOne({ where: { id: signingId } });
        if (!signing) return;

        let browser: any;
        try {
            const reservationDocument = await this.getReservationDocument(signing.hostifyReservationId);
            const includeIdDocuments = !(reservationDocument?.skipIdUpload ?? false);
            const includeSignature = !(reservationDocument?.isOverridden ?? false);
            const [idFrontDataUri, idBackDataUri] = await Promise.all([
                this.getFileInfoDataUri(signing.idFrontFileInfoId),
                this.getFileInfoDataUri(signing.idBackFileInfoId),
            ]);
            const renderIdCard = (label: string, dataUri: string | null) => `
                <div class="id-card">
                    <div class="id-label">${label}</div>
                    ${dataUri
                        ? `<img class="id-img" src="${dataUri}" alt="${label}" />`
                        : `<div class="id-placeholder">Not available</div>`}
                </div>
            `;
            const idDocumentsSection = includeIdDocuments && (idFrontDataUri || idBackDataUri) ? `
                <div class="id-documents">
                    <h3>Identity Verification Documents</h3>
                    <div class="id-row">
                        ${renderIdCard("Front ID", idFrontDataUri)}
                        ${renderIdCard("Back ID", idBackDataUri)}
                    </div>
                </div>
            ` : "";
            const displayedSignedAt = reservationDocument?.signatureTimestampOverrideAt || signing.signedAt;
            const displayedSignedTimezone = reservationDocument?.signatureTimezoneOverride || "America/New_York";
            const displayedPhone = formatPhoneForDisplay(reservationInfo.phone) || reservationInfo.phone || "N/A";
            const renderedAgreementHtml = this.formatAgreementHtmlPhone(signing.renderedHtml, reservationInfo.phone);
            const signatureDetailsSection = includeSignature ? `
                <div class="signer-details">
                  <p><strong>Signed by:</strong> ${signing.signedByName}</p>
                  <p><strong>Email:</strong> ${signing.signedByEmail || "N/A"}</p>
                  <p><strong>Phone:</strong> ${displayedPhone}</p>
                </div>
                <img class="sig-img" src="${signing.signatureDataUrl}" alt="Signature" />
                <p class="timestamp">Signed: ${displayedSignedAt.toLocaleString("en-US", { timeZone: displayedSignedTimezone, year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" })} | IP: ${signing.ipAddress || "N/A"}</p>
            ` : "";
            const completedSection = idDocumentsSection || signatureDetailsSection ? `
                <div class="sig-section">
                    ${idDocumentsSection}
                    ${signatureDetailsSection}
                </div>
            ` : "";
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; margin: 40px; color: #333; line-height: 1.6; }
  .agreement-header-block { margin-bottom: 24px; }
  .agreement-footer-block { margin-bottom: 24px; }
  .agreement-body { padding-top: 0; }
  .sig-section { margin-top: 40px; border-top: 2px solid #333; padding-top: 20px; }
  .id-documents { margin-bottom: 22px; }
  .id-documents h3 { margin: 0 0 14px; font-size: 18px; line-height: 1.2; color: #111; }
  .id-row { display: grid; grid-template-columns: 1fr 1fr; gap: 34px; align-items: start; }
  .id-label { margin-bottom: 8px; font-size: 14px; font-weight: 700; color: #111; }
  .id-img { width: 100%; max-height: 190px; object-fit: contain; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; }
  .id-placeholder { height: 150px; border: 1px dashed #cbd5e1; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 13px; }
  .signer-details { margin-top: 12px; margin-bottom: 10px; line-height: 1.22; }
  .signer-details p { margin: 0 0 4px; }
  .signer-details strong { display: inline-block; min-width: 72px; }
  .sig-img { max-width: 300px; border: 1px solid #ccc; display: block; margin-top: 8px; }
  .timestamp { margin-top: 10px; font-size: 12px; color: #777; }
</style></head><body>
  <div class="agreement-body">${renderedAgreementHtml}</div>
  ${completedSection}
</body></html>`;

            browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: "domcontentloaded" });
            const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
            await browser.close();
            browser = null;

            const reservationId = signing.hostifyReservationId;
            const pdfName = `rental-agreement-reservation-${reservationId}.pdf`;
            const tempFileName = `rental-agreement-${reservationId}-${Date.now()}.pdf`;
            const tempPath = path.join(os.tmpdir(), tempFileName);
            fs.writeFileSync(tempPath, pdfBuffer);

            const fileInfo = fileInfoRepo().create({
                entityType: "rental-agreements",
                entityId: signingId,
                localPath: tempPath,
                fileName: pdfName,
                originalName: pdfName,
                mimetype: "application/pdf",
                status: "pending",
            });
            const savedFileInfo = await fileInfoRepo().save(fileInfo);

            await signingRepo().update(signingId, {
                fileInfoId: savedFileInfo.id,
                pdfStatus: "pdf_ready",
            });
        } catch (err) {
            if (browser) {
                try { await browser.close(); } catch (_) {}
            }
            await signingRepo().update(signingId, { pdfStatus: "pdf_failed" });
            throw err;
        }
    }
}

export const rentalAgreementSigningService = new RentalAgreementSigningService();
