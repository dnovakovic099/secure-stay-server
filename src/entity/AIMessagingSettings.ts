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

    // Per-topic communication rules (JSON: [{ id, topic, rule, appliesTo }]).
    // Preferred over the free-text `communicationRules` column: giving each rule
    // its own topic keeps them digestible and lets the prompt inject only the
    // rules relevant to the current guest message.
    @Column({ type: "mediumtext", nullable: true })
    communicationRuleEntries: string | null;

    @Column({ type: "text", nullable: true })
    topicsToAvoid: string | null;

    // Capability limits — a short spec of what the assistant is allowed to do vs
    // what it must refuse/escalate. Fed into the prompt AND used by the teach
    // capability-check to reject learned instructions the AI can't actually
    // execute (e.g. "recommend nearby available properties").
    @Column({ type: "text", nullable: true })
    capabilityLimits: string | null;

    // Topics (slugs) where the assistant must always source its answer from the
    // live listing/reservation data instead of a learned fact — protects against
    // stale learned info once the underlying property/reservation changes.
    @Column({ type: "text", nullable: true })
    useListingDataForTopics: string | null;

    // Separate rules applied ONLY when the conversation is with Airbnb Support
    // (platform case workers), which needs a very different register than guests.
    @Column({ type: "text", nullable: true })
    airbnbSupportRules: string | null;

    // Prompt/rule overrides for guest-reply drafting. NULL means use the
    // compiled default rule block so existing behavior is preserved.
    @Column({ type: "mediumtext", nullable: true })
    baseReplyStyleRules: string | null;

    @Column({ type: "mediumtext", nullable: true })
    airbnbSupportBaseRules: string | null;

    @Column({ type: "mediumtext", nullable: true })
    inquirySalesBaseRules: string | null;

    @Column({ type: "mediumtext", nullable: true })
    selfServiceTroubleshootingRules: string | null;

    @Column({ type: "mediumtext", nullable: true })
    quoSmsRules: string | null;

    @Column({ type: "mediumtext", nullable: true })
    quoPmClientRules: string | null;

    @Column({ type: "mediumtext", nullable: true })
    quoUnlinkedThreadRules: string | null;

    @Column({ type: "tinyint", default: 0 })
    autoRespondEnabled: number;

    @Column({ type: "tinyint", default: 0 })
    quoAutoRespondEnabled: number;

    @Column({ type: "int", default: 85 })
    autosendMinConfidence: number;

    @Column({ length: 255, nullable: true })
    autosendChannels: string | null;

    // ---- Confidence-tiered automation ----
    // When enabled, auto-send runs in three tiers instead of one binary gate:
    //  * >= autosendInstantMinConfidence  -> send immediately
    //  * >= autosendDelayedMinConfidence  -> queue for autosendDelayMinutes,
    //    visible in the inbox; a human can veto before it goes out
    //  * below                            -> draft only (human sends)
    @Column({ type: "tinyint", default: 0 })
    autosendTierEnabled: number;

    @Column({ type: "int", default: 95 })
    autosendInstantMinConfidence: number;

    @Column({ type: "int", default: 85 })
    autosendDelayedMinConfidence: number;

    @Column({ type: "int", default: 5 })
    autosendDelayMinutes: number;

    // ---- Inquiry sales mode ----
    // Extra prompt rules applied only to pre-booking inquiry conversations.
    @Column({ type: "text", nullable: true })
    inquirySalesRules: string | null;

    // Allow auto-send for inquiry (pre-booking) threads. Inquiries are
    // revenue-critical and speed-to-first-response matters on the platforms,
    // but they're also sales conversations — so this is a separate opt-in on
    // top of the regular auto-respond toggle.
    @Column({ type: "tinyint", default: 0 })
    inquiryAutoRespondEnabled: number;

    // ---- Guest self-service troubleshooting ----
    // When ON, the assistant walks guests through documented fixes (router
    // restart, breaker location, lock steps) step-by-step BEFORE the team
    // dispatches anyone — deflecting the tickets that are really a 2-minute
    // guest-side fix. OFF returns to plain acknowledge-and-escalate behavior.
    @Column({ type: "tinyint", default: 0 })
    selfServiceTroubleshootingEnabled: number;

    /**
     * How the AI handles early check-in asks:
     * defer_to_team | deny | quote_fee_and_defer | accept_with_fee
     */
    @Column({ length: 32, default: "defer_to_team" })
    earlyCheckinHandling: string;

    /**
     * How the AI handles late check-out asks:
     * defer_to_team | deny | quote_fee_and_defer | accept_with_fee
     */
    @Column({ length: 32, default: "defer_to_team" })
    lateCheckoutHandling: string;

    // Comma/newline-separated recipients for payment-emergency alert emails
    // ("guest needs to pay" on non-Airbnb reservations arriving unpaid).
    @Column({ type: "text", nullable: true })
    paymentAlertEmails: string | null;

    // Comma/newline-separated recipients for the Ops Radar morning digest
    // (open critical/high alerts after the daily deep scan). Empty = no email.
    @Column({ type: "text", nullable: true })
    opsAlertEmails: string | null;

    // ---- AI detection of our own Action Items + Guest Issues (dormant) ----
    @Column({ type: "tinyint", default: 0 })
    itemDetectionEnabled: number;

    @Column({ type: "text", nullable: true })
    actionItemRules: string | null;

    // Managed action-item categories (JSON: [{ id, name, description, examples,
    // autoCreate }]). Gives the team full control over which categories the
    // detector may propose and the rules that guide each one.
    @Column({ type: "mediumtext", nullable: true })
    actionItemCategories: string | null;

    @Column({ type: "text", nullable: true })
    guestIssueRules: string | null;

    // Managed guest-issue categories (JSON, same shape as actionItemCategories).
    @Column({ type: "mediumtext", nullable: true })
    guestIssueCategories: string | null;

    // Unified ticket categories: SecureStay now handles GR and Maintenance in
    // one hybrid workflow, so a single category list feeds both detectors.
    // When populated this is the authoritative list; the legacy split columns
    // above are kept as a rollback safety net and are no longer written to.
    @Column({ type: "mediumtext", nullable: true })
    ticketCategories: string | null;

    // Free-form guidance on how to improve detection/creation quality; fed into
    // the detection prompt so the team can iteratively tune it.
    @Column({ type: "text", nullable: true })
    detectionFeedback: string | null;

    // ---- Rescue Copilot ----
    // When ON, Inbox V2 surfaces a rescue pack for upset / review-risk stays
    // and blocks AI auto-send while rescue is active. Default ON.
    @Column({ type: "tinyint", default: 1 })
    rescueCopilotEnabled: number;

    // ---- Inbox V2 proposed actions ----
    // Human-approved operation cards shown inside Inbox V2 when a guest message
    // looks like an early check-in, late checkout, access-code, or ops request.
    @Column({ type: "tinyint", default: 1 })
    proposedActionsEnabled: number;

    @Column({ type: "text", nullable: true })
    proposedActionInstructions: string | null;

    @Column({ type: "text", nullable: true })
    proposedActionApproveInstructions: string | null;

    @Column({ type: "text", nullable: true })
    proposedActionApproveSendInstructions: string | null;

    // ---- Admin-editable ticket-creation instructions ----
    // Previously hardcoded inside each detector service; surfaced here so SS
    // admins can iterate without a redeploy. NULL => fall back to the compiled
    // defaults in AIDetectorInstructions.ts (identical to the pre-migration
    // hardcoded strings, so seeding is a no-op behavior-wise).
    @Column({ type: "text", nullable: true })
    detectorSystemPersona: string | null;

    @Column({ type: "text", nullable: true })
    detectionExclusionRules: string | null;

    // 0.00–1.00; the detector omits proposals scoring below this.
    @Column({ type: "decimal", precision: 3, scale: 2, nullable: true })
    detectionConfidenceFloor: string | null;

    @Column({ type: "text", nullable: true })
    quoDetectorSystemPrompt: string | null;

    @Column({ type: "text", nullable: true })
    betaDetectorSystemPrompt: string | null;

    // Separate audit trail for the admin-only instruction edits so we can tell
    // who last touched a hard prompt vs who tweaked a regular category.
    @Column({ type: "timestamp", nullable: true })
    instructionsUpdatedAt: Date | null;

    @Column({ length: 255, nullable: true })
    instructionsUpdatedByName: string | null;

    @Column({ type: "int", nullable: true })
    updatedByUserId: number | null;

    @Column({ length: 255, nullable: true })
    updatedByName: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
