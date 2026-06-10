import { Request, Response, NextFunction } from "express";
import { rentalAgreementSigningService } from "../services/RentalAgreementSigningService";
import { drive } from "../utils/drive";

interface CustomRequest extends Request {
    user?: any;
}

export class RentalAgreementController {
    async getAdminOverview(req: CustomRequest, res: Response) {
        try {
            const result = await rentalAgreementSigningService.getAdminOverview({
                search: req.query.search as string | undefined,
                signingStatus: req.query.signingStatus as string | undefined,
                pdfStatus: req.query.pdfStatus as string | undefined,
                fromDate: req.query.fromDate as string | undefined,
                toDate: req.query.toDate as string | undefined,
                dateType: req.query.dateType as string | undefined,
                channel: req.query.channel as string | undefined,
                property: req.query.property as string | undefined,
                listingId: req.query.listingId as string | undefined,
                propertyType: req.query.propertyType as string | undefined,
                serviceType: req.query.serviceType as string | undefined,
                bothCompletion: req.query.bothCompletion as string | undefined,
                signatureCompletion: req.query.signatureCompletion as string | undefined,
                idCompletion: req.query.idCompletion as string | undefined,
                overridden: req.query.overridden as string | undefined,
                overriddenBy: req.query.overriddenBy as string | undefined,
                signatureTimestampOverridden: req.query.signatureTimestampOverridden as string | undefined,
                sort: req.query.sort as string | undefined,
                page: req.query.page ? Number(req.query.page) : undefined,
                limit: req.query.limit ? Number(req.query.limit) : undefined,
                statusTab: req.query.statusTab as string | undefined,
                bucket: req.query.bucket as string | undefined,
                editedOnly: req.query.editedOnly as string | undefined,
                includeMetadata: req.query.includeMetadata as string | undefined,
            });
            res.json({ success: true, data: result });
        } catch (err: any) {
            res.status(500).json({ success: false, message: err.message });
        }
    }

    async getPreviewContext(req: CustomRequest, res: Response) {
        try {
            const result = await rentalAgreementSigningService.getLatestPreviewContext();
            res.json({ success: true, data: result });
        } catch (err: any) {
            res.status(500).json({ success: false, message: err.message });
        }
    }

    async getReservationDocument(req: CustomRequest, res: Response) {
        try {
            const { hostifyReservationId } = req.params;
            const result = await rentalAgreementSigningService.getReservationDocumentForAdmin(hostifyReservationId);
            res.json({ success: true, data: result });
        } catch (err: any) {
            const status = err.message === "Reservation not found" ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    }

    async updateReservationDocument(req: CustomRequest, res: Response) {
        try {
            const { hostifyReservationId } = req.params;
            const userId = req.user?.email || req.user?.id;
            const result = await rentalAgreementSigningService.upsertReservationDocumentForAdmin(hostifyReservationId, req.body || {}, userId);
            res.json({ success: true, data: result });
        } catch (err: any) {
            const status = err.message === "Reservation not found" ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    }

    async updateReservationOverride(req: CustomRequest, res: Response) {
        try {
            const { hostifyReservationId } = req.params;
            const userId = req.user?.email || req.user?.id;
            const result = await rentalAgreementSigningService.setReservationOverride(
                hostifyReservationId,
                Boolean(req.body?.isOverridden),
                userId,
                req.body?.overrideReason,
            );
            res.json({ success: true, data: result });
        } catch (err: any) {
            const status = err.message === "Reservation not found" ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    }

    async createManualAgreement(req: CustomRequest, res: Response) {
        try {
            const result = await rentalAgreementSigningService.createManualAgreement(req.body || {});
            res.status(201).json({ success: true, data: result });
        } catch (err: any) {
            res.status(400).json({ success: false, message: err.message });
        }
    }

    async getSendPreview(req: CustomRequest, res: Response) {
        try {
            const { hostifyReservationId } = req.params;
            const result = await rentalAgreementSigningService.getManualSendPreview(hostifyReservationId);
            res.json({ success: true, data: result });
        } catch (err: any) {
            const status = err.message === "Reservation not found" ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    }

    // PUBLIC — no auth — guest uploads front and back ID photos
    async uploadGuestId(req: Request, res: Response) {
        try {
            const { hostifyReservationId } = req.params;
            const files = req.files as Record<string, Express.Multer.File[]> | undefined;
            const idFrontFile = files?.idFront?.[0];
            const idBackFile = files?.idBack?.[0];

            if (!idFrontFile || !idBackFile) {
                return res.status(400).json({ success: false, message: "Both idFront and idBack photo files are required" });
            }

            const result = await rentalAgreementSigningService.saveIdPhotos(hostifyReservationId, idFrontFile, idBackFile);
            res.json({ success: true, data: result });
        } catch (err: any) {
            const status = err.message === "Reservation not found" ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    }

    // PUBLIC — no auth — guest fetches the agreement for their reservation
    async getAgreementForGuest(req: Request, res: Response, next: NextFunction) {
        try {
            const { hostifyReservationId } = req.params;
            const result = await rentalAgreementSigningService.getAgreementForGuest(hostifyReservationId);
            res.json({ success: true, data: result });
        } catch (err: any) {
            const status = err.message === "Reservation not found" || err.message.includes("template") ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    }

    // PUBLIC — no auth — guest submits signature
    async submitSigning(req: Request, res: Response, next: NextFunction) {
        try {
            const { hostifyReservationId } = req.params;
            const { signatureDataUrl, signedByName, signedByEmail, idFrontFileInfoId, idBackFileInfoId } = req.body;

            if (!signatureDataUrl || !signedByName) {
                return res.status(400).json({ success: false, message: "signatureDataUrl and signedByName are required" });
            }

            const forwarded = req.headers["x-forwarded-for"] as string | undefined;
            const realIp = req.headers["x-real-ip"] as string | undefined;
            const rawIp = (forwarded?.split(",")[0] || realIp || req.ip || "").trim();
            const ip = rawIp.replace(/^::ffff:/, "");
            const userAgent = (req.headers["user-agent"] as string) || "";

            const result = await rentalAgreementSigningService.submitSigning(
                {
                    hostifyReservationId,
                    signatureDataUrl,
                    signedByName,
                    signedByEmail,
                    idFrontFileInfoId: idFrontFileInfoId ? Number(idFrontFileInfoId) : undefined,
                    idBackFileInfoId: idBackFileInfoId ? Number(idBackFileInfoId) : undefined,
                },
                ip,
                userAgent
            );
            res.status(201).json({ success: true, data: result });
        } catch (err: any) {
            const status = err.message === "Agreement already signed for this reservation" ? 409
                : err.message === "Reservation not found" ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    }

    // PUBLIC — no auth — guest polls for PDF status after signing
    async getSigningStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const { hostifyReservationId } = req.params;
            const protocol = req.protocol;
            const host = req.get("host");
            const baseUrl = `${protocol}://${host}`;

            const result = await rentalAgreementSigningService.getSigningStatus(hostifyReservationId, baseUrl);
            res.json({ success: true, data: result });
        } catch (err: any) {
            res.status(500).json({ success: false, message: err.message });
        }
    }

    // ADMIN — get signing details for a reservation
    async getSigningsByReservation(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const { hostifyReservationId } = req.params;
            const result = await rentalAgreementSigningService.getSigningsByReservation(hostifyReservationId);
            res.json({ success: true, data: result });
        } catch (err: any) {
            res.status(500).json({ success: false, message: err.message });
        }
    }

    // ADMIN — get Google Drive download URL for a signing
    async getDownloadUrl(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const signingId = Number(req.params.id);
            const downloadUrl = await rentalAgreementSigningService.getDownloadUrl(signingId);
            if (!downloadUrl) {
                return res.status(404).json({ success: false, message: "PDF not available yet" });
            }
            res.json({ success: true, data: { downloadUrl } });
        } catch (err: any) {
            res.status(500).json({ success: false, message: err.message });
        }
    }

    async downloadSigningFile(req: CustomRequest, res: Response) {
        try {
            const signingId = Number(req.params.id);
            const target = await rentalAgreementSigningService.getAdminDownloadTarget(signingId);
            if (!target) {
                return res.status(404).json({ success: false, message: "Signing not found" });
            }
            if (target.localPath) {
                return res.download(target.localPath, target.fileName);
            }
            if (target.driveFileId) {
                try {
                    const driveRes = await drive.files.get(
                        { fileId: target.driveFileId, alt: "media" },
                        { responseType: "arraybuffer" }
                    ) as any;
                    const buffer = Buffer.from(driveRes.data as ArrayBuffer);
                    res.setHeader("Content-Type", "application/pdf");
                    res.setHeader("Content-Disposition", `attachment; filename="${target.fileName}"`);
                    res.setHeader("Content-Length", buffer.length);
                    return res.send(buffer);
                } catch (driveErr: any) {
                    console.error(`[RentalAgreement] Admin download Drive API error:`, driveErr?.response?.data || driveErr.message);
                    return res.status(502).json({ success: false, message: "Failed to retrieve file from Google Drive." });
                }
            }
            return res.status(409).json({
                success: false,
                message: target.pdfStatus === "pdf_failed"
                    ? "PDF generation failed. Please retry PDF generation."
                    : "PDF is still being prepared.",
                data: { pdfStatus: target.pdfStatus },
            });
        } catch (err: any) {
            res.status(500).json({ success: false, message: err.message });
        }
    }

    async downloadGuestSigningFile(req: Request, res: Response) {
        try {
            const { hostifyReservationId } = req.params;
            const target = await rentalAgreementSigningService.getGuestDownloadTarget(hostifyReservationId);
            if (!target) {
                return res.status(404).json({ success: false, message: "Agreement not found" });
            }
            if (target.localPath) {
                return res.download(target.localPath, target.fileName);
            }
            if (target.driveFileId) {
                try {
                    // Fetch file content from Google Drive as a buffer
                    const driveRes = await drive.files.get(
                        { fileId: target.driveFileId, alt: "media" },
                        { responseType: "arraybuffer" }
                    ) as any;

                    const buffer = Buffer.from(driveRes.data as ArrayBuffer);
                    res.setHeader("Content-Type", "application/pdf");
                    res.setHeader("Content-Disposition", `attachment; filename="${target.fileName}"`);
                    res.setHeader("Content-Length", buffer.length);
                    return res.send(buffer);
                } catch (driveErr: any) {
                    console.error(`[RentalAgreement] Drive API error for fileId=${target.driveFileId}:`, driveErr?.response?.data || driveErr.message);
                    return res.status(502).json({
                        success: false,
                        message: "Failed to retrieve file from Google Drive.",
                    });
                }
            }
            return res.status(409).json({
                success: false,
                message: target.pdfStatus === "pdf_failed"
                    ? "The signed agreement exists, but the PDF is not available yet."
                    : "PDF is still being prepared.",
                data: { pdfStatus: target.pdfStatus },
            });
        } catch (err: any) {
            res.status(500).json({ success: false, message: err.message });
        }
    }

    async getIdPhotoImage(req: CustomRequest, res: Response) {
        try {
            const { hostifyReservationId } = req.params;
            const type = req.params.type as "front" | "back";
            if (type !== "front" && type !== "back") {
                return res.status(400).json({ success: false, message: "type must be front or back" });
            }
            const result = await rentalAgreementSigningService.getIdPhotoContent(hostifyReservationId, type);
            if (!result) {
                return res.status(404).json({ success: false, message: "ID photo not found" });
            }
            res.setHeader("Content-Type", result.mimetype);
            res.setHeader("Cache-Control", "private, max-age=3600");
            res.send(result.buffer);
        } catch (err: any) {
            res.status(500).json({ success: false, message: err.message });
        }
    }

    async sendAgreement(req: CustomRequest, res: Response) {
        try {
            const { hostifyReservationId } = req.params;
            const result = await rentalAgreementSigningService.sendAgreement(hostifyReservationId, {
                recipientEmail: req.body?.recipientEmail,
                subject: req.body?.subject,
                bodyHtml: req.body?.bodyHtml,
            });
            res.json({ success: true, data: result });
        } catch (err: any) {
            const status = err.message === "Reservation not found" ? 404 : 400;
            res.status(status).json({ success: false, message: err.message });
        }
    }

    async retryPdfGeneration(req: CustomRequest, res: Response) {
        try {
            const signingId = Number(req.params.id);
            const result = await rentalAgreementSigningService.retryPdfGeneration(signingId);
            res.json({ success: true, data: result });
        } catch (err: any) {
            const status = err.message === "Signing not found" || err.message === "Reservation not found" ? 404 : 400;
            res.status(status).json({ success: false, message: err.message });
        }
    }
}
