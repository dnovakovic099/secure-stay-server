import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AssignedTask } from './AssignedTask';
import { UsersEntity } from './Users';

@Entity({ name: 'assigned_task_updates' })
export class AssignedTaskUpdate {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'task_id' })
    taskId: number;

    @ManyToOne(() => AssignedTask, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'task_id' })
    task: AssignedTask;

    @Column({ name: 'user_id' })
    userId: number;

    @ManyToOne(() => UsersEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: UsersEntity;

    @Column({ type: 'text' })
    content: string;

    @CreateDateColumn()
    createdAt: Date;
}
