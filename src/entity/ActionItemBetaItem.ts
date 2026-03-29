import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("action_item_beta_items")
export class ActionItemBetaItemEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Index()
    @Column({ type: "int", nullable: true })
    reservationId: number | null;

    @Index()
    @Column({ type: "int", nullable: true })
    listingId: number | null;

    @Column({ length: 160, nullable: true })
    guestName: string | null;

    @Column({ length: 180, nullable: true })
    propertyName: string | null;

    @Column({ length: 120, nullable: true })
    confirmationCode: string | null;

    @Column({ length: 40, default: "unknown" })
    source: string;

    @Column({ length: 200 })
    title: string;

    @Column("text")
    description: string;

    @Column("text", { nullable: true })
    proposedResolution: string | null;

    @Index()
    @Column({ length: 36, nullable: true })
    categoryId: string | null;

    @Column({ length: 120 })
    categoryName: string;

    @Column({ length: 20, default: "Medium" })
    priority: string;

    @Index()
    @Column({ length: 40, default: "New" })
    status: string;

    @Column({ length: 160, nullable: true })
    assignedTo: string | null;

    @Column({ type: "float", default: 0 })
    confidence: number;

    @Column({ length: 40, default: "review" })
    decisionType: string;

    @Column("text", { nullable: true })
    flagReason: string | null;

    @Index()
    @Column({ length: 255, nullable: true })
    dedupeKey: string | null;

    @Column("text", { nullable: true })
    conversationSnippet: string | null;

    @Column("json", { nullable: true })
    messageIds: string[] | null;

    @Column("json", { nullable: true })
    sourceMeta: Record<string, any> | null;

    @Column("json", { nullable: true })
    notificationTargets: string[] | null;

    @Column({ type: "datetime", nullable: true })
    lastDetectedAt: Date | null;

    @Column({ type: "datetime", nullable: true })
    approvedAt: Date | null;

    @Column({ type: "datetime", nullable: true })
    rejectedAt: Date | null;

    @Column({ type: "datetime", nullable: true })
    resolvedAt: Date | null;

    @Column({ length: 120, nullable: true })
    createdBy: string | null;

    @Column({ length: 120, nullable: true })
    updatedBy: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
