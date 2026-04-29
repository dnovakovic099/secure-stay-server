import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type ClaimActivityLogType = "system" | "field_change" | "discussion" | "slack";

@Entity({ name: "claim_activity_logs" })
@Index("idx_claim_activity_claim", ["claimId"])
export class ClaimActivityLogEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "int", name: "claim_id" })
    claimId: number;

    @Column({ type: "varchar", length: 30, name: "type" })
    type: ClaimActivityLogType;

    @Column({ type: "varchar", length: 100, nullable: true, name: "actor_id" })
    actorId: string | null;

    @Column({ type: "varchar", length: 255, nullable: true, name: "actor_name" })
    actorName: string | null;

    @Column({ type: "varchar", length: 255, nullable: true, name: "title" })
    title: string | null;

    @Column({ type: "text", name: "content" })
    content: string;

    @Column({ type: "json", nullable: true, name: "metadata" })
    metadata: Record<string, any> | null;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;
}
