import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type ReservationAICopilotMessageRole = "user" | "assistant";

export interface ReservationAICopilotEvidenceItem {
    type:
        | "reservation_summary"
        | "operational_flag"
        | "communication"
        | "phase_summary"
        | "property_pattern"
        | "category_pattern"
        | "department_pattern"
        | "review_detail"
        | "linked_issue"
        | "refund_request"
        | "expense_log"
        | "discussion_update";
    label: string;
    detail: string;
    reservationId?: number | null;
    timestamp?: string | null;
    phase?: string | null;
    category?: string | null;
    department?: string | null;
    polarity?: "positive" | "negative" | null;
}

@Entity("reservation_ai_copilot_threads")
export class ReservationAICopilotThreadEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Index()
    @Column()
    reservationId: number;

    @Column({ length: 180, default: "Reservation AI Copilot" })
    name: string;

    @Column({ type: "boolean", default: true })
    isActive: boolean;

    @Column({ type: "datetime", nullable: true })
    lastRefreshedAt: Date | null;

    @Column({ length: 255, nullable: true })
    createdBy: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

@Entity("reservation_ai_copilot_messages")
export class ReservationAICopilotMessageEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Index()
    @Column({ length: 36 })
    threadId: string;

    @Index()
    @Column()
    reservationId: number;

    @Column({ length: 16 })
    role: ReservationAICopilotMessageRole;

    @Column("longtext")
    content: string;

    @Column("json", { nullable: true })
    evidenceItems: ReservationAICopilotEvidenceItem[] | null;

    @Column("json", { nullable: true })
    contextMeta: Record<string, any> | null;

    @Column({ length: 255, nullable: true })
    createdBy: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
