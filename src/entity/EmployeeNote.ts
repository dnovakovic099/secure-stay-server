import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Employee } from './Employee';
import { UsersEntity } from './Users';

@Entity({ name: 'employee_notes' })
export class EmployeeNote {
    @PrimaryGeneratedColumn()
    id: number;

    // Link to employee
    @Column({ name: 'employee_id' })
    employeeId: number;

    @ManyToOne(() => Employee, employee => employee.notes, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    // Note content
    @Column({ type: 'text' })
    content: string;

    // Added by (user who created the note)
    @Column({ name: 'added_by' })
    addedBy: number;

    @ManyToOne(() => UsersEntity, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'added_by' })
    addedByUser: UsersEntity;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
