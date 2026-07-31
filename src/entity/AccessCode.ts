import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { SmartLockDevice } from "./SmartLockDevice";

export enum AccessCodeStatus {
  PENDING = "pending",
  SCHEDULED = "scheduled",
  SET = "set",
  REMOVED = "removed",
  FAILED = "failed",
}

export enum AccessCodeSource {
  MANUAL = "manual",
  AUTOMATIC = "automatic",
}

@Entity("access_codes")
export class AccessCode {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "external_code_id", nullable: true })
  externalCodeId: string;

  @Column()
  provider: string;

  @Column({ name: "device_id" })
  deviceId: number;

  @Column({ name: "property_id" })
  propertyId: number;

  @Column({ name: "reservation_id", nullable: true })
  reservationId: number;

  @Column({ name: "guest_name", nullable: true })
  guestName: string;

  @Column({ name: "guest_phone", nullable: true })
  guestPhone: string;

  @Column()
  code: string;

  @Column({ name: "code_name", nullable: true })
  codeName: string;

  @Column({
    type: "enum",
    enum: AccessCodeStatus,
    default: AccessCodeStatus.PENDING,
  })
  status: AccessCodeStatus;

  @Column({ name: "scheduled_at", type: "timestamp", nullable: true })
  scheduledAt: Date;

  @Column({ name: "set_at", type: "timestamp", nullable: true })
  setAt: Date;

  @Column({ name: "provider_status", nullable: true })
  providerStatus: string;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage: string;

  @Column({ name: "provider_metadata", type: "json", nullable: true })
  providerMetadata: object;

  @Column({
    type: "enum",
    enum: AccessCodeSource,
    default: AccessCodeSource.MANUAL,
  })
  source: AccessCodeSource;

  @Column({ name: "check_in_date", type: "date", nullable: true })
  checkInDate: Date;

  @Column({ name: "check_out_date", type: "date", nullable: true })
  checkOutDate: Date;

  @Column({ name: "expires_at", type: "timestamp", nullable: true })
  expiresAt: Date;

  /** Operator email for manually pushed codes; null for scheduler-driven ones. */
  @Column({ name: "set_by", nullable: true })
  setBy: string;

  @Column({ name: "last_attempt_at", type: "timestamp", nullable: true })
  lastAttemptAt: Date;

  @Column({ name: "attempt_count", default: 0 })
  attemptCount: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => SmartLockDevice, (device) => device.accessCodes)
  @JoinColumn({ name: "device_id" })
  device: SmartLockDevice;
}
