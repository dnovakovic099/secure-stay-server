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

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => SmartLockDevice, (device) => device.accessCodes)
  @JoinColumn({ name: "device_id" })
  device: SmartLockDevice;
}
