import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type BookingPhase = 'inquiry' | 'during_stay' | 'after_stay';
export type GuestAnalysisFlagPolarity = 'positive' | 'negative';
export type GuestAnalysisTimelinePhase = 'inquiry' | 'before_stay' | 'during_stay' | 'after_stay';

/**
 * Flag type for operational issues identified in guest communication
 */
export interface GuestAnalysisFlag {
    flag: string;
    explanation: string;
    owner?: string;
    rootCause?: string;
    severity?: string;
    evidence?: string;
    evidenceAt?: string;
    polarity?: GuestAnalysisFlagPolarity;
    phases?: GuestAnalysisTimelinePhase[];
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

    @Column({ length: 32, default: 'during_stay' })
    bookingPhase: BookingPhase;

    @Column('json', { nullable: true })
    communicationIds: string[];  // IDs of communications analyzed

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
