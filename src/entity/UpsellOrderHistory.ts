import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "upsell_order_history" })
export class UpsellOrderHistoryEntity {
    @PrimaryGeneratedColumn({ type: "int" })
    id: number;

    @Column({ type: "int" })
    orderId: number;

    @Column({ type: "varchar", length: 100 })
    fieldName: string;

    @Column({ type: "text", nullable: true })
    oldValue: string | null;

    @Column({ type: "text", nullable: true })
    newValue: string | null;

    @Column({ type: "varchar", length: 255 })
    changedBy: string;

    @Column({ type: "varchar", length: 50, default: "UPDATE" })
    action: "CREATE" | "UPDATE" | "DELETE";

    @CreateDateColumn({ type: "timestamp" })
    changedAt: Date;
}
