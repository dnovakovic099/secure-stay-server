import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

/**
 * A synced OpenPhone (Quo) call — the call side of per-employee activity for
 * the admin workload page (messages already live in quo_messages).
 */
@Entity("quo_calls")
export class QuoCallEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index({ unique: true })
    @Column({ length: 64 })
    externalId: string;

    @Index()
    @Column({ length: 64, nullable: true })
    conversationId: string | null;

    @Column({ length: 40, nullable: true })
    phoneNumberId: string | null;

    /** incoming | outgoing */
    @Column({ length: 10 })
    direction: string;

    @Column({ length: 30, nullable: true })
    status: string | null;

    /** Talk time in seconds. */
    @Column({ type: "int", default: 0 })
    duration: number;

    /** Quo workspace user id who answered (incoming calls). */
    @Column({ length: 40, nullable: true })
    answeredBy: string | null;

    /** Quo workspace user id who initiated (outgoing calls). */
    @Column({ length: 40, nullable: true })
    initiatedBy: string | null;

    @Column({ length: 40, nullable: true })
    quoUserId: string | null;

    @Column({ length: 255, nullable: true })
    participants: string | null;

    @Index()
    @Column({ type: "datetime" })
    occurredAt: Date;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;
}
