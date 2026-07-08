import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * AILearnedFact
 *
 * A frequently-asked, stable fact the assistant has learned from real guest
 * conversations — either for a specific property (`scope = 'property'`, tied to
 * a `listingId`) or account-wide (`scope = 'portfolio'`, `listingId = null`).
 *
 * Auto-extracted facts are created by the nightly audit with `status = 'pending'`
 * and only feed the bot's context once a human sets `status = 'approved'` in the
 * AI Copilot review tab. This keeps the self-improvement loop safe: the bot never
 * repeats an auto-learned fact to a guest until it's been reviewed.
 */
@Entity("ai_learned_facts")
export class AILearnedFactEntity {
    @PrimaryGeneratedColumn()
    id: number;

    // 'property' | 'portfolio'
    @Index()
    @Column({ length: 20, default: "property" })
    scope: string;

    @Index()
    @Column({ type: "bigint", nullable: true })
    listingId: number | null;

    @Index()
    @Column({ length: 120 })
    topic: string;

    @Column({ type: "text", nullable: true })
    question: string | null;

    @Column({ type: "mediumtext", nullable: true })
    answer: string | null;

    @Index()
    @Column({ type: "int", default: 1 })
    frequency: number;

    // pending | approved | rejected
    @Index()
    @Column({ length: 20, default: "pending" })
    status: string;

    // 'nightly_audit' | 'manual'
    @Column({ length: 30, default: "nightly_audit" })
    source: string;

    @Column({ type: "bigint", nullable: true })
    sampleThreadId: number | null;

    @Column({ type: "int", nullable: true })
    reviewedByUserId: number | null;

    /** users.id of the staff member who taught this fact (NULL when auto-extracted). */
    @Column({ type: "int", nullable: true })
    createdByUserId: number | null;

    @Column({ type: "datetime", nullable: true })
    lastSeenAt: Date | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
