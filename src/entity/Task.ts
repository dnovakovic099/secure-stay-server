import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from "typeorm";

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

    @Column({ type: "boolean", default: false })
    add_to_post_stay: boolean;

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

    @DeleteDateColumn({ type: 'timestamp', nullable: true })
    deletedAt: Date;

    @Column({ nullable: true })
    deleted_by: string;
}