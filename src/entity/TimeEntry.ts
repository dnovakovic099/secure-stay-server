// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UsersEntity } from './Users';

@Entity({ name: 'time_entries' })
export class TimeEntryEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    userId: number;

    @Column({ type: 'datetime' })
    clockInAt: Date;

    @Column({ type: 'datetime', nullable: true })
    clockOutAt: Date;

    @Column({ type: 'int', nullable: true })
    duration: number; // Duration in seconds (actual raw duration)

    @Column({ type: 'int', nullable: true })
    computedDuration: number; // Duration in seconds after rounding/capping rules

    @Column({ type: 'boolean', default: false })
    isMissedClockout: boolean; // True if entry was auto-capped due to >12hrs

    @Column({ type: 'boolean', default: false })
    hasOvertimeRequest: boolean; // True if overtime request was created for this entry

    @Column({ type: 'varchar', length: 500, nullable: true })
    notes: string;

    @Column({ type: 'enum', enum: ['active', 'completed'], default: 'active' })
    status: 'active' | 'completed';

    @ManyToOne(() => UsersEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: UsersEntity;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @DeleteDateColumn({ nullable: true })
    deletedAt: Date;

    @Column({ type: 'int', nullable: true })
    deletedBy: number;
}


