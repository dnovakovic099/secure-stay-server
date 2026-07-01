import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    Index,
    CreateDateColumn,
} from "typeorm";

/**
 * AIEmbedding
 *
 * Semantic index over our real data so the assistant can retrieve the most
 * relevant knowledge instead of ranking by keyword overlap. The single biggest
 * asset is `kind = "qa"`: every real (guest question -> team answer) pair from
 * our message history, so the bot can reuse how our team actually answered
 * similar questions on the SAME property group.
 *
 * MariaDB has no native vector type, so the embedding is stored as a JSON float
 * array and cosine similarity is computed in-process over a small, group-scoped
 * candidate set (a few dozen to a few hundred rows), which is fast.
 */
@Entity("ai_embeddings")
@Index("idx_emb_kind_group", ["kind", "groupId"])
@Index("idx_emb_kind_listing", ["kind", "listingId"])
export class AIEmbeddingEntity {
    @PrimaryGeneratedColumn()
    id: number;

    /** 'qa' (question->answer exemplar) | 'kb' | 'fact' */
    @Column({ length: 16 })
    kind: string;

    /** Source row id (e.g. guest message externalId) for idempotency/tracing. */
    @Column({ type: "bigint", nullable: true })
    refId: number | null;

    @Column({ type: "bigint", nullable: true })
    listingId: number | null;

    /** Canonical property-group id (parent listing) — retrieval is scoped here. */
    @Column({ type: "bigint", nullable: true })
    groupId: number | null;

    /** 'property' | 'portfolio' */
    @Column({ length: 16, default: "property" })
    scope: string;

    /** The text that was embedded (guest question for 'qa'). */
    @Column({ type: "mediumtext" })
    embeddedText: string;

    /** Payload shown to the model (team answer for 'qa'). */
    @Column({ type: "mediumtext", nullable: true })
    payload: string | null;

    /** JSON-encoded number[] embedding vector. */
    @Column({ type: "longtext" })
    vector: string;

    @Column({ length: 64, nullable: true })
    model: string | null;

    /** For 'doc' chunks: 'internal' (staff-only) | 'external' (guest-shareable). */
    @Column({ length: 16, nullable: true })
    visibility: string | null;

    /** Normalized dedup key (kind|groupId|normalized question) — unique-ish. */
    @Index("idx_emb_dedup")
    @Column({ length: 200, nullable: true })
    dedupKey: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;
}
