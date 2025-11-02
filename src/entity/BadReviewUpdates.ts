import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, DeleteDateColumn } from 'typeorm';
import { BadReviewEntity } from './BadReview';

@Entity('bad_review_updates')
export class BadReviewUpdatesEntity {
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

    @ManyToOne(() => BadReviewEntity, review => review.badReviewUpdates, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'badReviewId' })
    badReview: BadReviewEntity;
}