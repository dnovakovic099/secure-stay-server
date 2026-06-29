import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity('turnover_settings')
export class TurnoverSettings {
    @PrimaryColumn({ type: 'int', name: 'listing_id' })
    listingId: number;

    // Pre-stay turnover settings
    @Column({ name: 'pre_stay_contact_id', nullable: true })
    preStayContactId: number;

    @Column({ name: 'pre_stay_recipient_ids', type: 'simple-json', nullable: true })
    preStayRecipientIds: string[] | null;

    @Column({ name: 'pre_stay_default_recipient_type', type: 'varchar', length: 20, nullable: true, default: 'cleaner' })
    preStayDefaultRecipientType: string | null;

    @Column({ name: 'pre_stay_enabled', default: true })
    preStayEnabled: boolean;

    @Column({ name: 'pre_stay_enabled_override', default: false })
    preStayEnabledOverride: boolean;

    @Column({ name: 'pre_stay_message_template', type: 'text', nullable: true })
    preStayMessageTemplate: string;

    @Column({ name: 'pre_stay_schedule_mode', type: 'varchar', length: 50, nullable: true, default: 'auto' })
    preStayScheduleMode: string;

    @Column({ name: 'pre_stay_offset_minutes', type: 'int', nullable: true, default: 0 })
    preStayOffsetMinutes: number | null;

    // Post-stay turnover settings
    @Column({ name: 'post_stay_contact_id', nullable: true })
    postStayContactId: number;

    @Column({ name: 'post_stay_recipient_ids', type: 'simple-json', nullable: true })
    postStayRecipientIds: string[] | null;

    @Column({ name: 'post_stay_default_recipient_type', type: 'varchar', length: 20, nullable: true, default: 'cleaner' })
    postStayDefaultRecipientType: string | null;

    @Column({ name: 'post_stay_enabled', default: true })
    postStayEnabled: boolean;

    @Column({ name: 'post_stay_enabled_override', default: false })
    postStayEnabledOverride: boolean;

    @Column({ name: 'post_stay_message_template', type: 'text', nullable: true })
    postStayMessageTemplate: string;

    @Column({ name: 'post_stay_schedule_mode', type: 'varchar', length: 50, nullable: true, default: 'auto' })
    postStayScheduleMode: string;

    @Column({ name: 'post_stay_offset_minutes', type: 'int', nullable: true, default: 0 })
    postStayOffsetMinutes: number | null;

    @Column({ name: 'same_day_combined_enabled', default: false })
    sameDayCombinedEnabled: boolean;

    @Column({ name: 'same_day_combined_enabled_override', default: false })
    sameDayCombinedEnabledOverride: boolean;

    @Column({ name: 'same_day_combined_recipient_ids', type: 'simple-json', nullable: true })
    sameDayCombinedRecipientIds: string[] | null;

    @Column({ name: 'same_day_combined_message_template', type: 'text', nullable: true })
    sameDayCombinedMessageTemplate: string;

    @Column({ name: 'same_day_schedule_mode', type: 'varchar', length: 50, nullable: true, default: 'post-stay' })
    sameDayScheduleMode: string;

    @Column({ name: 'same_day_offset_minutes', type: 'int', nullable: true, default: 0 })
    sameDayOffsetMinutes: number | null;

    // Owner info (cached from Hostify for display)
    @Column({ name: 'owner_name', nullable: true })
    ownerName: string;

    @Column({ name: 'owner_email', nullable: true })
    ownerEmail: string;

    @Column({ name: 'owner_phone', nullable: true })
    ownerPhone: string;

    @Column({ name: 'cleaner_sender_number', nullable: true })
    cleanerSenderNumber: string;

    @Column({ name: 'cleaner_sender_number_group1', nullable: true })
    cleanerSenderNumberGroup1: string;

    @Column({ name: 'cleaner_sender_number_group2', nullable: true })
    cleanerSenderNumberGroup2: string;

    @Column({ name: 'owner_sender_number', nullable: true })
    ownerSenderNumber: string;

    @Column({ name: 'reservation_change_updates_enabled', default: true })
    reservationChangeUpdatesEnabled: boolean;

    @Column({ name: 'reservation_change_message_template', type: 'text', nullable: true })
    reservationChangeMessageTemplate: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @Column({ name: 'updated_by', nullable: true })
    updatedBy: string;
}
