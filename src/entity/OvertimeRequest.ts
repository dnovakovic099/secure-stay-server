// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { TimeEntryEntity } from './TimeEntry';
import { UsersEntity } from './Users';

@Entity({ name: 'overtime_requests' })
export class OvertimeRequestEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    timeEntryId: number;

    @Column()
    userId: number;

    @Column({ type: 'int' })
    actualDurationSeconds: number;  // Raw logged duration

    @Column({ type: 'int' })
    cappedDurationSeconds: number;  // Duration after applying cap

    @Column({ type: 'int' })
    overtimeSeconds: number;  // Difference (overtime portion)

    @Column({ type: 'enum', enum: ['pending', 'approved', 'rejected'], default: 'pending' })
    status: 'pending' | 'approved' | 'rejected';

    @Column({ type: 'int', nullable: true })
    approvedBy: number;  // Admin who approved/rejected

    @Column({ type: 'datetime', nullable: true })
    approvedAt: Date;

    @Column({ type: 'varchar', length: 500, nullable: true })
    notes: string;

    @ManyToOne(() => TimeEntryEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'timeEntryId' })
    timeEntry: TimeEntryEntity;

    @ManyToOne(() => UsersEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: UsersEntity;

    @ManyToOne(() => UsersEntity, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'approvedBy' })
    approver: UsersEntity;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
