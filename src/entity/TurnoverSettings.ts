import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity('turnover_settings')
export class TurnoverSettings {
    @PrimaryColumn({ type: 'int', name: 'listing_id' })
    listingId: number;

    // Pre-stay turnover settings
    @Column({ name: 'pre_stay_contact_id', nullable: true })
    preStayContactId: number;

    @Column({ name: 'pre_stay_enabled', default: true })
    preStayEnabled: boolean;

    // Post-stay turnover settings
    @Column({ name: 'post_stay_contact_id', nullable: true })
    postStayContactId: number;

    @Column({ name: 'post_stay_enabled', default: true })
    postStayEnabled: boolean;

    // Owner info (cached from Hostify for display)
    @Column({ name: 'owner_name', nullable: true })
    ownerName: string;

    @Column({ name: 'owner_email', nullable: true })
    ownerEmail: string;

    @Column({ name: 'owner_phone', nullable: true })
    ownerPhone: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @Column({ name: 'updated_by', nullable: true })
    updatedBy: string;
}
