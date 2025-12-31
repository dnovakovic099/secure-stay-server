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
import { Listing } from "./Listing";

@Entity("property_devices")
export class PropertyDevice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "property_id" })
  propertyId: number;

  @Column({ name: "device_id" })
  deviceId: number;

  @Column({ name: "location_label", nullable: true })
  locationLabel: string;

  @Column({ name: "is_active", default: true })
  isActive: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => SmartLockDevice, (device) => device.propertyDevices)
  @JoinColumn({ name: "device_id" })
  device: SmartLockDevice;

  @ManyToOne(() => Listing)
  @JoinColumn({ name: "property_id" })
  property: Listing;
}
