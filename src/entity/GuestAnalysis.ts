import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Flag type for operational issues identified in guest communication
 */
export interface GuestAnalysisFlag {
    flag: string;
    explanation: string;
}

/**
 * GuestAnalysis Entity
 * Stores AI-generated analysis results for guest-host communications
 */
@Entity('guest_analysis')
export class GuestAnalysisEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    reservationId: number;

    @Column('text')
    summary: string;

    @Column({ length: 20 })
    sentiment: string;  // 'Positive' | 'Neutral' | 'Negative' | 'Mixed'

    @Column('text')
    sentimentReason: string;

    @Column('json')
    flags: GuestAnalysisFlag[];

    @Column({ type: 'datetime' })
    analyzedAt: Date;

    @Column({ length: 50, nullable: true })
    analyzedBy: string;  // 'auto' | 'manual' | user ID

    @Column('json', { nullable: true })
    communicationIds: string[];  // IDs of communications analyzed

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
