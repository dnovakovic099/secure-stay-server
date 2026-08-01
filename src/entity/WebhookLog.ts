import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type WebhookDirection = "incoming" | "outgoing";

@Entity("webhook_logs")
@Index("idx_webhook_logs_direction_created", ["direction", "createdAt"])
@Index("idx_webhook_logs_source_created", ["source", "createdAt"])
@Index("idx_webhook_logs_status", ["statusCode"])
export class WebhookLog {
    @PrimaryGeneratedColumn({ type: "bigint" })
    id: string;

    @Column({ name: "direction", type: "varchar", length: 16 })
    direction: WebhookDirection;

    @Column({ name: "source", type: "varchar", length: 64 })
    source: string;

    @Column({ name: "event_type", type: "varchar", length: 128, nullable: true })
    eventType: string | null;

    @Column({ name: "url", type: "varchar", length: 1024 })
    url: string;

    @Column({ name: "method", type: "varchar", length: 10 })
    method: string;

    @Column({ name: "status_code", type: "smallint", nullable: true })
    statusCode: number | null;

    @Column({ name: "request_headers", type: "json", nullable: true })
    requestHeaders: any;

    @Column({ name: "request_query", type: "json", nullable: true })
    requestQuery: any;

    @Column({ name: "request_body", type: "mediumtext", nullable: true })
    requestBody: string | null;

    @Column({ name: "response_headers", type: "json", nullable: true })
    responseHeaders: any;

    @Column({ name: "response_body", type: "mediumtext", nullable: true })
    responseBody: string | null;

    @Column({ name: "duration_ms", type: "int", nullable: true })
    durationMs: number | null;

    @Column({ name: "error_message", type: "text", nullable: true })
    errorMessage: string | null;

    @Column({ name: "remote_ip", type: "varchar", length: 64, nullable: true })
    remoteIp: string | null;

    @CreateDateColumn({ name: "created_at" })
    @Index()
    createdAt: Date;
}
