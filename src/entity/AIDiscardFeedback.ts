import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from "typeorm";

/**
 * AIDiscardFeedback
 *
 * One row per action item the team discarded as "not needed", with the reason
 * they gave. These are fed into the item-detection prompt as negative examples
 * so the AI learns which kinds of action items it should stop creating.
 */
@Entity("ai_discard_feedback")
export class AIDiscardFeedbackEntity {
    @PrimaryGeneratedColumn()
    id: number;

    // Currently always "action_item"; kept for future guest-issue discards.
    @Index()
    @Column({ length: 20, default: "action_item" })
    type: string;

    @Column({ type: "int", nullable: true })
    actionItemId: number | null;

    // The item text as it appeared to the team when they discarded it.
    @Column({ type: "text", nullable: true })
    itemText: string | null;

    @Column({ length: 120, nullable: true })
    category: string | null;

    @Column({ type: "int", nullable: true })
    listingId: number | null;

    @Column({ length: 255, nullable: true })
    listingName: string | null;

    @Column({ length: 255, nullable: true })
    guestName: string | null;

    @Column({ type: "bigint", nullable: true })
    reservationId: number | null;

    // Why the team says this item was not needed — the teaching signal.
    @Column({ type: "text" })
    reason: string;

    @Column({ length: 255, nullable: true })
    discardedBy: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;
}
