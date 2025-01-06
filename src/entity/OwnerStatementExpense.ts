import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    DeleteDateColumn,
    ManyToOne,
    JoinColumn,
} from "typeorm";
import { OwnerStatementEntity } from "./OwnerStatement";

@Entity("owner_statement_expense")
export class OwnerStatementExpenseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => OwnerStatementEntity, (ownerStatement) => ownerStatement.expense)
    @JoinColumn({ name: "ownerStatementId" })
    ownerStatementId: number;

    @Column({ nullable: true })
    concept: string;

    @Column()
    date: string;

    @Column({ nullable: true })
    categories: string;

    @Column()
    listingId: number;

    @Column({ nullable: true })
    reservationId: number;

    @Column({ nullable: true })
    owner: string;

    @Column("decimal", { precision: 10, scale: 2 })
    amount: number;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;

    @DeleteDateColumn({ type: "timestamp", nullable: true })
    deletedAt: Date;
}
