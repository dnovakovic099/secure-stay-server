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
    reviewDetailId: number;

    @Column({ nullable: true })
    guestPhone: string;

    @Column({ nullable: true })
    guestEmail: string;

    @Column({ nullable: true })
    bookingAmount: number;

    @Column({ nullable: true })
    date: string;

    @Column({ nullable: true })
    claimResolutionStatus: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    resolutionAmount: number;

    @Column({ nullable: true })
    resolutionDateRequested: string;

    @Column({ nullable: true })
    expenseId: number;

    @Column({ nullable: true })
    resolutionId: number;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @Column({ nullable: true })
    whoUpdated: string;
}
