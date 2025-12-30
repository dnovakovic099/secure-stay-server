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

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @OneToMany(() => PropertyDevice, (pd) => pd.device)
  propertyDevices: PropertyDevice[];

  @OneToMany(() => AccessCode, (ac) => ac.device)
  accessCodes: AccessCode[];
}
