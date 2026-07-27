import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from "typeorm";

/**
 * One action IR Copilot executed on a ticket (human-confirmed or opt-in
 * automation). Written alongside the free-text `issues_updates` entry so
 * Issue Resolution Analytics can aggregate bot activity structurally.
 */
@Entity("issue_ai_actions")
export class IssueAIActionEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ type: "int" })
    issueId: number;

    @Index()
    @Column({ type: "int", nullable: true })
    suggestionId: number | null;

    @Column({ type: "int", nullable: true })
    listingId: number | null;

    /** SecureStay user who confirmed the action; null for automation. */
    @Column({ type: "int", nullable: true })
    userId: number | null;

    /**
     * guest_message | guest_sms | vendor_sms | internal_note | follow_up
     * | vendor_taught | auto_assign | auto_ack
     */
    @Index()
    @Column({ length: 32 })
    actionType: string;

    /** inbox | quo | deep_link | ticket | null */
    @Column({ length: 32, nullable: true })
    channel: string | null;

    /** executed | skipped */
    @Column({ length: 16, default: "executed" })
    status: string;

    @Column({ type: "boolean", default: false })
    automated: boolean;

    @Column({ type: "text", nullable: true })
    detail: string | null;

    @Index()
    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;
}
