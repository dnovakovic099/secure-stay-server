import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, DeleteDateColumn } from 'typeorm';
import { ClientTicket } from './ClientTicket';
import { ActionItems } from './ActionItems';
import { ReviewCheckout } from './ReviewCheckout';

@Entity('review_checkout_updates')
export class ReviewCheckoutUpdates {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ type: "text", nullable: true })
    updates: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @DeleteDateColumn({ type: 'timestamp', nullable: true })
    deletedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ nullable: true })
    deletedBy: string;

    @ManyToOne(() => ReviewCheckout, reviewCheckout => reviewCheckout.reviewCheckoutUpdates, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'reviewCheckoutId' })
    reviewCheckout: ReviewCheckout;
}