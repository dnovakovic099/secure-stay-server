import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { ReviewDetailOldLogs } from './ReviewDetailOldLogs';
import { ReviewEntity } from './Review';
import { RemovalAttemptEntity } from './RemovalAttempt';

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
    claimResolutionStatus: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    resolutionAmount: number;

    @Column({ nullable: true })
    resolutionDateRequested: string;

    @Column({ nullable: true })
    expenseId: number;

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

    @OneToMany(() => RemovalAttemptEntity, removalAttempt => removalAttempt.reviewDetail)
    removalAttempts: RemovalAttemptEntity[];
}
