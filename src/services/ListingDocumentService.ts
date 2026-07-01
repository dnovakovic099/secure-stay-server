import fs from "fs";
import path from "path";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ListingDocumentEntity } from "../entity/ListingDocument";
import { AIEmbeddingEntity } from "../entity/AIEmbedding";
import { ExemplarService } from "./ExemplarService";
import { RetrievalService } from "./RetrievalService";
import { ListingGroupService } from "./ListingGroupService";

export interface UploadedDocMeta {
    fileName: string;
    originalName: string;
    mimeType: string;
    storagePath: string; // relative under public/
    absolutePath: string;
    sizeBytes: number;
}

/**
 * Ingests uploaded listing documents: extract text (PDF/DOCX/TXT/MD/RTF/
 * XLSX/CSV), chunk it, and embed the chunks into the shared retrieval store
 * (ai_embeddings kind="doc") scoped to the listing's property group. Chunks
 * carry the document's visibility so the bot only quotes guest-shareable ones.
 */
export class ListingDocumentService {
    private docRepo = appDatabase.getRepository(ListingDocumentEntity);
    private embRepo = appDatabase.getRepository(AIEmbeddingEntity);
    private exemplars = new ExemplarService();
    private groups = new ListingGroupService();

    async list(listingId: number): Promise<ListingDocumentEntity[]> {
        return this.docRepo.find({ where: { listingId: Number(listingId) as any }, order: { createdAt: "DESC" } });
    }

    async remove(id: number): Promise<boolean> {
        const doc = await this.docRepo.findOne({ where: { id } });
        if (!doc) return false;
        await this.embRepo.delete({ kind: "doc", refId: doc.id as any });
        if (doc.storagePath) {
            const abs = path.resolve(__dirname, "../../public", doc.storagePath);
            fs.promises.unlink(abs).catch(() => {});
        }
        await this.docRepo.delete({ id });
        RetrievalService.invalidate();
        return true;
    }

    /**
     * Create the document row, extract + chunk + embed. Returns the row. Heavy
     * work is awaited so the caller can report ready/failed; callers may also
     * fire-and-forget for very large files.
     */
    async ingest(
        meta: UploadedDocMeta,
        listingId: number,
        visibility: "internal" | "external",
        user?: { userId?: number | null; name?: string | null }
    ): Promise<ListingDocumentEntity> {
        const groupId = (await this.groups.resolve(listingId)) ?? listingId ?? null;
        let doc = this.docRepo.create({
            listingId: Number(listingId),
            groupId: groupId as any,
            fileName: meta.fileName,
            originalName: meta.originalName?.slice(0, 255) ?? null,
            mimeType: meta.mimeType?.slice(0, 128) ?? null,
            storagePath: meta.storagePath,
            sizeBytes: meta.sizeBytes,
            visibility: visibility === "external" ? "external" : "internal",
            status: "processing",
            uploadedByUserId: user?.userId ?? null,
            uploadedByName: user?.name ?? null,
        });
        doc = await this.docRepo.save(doc);

        try {
            const text = await this.extractText(meta.absolutePath, meta.originalName || meta.fileName);
            const clean = (text || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
            if (clean.length < 20) {
                doc.status = "failed";
                doc.errorMessage = "No readable text could be extracted from this file.";
                return this.docRepo.save(doc);
            }
            const chunks = this.chunkText(clean, 1000, 150);
            const label = (meta.originalName || meta.fileName).replace(/\.[^.]+$/, "");
            const records = chunks.map((c, idx) => ({
                kind: "doc",
                refId: doc.id,
                listingId: Number(listingId),
                groupId,
                scope: "property",
                // Prefix with the doc name so retrieval matches topical queries.
                text: `${label}: ${c}`.slice(0, 4000),
                payload: c.slice(0, 4000),
                dedupKey: `doc|${doc.id}|${idx}`,
                visibility: doc.visibility,
            }));
            const embedded = await this.exemplars.embedAndStore(records);
            doc.status = "ready";
            doc.charCount = clean.length;
            doc.chunkCount = embedded;
            doc.extractedText = clean.slice(0, 2_000_000);
            RetrievalService.invalidate();
            logger.info(`[ListingDoc] ingested doc ${doc.id} (${label}) -> ${embedded} chunks for listing ${listingId} (group ${groupId})`);
            return this.docRepo.save(doc);
        } catch (err: any) {
            logger.error(`[ListingDoc] ingest failed for doc ${doc.id}: ${err.message}`);
            doc.status = "failed";
            doc.errorMessage = (err.message || "extraction failed").slice(0, 500);
            return this.docRepo.save(doc);
        }
    }

    /** Extract raw text from a file by type. */
    private async extractText(absPath: string, name: string): Promise<string> {
        const ext = path.extname(name).toLowerCase();
        if (ext === ".pdf") {
            const pdf = require("pdf-parse");
            const data = await pdf(fs.readFileSync(absPath));
            return data.text || "";
        }
        if (ext === ".docx" || ext === ".doc") {
            const mammoth = require("mammoth");
            const res = await mammoth.extractRawText({ path: absPath });
            return res.value || "";
        }
        if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
            const XLSX = require("xlsx");
            const wb = XLSX.readFile(absPath);
            const parts: string[] = [];
            for (const sheetName of wb.SheetNames) {
                const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
                if (csv && csv.trim()) parts.push(`# ${sheetName}\n${csv}`);
            }
            return parts.join("\n\n");
        }
        // txt / md / rtf / fallback
        let raw = fs.readFileSync(absPath, "utf8");
        if (ext === ".rtf") raw = raw.replace(/\\par[d]?/g, "\n").replace(/\{\\[^}]*\}/g, "").replace(/\\[a-z]+\d* ?/g, "").replace(/[{}]/g, "");
        return raw;
    }

    /** Chunk text on paragraph boundaries to ~size chars with overlap. */
    private chunkText(text: string, size: number, overlap: number): string[] {
        const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
        const chunks: string[] = [];
        let cur = "";
        const push = () => {
            const t = cur.trim();
            if (t.length >= 20) chunks.push(t);
        };
        for (const p of paras) {
            if (p.length > size * 1.5) {
                // Very long paragraph: hard-split by sentences.
                const sentences = p.split(/(?<=[.!?])\s+/);
                for (const s of sentences) {
                    if ((cur + " " + s).length > size) {
                        push();
                        cur = cur.slice(Math.max(0, cur.length - overlap)) + " " + s;
                    } else cur += " " + s;
                }
                continue;
            }
            if ((cur + "\n\n" + p).length > size) {
                push();
                cur = cur.slice(Math.max(0, cur.length - overlap)) + "\n\n" + p;
            } else {
                cur = cur ? cur + "\n\n" + p : p;
            }
        }
        push();
        return chunks.slice(0, 400); // safety cap
    }
}
