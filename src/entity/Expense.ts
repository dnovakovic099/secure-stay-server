import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum ExpenseStatus {
    PENDING = 'Pending Approval',
    APPROVED = 'Approved',
    PAID = 'Paid',
    OVERDUE = 'Overdue'
}

@Entity('expense')
export class ExpenseEntity {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ type: "int", nullable: true })
    expenseId: number;

    @Column({ type: "int", nullable: true })
    listingMapId: number;

    @Column({ type: 'varchar' })
    expenseDate: string;

    @Column({ type: 'varchar', length: 255 })
    concept: string;

    @Column({ type: 'float' })
    amount: number;

    @Column({ type: "int" })
    isDeleted: number;

    @Column({ type: "text", nullable: true })
    categories: string;

    @Column({ type: 'varchar' })
    contractorName: string;

    @Column({ type: 'varchar' })
    contractorNumber: string;

    @Column({ type: 'varchar' })
    dateOfWork: string;

    @Column({ type: 'text' })
    findings: string;

    @Column({ type: 'text'})
    fileNames: string;

    @Column({ type: "enum", enum: ExpenseStatus, default: ExpenseStatus.PENDING })
    status: ExpenseStatus;

    @Column()
    userId: string;

    @Column({ type: 'varchar', nullable: true })
    paymentMethod: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}