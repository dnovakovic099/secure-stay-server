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

    /**
     * How this memory behaves in time — see AIMemoryPolicy for the rules:
     *  - 'permanent_fact'  : parking, house rules. No clock expiry; decays slowly.
     *  - 'temporary_state' : an active leak, a late cleaner. Hard 7-day TTL.
     *  - 'learned_pattern' : "this owner rejects discounts". Fades fastest.
     *  - 'decision'        : why a refund/override was granted. Kept as precedent.
     *
     * Only permanent facts can be quoted to a guest; the rest steer behaviour.
     */
    @Index()
    @Column({ length: 24, default: "permanent_fact" })
    memoryType: string;

    /**
     * What this memory is ABOUT: property | owner | guest | employee | vendor.
     * Before this existed, memory could only be keyed to a listing, so anything
     * learned about an owner or a cleaner had nowhere to live.
     */
    @Index()
    @Column({ length: 24, default: "property" })
    subjectType: string;

    /** Identifier within `subjectType`. Null for portfolio-wide memory. */
    @Index()
    @Column({ length: 128, nullable: true })
    subjectId: string | null;

    // Visibility for QA facts: 'external' is guest-shareable; 'internal' is
    // staff-only and never fed into guest-facing AI replies. Only external
    // facts sync to Knowledge Base entries.
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

    /**
     * For `memoryType = 'decision'`: WHY the call was made. Staff-only — this is
     * the part that lets the assistant stay consistent with a past refund or
     * exception instead of re-deciding from scratch. Never quoted to a guest.
     */
    @Column({ type: "text", nullable: true })
    decisionRationale: string | null;

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

    /** Last time reality confirmed this memory. Drives ranking decay. */
    @Column({ type: "datetime", nullable: true })
    lastSeenAt: Date | null;

    /** Explicit expiry. Overrides the per-type default TTL when set. */
    @Column({ type: "datetime", nullable: true })
    validUntil: Date | null;

    /** Set when a newer memory replaces this one; superseded memory is never used. */
    @Index()
    @Column({ type: "int", nullable: true })
    supersededByFactId: number | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
