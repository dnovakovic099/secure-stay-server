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
    sort?: string;
    page?: number;
    limit?: number;
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
    propertyType: string | null;
    serviceType: string | null;
    viewedAt: string | null;
    firstViewedAt: string | null;
    lastViewedAt: string | null;
    overriddenBy: string | null;
    lastEditedBy: string | null;
    agreementStatus: "signed" | "overridden" | "not_yet_signed";
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
    propertyName: string;
    propertyFullAddress: string;
    checkInTime: string;
    checkOutTime: string;
    nights: string;
    numberOfGuests: string;
    totalPrice: string;
    currency: string;
    reservationId: string;
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
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    channel: string;
    petCount: number;
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
        "withdrawn", "timedout", "not_possible", "deleted",
    ];

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
        const date = new Date(d);
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

    private async getListingForReservation(reservationInfo: ReservationInfoEntity): Promise<Listing | null> {
        if (!reservationInfo?.listingMapId) return null;
        return listingRepo().findOne({ where: { id: reservationInfo.listingMapId } });
    }

    private buildTemplateContext(info: ReservationInfoEntity, listing: Listing | null): RentalAgreementTemplateContext {
        const propertyName = info.listingName || listing?.internalListingName || listing?.name || "";
        const propertyFullAddress = listing?.address || "";
        const checkInTime = this.formatHourValue(info.checkInTime ?? listing?.checkInTimeStart);
        const checkOutTime = this.formatHourValue(info.checkOutTime ?? listing?.checkOutTime);

        return {
            guestName: info.guestName || "",
            guestFirstName: info.guestFirstName || "",
            guestLastName: info.guestLastName || "",
            guestEmail: info.guestEmail || "",
            guestPhone: info.phone || "",
            channel: info.channelName || "",
            petCount: String(info.pets || 0),
            checkInDate: this.formatDateValue(info.arrivalDate),
            checkOutDate: this.formatDateValue(info.departureDate),
            propertyName,
            propertyFullAddress,
            checkInTime,
            checkOutTime,
            nights: String(info.nights || ""),
            numberOfGuests: String(info.numberOfGuests || ""),
            totalPrice: String(info.totalPrice || ""),
            currency: info.currency || "",
            reservationId: info.reservationId || "",
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
            propertyName: context.propertyName,
            propertyFullAddress: context.propertyFullAddress,
            checkInTime: context.checkInTime,
            checkOutTime: context.checkOutTime,
            nights: context.nights,
            numberOfGuests: context.numberOfGuests,
            totalPrice: context.totalPrice,
            currency: context.currency,
            reservationId: context.reservationId,
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
        const propertyName = info.listingName || listing?.internalListingName || listing?.name || "your stay";
        return `Rental Agreement for ${propertyName}`;
    }

    private buildDefaultEmailBody(info: ReservationInfoEntity, listing: Listing | null, signingUrl: string) {
        const propertyName = info.listingName || listing?.internalListingName || listing?.name || "your stay";
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
        const template = await rentalAgreementTemplateService.getDefault();
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
    ): RentalAgreementOverviewRow {
        const isSigned = Boolean(raw.signingId);
        const isOverridden = Boolean(raw.isOverridden);
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
            arrivalDate: raw.arrivalDate ? new Date(raw.arrivalDate).toISOString() : null,
            departureDate: raw.departureDate ? new Date(raw.departureDate).toISOString() : null,
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
            propertyType: raw.propertyType || null,
            serviceType: raw.serviceType || null,
            viewedAt: raw.lastViewedAt ? new Date(raw.lastViewedAt).toISOString() : raw.firstViewedAt ? new Date(raw.firstViewedAt).toISOString() : null,
            firstViewedAt: raw.firstViewedAt ? new Date(raw.firstViewedAt).toISOString() : null,
            lastViewedAt: raw.lastViewedAt ? new Date(raw.lastViewedAt).toISOString() : null,
            overriddenBy: raw.overriddenBy || null,
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
        alreadySigned: boolean;
        signing?: Pick<RentalAgreementSigning, "pdfStatus" | "fileInfoId">;
    }> {
        const { reservationInfo, listing } = await this.getReservationAndListing(hostifyReservationId);
        const { template, snapshot } = await this.buildAgreementSnapshot(hostifyReservationId, reservationInfo, listing);
        await this.markAgreementViewed(hostifyReservationId, reservationInfo, template.id);

        const existingSigning = await signingRepo().findOne({
            where: { hostifyReservationId },
        });

        return {
            reservationInfo: {
                ...reservationInfo,
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
            alreadySigned: !!existingSigning,
            ...(existingSigning && {
                signing: { pdfStatus: existingSigning.pdfStatus, fileInfoId: existingSigning.fileInfoId },
            }),
        };
    }

    async submitSigning(data: {
        hostifyReservationId: string;
        signatureDataUrl: string;
        signedByName: string;
        signedByEmail?: string;
    }, ip: string, userAgent: string): Promise<{ signingId: number }> {
        const existing = await signingRepo().findOne({
            where: { hostifyReservationId: data.hostifyReservationId },
        });
        if (existing) throw new Error("Agreement already signed for this reservation");

        const { reservationInfo, listing } = await this.getReservationAndListing(data.hostifyReservationId);
        const { template, snapshot } = await this.buildAgreementSnapshot(data.hostifyReservationId, reservationInfo, listing);
        const { renderedHtml } = this.renderAgreementSnapshot(snapshot, reservationInfo, listing);

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
    }> {
        const signing = await signingRepo().findOne({
            where: { hostifyReservationId },
            relations: ["template"],
        });

        if (!signing) return { signing: null, downloadUrl: null };

        const fileInfo = await this.getFileInfoForSigning(signing);
        const downloadUrl = this.isDownloadArtifactAvailable(fileInfo)
            ? this.buildDirectDownloadPath(signing.id)
            : null;

        return { signing, downloadUrl };
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
        records: RentalAgreementOverviewRow[];
        total: number;
        page: number;
        limit: number;
    }> {
        const page = Math.max(1, Number(filters.page) || 1);
        const limit = Math.min(200, Math.max(10, Number(filters.limit) || 50));
        const search = String(filters.search || "").trim();
        const signingStatus = String(filters.signingStatus || "all");
        const statusTab = String(filters.statusTab || "all");
        const pdfStatus = String(filters.pdfStatus || "all");
        const dateType = String(filters.dateType || "checkIn");
        const channel = String(filters.channel || "").trim();
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
                "document.isEdited AS isEdited",
                "document.isOverridden AS isOverridden",
                "document.overrideReason AS overrideReason",
                "document.firstViewedAt AS firstViewedAt",
                "document.lastViewedAt AS lastViewedAt",
                "document.overriddenBy AS overriddenBy",
                "document.lastEditedBy AS lastEditedBy",
                "listing.tags AS listingTags",
            ])
            .where("reservation.arrivalDate IS NOT NULL")
            .andWhere("LOWER(COALESCE(reservation.status, '')) NOT IN (:...excludedStatuses)", {
                excludedStatuses: this.excludedReservationStatuses,
            });

        const bucketWhere = this.buildBucketWhere(bucket);
        if (bucketWhere) {
            qb.andWhere(bucketWhere.sql, bucketWhere.params);
        } else if (fromDate && toDate) {
            if (dateType === "checkOut") {
                qb.andWhere("reservation.departureDate >= :fromDate", { fromDate: format(fromDate, "yyyy-MM-dd") });
                qb.andWhere("reservation.departureDate <= :toDate", { toDate: format(toDate, "yyyy-MM-dd") });
            } else if (dateType === "signed") {
                qb.andWhere("signing.signedAt IS NOT NULL");
                qb.andWhere("DATE(signing.signedAt) >= :fromDate", { fromDate: format(fromDate, "yyyy-MM-dd") });
                qb.andWhere("DATE(signing.signedAt) <= :toDate", { toDate: format(toDate, "yyyy-MM-dd") });
            } else if (dateType === "viewed") {
                qb.andWhere("COALESCE(document.lastViewedAt, document.firstViewedAt) IS NOT NULL");
                qb.andWhere("DATE(COALESCE(document.lastViewedAt, document.firstViewedAt)) >= :fromDate", { fromDate: format(fromDate, "yyyy-MM-dd") });
                qb.andWhere("DATE(COALESCE(document.lastViewedAt, document.firstViewedAt)) <= :toDate", { toDate: format(toDate, "yyyy-MM-dd") });
            } else {
                qb.andWhere("reservation.arrivalDate >= :fromDate", { fromDate: format(fromDate, "yyyy-MM-dd") });
                qb.andWhere("reservation.arrivalDate <= :toDate", { toDate: format(toDate, "yyyy-MM-dd") });
            }
        }

        if (channel) {
            qb.andWhere("LOWER(COALESCE(reservation.channelName, '')) = :channel", {
                channel: channel.toLowerCase(),
            });
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
        const totalQb = qb.clone();
        qb.skip((page - 1) * limit).take(limit);

        const [rawRows, totalRaw] = await Promise.all([
            qb.getRawMany(),
            totalQb.select("COUNT(DISTINCT reservation.id)", "total").getRawOne(),
        ]);
        const total = Number(totalRaw?.total || 0);

        const fileInfoIds = rawRows.map((row) => Number(row.fileInfoId)).filter(Boolean);
        const fileInfos = fileInfoIds.length > 0
            ? await fileInfoRepo().findBy({ id: In(fileInfoIds) })
            : [];
        const fileInfoMap = new Map(fileInfos.map((fileInfo) => [fileInfo.id, fileInfo]));

        const records = rawRows.map((row) => {
            const fileInfo = row.fileInfoId ? fileInfoMap.get(Number(row.fileInfoId)) || null : null;
            const enrichedRow = {
                ...row,
                propertyType: this.extractPropertyTypeFromTags(row.listingTags),
                serviceType: this.extractServiceTypeFromTags(row.listingTags),
            };
            return this.buildOverviewRow(enrichedRow, this.isDownloadArtifactAvailable(fileInfo), fileInfo);
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
                .andWhere("LOWER(COALESCE(reservation.status, '')) NOT IN (:...excludedStatuses)", {
                    excludedStatuses: this.excludedReservationStatuses,
                })
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

        const [ongoingStay, checkingInToday, checkingInTomorrow, checkingInNext7Days] = await Promise.all([
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
        ]);

        return {
            summary: {
                ongoingStay,
                checkingInToday,
                checkingInTomorrow,
                checkingInNext7Days,
            },
            records,
            total,
            page,
            limit,
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
            guestName: reservationInfo.guestName || "",
            guestEmail: reservationInfo.guestEmail || "",
            guestPhone: reservationInfo.phone || "",
            channel: reservationInfo.channelName || "",
            petCount: reservationInfo.pets || 0,
            propertyName: reservationInfo.listingName || listing?.internalListingName || listing?.name || "",
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

        return {
            templateId: template.id,
            sourceTemplateId: snapshot.sourceTemplateId,
            reservationInfo: {
                id: reservationInfo.id,
                guestName: reservationInfo.guestName || "",
                guestEmail: reservationInfo.guestEmail || "",
                listingName: reservationInfo.listingName || listing?.internalListingName || listing?.name || "",
                propertyFullAddress: listing?.address || "",
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
                pdfStatus: signing.pdfStatus || null,
                pdfDownloadAvailable: this.isDownloadArtifactAvailable(fileInfo),
                pdfViewUrl: fileInfo?.webViewLink || null,
            } : null,
        };
    }

    async upsertReservationDocumentForAdmin(
        hostifyReservationId: string,
        payload: Partial<Pick<RentalAgreementReservationDocument, "headerHtml" | "bodyHtml" | "footerHtml" | "emailSubject" | "emailBodyHtml">> & {
            markAsOverridden?: boolean;
            overrideReason?: string | null;
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
        }

        await reservationDocumentRepo().save(nextDocument);
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

    private async generateAndUploadPdf(signingId: number, reservationInfo: ReservationInfoEntity): Promise<void> {
        const signing = await signingRepo().findOne({ where: { id: signingId } });
        if (!signing) return;

        let browser: any;
        try {
            const propertyName = reservationInfo.listingName || "";
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; margin: 40px; color: #333; line-height: 1.6; }
  h2 { text-align: center; margin-bottom: 4px; }
  .property-name { text-align: center; color: #555; margin-top: 0; margin-bottom: 30px; }
  .agreement-header-block, .agreement-footer-block { margin-bottom: 24px; }
  .agreement-body { border-top: 1px solid #ddd; padding-top: 20px; }
  .sig-section { margin-top: 40px; border-top: 2px solid #333; padding-top: 20px; }
  .sig-img { max-width: 300px; border: 1px solid #ccc; display: block; margin-top: 10px; }
  .timestamp { margin-top: 10px; font-size: 12px; color: #777; }
</style></head><body>
  <h2>Rental Agreement</h2>
  <p class="property-name">${propertyName}</p>
  <div class="agreement-body">${signing.renderedHtml}</div>
  <div class="sig-section">
    <p><strong>Signed by:</strong> ${signing.signedByName}</p>
    <p><strong>Email:</strong> ${signing.signedByEmail || "N/A"}</p>
    <img class="sig-img" src="${signing.signatureDataUrl}" alt="Signature" />
    <p class="timestamp">Signed: ${signing.signedAt.toISOString()} | IP: ${signing.ipAddress || "N/A"}</p>
  </div>
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
