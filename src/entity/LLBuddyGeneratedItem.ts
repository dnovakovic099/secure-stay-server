import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("ll_buddy_generated_items")
export class LLBuddyGeneratedItemEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Index()
    @Column({ length: 30 })
    itemType: "action_item" | "guest_issue";

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

    @Column({ length: 200 })
    title: string;

    @Column("text")
    description: string;

    @Column({ length: 120 })
    categoryName: string;

    @Column({ length: 20, default: "Medium" })
    priority: string;

    @Index()
    @Column({ length: 40, default: "New" })
    status: string;

    @Column({ type: "float", default: 0 })
    confidence: number;

    @Column("text", { nullable: true })
    proposedResolution: string | null;

    @Column("text", { nullable: true })
    flagReason: string | null;

    @Column("json", { nullable: true })
    messageIds: string[] | null;

    @Column("json", { nullable: true })
    sourceReferences: Record<string, any> | null;

    @Column({ length: 255, nullable: true })
    dedupeKey: string | null;

    @Column({ length: 120, nullable: true })
    createdBy: string | null;

    @Column({ length: 120, nullable: true })
    updatedBy: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
