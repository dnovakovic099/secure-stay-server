import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ReviewDetailOldLogs } from './ReviewDetailOldLogs';
import { ReviewEntity } from './Review';

@Entity('review_details')
export class ReviewDetailEntity {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @OneToOne(() => ReviewEntity, review => review.reviewDetail, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'reviewId' })  // This makes `reviewId` a foreign key
    review: ReviewEntity;

    @Column({ type: "varchar", length: 255, unique: true })
    reviewId: string;  // Foreign key referencing `ReviewEntity.id`

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
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ nullable: true })
    whoUpdated: string;

    // Optional One-to-One relationship with ReviewDetailOldLogs
    @OneToOne(() => ReviewDetailOldLogs, oldLog => oldLog.reviewDetail, { nullable: true })
    oldLog: ReviewDetailOldLogs;
}
