import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

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

    @Column({ type: "json", nullable: true })
    categories: string;

    @Column({ type: "json", nullable: true })
    categoriesNames: string;

    @Column({ type: 'varchar' })
    contractorName: string;

    @Column({ type: 'varchar' })
    contractorNumber: string;

    @Column({ type: 'varchar' })
    dateOfWork: string;

    @Column({ type: 'text' })
    findings: string;

    @Column()
    userId: string;
}