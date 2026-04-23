import { Request, Response, NextFunction } from "express";
import { rentalAgreementSigningService } from "../services/RentalAgreementSigningService";

interface CustomRequest extends Request {
    user?: any;
}

export class RentalAgreementController {
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
            const { signatureDataUrl, signedByName, signedByEmail } = req.body;

            if (!signatureDataUrl || !signedByName) {
                return res.status(400).json({ success: false, message: "signatureDataUrl and signedByName are required" });
            }

            const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
            const userAgent = (req.headers["user-agent"] as string) || "";

            const result = await rentalAgreementSigningService.submitSigning(
                { hostifyReservationId, signatureDataUrl, signedByName, signedByEmail },
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
            const result = await rentalAgreementSigningService.getSigningStatus(hostifyReservationId);
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
}
