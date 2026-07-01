import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * ListingKnowledgeEntry
 *
 * Backend store for the per-listing "Knowledge Base" that lives on the All
 * Listings page. Previously this was browser-localStorage only, so it was not
 * shared between users and the AI assistant could not see it. Persisting it here
 * makes it (a) shared across the team and (b) available to InboxAIService so
 * suggested replies can cite real, property-specific facts.
 *
 * visibility:
 *  - "external": guest-facing facts the assistant may share verbatim
 *    (e.g. check-in time, wifi network name, parking instructions).
 *  - "internal": staff-only guidance the assistant may use to inform a reply
 *    but must NOT quote to a guest (e.g. owner preferences, lockbox override).
 */
@Entity("listing_knowledge_entries")
export class ListingKnowledgeEntryEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ type: "bigint" })
    listingId: number;

    @Column({ length: 120, default: "General" })
    category: string;

    // "internal" | "external"
    @Index()
    @Column({ length: 16, default: "external" })
    visibility: string;

    @Column({ length: 255, nullable: true })
    title: string | null;

    @Column({ type: "mediumtext", nullable: true })
    content: string | null;

    // JSON-encoded array of { name, url, type } photo descriptors (optional).
    @Column({ type: "text", nullable: true })
    photos: string | null;

    @Column({ type: "int", nullable: true })
    createdByUserId: number | null;

    @Column({ length: 255, nullable: true })
    createdByName: string | null;

    @Column({ type: "int", nullable: true })
    updatedByUserId: number | null;

    @Column({ length: 255, nullable: true })
    updatedByName: string | null;

    // Provenance: 'manual' (typed by staff) | 'ai_suggested' (proposed by the
    // assistant and approved in the AI Copilot review view).
    @Column({ length: 20, default: "manual" })
    source: string;

    @Column({ type: "tinyint", default: 0 })
    isArchived: number;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
