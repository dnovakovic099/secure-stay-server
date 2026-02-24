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

    // Link to SecureStay user (required)
    @Column({ name: 'user_id', unique: true })
    userId: number;

    @ManyToOne(() => UsersEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: UsersEntity;

    // Employee number (LL-001, LL-002, etc.) - generated based on start date order
    @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
    employeeNumber: string;

    // Department
    @Column({ type: 'enum', enum: EmployeeDepartment })
    department: EmployeeDepartment;

    // Job title
    @Column({ type: 'varchar', length: 100 })
    jobTitle: string;

    // Hourly rate
    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    hourlyRate: number;

    // Start date (used for employee number ordering)
    @Column({ type: 'date' })
    startDate: Date;

    // Overtime hours (for payroll)
    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    overtimeHours: number;

    // Bonuses (for payroll)
    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    bonuses: number;

    // Status
    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    // Internal notes relationship
    @OneToMany(() => EmployeeNote, note => note.employee)
    notes: EmployeeNote[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @DeleteDateColumn({ nullable: true })
    deletedAt: Date;

    @Column({ name: 'created_by', nullable: true })
    createdBy: number;

    @ManyToOne(() => UsersEntity, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'created_by' })
    creator: UsersEntity;
}
