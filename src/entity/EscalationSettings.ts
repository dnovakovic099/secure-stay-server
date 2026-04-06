import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UsersEntity } from './Users';

/**
 * Stores escalation/reminder settings for GR Tasks.
 * These settings control how and when reminders are sent for overdue tasks.
 */
@Entity({ name: 'escalation_settings' })
export class EscalationSettings {
    @PrimaryGeneratedColumn()
    id: number;

    /**
     * Unique key for the setting (e.g., 'default', 'all-channel-support-messages')
     * 'default' applies to all channels unless overridden
     */
    @Column({ name: 'setting_key', type: 'varchar', length: 100, unique: true })
    settingKey: string;

    /**
     * Display name for the setting
     */
    @Column({ name: 'display_name', type: 'varchar', length: 255, nullable: true })
    displayName: string | null;

    /**
     * Slack channel name this setting applies to (nullable = applies to all)
     */
    @Column({ name: 'slack_channel', type: 'varchar', length: 100, nullable: true })
    slackChannel: string | null;

    /**
     * Event type this setting applies to (nullable = applies to all events)
     */
    @Column({ name: 'event_type', type: 'varchar', length: 100, nullable: true })
    eventType: string | null;

    /**
     * Hours before a task is considered overdue (default: 4)
     */
    @Column({ name: 'overdue_threshold_hours', type: 'int', default: 4 })
    overdueThresholdHours: number;

    /**
     * Hours between reminder messages (default: 1)
     */
    @Column({ name: 'reminder_interval_hours', type: 'int', default: 1 })
    reminderIntervalHours: number;

    /**
     * Time for daily check-in reminder (format: "HH:MM", e.g., "10:00")
     * Uses America/New_York timezone
     */
    @Column({ name: 'daily_reminder_time', type: 'varchar', length: 10, default: '10:00' })
    dailyReminderTime: string;

    /**
     * Primary employee ID to tag when on shift (nullable = use group)
     * If set, this employee will be tagged when they are on shift
     */
    @Column({ name: 'primary_employee_id', type: 'int', nullable: true })
    primaryEmployeeId: number | null;

    /**
     * Slack user group ID to tag when primary employee not available
     * Default: S09AUHMA6HE (Guest Relations)
     */
    @Column({ name: 'fallback_slack_group_id', type: 'varchar', length: 50, default: 'S09AUHMA6HE' })
    fallbackSlackGroupId: string;

    /**
     * Whether to check employee schedule before tagging primary
     * If true, checks if primary employee is on shift
     * If false, always tags primary employee when set
     */
    @Column({ name: 'check_shift_schedule', type: 'boolean', default: true })
    checkShiftSchedule: boolean;

    /**
     * Whether this setting is active
     */
    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive: boolean;

    /**
     * Whether AI-powered escalation is enabled for this setting
     */
    @Column({ name: 'ai_enabled', type: 'boolean', default: true })
    aiEnabled: boolean;

    /**
     * Custom instructions for the AI manager (optional)
     * E.g., "Be more lenient with first-time issues" or "Escalate immediately for VIP guests"
     */
    @Column({ name: 'ai_instructions', type: 'text', nullable: true })
    aiInstructions: string | null;

    /**
     * AI behavior mode: 'standard' | 'strict' | 'lenient'
     * - standard: balanced approach
     * - strict: push back more, shorter deadlines
     * - lenient: more understanding, longer grace periods
     */
    @Column({ name: 'ai_mode', type: 'varchar', length: 20, default: 'standard' })
    aiMode: string;

    @Column({ name: 'read_slack_replies', type: 'boolean', default: true })
    readSlackReplies: boolean;

    @Column({ name: 'use_conversation_context', type: 'boolean', default: true })
    useConversationContext: boolean;

    @Column({ name: 'reply_when_tagged', type: 'boolean', default: true })
    replyWhenTagged: boolean;

    @Column({ name: 'count_acknowledgment_as_activity', type: 'boolean', default: true })
    countAcknowledgmentAsActivity: boolean;

    @Column({ name: 'require_actionable_responses', type: 'boolean', default: false })
    requireActionableResponses: boolean;

    @Column({ name: 'use_ai_for_decisions', type: 'boolean', default: true })
    useAIForDecisions: boolean;

    @Column({ name: 'min_follow_up_minutes', type: 'int', default: 30 })
    minFollowUpMinutes: number;

    @Column({ name: 'max_follow_up_minutes', type: 'int', default: 480 })
    maxFollowUpMinutes: number;

    @Column({ name: 'allow_ai_adjust_timing', type: 'boolean', default: true })
    allowAIAdjustTiming: boolean;

    @Column({ name: 'urgency_overrides_timing', type: 'boolean', default: true })
    urgencyOverridesTiming: boolean;

    @Column({ name: 'evaluate_acknowledgment', type: 'boolean', default: true })
    evaluateAcknowledgment: boolean;

    @Column({ name: 'evaluate_vague_reply', type: 'boolean', default: true })
    evaluateVagueReply: boolean;

    @Column({ name: 'evaluate_eta', type: 'boolean', default: true })
    evaluateEta: boolean;

    @Column({ name: 'evaluate_actionable_update', type: 'boolean', default: true })
    evaluateActionableUpdate: boolean;

    @Column({ name: 'evaluate_completion', type: 'boolean', default: true })
    evaluateCompletion: boolean;

    @Column({ name: 'enable_completion_review', type: 'boolean', default: true })
    enableCompletionReview: boolean;

    @Column({ name: 'require_clear_resolution', type: 'boolean', default: true })
    requireClearResolution: boolean;

    @Column({ name: 'ask_for_missing_details', type: 'boolean', default: true })
    askForMissingDetails: boolean;

    @Column({ name: 'escalate_weak_completion', type: 'boolean', default: false })
    escalateWeakCompletion: boolean;

    @Column({ name: 'suppress_generic_messages', type: 'boolean', default: true })
    suppressGenericMessages: boolean;

    @Column({ name: 'allow_positive_reinforcement', type: 'boolean', default: true })
    allowPositiveReinforcement: boolean;

    @Column({ name: 'manager_tag_serious', type: 'varchar', length: 50, nullable: true })
    managerTagSerious: string | null;

    @Column({ name: 'manager_tag_neglect', type: 'varchar', length: 50, nullable: true })
    managerTagNeglect: string | null;

    @Column({ name: 'manager_tag_bad_completion', type: 'varchar', length: 50, nullable: true })
    managerTagBadCompletion: string | null;

    @Column({ name: 'neglect_threshold', type: 'int', default: 2 })
    neglectThreshold: number;

    @Column({ name: 'immediate_escalation', type: 'boolean', default: false })
    immediateEscalation: boolean;

    @Column({ name: 'vague_reply_escalation', type: 'boolean', default: false })
    vagueReplyEscalation: boolean;

    @Column({ name: 'only_follow_up_on_shift', type: 'boolean', default: false })
    onlyFollowUpOnShift: boolean;

    @Column({ name: 'delay_if_off_shift', type: 'boolean', default: true })
    delayIfOffShift: boolean;

    @Column({ name: 'escalate_urgent_off_shift', type: 'boolean', default: true })
    escalateUrgentOffShift: boolean;

    @Column({ name: 'fallback_timing_minutes', type: 'int', default: 60 })
    fallbackTimingMinutes: number;

    @Column({ name: 'tone_style', type: 'varchar', length: 50, default: 'supportive_firm' })
    toneStyle: string;

    @Column({ name: 'encourage_clarity', type: 'boolean', default: true })
    encourageClarity: boolean;

    @Column({ name: 'push_for_next_steps', type: 'boolean', default: true })
    pushForNextSteps: boolean;

    @Column({ name: 'avoid_filler_messages', type: 'boolean', default: true })
    avoidFillerMessages: boolean;

    /**
     * User who last updated this setting
     */
    @Column({ name: 'updated_by', nullable: true })
    updatedBy: number | null;

    @ManyToOne(() => UsersEntity, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'updated_by' })
    updatedByUser: UsersEntity;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
