import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity("user_notification_settings")
export class UserNotificationSettingsEntity {
    @PrimaryColumn({ type: "varchar", length: 64 })
    userUid: string;

    @Column({ type: "tinyint", width: 1, default: 1 })
    notificationsEnabled: boolean;

    @Column({ type: "tinyint", width: 1, default: 1 })
    soundEnabled: boolean;

    @Column({ type: "tinyint", width: 1, default: 1 })
    notifyMessages: boolean;

    @Column({ type: "tinyint", width: 1, default: 1 })
    notifyReservations: boolean;

    @Column({ type: "tinyint", width: 1, default: 1 })
    notifyActionItems: boolean;

    @Column({ type: "datetime", nullable: true })
    lastSeenAt: Date | null;

    @CreateDateColumn({ type: "datetime" })
    createdAt: Date;

    @UpdateDateColumn({ type: "datetime" })
    updatedAt: Date;
}
