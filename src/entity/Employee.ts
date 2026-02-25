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

    @Column({ name: 'slack_user_id', type: 'varchar', length: 50, nullable: true })
    slackUserId: string | null;

    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive: boolean;

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
