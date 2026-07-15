import {
    Entity,
    PrimaryColumn,
    Column,
    Index,
    CreateDateColumn,
} from "typeorm";

/**
 * ReservationQuoConversation
 *
 * Extra Quo conversation attachments for a Hostify reservation. The auto-link
 * lives on `quo_conversations.reservationId` (matched by guest phone during
 * Quo sync); this table lets a rep attach additional Quo threads to the same
 * reservation — e.g. when a guest texts from a second phone number and lands
 * on a separate Quo conversation that we still want visible under the guest's
 * Hostify thread.
 */
@Entity("reservation_quo_conversation")
export class ReservationQuoConversationEntity {
    @PrimaryColumn({ type: "bigint" })
    reservationId: number;

    @PrimaryColumn({ type: "varchar", length: 64 })
    quoConversationId: string;

    /**
     * 1 = the rep explicitly detached this thread from the reservation and it
     * should stay hidden even if the phone-match fallback would re-surface it.
     * 0 = normal manual attachment (the row exists purely to attach an extra
     * Quo conversation not caught by the auto-link).
     */
    @Column({ type: "tinyint", default: 0 })
    isSuppressed: number;

    @Index()
    @Column({ type: "varchar", length: 255, nullable: true })
    createdBy: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;
}
