import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, OneToOne, JoinColumn, OneToMany } from "typeorm";
import { ReservationInfoEntity } from "./ReservationInfo";
import { ReviewCheckoutUpdates } from "./ReviewCheckoutUpdates";

@Entity('review_checkout')
export class ReviewCheckout {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    adjustedCheckoutDate: string;  // If the actual checkout date falls on a weekend then adjust it to Monday

    @Column({ nullable: true })
    sevenDaysAfterCheckout: string; // 7 days after the checkout date

    @Column({ nullable: true })
    fourteenDaysAfterCheckout: string; // 14 days after the checkout date

    @Column({ nullable: true })
    status: string;

    @Column({ type: "text", nullable: true })
    comments: string;

    @OneToMany(() => ReviewCheckoutUpdates, actionItems => actionItems.reviewCheckout)
    reviewCheckoutUpdates: ReviewCheckoutUpdates[];

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

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @DeleteDateColumn({ type: 'timestamp', nullable: true })
    deletedAt: Date;

    @Column({ nullable: true })
    deletedBy: string;

    @OneToOne(() => ReservationInfoEntity, (reservationInfo) => reservationInfo.reviewCheckout, { onDelete: "CASCADE" })
    @JoinColumn()
    reservationInfo: ReservationInfoEntity;
}