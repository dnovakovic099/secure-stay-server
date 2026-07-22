import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from "typeorm";

/**
 * Structured human feedback on an IR Copilot suggestion
 * (thumbs + categories + optional corrected playbook / draft).
 */
@Entity("issue_ai_feedback")
export class IssueAIFeedbackEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ type: "int", nullable: true })
    suggestionId: number | null;

    @Index()
    @Column({ type: "int", nullable: true })
    issueId: number | null;

    @Column({ type: "int", nullable: true })
    listingId: number | null;

    @Column({ type: "int", nullable: true })
    userId: number | null;

    /** 'up' | 'down' | null */
    @Column({ length: 10, nullable: true })
    rating: string | null;

    /** JSON-encoded string[] */
    @Column({ type: "text", nullable: true })
    categories: string | null;

    @Column({ type: "text", nullable: true })
    feedbackText: string | null;

    @Column({ type: "mediumtext", nullable: true })
    correctedResponse: string | null;

    @Index()
    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;
}
