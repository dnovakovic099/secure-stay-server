// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UsersEntity } from './Users';

@Entity({ name: 'leave_requests' })
export class LeaveRequestEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    userId: number;

    @Column({ type: 'varchar', length: 200 })
    leaveType: string;

    @Column({ type: 'date' })
    startDate: Date;

    @Column({ type: 'date' })
    endDate: Date;

    @Column({ type: 'int' })
    totalDays: number;

    @Column({ type: 'varchar', length: 1000, nullable: true })
    reason: string;

    @Column({ type: 'varchar', length: 50, default: 'pending' })
    status: string;

    @Column({ type: 'varchar', length: 20, nullable: true })
    paymentType: string | null;

    @Column({ type: 'int', nullable: true })
    actionedBy: number;

    @Column({ type: 'datetime', nullable: true })
    actionedAt: Date;

    @Column({ type: 'varchar', length: 500, nullable: true })
    adminNotes: string;

    // Cancellation tracking
    @Column({ type: 'datetime', nullable: true })
    cancellationRequestedAt: Date;

    @Column({ type: 'int', nullable: true })
    cancellationActionedBy: number;

    @Column({ type: 'datetime', nullable: true })
    cancellationActionedAt: Date;

    @Column({ type: 'varchar', length: 500, nullable: true })
    cancellationNotes: string;

    @ManyToOne(() => UsersEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: UsersEntity;

    @ManyToOne(() => UsersEntity, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'actionedBy' })
    actioner: UsersEntity;

    @ManyToOne(() => UsersEntity, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'cancellationActionedBy' })
    cancellationActioner: UsersEntity;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @DeleteDateColumn({ nullable: true })
    deletedAt: Date;
}
