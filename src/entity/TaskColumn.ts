import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'task_columns' })
export class TaskColumn {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ type: 'varchar', length: 50 })
    type: string; // 'text', 'dropdown', 'date', 'number'

    @Column({ type: 'json', nullable: true })
    options: any; // For dropdown options like ["High", "Medium", "Low"]

    @Column({ type: 'boolean', default: false })
    isDefault: boolean; // Protect baseline columns from deletion/modification if needed

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
