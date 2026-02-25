import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Employee } from './Employee';

export enum ShiftType {
    REGULAR = 'Regular',
    OFF = 'Off',
    HOLIDAY = 'Holiday',
}

@Entity({ name: 'employee_schedules' })
@Index('idx_schedule_employee_date', ['employeeId', 'date'], { unique: true })
@Index('idx_schedule_date', ['date'])
@Index('idx_schedule_shift_type', ['shiftType'])
export class EmployeeSchedule {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'employee_id' })
    employeeId: number;

    @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    @Column({ type: 'date' })
    date: string;

    @Column({ name: 'shift_start', type: 'time' })
    shiftStart: string;

    @Column({ name: 'shift_end', type: 'time' })
    shiftEnd: string;

    @Column({ name: 'break_duration', type: 'int', nullable: true })
    breakDuration: number | null;

    @Column({ name: 'shift_type', type: 'enum', enum: ShiftType, default: ShiftType.REGULAR })
    shiftType: ShiftType;

    @Column({ type: 'text', nullable: true })
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
