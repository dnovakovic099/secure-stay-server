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
