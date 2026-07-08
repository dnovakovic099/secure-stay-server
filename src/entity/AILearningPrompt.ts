import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * AILearningPrompt
 *
 * When the bot drafts a reply but lacks a specific, reusable, property-level fact
 * a staff member could provide, it raises a "learning prompt" — a question shown
 * at the top of that conversation. When staff answer it, we store the answer as a
 * learned fact so future replies are grounded. If the team's own reply later
 * teaches us the fact (nightly extraction), the prompt is auto-resolved.
 *
 * One active (pending) prompt per thread at a time.
 */
@Entity("ai_learning_prompts")
export class AILearningPromptEntity {
    @PrimaryGeneratedColumn() id: number;

    @Index() @Column({ type: "bigint" }) threadId: number;
    /** Which inbox raised it: 'hostify' (default) or 'quo'. threadId is scoped per source. */
    @Column({ length: 20, default: "hostify" }) source: string;
    @Column({ type: "bigint", nullable: true }) listingId: number | null;
    @Column({ length: 255, nullable: true }) listingName: string | null;

    /** Short staff-facing question, e.g. "How many cars fit in the driveway?" */
    @Column({ type: "text" }) question: string;
    /** Slug/topic used to dedupe + match learned facts, e.g. "parking". */
    @Column({ length: 120, nullable: true }) topic: string | null;

    /** pending | answered | dismissed */
    @Index() @Column({ length: 20, default: "pending" }) status: string;

    @Column({ type: "text", nullable: true }) answerText: string | null;
    @Column({ length: 20, nullable: true }) answerScope: string | null; // property | portfolio
    /** users.id of whoever answered — or dismissed — the prompt. */
    @Column({ type: "int", nullable: true }) answeredByUserId: number | null;
    @Column({ type: "datetime", nullable: true }) resolvedAt: Date | null;
    /** How it was resolved: staff | auto_learned */
    @Column({ length: 20, nullable: true }) resolvedVia: string | null;

    @Column({ type: "bigint", nullable: true }) sampleSuggestionId: number | null;

    @CreateDateColumn({ type: "timestamp" }) createdAt: Date;
    @UpdateDateColumn({ type: "timestamp" }) updatedAt: Date;
}
