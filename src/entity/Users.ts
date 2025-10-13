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

}