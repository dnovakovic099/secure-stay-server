import { Entity, PrimaryColumn, Column, OneToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ReviewDetailEntity } from './ReviewDetail';

@Entity('reviews')
export class ReviewEntity {
    @PrimaryColumn({ type: "varchar", length: 255,  unique: true })
    id: string;

    @Column({ nullable: true })
    reviewerName: string;

    @Column({ nullable: true })
    listingMapId: number;

    @Column({ type: "int", nullable: true })
    channelId: number;

    @Column({ nullable: true })
    channelName: string;

    @Column({ type: "int", nullable: true })
    rating: number;

    @Column({ nullable: true })
    externalReservationId: string;

    @Column({ type: 'text', nullable: true })
    publicReview: string;

    @Column({ nullable: true })
    submittedAt: string;

    @Column({ nullable: true })
    arrivalDate: string;

    @Column({ nullable: true })
    departureDate: string;

    @Column({ nullable: true })
    listingName: string;

    @Column({ nullable: true })
    externalListingName: string;

    @Column({ nullable: true })
    guestName: string;

    @Column({ type: "tinyint" })
    isHidden: number;

    @Column({ nullable: true })
    bookingAmount: number;

    @Column({ type: "bigint", nullable: true })
    reservationId: number;

    @OneToOne(() => ReviewDetailEntity, reviewDetail => reviewDetail.review, { cascade: true })
    reviewDetail: ReviewDetailEntity;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}