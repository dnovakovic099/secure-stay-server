import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from "typeorm";

/**
 * AIMessageFeedback
 * Human feedback on an AI suggestion, general AI guidance, or a sent reply.
 * Persisted permanently for learning, reporting, and auditing. Recent rows
 * with notes / preferred wording are injected into future reply prompts.
 */
@Entity("ai_message_feedback")
export class AIMessageFeedbackEntity {
    @PrimaryGeneratedColumn() id: number;

    @Index() @Column({ type: "int", nullable: true }) suggestionId: number | null;
    @Index() @Column({ type: "bigint", nullable: true }) threadId: number | null;
    @Column({ type: "bigint", nullable: true }) messageId: number | null;
    @Column({ type: "bigint", nullable: true }) listingId: number | null;
    @Column({ type: "bigint", nullable: true }) reservationId: number | null;
    @Index() @Column({ type: "int", nullable: true }) userId: number | null;

    /** 'suggestion' | 'general' | 'sent_reply' */
    @Index()
    @Column({ length: 20, nullable: true })
    targetType: string | null;

    /** Original AI draft or sent reply body captured at feedback time (for reports). */
    @Column({ type: "mediumtext", nullable: true })
    originalMessage: string | null;

    /** User who authored the sent reply being judged (sent_reply only). */
    @Index()
    @Column({ type: "int", nullable: true })
    subjectUserId: number | null;

    /** 'up' | 'down' | null */
    @Column({ length: 10, nullable: true }) rating: string | null;

    /** JSON-encoded string[] of category tags (e.g. "Wrong tone", "Too long"). */
    @Column({ type: "text", nullable: true }) categories: string | null;

    @Column({ type: "text", nullable: true }) feedbackText: string | null;
    @Column({ type: "mediumtext", nullable: true }) correctedResponse: string | null;

    @Index() @CreateDateColumn({ type: "timestamp" }) createdAt: Date;
}
