import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("inbox_message_escalations")
export class InboxMessageEscalationEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ type: "bigint" })
    threadId: number;

    @Column({ type: "bigint", nullable: true })
    messageExternalId: number | null;

    @Column({ type: "int", nullable: true })
    messageId: number | null;

    @Column({ type: "varchar", length: 64 })
    actorUid: string;

    @Column({ type: "varchar", length: 160, nullable: true })
    actorName: string | null;

    @Index()
    @Column({ type: "varchar", length: 64 })
    assigneeUid: string;

    @Column({ type: "varchar", length: 160, nullable: true })
    assigneeName: string | null;

    @Column({ type: "varchar", length: 40, nullable: true })
    category: string | null;

    @Column({ type: "text" })
    note: string;

    @Column({ type: "mediumtext", nullable: true })
    aiStepsJson: string | null;

    @Column({ type: "text", nullable: true })
    aiSummary: string | null;

    /** suggested | notified | cancelled */
    @Index()
    @Column({ type: "varchar", length: 30, default: "suggested" })
    status: string;

    @CreateDateColumn({ type: "datetime" })
    createdAt: Date;

    @UpdateDateColumn({ type: "datetime" })
    updatedAt: Date;
}
