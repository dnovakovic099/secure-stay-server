import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UsersEntity } from './Users';

@Entity({ name: 'assigned_tasks' })
export class AssignedTask {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 255 })
    title: string;

    @Column({ type: 'text', nullable: true })
    description: string;

    @Column({ type: 'varchar', length: 50, default: 'Pending' })
    status: string; // 'Pending', 'In Progress', 'Completed'

    @Column({ type: 'varchar', length: 100, nullable: true })
    taskType: string; // E.g., 'Personal', 'Client Ticket'

    @Column({ name: 'assignee_id', nullable: true })
    assigneeId: number;

    @ManyToOne(() => UsersEntity, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'assignee_id' })
    assignee: UsersEntity;

    @Column({ type: 'datetime', nullable: true })
    dueDate: Date;

    @Column({ type: 'boolean', default: false })
    isRecurring: boolean;

    @Column({ type: 'json', nullable: true })
    recurringPattern: any;
    // Example: { type: 'weekly', days: [1, 3] } or { type: 'periodically', daysAfterCompletion: 5 }

    @Column({ type: 'json', nullable: true })
    customColumnValues: any; // e.g. {"1": "High"} where "1" is TaskColumn.id

    @Column({ name: 'created_by', nullable: true })
    createdBy: number;

    @ManyToOne(() => UsersEntity, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'created_by' })
    creator: UsersEntity;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
