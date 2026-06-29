import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("ll_buddy_messages")
export class LLBuddyMessageEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Index()
    @Column({ length: 36 })
    conversationId: string;

    @Index()
    @Column({ length: 255, nullable: true })
    externalMessageId: string | null;

    @Column({ length: 60, default: "local" })
    sourceSystem: string;

    @Column({ length: 60, nullable: true })
    channel: string | null;

    @Index()
    @Column({ length: 20 })
    direction: "inbound" | "outbound" | "internal" | "system";

    @Column({ length: 30, default: "unknown" })
    senderType: "guest" | "team" | "client" | "system" | "ai" | "unknown";

    @Column({ length: 160, nullable: true })
    senderName: string | null;

    @Column({ length: 160, nullable: true })
    senderExternalId: string | null;

    @Column({ length: 120, nullable: true })
    securestayUserId: string | null;

    @Column("text")
    body: string;

    @Column("json", { nullable: true })
    attachments: Record<string, any>[] | null;

    @Column({ type: "datetime", nullable: true })
    sentAt: Date | null;

    @Column({ type: "datetime", nullable: true })
    receivedAt: Date | null;

    @Index()
    @Column({ length: 40, default: "received" })
    sendStatus: string;

    @Column("json", { nullable: true })
    rawPayload: Record<string, any> | null;

    @Column({ length: 36, nullable: true })
    sourceCommunicationId: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
