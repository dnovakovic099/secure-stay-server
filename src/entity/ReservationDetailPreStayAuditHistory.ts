import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "reservation_detail_pre_stay_audit_history" })
export class ReservationDetailPreStayAuditHistory {
    @PrimaryGeneratedColumn({ type: "int" })
    id: number;

    @Column({ type: "bigint" })
    reservationId: number;

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
