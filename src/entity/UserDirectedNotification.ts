import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("user_directed_notifications")
export class UserDirectedNotificationEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ type: "varchar", length: 64 })
    userUid: string;

    @Column({ type: "varchar", length: 64, nullable: true })
    actorUid: string | null;

    @Column({ type: "varchar", length: 160, nullable: true })
    actorName: string | null;

    @Column({ type: "varchar", length: 40, default: "escalation" })
    type: string;

    @Column({ type: "varchar", length: 255 })
    title: string;

    @Column({ type: "text", nullable: true })
    body: string | null;

    @Column({ type: "varchar", length: 500 })
    href: string;

    @Column({ type: "bigint", nullable: true })
    threadId: number | null;

    @Column({ type: "bigint", nullable: true })
    messageExternalId: number | null;

    @Column({ type: "int", nullable: true })
    escalationId: number | null;

    @Column({ type: "datetime", nullable: true })
    readAt: Date | null;

    @CreateDateColumn({ type: "datetime" })
    createdAt: Date;
}
