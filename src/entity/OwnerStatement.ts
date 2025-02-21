import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    DeleteDateColumn,
    OneToMany,
} from "typeorm";
import { OwnerStatementIncomeEntity } from "./OwnerStatementIncome";
import { OwnerStatementExpenseEntity } from "./OwnerStatementExpense";

@Entity("owner_statements")
export class OwnerStatementEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    fromDate: string;

    @Column()
    toDate: string;

    @Column()
    dateType: string;

    @Column({ nullable: true })
    channel: string;

    @Column()
    listingId: string;

    @Column({ nullable: true })
    ownerName: string;

    @Column({ nullable: true })
    paymentStatus: string;

    @Column({ nullable: true })
    invoiceNo: string;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;

    @DeleteDateColumn({ type: "timestamp", nullable: true })
    deletedAt: Date;

    @OneToMany(() => OwnerStatementIncomeEntity, (income) => income.ownerStatementId)
    income: OwnerStatementIncomeEntity[];

    @OneToMany(() => OwnerStatementExpenseEntity, (income) => income.ownerStatementId)
    expense: OwnerStatementExpenseEntity[];

    @Column()
    userId: string;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}
