import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany, DeleteDateColumn } from 'typeorm';
import { UsersEntity } from './Users';
import { EmployeeNote } from './EmployeeNote';
import { EmployeeChangeLog } from './EmployeeChangeLog';

export enum EmployeeDepartment {
    GUEST_RELATIONS = 'Guest Relations',
    CLIENT_RELATIONS = 'Client Relations',
    MAINTENANCE = 'Maintenance',
    ONBOARDING = 'Onboarding',
    ADMIN = 'Admin',
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

    @Column({ name: 'employee_number_seq', type: 'int', nullable: true })
    employeeNumberSeq: number;

    @Column({ name: 'department', type: 'enum', enum: EmployeeDepartment })
    department: EmployeeDepartment;

    @Column({ name: 'job_title', type: 'varchar', length: 100 })
    jobTitle: string;

    @Column({ name: 'job_type', type: 'varchar', length: 50, nullable: true })
    jobType: string | null;

    @Column({ name: 'hired_from', type: 'varchar', length: 50, nullable: true })
    hiredFrom: string | null;

    @Column({ name: 'hired_from_other', type: 'varchar', length: 100, nullable: true })
    hiredFromOther: string | null;

    @Column({ name: 'employee_type', type: 'varchar', length: 50, nullable: true })
    employeeType: string | null;

    @Column({ name: 'hourly_rate', type: 'decimal', precision: 10, scale: 2, default: 0 })
    hourlyRate: number;

    @Column({ name: 'start_date', type: 'date' })
    startDate: Date;

    @Column({ name: 'overtime_hours', type: 'decimal', precision: 10, scale: 2, default: 0 })
    overtimeHours: number;

    @Column({ name: 'bonuses', type: 'decimal', precision: 10, scale: 2, default: 0 })
    bonuses: number;

    @Column({ name: 'slack_user_id', type: 'varchar', length: 50, nullable: true })
    slackUserId: string | null;

    @Column({ name: 'preferred_name', type: 'varchar', length: 100, nullable: true })
    preferredName: string | null;

    @Column({ name: 'profile_photo', type: 'varchar', length: 500, nullable: true })
    profilePhoto: string | null;

    @Column({ name: 'phone', type: 'varchar', length: 30, nullable: true })
    phone: string | null;

    @Column({ name: 'birthday', type: 'date', nullable: true })
    birthday: Date | null;

    @Column({ name: 'country', type: 'varchar', length: 100, nullable: true })
    country: string | null;

    @Column({ name: 'schedule', type: 'varchar', length: 255, nullable: true })
    schedule: string | null;

    @Column({ name: 'slack_id', type: 'varchar', length: 100, nullable: true })
    slackId: string | null;

    @Column({ name: 'payment_method', type: 'varchar', length: 50, nullable: true })
    paymentMethod: string | null;

    @Column({ name: 'payment_method_other', type: 'varchar', length: 100, nullable: true })
    paymentMethodOther: string | null;

    @Column({ name: 'payment_schedule', type: 'varchar', length: 50, nullable: true })
    paymentSchedule: string | null;

    @Column({ name: 'payment_info', type: 'text', nullable: true })
    paymentInfo: string | null;

    @Column({ name: 'payment_day', type: 'varchar', length: 20, nullable: true })
    paymentDay: string | null;

    @Column({ name: 'payment_recurrence', type: 'varchar', length: 20, nullable: true })
    paymentRecurrence: string | null;

    @Column({ name: 'payment_start_date', type: 'date', nullable: true })
    paymentStartDate: Date | null;

    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive: boolean;

    @OneToMany(() => EmployeeNote, note => note.employee)
    notes: EmployeeNote[];

    @OneToMany(() => EmployeeChangeLog, log => log.employee)
    changeLogs: EmployeeChangeLog[];

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
