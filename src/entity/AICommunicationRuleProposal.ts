import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * Draft communication-rule updates awaiting human approval before they are
 * merged into ai_messaging_settings.communicationRuleEntries.
 */
@Entity("ai_communication_rule_proposals")
export class AICommunicationRuleProposalEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 160 })
    topic: string;

    @Column({ type: "mediumtext" })
    rule: string;

    @Column({ length: 255, nullable: true })
    appliesTo: string | null;

    /** pending | approved | rejected */
    @Index()
    @Column({ length: 20, default: "pending" })
    status: string;

    @Column({ type: "text", nullable: true })
    rationale: string | null;

    /** JSON-encoded number[] of ai_message_feedback ids. */
    @Column({ type: "text", nullable: true })
    sourceFeedbackIds: string | null;

    @Column({ type: "mediumtext", nullable: true })
    sourceSummary: string | null;

    @Column({ type: "int", nullable: true })
    proposedByUserId: number | null;

    @Column({ length: 255, nullable: true })
    proposedByName: string | null;

    @Column({ type: "int", nullable: true })
    reviewedByUserId: number | null;

    @Column({ length: 255, nullable: true })
    reviewedByName: string | null;

    @Column({ type: "datetime", nullable: true })
    reviewedAt: Date | null;

    @Column({ type: "text", nullable: true })
    reviewNote: string | null;

    @Column({ length: 64, nullable: true })
    createdEntryId: string | null;

    @Index()
    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
