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
    duration: number; // Duration in seconds

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


