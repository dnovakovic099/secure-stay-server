import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * AIDetectedItem
 *
 * A PROPOSAL detected by the assistant from a guest message — either an Action
 * Item or a Guest Issue that we would create ourselves (instead of HostBuddy).
 *
 * DORMANT by default: nothing writes here unless item detection is switched on
 * (env AI_ITEM_DETECTION_ENABLED + settings.itemDetectionEnabled). Even when on,
 * rows here are proposals for review — they are not pushed into the live
 * action-item / issue tables until we explicitly wire that step.
 */
@Entity("ai_detected_items")
export class AIDetectedItemEntity {
    @PrimaryGeneratedColumn()
    id: number;

    // "action_item" | "guest_issue"
    @Index()
    @Column({ length: 20 })
    type: string;

    @Index()
    @Column({ type: "bigint", nullable: true })
    threadId: number | null;

    @Column({ type: "bigint", nullable: true })
    messageId: number | null;

    @Column({ type: "bigint", nullable: true })
    reservationId: number | null;

    @Column({ type: "bigint", nullable: true })
    listingId: number | null;

    @Column({ length: 255, nullable: true })
    title: string | null;

    @Column({ type: "mediumtext", nullable: true })
    description: string | null;

    @Column({ length: 120, nullable: true })
    category: string | null;

    @Column({ length: 20, nullable: true })
    priority: string | null;

    @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
    confidence: number | null;

    // proposed | approved | rejected | created
    @Index()
    @Column({ length: 20, default: "proposed" })
    status: string;

    @Column({ type: "mediumtext", nullable: true })
    payload: string | null;

    @Column({ length: 64, nullable: true })
    modelName: string | null;

    @Column({ length: 32, nullable: true })
    promptVersion: string | null;

    @Column({ type: "int", nullable: true })
    reviewedByUserId: number | null;

    // Set when the Action Items (Testing) page converts this proposal into a
    // real Issue row via POST /ai-action-items-testing/:id/convert-to-issue.
    // Used to (a) dedupe repeated Convert clicks and (b) route the UI to open
    // the existing ticket in IssueEditModal instead of creating a new one.
    @Index()
    @Column({ type: "int", nullable: true })
    convertedIssueId: number | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
