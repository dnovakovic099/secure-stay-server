import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from "typeorm";

/**
 * AIMessagingSettings
 *
 * Single global row (listingId NULL) that backs the AI Copilot "Settings" page:
 * communication tone, communication rules, topics to avoid, and the auto-respond
 * toggle. These feed InboxAIService.systemPrompt() and the auto-send guardrails,
 * letting the team steer the assistant without a redeploy.
 *
 * Env flags remain a hard safety override: AI_MESSAGING_ENABLED must be true for
 * the assistant to run at all, and if AI_MESSAGING_AUTOSEND_ENABLED is explicitly
 * "false" auto-send stays off regardless of this row.
 */
@Entity("ai_messaging_settings")
export class AIMessagingSettingsEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "bigint", nullable: true })
    listingId: number | null;

    @Column({ length: 64, nullable: true })
    tone: string | null;

    @Column({ type: "text", nullable: true })
    communicationRules: string | null;

    @Column({ type: "text", nullable: true })
    topicsToAvoid: string | null;

    // Separate rules applied ONLY when the conversation is with Airbnb Support
    // (platform case workers), which needs a very different register than guests.
    @Column({ type: "text", nullable: true })
    airbnbSupportRules: string | null;

    @Column({ type: "tinyint", default: 0 })
    autoRespondEnabled: number;

    @Column({ type: "tinyint", default: 0 })
    quoAutoRespondEnabled: number;

    @Column({ type: "int", default: 85 })
    autosendMinConfidence: number;

    @Column({ length: 255, nullable: true })
    autosendChannels: string | null;

    // Comma/newline-separated recipients for payment-emergency alert emails
    // ("guest needs to pay" on non-Airbnb reservations arriving unpaid).
    @Column({ type: "text", nullable: true })
    paymentAlertEmails: string | null;

    // ---- AI detection of our own Action Items + Guest Issues (dormant) ----
    @Column({ type: "tinyint", default: 0 })
    itemDetectionEnabled: number;

    @Column({ type: "text", nullable: true })
    actionItemRules: string | null;

    @Column({ type: "text", nullable: true })
    guestIssueRules: string | null;

    // Free-form guidance on how to improve detection/creation quality; fed into
    // the detection prompt so the team can iteratively tune it.
    @Column({ type: "text", nullable: true })
    detectionFeedback: string | null;

    @Column({ type: "int", nullable: true })
    updatedByUserId: number | null;

    @Column({ length: 255, nullable: true })
    updatedByName: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
