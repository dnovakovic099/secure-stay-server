import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany, DeleteDateColumn } from 'typeorm';
import { UsersEntity } from './Users';
import { EmployeeNote } from './EmployeeNote';

export enum EmployeeDepartment {
    GUEST_RELATIONS = 'Guest Relations',
    CLIENT_RELATIONS = 'Client Relations',
    MAINTENANCE = 'Maintenance',
    ONBOARDING = 'Onboarding',
    ADMIN = 'Admin',
}

export enum PaymentMethod {
    WISE = 'Wise',
    ACH = 'ACH',
    OTHER = 'Other',
}

export enum PaymentSchedule {
    BATCH_A = 'Batch A',
    BATCH_B = 'Batch B',
}

@Entity({ name: 'employees' })
export class Employee {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'user_id', unique: true })
    userId: number;

    @ManyToOne(() => UsersEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: UsersEntity;

    @Column({ name: 'employee_number', type: 'varchar', length: 20, unique: true, nullable: true })
    employeeNumber: string;

    // Numeric part of employee number for proper sorting
    @Column({ name: 'employee_number_seq', type: 'int', nullable: true })
    employeeNumberSeq: number;

    @Column({ name: 'department', type: 'enum', enum: EmployeeDepartment })
    department: EmployeeDepartment;

    @Column({ name: 'job_title', type: 'varchar', length: 100 })
    jobTitle: string;

    @Column({ name: 'hourly_rate', type: 'decimal', precision: 10, scale: 2, default: 0 })
    hourlyRate: number;

    @Column({ name: 'start_date', type: 'date' })
    startDate: Date;

    @Column({ name: 'overtime_hours', type: 'decimal', precision: 10, scale: 2, default: 0 })
    overtimeHours: number;

    @Column({ name: 'bonuses', type: 'decimal', precision: 10, scale: 2, default: 0 })
    bonuses: number;

    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive: boolean;

    // New fields for personal info
    @Column({ name: 'phone', type: 'varchar', length: 50, nullable: true })
    phone: string;

    @Column({ name: 'birthday', type: 'date', nullable: true })
    birthday: Date;

    // Schedule
    @Column({ name: 'schedule', type: 'varchar', length: 100, nullable: true })
    schedule: string;

    // Slack account
    @Column({ name: 'slack_id', type: 'varchar', length: 100, nullable: true })
    slackId: string;

    // Payroll fields
    @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod, nullable: true })
    paymentMethod: PaymentMethod;

    @Column({ name: 'payment_method_other', type: 'varchar', length: 100, nullable: true })
    paymentMethodOther: string;

    @Column({ name: 'payment_schedule', type: 'enum', enum: PaymentSchedule, nullable: true })
    paymentSchedule: PaymentSchedule;

    @Column({ name: 'payment_info', type: 'text', nullable: true })
    paymentInfo: string;

    @OneToMany(() => EmployeeNote, note => note.employee)
    notes: EmployeeNote[];

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @DeleteDateColumn({ name: 'deleted_at', nullable: true })
    deletedAt: Date;

    @Column({ name: 'created_by', nullable: true })
    createdBy: number;

    @ManyToOne(() => UsersEntity, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'created_by' })
    creator: UsersEntity;
}
