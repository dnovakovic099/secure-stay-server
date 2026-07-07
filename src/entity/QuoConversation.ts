import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * A Quo (OpenPhone) SMS conversation on one of our PM/GR lines. Kept fully
 * separate from the Hostify inbox_conversations table.
 */
@Entity("quo_conversations")
export class QuoConversationEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index({ unique: true })
    @Column({ length: 64 })
    conversationId: string;

    @Index()
    @Column({ length: 40 })
    phoneNumberId: string;

    /** Our line's E.164 number — shown prominently in the UI. */
    @Column({ length: 20, nullable: true })
    lineNumber: string | null;

    /** Our line's display name (inbox name). */
    @Column({ length: 255, nullable: true })
    lineName: string | null;

    /** The external participant (guest/owner/vendor) phone. */
    @Index()
    @Column({ length: 30, nullable: true })
    participantPhone: string | null;

    /** All participants, comma separated (group threads). */
    @Column({ length: 500, nullable: true })
    participants: string | null;

    @Column({ length: 255, nullable: true })
    contactName: string | null;

    // --- Hostify reservation link (resolved by phone / message / manual) ---
    @Column({ type: "bigint", nullable: true })
    reservationId: number | null;

    @Column({ type: "bigint", nullable: true })
    listingId: number | null;

    @Column({ length: 255, nullable: true })
    listingName: string | null;

    @Column({ length: 255, nullable: true })
    guestName: string | null;

    /** phone | message | manual */
    @Column({ length: 20, nullable: true })
    linkMethod: string | null;

    @Column({ type: "text", nullable: true })
    lastMessageText: string | null;

    @Index()
    @Column({ type: "datetime", nullable: true })
    lastMessageAt: Date | null;

    @Column({ length: 10, nullable: true })
    lastDirection: string | null;

    @Column({ type: "tinyint", default: 0 })
    unread: number;

    @Column({ type: "tinyint", default: 0 })
    isArchived: number;

    /** Last time action-item detection ran for this conversation. */
    @Column({ type: "datetime", nullable: true })
    lastDetectAt: Date | null;

    @Column({ type: "datetime", nullable: true })
    syncedAt: Date | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
