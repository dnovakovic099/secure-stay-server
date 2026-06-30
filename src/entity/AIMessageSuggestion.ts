import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * AIMessageSuggestion
 * A persisted AI-generated reply suggestion for a v2 inbox conversation.
 *
 * The assistant is SUGGESTION-ONLY — it never auto-sends. Every suggestion is
 * stored (even when a human already replied) so we can compare AI vs human and
 * feed the nightly learning job. Status tracks what the human did with it.
 */
@Entity("ai_message_suggestions")
export class AIMessageSuggestionEntity {
    @PrimaryGeneratedColumn() id: number;

    @Index() @Column({ type: "bigint" }) threadId: number;

    /** externalId of the inbound guest message this responds to (nullable). */
    @Index() @Column({ type: "bigint", nullable: true }) messageId: number | null;

    @Column({ type: "bigint", nullable: true }) reservationId: number | null;
    @Column({ type: "bigint", nullable: true }) listingId: number | null;

    @Column({ type: "mediumtext", nullable: true }) suggestedReply: string | null;

    /** 0..100 model-reported confidence. */
    @Column({ type: "decimal", precision: 5, scale: 2, nullable: true }) confidence: number | null;

    @Column({ type: "tinyint", default: 0 }) escalationRequired: number;
    @Column({ length: 500, nullable: true }) escalationReason: string | null;

    @Column({ type: "text", nullable: true }) internalSummary: string | null;

    /** JSON-encoded string[] of source references the model used. */
    @Column({ type: "text", nullable: true }) sourcesUsed: string | null;
    /** JSON-encoded string[] of missing-info warnings. */
    @Column({ type: "text", nullable: true }) warnings: string | null;
    /** JSON-encoded string[] of suggested internal action items. */
    @Column({ type: "text", nullable: true }) suggestedActionItems: string | null;

    @Column({ length: 64, nullable: true }) modelName: string | null;
    @Column({ length: 32, nullable: true }) promptVersion: string | null;

    /** suggested | accepted | edited | ignored | rejected | regenerated */
    @Index() @Column({ length: 20, default: "suggested" }) status: string;

    @Column({ type: "int", nullable: true }) acceptedByUserId: number | null;
    @Column({ type: "bigint", nullable: true }) finalSentMessageId: number | null;

    /** Raw model response for debugging/audit. */
    @Column({ type: "mediumtext", nullable: true }) rawResponse: string | null;

    @Index() @Column({ type: "datetime" }) generatedAt: Date;

    @CreateDateColumn({ type: "timestamp" }) createdAt: Date;
    @UpdateDateColumn({ type: "timestamp" }) updatedAt: Date;
}
