import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("ll_buddy_conversations")
export class LLBuddyConversationEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Index()
    @Column({ length: 255, nullable: true })
    externalConversationId: string | null;

    @Index()
    @Column({ length: 60, default: "local" })
    sourceSystem: string;

    @Column({ length: 60, nullable: true })
    channel: string | null;

    @Column({ length: 160, nullable: true })
    guestName: string | null;

    @Index()
    @Column({ type: "int", nullable: true })
    listingId: number | null;

    @Column({ length: 180, nullable: true })
    propertyName: string | null;

    @Index()
    @Column({ type: "int", nullable: true })
    reservationId: number | null;

    @Column({ type: "datetime", nullable: true })
    lastMessageAt: Date | null;

    @Column({ type: "datetime", nullable: true })
    lastInboundMessageAt: Date | null;

    @Column({ type: "datetime", nullable: true })
    lastOutboundMessageAt: Date | null;

    @Column({ type: "tinyint", default: 0 })
    unread: boolean;

    @Column({ type: "tinyint", default: 0 })
    unresponded: boolean;

    @Column({ length: 160, nullable: true })
    assignedUserId: string | null;

    @Index()
    @Column({ length: 40, default: "open" })
    status: string;

    @Column({ length: 40, default: "synced" })
    syncStatus: string;

    @Column({ type: "datetime", nullable: true })
    lastSyncedAt: Date | null;

    @Column("text", { nullable: true })
    syncError: string | null;

    @Column("text", { nullable: true })
    lastMessagePreview: string | null;

    @Column("json", { nullable: true })
    metadata: Record<string, any> | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
