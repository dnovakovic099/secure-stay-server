import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("ll_buddy_suggestions")
export class LLBuddySuggestionEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Index()
    @Column({ type: "int", nullable: true })
    reservationId: number | null;

    @Index()
    @Column({ type: "int", nullable: true })
    listingId: number | null;

    @Index()
    @Column({ length: 36, nullable: true })
    communicationId: string | null;

    @Column({ length: 160, nullable: true })
    guestName: string | null;

    @Column({ length: 180, nullable: true })
    propertyName: string | null;

    @Column("text")
    guestMessage: string;

    @Column("text")
    suggestedReply: string;

    @Column("text", { nullable: true })
    internalSummary: string | null;

    @Column({ type: "float", default: 0 })
    confidence: number;

    @Index()
    @Column({ length: 40, default: "pending_review" })
    status: string;

    @Column({ type: "tinyint", default: 0 })
    autoSendAllowed: boolean;

    @Column("json", { nullable: true })
    sourceReferences: Record<string, any> | null;

    @Column("json", { nullable: true })
    warnings: string[] | null;

    @Column({ length: 120, default: "ll-buddy-v1" })
    promptVersion: string;

    @Column({ length: 120, default: "rules-first" })
    model: string;

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
