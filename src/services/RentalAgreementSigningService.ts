import os from "os";
import path from "path";
import fs from "fs";
import puppeteer from "puppeteer";
import { appDatabase } from "../utils/database.util";
import { RentalAgreementSigning } from "../entity/RentalAgreementSigning";
import { RentalAgreementTemplate } from "../entity/RentalAgreementTemplate";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { FileInfo } from "../entity/FileInfo";
import { PUPPETEER_LAUNCH_OPTIONS } from "../constants";
import { rentalAgreementTemplateService } from "./RentalAgreementTemplateService";

const signingRepo = () => appDatabase.getRepository(RentalAgreementSigning);
const fileInfoRepo = () => appDatabase.getRepository(FileInfo);
const reservationInfoRepo = () => appDatabase.getRepository(ReservationInfoEntity);

export class RentalAgreementSigningService {
    // Resolve {{placeholder}} tokens in template body using reservation data
    resolveTemplate(bodyHtml: string, info: ReservationInfoEntity): string {
        const formatDate = (d: Date | string | null | undefined): string => {
            if (!d) return "";
            const date = new Date(d);
            return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
        };

        return bodyHtml
            .replace(/\{\{guestName\}\}/g, info.guestName || "")
            .replace(/\{\{guestFirstName\}\}/g, info.guestFirstName || "")
            .replace(/\{\{guestLastName\}\}/g, info.guestLastName || "")
            .replace(/\{\{guestEmail\}\}/g, info.guestEmail || "")
            .replace(/\{\{checkInDate\}\}/g, formatDate(info.arrivalDate))
            .replace(/\{\{checkOutDate\}\}/g, formatDate(info.departureDate))
            .replace(/\{\{propertyName\}\}/g, info.listingName || "")
            .replace(/\{\{nights\}\}/g, String(info.nights || ""))
            .replace(/\{\{numberOfGuests\}\}/g, String(info.numberOfGuests || ""))
            .replace(/\{\{totalPrice\}\}/g, String(info.totalPrice || ""))
            .replace(/\{\{currency\}\}/g, info.currency || "")
            .replace(/\{\{reservationId\}\}/g, info.reservationId || "");
    }

    async getAgreementForGuest(hostifyReservationId: string): Promise<{
        reservationInfo: ReservationInfoEntity;
        template: RentalAgreementTemplate;
        alreadySigned: boolean;
        signing?: Pick<RentalAgreementSigning, "pdfStatus" | "fileInfoId">;
    }> {
        const reservationInfo = await reservationInfoRepo().findOne({
            where: { id: Number(hostifyReservationId) },
        });
        if (!reservationInfo) throw new Error("Reservation not found");

        const template = await rentalAgreementTemplateService.getDefault();
        if (!template) throw new Error("No active rental agreement template configured");

        const existingSigning = await signingRepo().findOne({
            where: { hostifyReservationId },
        });

        return {
            reservationInfo,
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

        const reservationInfo = await reservationInfoRepo().findOne({
            where: { id: Number(data.hostifyReservationId) },
        });
        if (!reservationInfo) throw new Error("Reservation not found");

        const template = await rentalAgreementTemplateService.getDefault();
        if (!template) throw new Error("No active rental agreement template configured");

        const renderedHtml = this.resolveTemplate(template.bodyHtml, reservationInfo);

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

    async getSigningStatus(hostifyReservationId: string): Promise<{
        pdfStatus: string;
        downloadUrl: string | null;
    }> {
        const signing = await signingRepo().findOne({
            where: { hostifyReservationId },
        });
        if (!signing) return { pdfStatus: "not_found", downloadUrl: null };

        let downloadUrl: string | null = null;
        if (signing.pdfStatus === "pdf_ready" && signing.fileInfoId) {
            const fileInfo = await fileInfoRepo().findOne({ where: { id: signing.fileInfoId } });
            downloadUrl = fileInfo?.webContentLink || null;
        }

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

        let downloadUrl: string | null = null;
        if (signing.pdfStatus === "pdf_ready" && signing.fileInfoId) {
            const fileInfo = await fileInfoRepo().findOne({ where: { id: signing.fileInfoId } });
            downloadUrl = fileInfo?.webContentLink || null;
        }

        return { signing, downloadUrl };
    }

    async getDownloadUrl(signingId: number): Promise<string | null> {
        const signing = await signingRepo().findOne({ where: { id: signingId } });
        if (!signing || !signing.fileInfoId) return null;
        const fileInfo = await fileInfoRepo().findOne({ where: { id: signing.fileInfoId } });
        return fileInfo?.webContentLink || null;
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
