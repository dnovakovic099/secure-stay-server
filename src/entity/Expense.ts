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

    @Column({ type: 'varchar', nullable: true })
    contractorNumber: string;

    @Column({ type: 'varchar', nullable: true })
    dateOfWork: string;

    @Column({ type: 'varchar', nullable: true })
    datePaid: string;

    @Column({ type: 'text', nullable: true })
    findings: string;

    @Column({ type: 'text'})
    fileNames: string;

    @Column({ type: "enum", enum: ExpenseStatus, default: ExpenseStatus.PENDING })
    status: ExpenseStatus;

    @Column()
    userId: string;

    @Column({ type: 'varchar', nullable: true })
    paymentMethod: string;

    @Column({ nullable: true })
    issues: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ type: "tinyint", default: 0 })
    isRecurring: number;

    @Column({ nullable: true })
    comesFrom: string;

    @Column({ nullable: true })
    reservationId: string;

    @Column({ nullable: true })
    guestName: string;
}