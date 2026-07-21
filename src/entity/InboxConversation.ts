import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * InboxConversation
 *
 * Locally-persisted Hostify inbox thread (one row per Hostify thread id).
 * Powers the v2 inbox so the UI reads from our DB instead of live-proxying
 * Hostify on every request. Kept intentionally separate from the legacy
 * `messages` table (which is incoming-only and feeds the unanswered-alert job).
 */
@Entity("inbox_conversations")
export class InboxConversationEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index({ unique: true })
    @Column({ type: "bigint" })
    threadId: number;

    @Index()
    @Column({ type: "bigint", nullable: true })
    reservationId: number | null;

    @Column({ type: "bigint", nullable: true })
    listingId: number | null;

    @Column({ type: "bigint", nullable: true })
    guestId: number | null;

    @Column({ length: 255, nullable: true })
    guestName: string | null;

    @Column({ length: 64, nullable: true })
    guestPhone: string | null;

    @Column({ length: 255, nullable: true })
    guestEmail: string | null;

    // Hostify integration_type_name e.g. "Airbnb", "VRBO", "Booking.com"
    @Index()
    @Column({ length: 64, nullable: true })
    channel: string | null;

    @Column({ length: 255, nullable: true })
    listingName: string | null;

    @Column({ type: "text", nullable: true })
    lastMessageText: string | null;

    @Index()
    @Column({ type: "datetime", nullable: true })
    lastMessageAt: Date | null;

    @Column({ type: "tinyint", default: 0 })
    answered: number;

    @Column({ type: "tinyint", default: 0 })
    unread: number;

    @Column({ type: "tinyint", default: 0 })
    isArchived: number;

    @Column({ type: "int", nullable: true })
    nights: number | null;

    @Column({ type: "int", nullable: true })
    guests: number | null;

    @Column({ type: "date", nullable: true })
    checkin: string | null;

    @Column({ type: "date", nullable: true })
    checkout: string | null;

    // Booking cost as reported by Hostify thread summary
    @Column({ type: "decimal", precision: 12, scale: 2, nullable: true })
    price: number | null;

    @Column({ length: 8, nullable: true })
    currency: string | null;

    @Column({ length: 64, nullable: true })
    reservationStatus: string | null;

    @Column({ length: 500, nullable: true })
    guestThumb: string | null;

    @Column({ length: 500, nullable: true })
    listingThumb: string | null;

    @Column({ length: 20, default: "hostify" })
    source: string;

    // ---- Emergency flag (e.g. non-Airbnb guest arriving with an unpaid balance) ----
    // When set, the inbox shows a red banner and the AI response bot is suppressed
    // for this thread so a human handles the payment conversation.
    @Column({ type: "tinyint", default: 0 })
    emergency: number;

    @Column({ length: 50, nullable: true })
    emergencyType: string | null;

    @Column({ length: 500, nullable: true })
    emergencyReason: string | null;

    @Column({ type: "datetime", nullable: true })
    emergencyAt: Date | null;

    // Manual mute from Inbox V2 ("Disable auto-respond") for problematic guests.
    // When guestId is set, a matching ai_guest_autosend_disable row also persists
    // the mute across future threads for that guest.
    @Column({ type: "tinyint", default: 0 })
    aiAutoRespondDisabled: number;

    @Column({ type: "datetime", nullable: true })
    aiAutoRespondDisabledAt: Date | null;

    @Column({ length: 255, nullable: true })
    aiAutoRespondDisabledBy: string | null;

    @Column({ type: "datetime", nullable: true })
    syncedAt: Date | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
