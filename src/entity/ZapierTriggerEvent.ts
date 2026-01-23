import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * ZapierTriggerEvent Entity
 * Stores incoming Zapier webhook trigger events for auditing and tracking purposes.
 * Handles various event types like low_battery, pending_reservation, reservation_change, bdc_listing_question, etc.
 */
@Entity('zapier_trigger_events')
export class ZapierTriggerEvent {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ type: 'varchar', length: 50, default: 'New' })
    status: string;  // 'New' | 'In Progress' | 'Completed'

    @Index()
    @Column({ type: 'varchar', length: 100 })
    event: string;  // Event type from webhook (e.g., 'low_battery', 'reservation_change')

    @Column({ name: 'bot_name', type: 'varchar', length: 255 })
    botName: string;  // Bot name from webhook

    @Column({ name: 'bot_icon', type: 'text', nullable: true })
    botIcon: string;  // Bot icon URL from webhook

    @Column({ type: 'varchar', length: 255, nullable: true })
    title: string;  // Title field (present in some events)

    @Column({ type: 'text' })
    message: string;  // Message content from webhook

    @Column({ name: 'slack_channel', type: 'varchar', length: 100, nullable: true })
    slackChannel: string;  // Target Slack channel

    @Column({ name: 'email_subject', type: 'varchar', length: 500, nullable: true })
    emailSubject: string;  // Email subject (for email-related events)

    @Column({ name: 'email_body_plain', type: 'mediumtext', nullable: true })
    emailBodyPlain: string;  // Plain text email body

    @Column({ name: 'email_body_html', type: 'mediumtext', nullable: true })
    emailBodyHtml: string;  // HTML email body (can be very large)

    @Column({ name: 'processed_message', type: 'mediumtext', nullable: true })
    processedMessage: string; // Sanitized and normalized content (no noise/replies)

    @Column({ name: 'raw_payload', type: 'mediumtext' })
    rawPayload: string;  // Complete raw JSON payload for debugging

    @Column({ name: 'completed_on', type: 'datetime', nullable: true })
    completedOn: Date;  // When the event was fully processed

    @Column({ name: 'error_message', type: 'text', nullable: true })
    errorMessage: string;  // Error details if processing failed

    @Index()
    @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
    updatedAt: Date;

    @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true })
    createdBy: string;  // User/system that created the record

    @Column({ name: 'updated_by', type: 'varchar', length: 100, nullable: true })
    updatedBy: string;  // User/system that last updated the record
}
