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

    /**
     * What kind of fact this row stores:
     *  - 'qa'            : a plain question/answer (default; guest-answerable)
     *  - 'style_rule'    : a learned communication-style rule (feeds prompt tone)
     *  - 'topic_to_avoid': a learned topic the AI should refuse / escalate
     *
     * `style_rule` and `topic_to_avoid` never surface as guest answers; they
     * mirror into the Settings tab's Communication Rules and Topics-to-Avoid
     * sections so curators can promote them account-wide.
     */
    @Index()
    @Column({ length: 24, default: "qa" })
    factType: string;

    // Visibility for QA facts: 'external' is guest-shareable; 'internal' is
    // staff-only guidance and must not be quoted to a guest. Mirrors the
    // Knowledge Base visibility model so facts sync 1:1 to KB entries.
    @Column({ length: 16, default: "external" })
    visibility: string;

    // When set, this learned fact is synced to a listing Knowledge Base entry;
    // any edit/delete on either side propagates through AILearnedFactsService.
    @Index()
    @Column({ type: "bigint", nullable: true })
    knowledgeEntryId: number | null;

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
