import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from "typeorm";

/**
 * AutoMessageLog
 *
 * One row per (rule, thread, occurrence). The unique (ruleId, threadId,
 * dedupeKey) index is the idempotency guarantee: the engine inserts the row
 * BEFORE delivering, so retries/concurrent runs can never double-send.
 */
@Entity("auto_message_log")
@Index(["ruleId", "threadId", "dedupeKey"], { unique: true })
export class AutoMessageLogEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ type: "int" })
    ruleId: number;

    @Index()
    @Column({ type: "bigint" })
    threadId: number;

    /**
     * Occurrence key: 'once' for winback/one_time, or the ET date key
     * (YYYY-MM-DD) for recurring date-based triggers.
     */
    @Column({ length: 40 })
    dedupeKey: string;

    // 'sending' | 'sent' | 'failed'
    @Index()
    @Column({ length: 20, default: "sending" })
    status: string;

    @Column({ type: "text", nullable: true })
    messageBody: string | null;

    @Column({ type: "text", nullable: true })
    error: string | null;

    @Column({ type: "datetime", nullable: true })
    sentAt: Date | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;
}
