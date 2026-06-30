import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from "typeorm";

/**
 * AIMessageFeedback
 * Human feedback on an AI suggestion (or on a sent reply). Persisted permanently
 * for learning, reporting, and auditing. Consumed by the nightly learning job.
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

    /** 'up' | 'down' | null */
    @Column({ length: 10, nullable: true }) rating: string | null;

    /** JSON-encoded string[] of category tags (e.g. "Wrong tone", "Too long"). */
    @Column({ type: "text", nullable: true }) categories: string | null;

    @Column({ type: "text", nullable: true }) feedbackText: string | null;
    @Column({ type: "mediumtext", nullable: true }) correctedResponse: string | null;

    @Index() @CreateDateColumn({ type: "timestamp" }) createdAt: Date;
}
