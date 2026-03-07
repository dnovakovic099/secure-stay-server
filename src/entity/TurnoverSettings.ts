import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity('turnover_settings')
export class TurnoverSettings {
    @PrimaryColumn({ type: 'int' })
    listingId: number;

    // Pre-stay turnover settings
    @Column({ nullable: true })
    preStayContactId: number;

    @Column({ default: true })
    preStayEnabled: boolean;

    // Post-stay turnover settings
    @Column({ nullable: true })
    postStayContactId: number;

    @Column({ default: true })
    postStayEnabled: boolean;

    // Owner info (cached from Hostify for display)
    @Column({ nullable: true })
    ownerName: string;

    @Column({ nullable: true })
    ownerEmail: string;

    @Column({ nullable: true })
    ownerPhone: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ nullable: true })
    updatedBy: string;
}
