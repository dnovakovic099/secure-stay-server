import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * AIKnowledgeConflict
 *
 * One detected contradiction between two of the AI's knowledge sources for a
 * property: live listing data ('listing_data', authoritative), a learned Q&A
 * fact ('learned_fact'), or a Knowledge Base entry ('kb_entry'). Example:
 * listing_info says check-out is 10 AM while a taught fact says 11 AM — the
 * bot could tell a guest either one depending on retrieval.
 *
 * Rows are written by AIConflictDetectorService sweeps (dedupeKey-idempotent)
 * and reviewed in the AI Assistant "Conflicts" tab, where staff fix or remove
 * the wrong source. Dismissed conflicts stay dismissed on re-scan; resolved
 * ones reopen if the same pair is detected again.
 */
@Entity("ai_knowledge_conflicts")
export class AIKnowledgeConflictEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ type: "bigint", nullable: true })
    listingId: number | null;

    @Column({ length: 255, nullable: true })
    listingName: string | null;

    // Short human label, e.g. "check-out time", "pet fee"
    @Column({ length: 120, nullable: true })
    topic: string | null;

    // 'high' (money/access/times/policy misinformation) | 'medium'
    @Column({ length: 12, default: "medium" })
    severity: string;

    // 'open' | 'resolved' | 'dismissed'
    @Index()
    @Column({ length: 16, default: "open" })
    status: string;

    @Index({ unique: true })
    @Column({ length: 160 })
    dedupeKey: string;

    // 'listing_data' | 'learned_fact' | 'kb_entry'
    @Column({ length: 20 })
    sourceAType: string;

    // learned_fact -> ai_learned_facts.id; kb_entry -> listing_knowledge_entries.id
    @Column({ type: "bigint", nullable: true })
    sourceAId: number | null;

    @Column({ length: 255, nullable: true })
    sourceALabel: string | null;

    @Column({ type: "text", nullable: true })
    sourceAText: string | null;

    @Column({ length: 20 })
    sourceBType: string;

    @Column({ type: "bigint", nullable: true })
    sourceBId: number | null;

    @Column({ length: 255, nullable: true })
    sourceBLabel: string | null;

    @Column({ type: "text", nullable: true })
    sourceBText: string | null;

    // One sentence quoting both conflicting values.
    @Column({ type: "text", nullable: true })
    explanation: string | null;

    // Which source to change and to what.
    @Column({ type: "text", nullable: true })
    suggestedFix: string | null;

    @Column({ type: "int", nullable: true })
    dismissedByUserId: number | null;

    @Column({ type: "datetime", nullable: true })
    resolvedAt: Date | null;

    @Column({ type: "datetime", nullable: true })
    lastSeenAt: Date | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}

/**
 * Per-listing scan cache — hash of every knowledge source feeding a listing's
 * prompt. Unchanged hash = the nightly sweep skips the LLM call entirely.
 * listingId NULL is the portfolio-wide pseudo-scan (portfolio facts only).
 */
@Entity("ai_conflict_scans")
export class AIConflictScanEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index({ unique: true })
    @Column({ type: "bigint", nullable: true })
    listingId: number | null;

    @Column({ length: 64 })
    sourceHash: string;

    @Column({ type: "int", default: 0 })
    conflictsFound: number;

    @Column({ type: "datetime", nullable: true })
    scannedAt: Date | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
