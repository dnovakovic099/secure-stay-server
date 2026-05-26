import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'expense_history' })
export class ExpenseHistoryEntity {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ type: 'int' })
    expenseId: number;

    @Column({ type: 'varchar', length: 100 })
    fieldName: string;

    @Column({ type: 'text', nullable: true })
    oldValue: string | null;

    @Column({ type: 'text', nullable: true })
    newValue: string | null;

    @Column({ type: 'varchar', length: 255 })
    changedBy: string;

    @Column({ type: 'varchar', length: 50, default: 'UPDATE' })
    action: 'UPDATE' | 'DELETE';

    @CreateDateColumn({ type: 'timestamp' })
    changedAt: Date;
}
