import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, OneToMany } from 'typeorm';
import { ActionItemsUpdates } from './ActionItemsUpdates';

@Entity('action_items')
export class ActionItems {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ nullable: true })
    listingName: string;

    @Column({ nullable: true })
    listingId: number;

    @Column({ nullable: true })
    guestName: string;

    @Column({ nullable: true })
    reservationId: number;

    @Column({ type: "text", nullable: true })
    item: string;

    @Column({ nullable: true })
    category: string;

    @Column({ nullable: true })
    status: string;

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

    @OneToMany(() => ActionItemsUpdates, actionItems => actionItems.actionItems)
    actionItemsUpdates: ActionItemsUpdates[];
}