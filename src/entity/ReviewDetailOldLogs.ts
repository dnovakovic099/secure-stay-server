import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ReviewDetailEntity } from './ReviewDetail';

@Entity('review_detail_old_logs')
export class ReviewDetailOldLogs {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @OneToOne(() => ReviewDetailEntity, reviewDetail => reviewDetail.oldLog, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'reviewDetailId' })
    reviewDetail: ReviewDetailEntity;

    @Column({ type: 'bigint', nullable: false })
    reviewDetailId: number;  // Foreign key to ReviewDetailEntity

    @Column({ nullable: true })
    guestPhone: string;

    @Column({ nullable: true })
    guestEmail: string;

    @Column({ nullable: true })
    bookingAmount: number;

    @Column({ nullable: true })
    date: string;

    @Column({ nullable: true })
    firstContactDate: string;
    
    @Column({ nullable: true })
    lastContactDate: string;

    @Column({ type: "text", nullable: true })
    methodsTried: string;

    @Column({ type: "text", nullable: true })
    methodsLeft: string;

    @Column({ type: "text", nullable: true })
    notes: string;

    @Column({ nullable: true })
    claimResolutionStatus: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @Column({ nullable: true })
    whoUpdated: string;
}
