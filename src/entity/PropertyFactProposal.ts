import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";

/**
 * property_fact_proposals — the correction queue feeding property_facts.
 *
 * Created automatically when evidence appears that a preset fact is wrong or
 * missing: a rep downvotes an AI reply with a correction, or the nightly audit
 * finds the team's reply contradicted the AI (wrong_info miss). A human
 * confirms or rejects; confirming writes the VERIFIED value to property_facts.
 *
 * This is how the source-of-truth layer fills itself from real mistakes
 * instead of an upfront data-entry project.
 */
@Entity("property_fact_proposals")
export class PropertyFactProposalEntity {
    @PrimaryGeneratedColumn() id: number;

    /** Canonical (group parent) listing id. */
    @Index() @Column({ type: "bigint" }) listingId: number;

    @Column({ length: 64 }) fieldKey: string;

    @Column({ type: "text", nullable: true }) currentValue: string | null;

    @Column({ type: "text" }) proposedValue: string;

    /** What produced this proposal: feedback | audit_wrong_info */
    @Column({ length: 32 }) sourceType: string;

    /** ai_message_feedback.id or ai_message_suggestions.id depending on sourceType. */
    @Column({ type: "bigint", nullable: true }) sourceId: number | null;

    /** Human-readable evidence: the guest ask, the AI's claim, the team's correction. */
    @Column({ type: "mediumtext", nullable: true }) evidence: string | null;

    @Index() @Column({ length: 16, default: "pending" }) status: string; // pending | accepted | rejected

    @Column({ type: "bigint", nullable: true }) reviewedByUserId: number | null;

    @Column({ type: "datetime", nullable: true }) reviewedAt: Date | null;

    @CreateDateColumn({ type: "timestamp" }) createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" }) updatedAt: Date;
}
