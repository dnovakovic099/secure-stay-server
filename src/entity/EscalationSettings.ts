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
