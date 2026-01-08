// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { UsersEntity } from './Users';
import { DepartmentEntity } from './Department';

@Entity({ name: 'user_departments' })
export class UserDepartmentEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    userId: number;

    @Column()
    departmentId: number;

    @ManyToOne(() => UsersEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: UsersEntity;

    @ManyToOne(() => DepartmentEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'departmentId' })
    department: DepartmentEntity;

    @CreateDateColumn()
    createdAt: Date;

    @Column({ nullable: true })
    createdBy: string;
}
