import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * InboxMessage
 *
 * Locally-persisted individual message belonging to an InboxConversation.
 * Stores BOTH incoming (guest) and outgoing (host/automatic/system) messages,
 * unlike the legacy `messages` table which only kept incoming guest messages.
 *
 * Sender attribution:
 *  - For messages we sent from the v2 inbox, `sentByUserId` / `sentByName`
 *    record the internal SecureStay user who clicked send.
 *  - For messages that originate in Hostify (or other channels), `senderName`
 *    holds the channel-provided sender label and `sentByUserId` stays null.
 */
@Entity("inbox_messages")
export class InboxMessageEntity {
    @PrimaryGeneratedColumn()
    id: number;

    // Hostify message id (unique per channel message). Used for idempotent upserts.
    @Index({ unique: true })
    @Column({ type: "bigint" })
    externalId: number;

    @Index()
    @Column({ type: "bigint" })
    threadId: number;

    @Index()
    @Column({ type: "bigint", nullable: true })
    reservationId: number | null;

    @Column({ type: "bigint", nullable: true })
    listingId: number | null;

    @Column({ type: "mediumtext", nullable: true })
    body: string | null;

    // Hostify internal note attached to a message (separate from guest-visible body)
    @Column({ type: "text", nullable: true })
    note: string | null;

    // 'incoming' (from guest) | 'outgoing' (from host/automatic/system)
    @Column({ length: 10 })
    direction: string;

    // 'guest' | 'host' | 'automatic' | 'system'
    @Column({ length: 20, nullable: true })
    senderType: string | null;

    // Channel-provided display name of the sender (guest name, or Hostify rep name)
    @Column({ length: 255, nullable: true })
    senderName: string | null;

    @Column({ type: "tinyint", default: 0 })
    isAutomatic: number;

    @Column({ type: "tinyint", default: 0 })
    isSms: number;

    @Column({ length: 64, nullable: true })
    channel: string | null;

    @Column({ length: 1000, nullable: true })
    attachmentUrl: string | null;

    @Column({ type: "bigint", nullable: true })
    guestId: number | null;

    @Index()
    @Column({ type: "datetime" })
    sentAt: Date;

    // Internal SecureStay user attribution (set when sent from the v2 inbox)
    @Index()
    @Column({ type: "int", nullable: true })
    sentByUserId: number | null;

    @Column({ length: 255, nullable: true })
    sentByName: string | null;

    // Where this row was created: 'sync' | 'webhook' | 'inbox_v2'
    @Column({ length: 20, default: "sync" })
    sentVia: string;

    @Column({ length: 20, default: "hostify" })
    source: string;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
