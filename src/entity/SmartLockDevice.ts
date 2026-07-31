import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { PropertyDevice } from "./PropertyDevice";
import { AccessCode } from "./AccessCode";

@Entity("smart_lock_devices")
export class SmartLockDevice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "external_device_id" })
  externalDeviceId: string;

  @Column()
  provider: string;

  @Column({ name: "connected_account_id", nullable: true })
  connectedAccountId: string;

  @Column({ name: "device_name", nullable: true })
  deviceName: string;

  @Column({ name: "device_type", nullable: true })
  deviceType: string;

  @Column({ nullable: true })
  manufacturer: string;

  @Column({ nullable: true })
  model: string;

  @Column({ name: "location_name", nullable: true })
  locationName: string;

  @Column({ name: "is_online", default: true })
  isOnline: boolean;

  @Column({ type: "json", nullable: true })
  capabilities: object;

  @Column({ name: "provider_metadata", type: "json", nullable: true })
  providerMetadata: object;

  @Column({ name: "last_synced_at", type: "timestamp", nullable: true })
  lastSyncedAt: Date;

  /** 0–1 decimal as reported by the provider, not a percentage. */
  @Column({
    name: "battery_level",
    type: "decimal",
    precision: 5,
    scale: 4,
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  batteryLevel: number;

  @Column({ name: "battery_status", nullable: true })
  batteryStatus: string;

  @Column({ name: "is_locked", type: "boolean", nullable: true })
  isLocked: boolean;

  @Column({ name: "serial_number", nullable: true })
  serialNumber: string;

  @Column({ name: "image_url", nullable: true })
  imageUrl: string;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string;

  @Column({ name: "last_error_at", type: "timestamp", nullable: true })
  lastErrorAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @OneToMany(() => PropertyDevice, (pd) => pd.device)
  propertyDevices: PropertyDevice[];

  @OneToMany(() => AccessCode, (ac) => ac.device)
  accessCodes: AccessCode[];
}
