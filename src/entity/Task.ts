import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity('tasks')
export class Task {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    status: string;

    @Column()
    listing_id: string;

    @Column()
    assignee_id: string;

    @Column({ type: 'text' })
    task: string;

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updated_at: Date;

    @Column({ nullable: true })
    created_by: string;

    @Column({ nullable: true })
    updated_by: string;

    @Column({ type: 'datetime', nullable: true })
    completed_at: Date;

    @Column({ nullable: true })
    completed_by: string;
}