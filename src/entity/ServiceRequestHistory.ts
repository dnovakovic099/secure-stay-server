import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "service_request_history" })
export class ServiceRequestHistory {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: "request_type", type: "varchar", length: 40 })
    requestType: string;

    @Column({ name: "request_id", type: "int" })
    requestId: number;

    @Column({ type: "varchar", length: 40 })
    action: string;

    @Column({ name: "field_name", type: "varchar", length: 120, nullable: true })
    fieldName: string | null;

    @Column({ name: "field_label", type: "varchar", length: 160, nullable: true })
    fieldLabel: string | null;

    @Column({ name: "from_value", type: "text", nullable: true })
    fromValue: string | null;

    @Column({ name: "to_value", type: "text", nullable: true })
    toValue: string | null;

    @Column({ name: "created_by", type: "varchar", length: 255, nullable: true })
    createdBy: string | null;

    @CreateDateColumn({ name: "created_at", type: "timestamp" })
    createdAt: Date;
}
