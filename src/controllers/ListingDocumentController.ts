import { Request, Response, NextFunction } from "express";
import { ListingDocumentService } from "../services/ListingDocumentService";

export class ListingDocumentController {
    private service = new ListingDocumentService();

    /** POST /listing-documents (multipart: file, listingId, visibility). */
    upload = async (request: Request, response: Response, next: NextFunction) => {
        try {
            const file = (request as any).file as Express.Multer.File | undefined;
            const listingId = Number(request.body?.listingId);
            const visibility = request.body?.visibility === "external" ? "external" : "internal";
            if (!file) return response.status(400).json({ status: false, message: "No file uploaded" });
            if (!listingId) return response.status(400).json({ status: false, message: "listingId is required" });

            const u = (request as any).user || {};
            const userId = u.secureStayUserId ?? u.id ?? null;
            const name = u.user_metadata?.full_name ?? u.name ?? u.email ?? null;

            const doc = await this.service.ingest(
                {
                    fileName: file.filename,
                    originalName: file.originalname,
                    mimeType: file.mimetype,
                    storagePath: `listing-docs/${file.filename}`,
                    absolutePath: file.path,
                    sizeBytes: file.size,
                },
                listingId,
                visibility,
                { userId: typeof userId === "number" ? userId : null, name }
            );
            return response.status(201).json({ status: true, document: this.serialize(doc) });
        } catch (error) {
            return next(error);
        }
    };

    /** GET /listing-documents?listingId= */
    list = async (request: Request, response: Response, next: NextFunction) => {
        try {
            const listingId = Number(request.query.listingId);
            if (!listingId) return response.status(400).json({ status: false, message: "listingId is required" });
            const docs = await this.service.list(listingId);
            return response.json({ status: true, documents: docs.map((d) => this.serialize(d)) });
        } catch (error) {
            return next(error);
        }
    };

    /** DELETE /listing-documents/:id */
    remove = async (request: Request, response: Response, next: NextFunction) => {
        try {
            const id = Number(request.params.id);
            const ok = await this.service.remove(id);
            return response.json({ status: ok, message: ok ? "Deleted" : "Not found" });
        } catch (error) {
            return next(error);
        }
    };

    private serialize(d: any) {
        return {
            id: d.id,
            listingId: Number(d.listingId),
            fileName: d.originalName || d.fileName,
            mimeType: d.mimeType,
            sizeBytes: d.sizeBytes,
            visibility: d.visibility,
            status: d.status,
            errorMessage: d.errorMessage,
            charCount: d.charCount,
            chunkCount: d.chunkCount,
            uploadedByName: d.uploadedByName,
            createdAt: d.createdAt,
        };
    }
}
