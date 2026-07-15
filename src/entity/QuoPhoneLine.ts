import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * One of our Quo (OpenPhone) phone lines. Only lines flagged enabled are
 * synced into the Quo inbox — PM and GR lines; maintenance/sales stay off.
 */
@Entity("quo_phone_lines")
export class QuoPhoneLineEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index({ unique: true })
    @Column({ length: 40 })
    phoneNumberId: string;

    @Column({ length: 20 })
    number: string;

    @Column({ length: 255, nullable: true })
    name: string | null;

    @Column({ length: 10, nullable: true })
    symbol: string | null;

    /** PM | GR | maintenance | sales | other */
    @Column({ length: 20, default: "other" })
    category: string;

    @Column({ type: "tinyint", default: 0 })
    enabled: number;

    @Column({ type: "tinyint", default: 0 })
    aiAutoRespondEnabled: number;

    @Column({ type: "datetime", nullable: true })
    lastSyncedAt: Date | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
