import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, PrimaryColumn } from 'typeorm';

@Entity('reviews')
export class ReviewEntity {
    @PrimaryColumn({ type: "bigint" })
    id: number;

    @Column({ nullable: true })
    reviewerName: string;

    @Column({ nullable: true })
    listingMapId: number;

    @Column({ type: "int", nullable: true })
    channelId: number;

    @Column({ nullable: true })
    channelName: string;

    @Column({ type: "int", nullable: true })
    rating: string;

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

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}