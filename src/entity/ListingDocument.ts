import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    Index,
    CreateDateColumn,
    UpdateDateColumn,
} from "typeorm";

/**
 * ListingDocument
 *
 * A document uploaded for a listing (house manual, welcome guide, policy sheet,
 * pricing/FAQ spreadsheet, etc.) to teach the AI assistant. On upload the text
 * is extracted, chunked, and embedded into `ai_embeddings` (kind = "doc"),
 * scoped to the listing's property group so every channel-split sibling shares
 * it. Chunks inherit the document's visibility (internal vs guest-shareable).
 */
@Entity("listing_documents")
export class ListingDocumentEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ type: "bigint" })
    listingId: number;

    @Index()
    @Column({ type: "bigint", nullable: true })
    groupId: number | null;

    @Column({ length: 255 })
    fileName: string;

    @Column({ length: 255, nullable: true })
    originalName: string | null;

    @Column({ length: 128, nullable: true })
    mimeType: string | null;

    /** Relative path under public/ where the file is stored on disk. */
    @Column({ length: 512, nullable: true })
    storagePath: string | null;

    @Column({ type: "int", nullable: true })
    sizeBytes: number | null;

    /** 'internal' (staff-only) | 'external' (guest-shareable). */
    @Column({ length: 16, default: "internal" })
    visibility: string;

    /** 'processing' | 'ready' | 'failed' */
    @Index()
    @Column({ length: 16, default: "processing" })
    status: string;

    @Column({ length: 500, nullable: true })
    errorMessage: string | null;

    @Column({ type: "int", nullable: true })
    charCount: number | null;

    @Column({ type: "int", nullable: true })
    chunkCount: number | null;

    /** Full extracted text (for preview + re-embedding). */
    @Column({ type: "longtext", nullable: true })
    extractedText: string | null;

    @Column({ type: "int", nullable: true })
    uploadedByUserId: number | null;

    @Column({ length: 255, nullable: true })
    uploadedByName: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
