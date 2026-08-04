import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * AIProposedAction
 *
 * A concrete, one-click operation the AI detected from a guest message and
 * proposes to a human for approval. The AI NEVER executes these itself —
 * staff approve (execute) or dismiss from the inbox.
 *
 * actionType:
 *  - "late_checkout"     guest asked for late checkout and the calendar shows
 *                        the night after checkout is open (evidence attached)
 *  - "early_check_in"    guest asked for early check-in and the night before
 *                        check-in is open
 *  - "resend_access_code" guest is locked out / code not working and a live
 *                        code exists on the smart lock for this reservation
 *  - "create_ops_ticket" RETIRED. Guest Issues tickets cover the same problem
 *                        reports, so this duplicated them. Never proposed or
 *                        executed; historical rows are filtered out of reads.
 */
@Entity("ai_proposed_actions")
export class AIProposedActionEntity {
    @PrimaryGeneratedColumn() id: number;

    /** The suggestion whose generation detected this action (nullable). */
    @Column({ type: "int", nullable: true }) suggestionId: number | null;

    @Column({ length: 16, default: "hostify" }) source: string;

    @Index() @Column({ type: "bigint" }) threadId: number;

    /** externalId of the inbound guest message that triggered the proposal. */
    @Column({ type: "bigint", nullable: true }) messageId: number | null;

    @Column({ type: "bigint", nullable: true }) reservationId: number | null;
    @Column({ type: "bigint", nullable: true }) listingId: number | null;

    @Column({ length: 32 }) actionType: string;

    /** Short human-readable headline, e.g. "Approve late checkout until 1pm?". */
    @Column({ length: 255 }) title: string;

    /** Why the AI proposed this (calendar data, code found, guest quote). */
    @Column({ type: "text", nullable: true }) evidence: string | null;

    /** Guest-facing reply sent when the action is approved (staff-editable). */
    @Column({ type: "mediumtext", nullable: true }) proposedReply: string | null;

    /** Pre-filled task text for the schedule-change types. */
    @Column({ type: "text", nullable: true }) taskDescription: string | null;

    /** JSON blob with action-specific data (codes, dates, category…). */
    @Column({ type: "mediumtext", nullable: true }) payload: string | null;

    /** proposed | awaiting_ops | needs_human | executed | dismissed | expired */
    @Index() @Column({ length: 20, default: "proposed" }) status: string;

    /** Outcome note after execution ("reply sent", "task #123 created"). */
    @Column({ length: 500, nullable: true }) resultNote: string | null;

    @Column({ type: "int", nullable: true }) executedByUserId: number | null;
    @Column({ length: 255, nullable: true }) executedByName: string | null;
    @Column({ type: "datetime", nullable: true }) executedAt: Date | null;

    @CreateDateColumn({ type: "timestamp" }) createdAt: Date;
    @UpdateDateColumn({ type: "timestamp" }) updatedAt: Date;
}
