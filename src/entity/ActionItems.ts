import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, OneToMany, ManyToOne, JoinColumn, Index } from 'typeorm';
import { ActionItemsUpdates } from './ActionItemsUpdates';
import { ReservationInfoEntity } from './ReservationInfo';

@Entity('action_items')
@Index('IDX_action_items_listing_status', ['listingId', 'status'])
@Index('IDX_action_items_createdAt', ['createdAt'])
@Index('IDX_action_items_category', ['category'])
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

    @ManyToOne(() => ReservationInfoEntity)
    @JoinColumn({ name: 'reservationId' })
    reservation: ReservationInfoEntity;

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

    @Column({ nullable: true })
    completedOn: string;

    @Column({ nullable: true })
    assignee: string;

    @Column({ nullable: true })
    urgency: number;

    @Column({ nullable: true })
    mistake: string;

    @Column({ nullable: true })
    mistakeResolvedOn: string;
}