import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * AIOpsAlert
 *
 * A manager-facing alert raised by the Ops Radar sweeps. One table for all
 * alert types so the dashboard shows a single manage-by-exception feed.
 *
 * type:
 *  - "maintenance"   lock battery low / device offline before a check-in
 *  - "root_cause"    the same issue keeps recurring at one listing
 *  - "sla"           unanswered guest thread or stale ticket past its SLA
 *  - "review_risk"   active stay trending toward a bad review
 *  - "turnover_risk" same-day turnover with risk factors stacked up
 *
 * Lifecycle: open -> resolved (condition cleared on a later sweep) or
 * open -> dismissed (human said "seen it"). dedupeKey is stable per
 * underlying condition so a dismissed alert never reappears while the
 * same condition persists; if it RESOLVES and later recurs, it reopens.
 */
@Entity("ai_ops_alerts")
export class AIOpsAlertEntity {
    @PrimaryGeneratedColumn() id: number;

    @Column({ length: 24 }) type: string;

    /** low | medium | high | critical */
    @Column({ length: 12, default: "medium" }) severity: string;

    /** open | resolved | dismissed */
    @Column({ length: 16, default: "open" }) status: string;

    @Index({ unique: true })
    @Column({ length: 160 })
    dedupeKey: string;

    @Column({ type: "bigint", nullable: true }) listingId: number | null;
    @Column({ length: 255, nullable: true }) listingName: string | null;
    @Column({ type: "bigint", nullable: true }) threadId: number | null;
    @Column({ type: "bigint", nullable: true }) reservationId: number | null;

    @Column({ length: 300 }) title: string;
    @Column({ type: "text", nullable: true }) detail: string | null;
    @Column({ type: "text", nullable: true }) recommendation: string | null;

    /** JSON blob with type-specific data (battery %, cluster items, timers…). */
    @Column({ type: "mediumtext", nullable: true }) payload: string | null;

    /** Action item auto-created from this alert (predictive maintenance). */
    @Column({ type: "int", nullable: true }) actionItemId: number | null;

    @Column({ type: "int", nullable: true }) dismissedByUserId: number | null;
    @Column({ type: "datetime", nullable: true }) resolvedAt: Date | null;

    /** Bumped every sweep that still observes the condition. */
    @Column({ type: "datetime", nullable: true }) lastSeenAt: Date | null;

    @CreateDateColumn({ type: "timestamp" }) createdAt: Date;
    @UpdateDateColumn({ type: "timestamp" }) updatedAt: Date;
}
