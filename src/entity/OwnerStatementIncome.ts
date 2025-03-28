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

@Entity("owner_statement_income")
export class OwnerStatementIncomeEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => OwnerStatementEntity, (ownerStatement) => ownerStatement.income)
    @JoinColumn({ name: "ownerStatementId" })
    ownerStatementId: number;

    @Column()
    guest: string;

    @Column()
    nights: number;

    @Column()
    checkInDate: string;

    @Column()
    checkOutDate: string;

    @Column()
    channel: number;

    @Column("decimal", { precision: 10, scale: 2, nullable: true })
    totalPaid: number;

    @Column("decimal", { precision: 10, scale: 2, nullable: true })
    ownerPayout: number;

    @Column("decimal", { precision: 10, scale: 2, nullable: true })
    pmCommission: number;

    @Column("decimal", { precision: 10, scale: 2, nullable:true })
    paymentProcessing: number;

    @Column("decimal", { precision: 10, scale: 2, nullable: true })
    channelFee: number;

    @Column("decimal", { precision: 10, scale: 2, nullable: true })
    totalTax: number;

    @Column("decimal", { precision: 10, scale: 2, nullable: true })
    revenue: number;

    @Column("decimal", { precision: 10, scale: 2, nullable: true })
    managementFee: number;

    @Column("decimal", { precision: 10, scale: 2, nullable: true })
    payout: number;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;

    @DeleteDateColumn({ type: "timestamp", nullable: true })
    deletedAt: Date;
}
