// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, DeleteDateColumn, UpdateDateColumn } from 'typeorm';

// Define the entity class
@Entity({ name: 'users' })
export class UsersEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 50, nullable: false })
    uid: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    firstName: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    lastName: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    email: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    companyName: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    numberofProperties: number;

    @Column({ type: 'varchar', length: 255, nullable: true })
    message: string;

    @Column({ nullable: true })
    department: string;

    // User Management Fields
    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    @Column({ type: 'varchar', length: 50, nullable: true })
    authProvider: string; // 'email' | 'google'

    @Column({ type: 'varchar', length: 50, default: 'regular' })
    userType: string; // 'admin' | 'regular'

    @Column({ type: 'boolean', default: false })
    isSuperAdmin: boolean;

    @Column({ type: 'datetime', nullable: true })
    lastLoginAt: Date;

    @Column({ type: 'varchar', nullable: true })
    disabledBy: string; // UID of admin who disabled this user

    @Column({ type: 'datetime', nullable: true })
    disabledAt: Date;

    @Column({ type: 'varchar', nullable: true })
    reactivatedBy: string; // UID of admin who re-enabled this user

    @Column({ type: 'datetime', nullable: true })
    reactivatedAt: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @DeleteDateColumn({ nullable: true })
    deletedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ nullable: true })
    deletedBy: string;

    // Employee Settings
    @Column({ type: 'date', nullable: true })
    startDate: Date;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    hourlyRate: number;

    @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
    dailyHourLimit: number; // NULL means no limit

    @Column({ type: 'varchar', length: 50, nullable: true })
    offDays: string; // Comma-separated day indices (0=Sun, 1=Mon, etc.)

}