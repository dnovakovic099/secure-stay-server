import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("utility_payment_method")
export class UtilityPaymentMethod {
    @PrimaryGeneratedColumn({ type: "int" })
    id: number;

    @Column({ type: "varchar", length: 120 })
    label: string;

    @Column({ type: "int", default: 0 })
    sortOrder: number;

    @Column({ type: "boolean", default: true })
    isActive: boolean;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;

    @DeleteDateColumn({ type: "timestamp", nullable: true })
    deletedAt: Date | null;

    @Column({ nullable: true })
    createdBy: string | null;

    @Column({ nullable: true })
    updatedBy: string | null;

    @Column({ nullable: true })
    deletedBy: string | null;
}
