import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ReviewDetailEntity } from './ReviewDetail';

@Entity('removal_attempts')
export class RemovalAttemptEntity {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @ManyToOne(() => ReviewDetailEntity, reviewDetail => reviewDetail.removalAttempts, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'reviewDetailId' })
    reviewDetail: ReviewDetailEntity;

    @Column({ type: 'int' })
    reviewDetailId: number;

    @Column({ type: 'date' })
    dateAttempted: string;

    @Column({ type: 'text' })
    details: string;

    @Column({ type: 'enum', enum: ['Removed', 'Denied', 'Pending'] })
    result: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
} 