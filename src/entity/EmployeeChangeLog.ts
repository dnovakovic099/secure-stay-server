import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Employee } from './Employee';
import { UsersEntity } from './Users';

@Entity({ name: 'employee_change_logs' })
export class EmployeeChangeLog {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'employee_id' })
    employeeId: number;

    @ManyToOne(() => Employee, employee => employee.changeLogs, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    @Column({ name: 'field_name', type: 'varchar', length: 100 })
    fieldName: string;

    @Column({ name: 'old_value', type: 'text', nullable: true })
    oldValue: string | null;

    @Column({ name: 'new_value', type: 'text', nullable: true })
    newValue: string | null;

    @Column({ name: 'changed_by', nullable: true })
    changedBy: number | null;

    @ManyToOne(() => UsersEntity, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'changed_by' })
    changedByUser: UsersEntity;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
