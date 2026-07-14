import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from "typeorm";

/** A single SMS/MMS message in a Quo conversation. */
@Entity("quo_messages")
export class QuoMessageEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index({ unique: true })
    @Column({ length: 64 })
    externalId: string;

    @Index()
    @Column({ length: 64 })
    conversationId: string;

    @Column({ length: 40, nullable: true })
    phoneNumberId: string | null;

    @Column({ type: "mediumtext", nullable: true })
    body: string | null;

    /** incoming | outgoing */
    @Column({ length: 10 })
    direction: string;

    @Column({ length: 30, nullable: true })
    fromNumber: string | null;

    @Column({ length: 255, nullable: true })
    toNumbers: string | null;

    @Column({ type: "text", nullable: true })
    mediaUrls: string | null;

    @Column({ length: 20, nullable: true })
    status: string | null;

    @Column({ length: 40, nullable: true })
    quoUserId: string | null;

    /** Resolved Quo workspace user name for outgoing messages. */
    @Column({ length: 255, nullable: true })
    senderName: string | null;

    @Index()
    @Column({ type: "datetime" })
    sentAt: Date;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;
}
