import os from "os";
import path from "path";
import fs from "fs";
import puppeteer from "puppeteer";
import { addDays, endOfDay, format, startOfDay } from "date-fns";
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

const signingRepo = () => appDatabase.getRepository(RentalAgreementSigning);
const fileInfoRepo = () => appDatabase.getRepository(FileInfo);
const reservationInfoRepo = () => appDatabase.getRepository(ReservationInfoEntity);
const listingRepo = () => appDatabase.getRepository(Listing);

type RentalAgreementAdminFilters = {
    search?: string;
    signingStatus?: string;
    pdfStatus?: string;
    fromDate?: string;
    toDate?: string;
    sort?: string;
    page?: number;
    limit?: number;
};

type RentalAgreementSummaryCard = {
    label: string;
    total: number;
    signed: number;
    unsigned: number;
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
};

export class RentalAgreementSigningService {
    private excludedReservationStatuses = [
        "cancelled", "pending", "awaitingpayment",
        "declined", "expired", "inquiry",
        "inquirypreapproved", "inquirydenied",
        "inquirytimedout", "inquirynotpossible",
        "denied", "no_show", "awaiting_payment",
        "declined_inq", "preapproved", "offer",
        "withdrawn", "timedout", "not_possible", "deleted"
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

    private buildTemplateContext(info: ReservationInfoEntity, listing: Listing | null) {
        const propertyName = info.listingName || listing?.internalListingName || listing?.name || "";
        const propertyFullAddress = listing?.address || "";
        const checkInTime = this.formatHourValue(info.checkInTime ?? listing?.checkInTimeStart);
        const checkOutTime = this.formatHourValue(info.checkOutTime ?? listing?.checkOutTime);

        return {
            guestName: info.guestName || "",
            guestFirstName: info.guestFirstName || "",
            guestLastName: info.guestLastName || "",
            guestEmail: info.guestEmail || "",
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

    private buildDirectDownloadPath(signingId: number) {
        return `/rental-agreement/signings/${signingId}/file`;
    }

    private buildGuestDownloadPath(hostifyReservationId: string, baseUrl?: string) {
        const path = `/rental-agreement/guest/${hostifyReservationId}/download`;
        return baseUrl ? `${baseUrl}${path}` : path;
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
        } catch (error) {
            // Keep the signed agreement intact and surface retry status separately.
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
            isSigned: Boolean(raw.signingId),
            signedAt: raw.signedAt ? new Date(raw.signedAt).toISOString() : null,
            signedByName: raw.signedByName || null,
            signedByEmail: raw.signedByEmail || null,
            pdfStatus: raw.pdfStatus || null,
            pdfDownloadAvailable,
            pdfViewUrl: fileInfo?.webViewLink || null,
        };
    }

    // Resolve {{placeholder}} tokens in template body using reservation data
    resolveTemplate(bodyHtml: string, info: ReservationInfoEntity, listing: Listing | null = null): string {
        const context = this.buildTemplateContext(info, listing);
        return bodyHtml
            .replace(/\{\{guestName\}\}/g, context.guestName)
            .replace(/\{\{guestFirstName\}\}/g, context.guestFirstName)
            .replace(/\{\{guestLastName\}\}/g, context.guestLastName)
            .replace(/\{\{guestEmail\}\}/g, context.guestEmail)
            .replace(/\{\{checkInDate\}\}/g, context.checkInDate)
            .replace(/\{\{checkOutDate\}\}/g, context.checkOutDate)
            .replace(/\{\{propertyName\}\}/g, context.propertyName)
            .replace(/\{\{propertyFullAddress\}\}/g, context.propertyFullAddress)
            .replace(/\{\{checkInTime\}\}/g, context.checkInTime)
            .replace(/\{\{checkOutTime\}\}/g, context.checkOutTime)
            .replace(/\{\{nights\}\}/g, context.nights)
            .replace(/\{\{numberOfGuests\}\}/g, context.numberOfGuests)
            .replace(/\{\{totalPrice\}\}/g, context.totalPrice)
            .replace(/\{\{currency\}\}/g, context.currency)
            .replace(/\{\{reservationId\}\}/g, context.reservationId);
    }

    async getAgreementForGuest(hostifyReservationId: string): Promise<{
        reservationInfo: ReservationInfoEntity;
        template: RentalAgreementTemplate;
        alreadySigned: boolean;
        signing?: Pick<RentalAgreementSigning, "pdfStatus" | "fileInfoId">;
    }> {
        const { reservationInfo, listing } = await this.getReservationAndListing(hostifyReservationId);

        const template = await rentalAgreementTemplateService.getDefault();
        if (!template) throw new Error("No active rental agreement template configured");

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
            template,
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

        const template = await rentalAgreementTemplateService.getDefault();
        if (!template) throw new Error("No active rental agreement template configured");

        const renderedHtml = this.resolveTemplate(template.bodyHtml, reservationInfo, listing);

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

        // Fire and forget — don't block the HTTP response
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
        const pdfStatus = String(filters.pdfStatus || "all");
        const sort = String(filters.sort || "checkInAsc");

        const today = startOfDay(new Date());
        const fromDate = filters.fromDate ? startOfDay(new Date(filters.fromDate)) : today;
        const toDate = filters.toDate ? endOfDay(new Date(filters.toDate)) : null;

        const qb = reservationInfoRepo()
            .createQueryBuilder("reservation")
            .leftJoin(RentalAgreementSigning, "signing", "signing.reservationInfoId = reservation.id")
            .leftJoin(Listing, "listing", "listing.id = reservation.listingMapId")
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
            ])
            .where("reservation.arrivalDate IS NOT NULL")
            .andWhere("LOWER(COALESCE(reservation.status, '')) NOT IN (:...excludedStatuses)", {
                excludedStatuses: this.excludedReservationStatuses,
            })
            .andWhere("reservation.arrivalDate >= :fromDate", { fromDate: format(fromDate, "yyyy-MM-dd") });

        if (toDate) {
            qb.andWhere("reservation.arrivalDate <= :toDate", { toDate: format(toDate, "yyyy-MM-dd") });
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
            return this.buildOverviewRow(row, this.isDownloadArtifactAvailable(fileInfo), fileInfo);
        });

        const buildSummaryCard = async (label: string, start: Date, end: Date): Promise<RentalAgreementSummaryCard> => {
            const raw = await reservationInfoRepo()
                .createQueryBuilder("reservation")
                .leftJoin(RentalAgreementSigning, "signing", "signing.reservationInfoId = reservation.id")
                .select("COUNT(DISTINCT reservation.id)", "total")
                .addSelect("COUNT(DISTINCT CASE WHEN signing.id IS NOT NULL THEN reservation.id END)", "signed")
                .where("reservation.arrivalDate BETWEEN :start AND :end", {
                    start: format(start, "yyyy-MM-dd"),
                    end: format(end, "yyyy-MM-dd"),
                })
                .andWhere("LOWER(COALESCE(reservation.status, '')) NOT IN (:...excludedStatuses)", {
                    excludedStatuses: this.excludedReservationStatuses,
                })
                .getRawOne();

            const totalCount = Number(raw?.total || 0);
            const signedCount = Number(raw?.signed || 0);
            return {
                label,
                total: totalCount,
                signed: signedCount,
                unsigned: Math.max(0, totalCount - signedCount),
            };
        };

        const tomorrow = addDays(today, 1);
        const nextSevenStart = today;
        const nextSevenEnd = addDays(today, 6);

        const [checkingInToday, checkingInTomorrow, checkingInNext7Days] = await Promise.all([
            buildSummaryCard("Checking In Today", today, today),
            buildSummaryCard("Checking In Tomorrow", tomorrow, tomorrow),
            buildSummaryCard("Next 7 Days", nextSevenStart, nextSevenEnd),
        ]);

        return {
            summary: {
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

    async sendAgreement(hostifyReservationId: string): Promise<{ recipientEmail: string }> {
        const { reservationInfo, listing } = await this.getReservationAndListing(hostifyReservationId);
        const recipientEmail = String(reservationInfo.guestEmail || "").trim();
        if (!recipientEmail) throw new Error("Reservation does not have a guest email");

        const signingUrl = `${this.getFrontendBaseUrl()}/rental-agreement/${hostifyReservationId}`;
        const propertyName = reservationInfo.listingName || listing?.internalListingName || listing?.name || "your stay";
        const checkInDate = this.formatDateValue(reservationInfo.arrivalDate);

        await sendSupportEmail(
            recipientEmail,
            `Rental Agreement for ${propertyName}`,
            `
                <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
                    <p>Hello ${reservationInfo.guestFirstName || reservationInfo.guestName || "Guest"},</p>
                    <p>Your rental agreement for <strong>${propertyName}</strong>${checkInDate ? ` starting on <strong>${checkInDate}</strong>` : ""} is ready to review and sign.</p>
                    <p>
                        <a href="${signingUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">
                            Review & Sign Agreement
                        </a>
                    </p>
                    <p>If the button above does not work, you can copy and paste this link into your browser:</p>
                    <p><a href="${signingUrl}">${signingUrl}</a></p>
                    <p>Thank you,<br/>Luxury Lodging PM</p>
                </div>
            `,
        );

        return { recipientEmail };
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
            await page.setContent(html, { waitUntil: "networkidle0" });
            const pdfBuffer = await page.pdf({ format: "A4", printBackground: true, timeout: 0 });
            await browser.close();
            browser = null;

            // Write to temp file (FileInfoSubscriber will stream it from disk)
            const reservationId = signing.hostifyReservationId;
            const pdfName = `rental-agreement-reservation-${reservationId}.pdf`;
            const tempFileName = `rental-agreement-${reservationId}-${Date.now()}.pdf`;
            const tempPath = path.join(os.tmpdir(), tempFileName);
            fs.writeFileSync(tempPath, pdfBuffer);

            // Save FileInfo — FileInfoSubscriber auto-queues the Drive upload
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
