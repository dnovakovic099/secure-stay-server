import { Entity, PrimaryColumn, Column, OneToOne, CreateDateColumn, UpdateDateColumn, JoinColumn, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { ReviewEntity } from './Review';
import { ReservationInfoEntity } from './ReservationInfo';
import { BadReviewUpdatesEntity } from './BadReviewUpdates';

@Entity('bad_reviews')
export class BadReviewEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: false })
    status: string;

    @Column({ nullable: false, default: false })
    isTodayActive: boolean;

    @OneToOne(() => ReservationInfoEntity, (reservationInfo) => reservationInfo.reviewCheckout, { onDelete: "CASCADE" })
    @JoinColumn()
    reservationInfo: ReservationInfoEntity; @OneToOne(() => ReviewEntity, review => review.reviewDetail, { onDelete: 'CASCADE' })

    @OneToMany(() => BadReviewUpdatesEntity, data => data.badReview, { onDelete: 'CASCADE' })
    badReviewUpdates: BadReviewUpdatesEntity[];

    @Column({ nullable: true, default: false })
    isActive: boolean;

    @Column({ nullable: true })
    assignee: string;

    @Column({ nullable: true })
    urgency: number;

    @Column({ nullable: true })
    mistake: string;

    @Column({ nullable: true })
    mistakeResolvedOn: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}