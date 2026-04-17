import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Employee } from './Employee';

export enum EmployeeScheduleShiftType {
    REGULAR = 'Regular',
    OFF = 'Off',
    HOLIDAY = 'Holiday',
}

@Entity({ name: 'employee_schedules' })
export class EmployeeScheduleEntry {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'employee_id', type: 'int' })
    employeeId: number;

    @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    @Column({ name: 'date', type: 'date' })
    date: string;

    @Column({ name: 'shift_start', type: 'time', nullable: true })
    shiftStart: string | null;

    @Column({ name: 'shift_end', type: 'time', nullable: true })
    shiftEnd: string | null;

    @Column({ name: 'break_duration', type: 'int', nullable: true })
    breakDuration: number | null;

    @Column({ name: 'shift_type', type: 'enum', enum: EmployeeScheduleShiftType, default: EmployeeScheduleShiftType.REGULAR })
    shiftType: EmployeeScheduleShiftType;

    @Column({ name: 'notes', type: 'text', nullable: true })
    notes: string | null;

    @Column({ name: 'is_recurring', type: 'boolean', default: false })
    isRecurring: boolean;

    @Column({ name: 'recurring_day_of_week', type: 'tinyint', nullable: true })
    recurringDayOfWeek: number | null;

    @Column({ name: 'created_by', type: 'varchar', length: 255, nullable: true })
    createdBy: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
