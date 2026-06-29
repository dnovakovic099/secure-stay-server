import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("ll_buddy_learning_candidates")
export class LLBuddyLearningCandidateEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ length: 40 })
    candidateType: "property_knowledge" | "company_guidance" | "classification_rule";

    @Index()
    @Column({ type: "int", nullable: true })
    listingId: number | null;

    @Column({ length: 180, nullable: true })
    propertyName: string | null;

    @Column({ length: 120 })
    topic: string;

    @Column("text")
    proposedText: string;

    @Column("text", { nullable: true })
    reason: string | null;

    @Column({ type: "float", default: 0 })
    confidence: number;

    @Column({ type: "int", default: 1 })
    evidenceCount: number;

    @Column("json", { nullable: true })
    evidence: Record<string, any> | null;

    @Column("json", { nullable: true })
    warnings: string[] | null;

    @Index()
    @Column({ length: 40, default: "pending" })
    status: string;

    @Column("text", { nullable: true })
    decisionReason: string | null;

    @Column({ length: 120, nullable: true })
    reviewedBy: string | null;

    @Column({ type: "datetime", nullable: true })
    reviewedAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
