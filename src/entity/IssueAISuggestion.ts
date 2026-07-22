import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * Persisted IR Copilot suggestion for a Guest Issue ticket.
 * Suggestion-only — never auto-sends or changes ticket status.
 */
@Entity("issue_ai_suggestions")
export class IssueAISuggestionEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ type: "int" })
    issueId: number;

    @Column({ type: "int", nullable: true })
    listingId: number | null;

    @Column({ type: "int", nullable: true })
    reservationId: number | null;

    @Column({ type: "text", nullable: true })
    summary: string | null;

    @Column({ length: 32, nullable: true })
    severity: string | null;

    @Column({ type: "text", nullable: true })
    primaryAction: string | null;

    /** JSON: Array<{ step, ownerLane, detail }> */
    @Column({ type: "mediumtext", nullable: true })
    playbookJson: string | null;

    /** JSON: ranked contact pack */
    @Column({ type: "mediumtext", nullable: true })
    recommendedContactsJson: string | null;

    @Column({ type: "mediumtext", nullable: true })
    draftGuestMessage: string | null;

    @Column({ type: "mediumtext", nullable: true })
    draftInternalNote: string | null;

    @Column({ type: "mediumtext", nullable: true })
    draftVendorMessage: string | null;

    /** JSON string[] */
    @Column({ type: "text", nullable: true })
    warningsJson: string | null;

    @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
    confidence: number | null;

    @Column({ length: 64, nullable: true })
    modelName: string | null;

    @Column({ length: 32, nullable: true })
    promptVersion: string | null;

    /** suggested | accepted | edited | ignored | regenerated */
    @Index()
    @Column({ length: 20, default: "suggested" })
    status: string;

    @Column({ type: "mediumtext", nullable: true })
    rawResponse: string | null;

    @Index()
    @Column({ type: "datetime" })
    generatedAt: Date;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
