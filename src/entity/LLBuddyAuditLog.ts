import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("ll_buddy_audit_logs")
export class LLBuddyAuditLogEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Index()
    @Column({ length: 80 })
    eventType: string;

    @Column({ length: 80, nullable: true })
    entityType: string | null;

    @Column({ length: 80, nullable: true })
    entityId: string | null;

    @Column("text", { nullable: true })
    summary: string | null;

    @Column("json", { nullable: true })
    details: Record<string, any> | null;

    @Column({ length: 120, nullable: true })
    createdBy: string | null;

    @CreateDateColumn()
    createdAt: Date;
}
